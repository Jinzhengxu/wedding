#!/usr/bin/env node
/**
 * 婚礼邀请函 · 极简后端
 *
 *   - 托管 site/ 下的静态文件（带缓存头与 gzip）
 *   - POST /api/rsvp    宾客回执
 *   - GET  /api/wishes  祝福留言列表
 *   - POST /api/wishes  提交祝福
 *   - GET  /admin       管理后台（看回执 / 导出 CSV / 隐藏留言）
 *
 * 零依赖，Node 18+。数据以 JSONL 追加写入 server/data/，方便备份和肉眼检查。
 *
 *   node server/server.js            默认 127.0.0.1:8080
 *   PORT=3000 HOST=0.0.0.0 node server/server.js
 */

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = path.resolve(__dirname, '..');            // site/
const DATA = path.join(__dirname, 'data');
const RSVP_FILE = path.join(DATA, 'rsvp.jsonl');
const WISH_FILE = path.join(DATA, 'wishes.jsonl');
const MOD_FILE = path.join(DATA, 'moderation.jsonl');  // 隐藏/恢复留言的操作流水
const KEY_FILE = path.join(DATA, 'admin-key.txt');

// 留言是否需要先审核再显示。默认关（发出即可见，但过敏感词 + 管理员可随时隐藏）。
const PREMODERATE = process.env.PREMODERATE === '1';

fs.mkdirSync(DATA, { recursive: true });

// ---------------------------------------------------------------- 管理密钥
let ADMIN_KEY = process.env.ADMIN_KEY;
if (!ADMIN_KEY) {
  if (fs.existsSync(KEY_FILE)) {
    ADMIN_KEY = fs.readFileSync(KEY_FILE, 'utf8').trim();
  } else {
    ADMIN_KEY = crypto.randomBytes(12).toString('base64url');
    fs.writeFileSync(KEY_FILE, ADMIN_KEY + '\n', { mode: 0o600 });
  }
}

// ---------------------------------------------------------------- 小工具
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.txt': 'text/plain; charset=utf-8',
};

const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.json', '.svg', '.txt']);

function send(res, code, body, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  res.writeHead(code, {
    'Content-Length': buf.length,
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(buf);
}

function json(res, code, obj, headers = {}) {
  send(res, code, JSON.stringify(obj), {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
}

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim();
  return req.socket.remoteAddress || '?';
}

/** 去掉控制字符、压缩连续空白、截断。 */
function clean(v, max) {
  if (typeof v !== 'string') return '';
  return v
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u2028\u2029\uFEFF]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function readBody(req, limit = 16 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) { req.destroy(); throw new Error('body too large'); }
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// ---------------------------------------------------------------- 限流
// 每 IP 的令牌桶：写接口比较宽松，够用就行——这是婚礼请柬，不是银行。
const buckets = new Map();
function rateLimit(ip, cost = 1, capacity = 30, refillPerMin = 15) {
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b) { b = { tokens: capacity, ts: now }; buckets.set(ip, b); }
  b.tokens = Math.min(capacity, b.tokens + ((now - b.ts) / 60000) * refillPerMin);
  b.ts = now;
  if (b.tokens < cost) return false;
  b.tokens -= cost;
  return true;
}
setInterval(() => {
  const cut = Date.now() - 30 * 60 * 1000;
  for (const [k, v] of buckets) if (v.ts < cut) buckets.delete(k);
}, 10 * 60 * 1000).unref();

// ---------------------------------------------------------------- 敏感词
// 只做最基本的拦截：广告、辱骂、政治敏感的一小撮。婚礼场景真正的防线是管理员能一键隐藏。
const BLOCKLIST = [
  '加微信', '加v信', '代开发票', '办证', '博彩', '赌场', '菠菜网', '色情', '开票',
  '贷款', '刷单', '兼职日结', '推广', 'http://', 'https://', 'www.',
  '傻逼', '煞笔', 'sb玩意', '去死', '死全家', '狗东西', '婊子', '操你',
];
function looksSpammy(text) {
  const t = text.toLowerCase().replace(/\s/g, '');
  for (const w of BLOCKLIST) if (t.includes(w.toLowerCase())) return w;
  // 连续 8 位以上数字（电话/QQ/微信号）
  if (/\d{8,}/.test(t)) return '长数字串';
  return null;
}

// ---------------------------------------------------------------- 存取
async function append(file, obj) {
  await fsp.appendFile(file, JSON.stringify(obj) + '\n', 'utf8');
}

async function readJsonl(file) {
  let raw;
  try { raw = await fsp.readFile(file, 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* 跳过坏行，别让一行毁掉整个文件 */ }
  }
  return out;
}

/** 把留言流水 + 审核流水合并成当前状态。 */
async function currentWishes() {
  const wishes = await readJsonl(WISH_FILE);
  const mods = await readJsonl(MOD_FILE);
  const state = new Map();
  for (const w of wishes) state.set(w.id, { ...w });
  for (const m of mods) {
    const w = state.get(m.id);
    if (w) w.hidden = m.action === 'hide';
  }
  return [...state.values()];
}

// ---------------------------------------------------------------- API
async function handleApi(req, res, url) {
  const ip = clientIp(req);

  // ------- 提交回执
  if (url.pathname === '/api/rsvp' && req.method === 'POST') {
    if (!rateLimit(ip, 1)) return json(res, 429, { ok: false, error: '点得太快啦，歇一分钟再试' });
    let body;
    try { body = JSON.parse(await readBody(req)); }
    catch { return json(res, 400, { ok: false, error: '请求格式不对' }); }

    const name = clean(body.name, 20);
    if (name.length < 1) return json(res, 400, { ok: false, error: '请留下您的称呼' });

    const attending = body.attending === 'no' ? 'no' : 'yes';
    let guests = Number.parseInt(body.guests, 10);
    if (!Number.isFinite(guests) || guests < 1) guests = 1;
    if (guests > 20) guests = 20;
    if (attending === 'no') guests = 0;

    const side = ['男方', '女方', '双方好友'].includes(body.side) ? body.side : '';
    const phone = clean(body.phone, 20).replace(/[^\d+\- ]/g, '');
    const note = clean(body.note, 200);

    const rec = {
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      name, attending, guests, side, phone, note,
      ip: crypto.createHash('sha256').update(ip).digest('hex').slice(0, 12), // 只存指纹，不存明文 IP
      ua: clean(req.headers['user-agent'] || '', 160),
    };
    await append(RSVP_FILE, rec);
    return json(res, 200, { ok: true });
  }

  // ------- 读留言
  if (url.pathname === '/api/wishes' && req.method === 'GET') {
    const all = (await currentWishes())
      .filter((w) => !w.hidden && w.approved !== false)
      .sort((a, b) => (a.ts < b.ts ? 1 : -1))
      .slice(0, 200)
      .map((w) => ({ id: w.id, name: w.name, text: w.text, ts: w.ts }));
    return json(res, 200, { ok: true, wishes: all, premoderate: PREMODERATE });
  }

  // ------- 写留言
  if (url.pathname === '/api/wishes' && req.method === 'POST') {
    if (!rateLimit(ip, 2)) return json(res, 429, { ok: false, error: '留言太频繁了，歇口气再说' });
    let body;
    try { body = JSON.parse(await readBody(req)); }
    catch { return json(res, 400, { ok: false, error: '请求格式不对' }); }

    const name = clean(body.name, 20);
    const text = clean(body.text, 140);
    if (name.length < 1) return json(res, 400, { ok: false, error: '请留下您的称呼' });
    if (text.length < 2) return json(res, 400, { ok: false, error: '祝福至少写两个字呀' });

    const bad = looksSpammy(name + text);
    const rec = {
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      name, text,
      approved: bad ? false : !PREMODERATE,
      flag: bad || '',
      ip: crypto.createHash('sha256').update(ip).digest('hex').slice(0, 12),
    };
    await append(WISH_FILE, rec);

    if (bad) return json(res, 200, { ok: true, pending: true, reason: '已收到，新人确认后会显示' });
    if (PREMODERATE) return json(res, 200, { ok: true, pending: true });
    return json(res, 200, { ok: true, wish: { id: rec.id, name, text, ts: rec.ts } });
  }

  return json(res, 404, { ok: false, error: 'not found' });
}

// ---------------------------------------------------------------- 管理后台
function adminAuthed(url, req) {
  const k = url.searchParams.get('key') || req.headers['x-admin-key'] || '';
  if (k.length !== ADMIN_KEY.length) return false;
  return crypto.timingSafeEqual(Buffer.from(k), Buffer.from(ADMIN_KEY));
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function handleAdmin(req, res, url) {
  if (!adminAuthed(url, req)) {
    return send(res, 403, '403 — 需要正确的 ?key=', { 'Content-Type': 'text/plain; charset=utf-8' });
  }

  // 隐藏 / 恢复留言
  if (url.pathname === '/admin/moderate' && req.method === 'POST') {
    const body = new URLSearchParams(await readBody(req));
    const id = body.get('id');
    const action = body.get('action') === 'show' ? 'show' : 'hide';
    if (id) await append(MOD_FILE, { id, action, ts: new Date().toISOString() });
    return send(res, 303, '', { Location: '/admin?key=' + encodeURIComponent(ADMIN_KEY) + '#wishes' });
  }

  const rsvps = await readJsonl(RSVP_FILE);
  // 同一个名字重复提交时以最后一次为准
  const latest = new Map();
  for (const r of rsvps) latest.set(r.name + '|' + (r.phone || ''), r);
  const rows = [...latest.values()].sort((a, b) => (a.ts < b.ts ? 1 : -1));

  // CSV 导出
  if (url.pathname === '/admin/rsvp.csv') {
    const head = ['提交时间', '称呼', '出席', '人数', '来自', '电话', '留言'];
    const lines = [head.join(',')];
    for (const r of rows) {
      lines.push([
        new Date(r.ts).toLocaleString('zh-CN', { hour12: false }),
        r.name, r.attending === 'yes' ? '出席' : '不能来', r.guests, r.side, r.phone, r.note,
      ].map(csvCell).join(','));
    }
    return send(res, 200, '﻿' + lines.join('\n'), {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="rsvp.csv"',
      'Cache-Control': 'no-store',
    });
  }

  const wishes = (await currentWishes()).sort((a, b) => (a.ts < b.ts ? 1 : -1));
  const coming = rows.filter((r) => r.attending === 'yes');
  const heads = coming.reduce((n, r) => n + (r.guests || 1), 0);
  const t = (iso) => new Date(iso).toLocaleString('zh-CN', { hour12: false });
  const k = encodeURIComponent(ADMIN_KEY);

  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>婚礼后台 · 金正旭 & 刘俊懿</title>
<style>
 :root{color-scheme:light dark}
 body{font:15px/1.6 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;margin:0;padding:24px;max-width:1000px;margin-inline:auto}
 h1{font-size:20px;margin:0 0 4px} h2{font-size:16px;margin:32px 0 10px;padding-top:12px;border-top:1px solid #8883}
 .stat{display:flex;gap:24px;flex-wrap:wrap;margin:16px 0;padding:14px 18px;background:#8881;border-radius:10px}
 .stat b{display:block;font-size:26px;font-weight:600;line-height:1.2}
 .stat span{font-size:12px;opacity:.65}
 table{border-collapse:collapse;width:100%;font-size:14px}
 th,td{text-align:left;padding:7px 10px;border-bottom:1px solid #8883;vertical-align:top}
 th{font-weight:600;font-size:12px;opacity:.7;white-space:nowrap}
 td.no{opacity:.45}
 .muted{opacity:.55;font-size:12px}
 a.btn,button{font:inherit;font-size:13px;padding:5px 12px;border:1px solid #8886;border-radius:7px;background:transparent;color:inherit;text-decoration:none;cursor:pointer}
 .flag{color:#c0392b;font-size:12px}
 .hidden td{opacity:.4}
 form{display:inline}
 .overflow{overflow-x:auto}
</style></head><body>
<h1>婚礼后台</h1>
<div class="muted">金正旭 &amp; 刘俊懿 · 2026.09.26 · 济南美悦云禧 5F 云颂厅</div>

<div class="stat">
  <div><b>${coming.length}</b><span>确认出席（份数）</span></div>
  <div><b>${heads}</b><span>预计到场人数</span></div>
  <div><b>${rows.length - coming.length}</b><span>无法到场</span></div>
  <div><b>${wishes.filter((w) => !w.hidden).length}</b><span>祝福留言</span></div>
</div>

<h2>宾客回复 <a class="btn" href="/admin/rsvp.csv?key=${k}">导出 CSV</a></h2>
<div class="overflow"><table>
<tr><th>时间</th><th>称呼</th><th>出席</th><th>人数</th><th>来自</th><th>电话</th><th>留言</th></tr>
${rows.length === 0 ? '<tr><td colspan="7" class="muted">还没有人回复</td></tr>' : ''}
${rows.map((r) => `<tr class="${r.attending === 'yes' ? '' : 'no'}">
<td class="muted">${esc(t(r.ts))}</td><td>${esc(r.name)}</td>
<td>${r.attending === 'yes' ? '✓ 出席' : '— 不能来'}</td>
<td>${r.attending === 'yes' ? r.guests : ''}</td>
<td>${esc(r.side)}</td><td>${esc(r.phone)}</td><td>${esc(r.note)}</td></tr>`).join('\n')}
</table></div>

<h2 id="wishes">祝福留言</h2>
<div class="overflow"><table>
<tr><th>时间</th><th>称呼</th><th>祝福</th><th>状态</th><th></th></tr>
${wishes.length === 0 ? '<tr><td colspan="5" class="muted">还没有留言</td></tr>' : ''}
${wishes.map((w) => {
    const shown = !w.hidden && w.approved !== false;
    return `<tr class="${shown ? '' : 'hidden'}">
<td class="muted">${esc(t(w.ts))}</td><td>${esc(w.name)}</td><td>${esc(w.text)}</td>
<td>${shown ? '显示中' : '<span class="flag">已隐藏</span>'}${w.flag ? ` <span class="flag">[${esc(w.flag)}]</span>` : ''}</td>
<td><form method="post" action="/admin/moderate?key=${k}">
<input type="hidden" name="id" value="${esc(w.id)}">
<input type="hidden" name="action" value="${shown ? 'hide' : 'show'}">
<button>${shown ? '隐藏' : '恢复'}</button></form></td></tr>`;
  }).join('\n')}
</table></div>

<p class="muted" style="margin-top:32px">数据文件：<code>server/data/rsvp.jsonl</code> · <code>server/data/wishes.jsonl</code>（直接备份这两个文件即可）</p>
</body></html>`;

  return send(res, 200, html, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
}

// ---------------------------------------------------------------- 静态文件
async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep) && file !== path.join(ROOT, 'index.html')) {
    return send(res, 403, 'forbidden');
  }

  let stat;
  try { stat = await fsp.stat(file); }
  catch { return send(res, 404, '404 — 页面不存在', { 'Content-Type': 'text/plain; charset=utf-8' }); }
  if (stat.isDirectory()) return serveStatic(req, res, new URL(url.pathname + '/index.html', 'http://x'));

  const ext = path.extname(file).toLowerCase();
  const etag = `W/"${stat.size}-${stat.mtimeMs.toString(36)}"`;
  if (req.headers['if-none-match'] === etag) return send(res, 304, '');

  // 图片/字体/音频内容稳定，长缓存。
  // HTML / CSS / JS 一律 no-cache：不是不缓存，是每次带 ETag 校验，没变就 304。
  // 新人改一行文案之后，亲友拿到的是旧样式表 —— 这个代价比一次 304 大得多。
  const immutable = ['.webp', '.jpg', '.jpeg', '.png', '.woff2', '.woff', '.mp3', '.m4a'].includes(ext);
  const cache = immutable ? 'public, max-age=31536000' : 'no-cache';

  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': cache,
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
  };

  const accepts = String(req.headers['accept-encoding'] || '');
  if (COMPRESSIBLE.has(ext) && /\bgzip\b/.test(accepts) && stat.size > 512) {
    const raw = await fsp.readFile(file);
    const gz = zlib.gzipSync(raw, { level: 8 });
    return send(res, 200, gz, { ...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' });
  }

  headers['Content-Length'] = stat.size;
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
}

// ---------------------------------------------------------------- 入口
const server = http.createServer(async (req, res) => {
  // req.url 是外部输入，解析必须在 try 里。「GET //」这种就足以让 new URL 抛错
  // （被当成缺主机名的协议相对 URL），而它原先抛在 try 外面 —— 未捕获异常，
  // 整个进程退出，站点直接挂掉。谁都能拿一行 curl 反复把它打下去。
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    return send(res, 400, 'bad request');
  }

  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (url.pathname.startsWith('/admin')) return await handleAdmin(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');
    return await serveStatic(req, res, url);
  } catch (err) {
    console.error('[error]', req.method, url.pathname, err && err.message);
    if (!res.headersSent) send(res, 500, '500');
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  婚礼邀请函  http://${HOST}:${PORT}/`);
  console.log(`  管理后台    http://${HOST}:${PORT}/admin?key=${ADMIN_KEY}`);
  console.log(`  数据目录    ${DATA}`);
  console.log(`  留言${PREMODERATE ? '需先审核（PREMODERATE=1）' : '发出即显示（管理员可隐藏）'}\n`);
});
