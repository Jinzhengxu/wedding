/* ============================================================================
   金正旭 · 刘俊懿  婚礼请柬
   ---------------------------------------------------------------------------
   工程约定（改之前先读）：

   · HTML 的默认状态 = 动画的终态。初始隐藏只写在 CSS 的 html.js 选择器下。
     这个文件整个挂掉、IntersectionObserver 不被支持、脚本被运营商劫持，
     页面依然是完整可读的静态页。表单带真实 action，导航是真实 <a href>，
     折叠用原生 <details> —— JS 只做接管，不做承载。

   · 不监听 scroll 事件驱动动画（微信 X5 惯性滑动期间回调节流极粗）。
     一律用 IntersectionObserver，命中即 unobserve。

   · 用户输入内容一律 textContent 渲染，绝不 innerHTML。

   · 倒计时分钟级 tick，切后台就停 —— 每秒重排在低端安卓上掉帧，
     而且跳秒对长辈是干扰。
   ========================================================================== */
(function () {
  'use strict';

  var doc = document;
  var html = doc.documentElement;
  html.classList.add('js');

  var $ = function (s, r) { return (r || doc).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || doc).querySelectorAll(s)); };

  // ------------------------------------------------------------ 能力判定
  // 不用机型 UA 正则（Redmi [1-8] 这类名单太脆），用真实的能力信号。
  var reduce = false;
  try { reduce = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  var lite = reduce
    || (navigator.deviceMemory || 4) < 4
    || (navigator.hardwareConcurrency || 8) <= 4
    || (/X5|MQQBrowser/i.test(navigator.userAgent) && screen.width <= 360);

  html.classList.add(lite ? 'lite' : 'motion');

  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };

  // ------------------------------------------------------------ 入场
  if (!lite && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        en.target.classList.add('in');
        io.unobserve(en.target);          // 一次性，不做进出反复动画
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -10% 0px' });

    $$('.reveal').forEach(function (el, i) {
      el.style.setProperty('--d', (i % 3) * 70 + 'ms');
      io.observe(el);
    });
  } else {
    $$('.reveal').forEach(function (el) { el.classList.add('in'); });
  }

  // ------------------------------------------------------------ 图片
  // LQIP 铺在占位 div 的背景上，真图 decode 完成后再淡入。
  // blur 值绝不做动画 —— 那是 X5 上掉帧的头号来源。
  $$('.ph img').forEach(function (img) {
    var done = function () {
      img.classList.add('ready');
      var box = img.closest('.ph');
      if (box) box.style.backgroundImage = 'none';
    };
    if (img.complete && img.naturalWidth) { done(); return; }
    if (img.decode) { img.decode().then(done).catch(done); }
    else { img.addEventListener('load', done); img.addEventListener('error', done); }
  });

  // ------------------------------------------------------------ 倒计时 + 月环
  // 环走满整整一年：2025-09-26 → 2026-09-26，婚礼当天恰好闭合成满月。
  var WEDDING   = new Date('2026-09-26T12:18:00+08:00').getTime();
  var DAY_START = new Date('2026-09-26T00:00:00+08:00').getTime();
  var DAY_END   = new Date('2026-09-27T00:00:00+08:00').getTime();
  var RING_FROM = new Date('2025-09-26T12:18:00+08:00').getTime();
  var CIRC = 289.03;   // 2πr, r = 46

  var ring = $('#ring'), prog = $('#ringProg');
  var cdNum = $('#cdNum'), cdUnit = $('#cdUnit'), cdMid = $('#ringMid');

  function digits(n) {
    // EB Garamond 没有等宽数字，逐位锁宽，否则每分钟宽度抖一下
    cdNum.textContent = '';
    String(n).split('').forEach(function (c) {
      var i = doc.createElement('i');
      i.textContent = c;
      cdNum.appendChild(i);
    });
  }

  function say(text) {
    cdMid.textContent = '';
    var s = doc.createElement('span');
    s.className = 'done';
    s.textContent = text;
    cdMid.appendChild(s);
  }

  function tick() {
    var now = Date.now();
    if (now >= DAY_END) { say('承蒙厚爱\n谢谢诸亲'); return false; }
    if (now >= DAY_START) { say('今日\n花好月圆'); if (ring) ring.classList.add('full'); return false; }

    var left = WEDDING - now;
    var d = Math.ceil(left / 86400000);
    if (d >= 1) { digits(d); cdUnit.textContent = '天'; }
    else {
      var h = Math.floor(left / 3600000);
      digits(h); cdUnit.textContent = '小时';
    }
    return true;
  }

  if (cdNum) {
    var alive = tick();
    var timer = null;
    var start = function () { if (alive && !timer) timer = setInterval(function () { alive = tick(); }, 60000); };
    var stop = function () { if (timer) { clearInterval(timer); timer = null; } };
    start();
    doc.addEventListener('visibilitychange', function () {
      if (doc.hidden) stop(); else { alive = tick(); start(); }
    });
  }

  if (prog) {
    var p = (Date.now() - RING_FROM) / (WEDDING - RING_FROM);
    p = Math.max(0, Math.min(1, p));
    var draw = function () { prog.style.strokeDashoffset = (CIRC * (1 - p)).toFixed(2); };
    if (lite) { draw(); }
    else if ('IntersectionObserver' in window) {
      var ro = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) { draw(); ro.unobserve(e.target); } });
      }, { threshold: 0.4 });
      ro.observe(ring);
    } else { draw(); }
    if (p >= 1 && ring) ring.classList.add('full');
  }

  // ------------------------------------------------------------ 复制地址
  // 三级降级。X5 上 execCommand 比 Clipboard API 可靠，
  // iOS WKWebView 必须走 setSelectionRange 那一步。
  function copyText(text) {
    return new Promise(function (resolve) {
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(function () { resolve(true); },
                                                  function () { resolve(legacy()); });
        return;
      }
      resolve(legacy());

      function legacy() {
        try {
          var ta = doc.createElement('textarea');
          ta.value = text;
          ta.setAttribute('readonly', '');
          ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
          doc.body.appendChild(ta);
          ta.focus();
          ta.select();
          if (ta.setSelectionRange) ta.setSelectionRange(0, 99999);
          var ok = doc.execCommand('copy');
          doc.body.removeChild(ta);
          return ok;
        } catch (e) { return false; }
      }
    });
  }

  var copyBtn = $('#copyAddr');
  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      var addr = ($('#addrText').textContent || '').trim() + ' 美悦云禧酒店 5楼云颂厅';
      copyText(addr).then(function (ok) {
        // 微信里 fixed toast 常被键盘顶飞，所以在按钮上原地反馈
        var old = copyBtn.textContent;
        copyBtn.textContent = ok ? '已复制' : '请长按上方地址复制';
        if (ok) copyBtn.classList.add('btn--solid');
        setTimeout(function () {
          copyBtn.textContent = old;
          copyBtn.classList.remove('btn--solid');
        }, 1800);
      });
    });
  }

  // ------------------------------------------------------------ 平滑滚动
  // 禁用 scroll-behavior:smooth（X5 上卡），自写 rAF tween。
  function scrollTo(target) {
    var to = target.getBoundingClientRect().top + window.pageYOffset - 12;
    if (lite || !window.requestAnimationFrame) { window.scrollTo(0, to); return; }
    var from = window.pageYOffset, d = to - from, t0 = null, dur = 520;
    requestAnimationFrame(function step(t) {
      if (t0 === null) t0 = t;
      var k = Math.min(1, (t - t0) / dur);
      var e = 1 - Math.pow(1 - k, 3);
      window.scrollTo(0, from + d * e);
      if (k < 1) requestAnimationFrame(step);
    });
  }

  $$('a[href^="#"]').forEach(function (a) {
    a.addEventListener('click', function (ev) {
      var el = doc.getElementById(a.getAttribute('href').slice(1));
      if (!el) return;
      ev.preventDefault();
      scrollTo(el);
    });
  });

  // ------------------------------------------------------------ 回喜帖圆钮
  var tie = $('#tie'), backtop = $('#backtop');
  if (tie && backtop && 'IntersectionObserver' in window) {
    // 帖芯本来就在第二屏，这个钮只是保险 —— 长辈的逃生梯
    var sentinel = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        backtop.classList.toggle('on', !e.isIntersecting && e.boundingClientRect.top < 0);
      });
    }, { threshold: 0 });
    sentinel.observe(tie);
    $('#backtopBtn').addEventListener('click', function () { scrollTo(tie); });
  }
  // 表单在视口里时收起，别挡住提交按钮
  ['#rsvp', '#wish'].forEach(function (sel) {
    var el = $(sel);
    if (!el || !('IntersectionObserver' in window) || !backtop) return;
    new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) backtop.classList.remove('on'); });
    }, { threshold: 0.1 }).observe(el);
  });

  // ------------------------------------------------------------ 音乐
  // 微信会拦截自动播放。绝不在 load 时调 play() —— 失败的 play() 在部分 X5 上
  // 会打控制台错误并触发一次布局。只在用户点击后才 load + play。
  var audio = $('#bgm'), mBtn = $('#musicBtn'), nudge = $('#nudge');
  if (audio && mBtn) {
    var playing = false, fade = null;

    function icon() {
      mBtn.textContent = '';
      var s = doc.createElement('span');
      s.className = playing ? 'ico-pause' : 'ico-play';
      s.setAttribute('aria-hidden', 'true');
      if (playing) { s.appendChild(doc.createElement('i')); s.appendChild(doc.createElement('i')); }
      mBtn.appendChild(s);
      mBtn.setAttribute('aria-pressed', playing ? 'true' : 'false');
      mBtn.setAttribute('aria-label', playing ? '暂停背景音乐' : '播放背景音乐');
    }

    function fadeIn() {
      // 不用 Web Audio，X5 兼容差
      if (fade) clearInterval(fade);
      audio.volume = 0;
      var v = 0;
      fade = setInterval(function () {
        v += 0.5 / 16;
        if (v >= 0.5) { v = 0.5; clearInterval(fade); fade = null; }
        try { audio.volume = v; } catch (e) {}
      }, 50);
    }

    mBtn.addEventListener('click', function () {
      if (playing) { audio.pause(); playing = false; icon(); return; }
      audio.load();
      var pr = audio.play();
      if (pr && pr.then) {
        pr.then(function () { playing = true; icon(); fadeIn(); })
          .catch(function () { playing = false; icon(); });   // 静默失败，不弹窗
      } else { playing = true; icon(); fadeIn(); }
      if (nudge) nudge.classList.remove('on');
      store.set('bgm_hint', '1');
    });

    audio.addEventListener('pause', function () { if (playing) { playing = false; icon(); } });
    doc.addEventListener('visibilitychange', function () {
      if (doc.hidden && playing) { audio.pause(); }   // 切后台自动暂停，保留进度
    });

    if (nudge && !store.get('bgm_hint')) {
      setTimeout(function () {
        nudge.classList.add('on');
        setTimeout(function () {
          nudge.classList.remove('on');
          setTimeout(function () { if (nudge.parentNode) nudge.parentNode.removeChild(nudge); }, 400);
        }, 4500);
      }, 1400);
    }
  }

  // ------------------------------------------------------------ 单选按钮组
  function radioGroup(box, hidden, onChange) {
    if (!box) return;
    box.addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-v]');
      if (!b) return;
      $$('button[data-v]', box).forEach(function (x) { x.setAttribute('aria-checked', 'false'); });
      b.setAttribute('aria-checked', 'true');
      if (hidden) hidden.value = b.getAttribute('data-v');
      if (onChange) onChange(b.getAttribute('data-v'));
    });
  }

  // ------------------------------------------------------------ 回执
  var form = $('#rsvpForm'), doneBox = $('#rsvpDone'), rsvpMsg = $('#rsvpMsg');
  var fldGuests = $('#fldGuests'), gNum = $('#gNum'), rGuests = $('#rGuests');

  radioGroup($('#pickGo'), $('#rGo'), function (v) {
    if (fldGuests) fldGuests.hidden = (v === 'no');
  });
  radioGroup($('#pickSide'), $('#rSide'));

  function setGuests(n) {
    n = Math.max(1, Math.min(20, n));
    gNum.textContent = String(n);
    rGuests.value = String(n);
  }
  if (gNum) {
    $('#gMinus').addEventListener('click', function () { setGuests(+rGuests.value - 1); });
    $('#gPlus').addEventListener('click', function () { setGuests(+rGuests.value + 1); });
  }

  function showDone(rec) {
    if (!doneBox) return;
    form.hidden = true;
    doneBox.hidden = false;
    // 已经回执了，就别再催「请于 9 月 15 日前告知」
    var why = $('#rsvpWhy'); if (why) why.hidden = true;
    var bits = [rec.attending === 'no' ? '您回复：实在抱歉' : '您回复：准时赴宴'];
    if (rec.attending !== 'no' && rec.guests) bits.push('共 ' + rec.guests + ' 位');
    if (rec.side) bits.push(rec.side);
    $('#rsvpSum').textContent = bits.join(' · ');
  }

  var saved = store.get('rsvp_v1');
  if (saved) { try { showDone(JSON.parse(saved)); } catch (e) {} }

  if ($('#rsvpAgain')) {
    $('#rsvpAgain').addEventListener('click', function () {
      doneBox.hidden = true;
      form.hidden = false;
      var why = $('#rsvpWhy'); if (why) why.hidden = false;
      rsvpMsg.textContent = '';
    });
  }

  if (form) {
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var btn = $('#rsvpSubmit');
      var name = $('#rName').value.trim();
      if (!name) {
        rsvpMsg.className = 'msg msg--err';
        rsvpMsg.textContent = '还不知道怎么称呼您呢';
        $('#rName').focus();
        return;
      }
      if (form.website.value) { showDone({ attending: 'yes', guests: 1 }); return; }  // 蜜罐

      var rec = {
        name: name,
        attending: $('#rGo').value,
        guests: parseInt(rGuests.value, 10) || 1,
        side: $('#rSide').value,
        phone: $('#rPhone').value.trim(),
        note: $('#rNote').value.trim()
      };

      btn.disabled = true;
      btn.textContent = '提交中…';
      rsvpMsg.textContent = '';

      fetch('/api/rsvp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rec)
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (!d || !d.ok) throw new Error((d && d.error) || '提交失败');
        store.set('rsvp_v1', JSON.stringify(rec));
        showDone(rec);
      }).catch(function (err) {
        btn.disabled = false;
        btn.textContent = '提交回执';
        rsvpMsg.className = 'msg msg--err';
        rsvpMsg.textContent = (err && err.message) || '网络不太好，您也可以直接微信告诉我们';
      });
    });
  }

  // ------------------------------------------------------------ 留言
  var list = $('#wishList'), moreBtn = $('#wishMore'), emptyEl = $('#wishEmpty');
  var countEl = $('#wishCount');
  var PAGE = 8;
  var all = [];

  function ago(iso) {
    var t = new Date(iso).getTime();
    if (!t) return '';
    var s = (Date.now() - t) / 1000;
    if (s < 60) return '刚刚';
    if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
    if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
    if (s < 86400 * 8) return Math.floor(s / 86400) + ' 天前';
    var d = new Date(t);
    return (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日';
  }

  function node(w) {
    var box = doc.createElement('div');
    box.className = 'wish-item';
    var top = doc.createElement('div'); top.className = 'top';
    var who = doc.createElement('span'); who.className = 'who ugc'; who.textContent = w.name;
    var when = doc.createElement('span'); when.className = 'ago'; when.textContent = ago(w.ts);
    top.appendChild(who); top.appendChild(when);
    var txt = doc.createElement('p'); txt.className = 'txt ugc';
    txt.textContent = w.text;                       // 绝不 innerHTML
    box.appendChild(top); box.appendChild(txt);
    return box;
  }

  function render(limit) {
    if (!list) return;
    list.textContent = '';
    all.slice(0, limit).forEach(function (w) { list.appendChild(node(w)); });
    if (countEl) countEl.textContent = String(all.length);
    if (emptyEl) emptyEl.hidden = all.length > 0;
    if (moreBtn) {
      if (all.length > limit) {
        moreBtn.hidden = false;
        moreBtn.textContent = '查看全部 ' + all.length + ' 条';
      } else { moreBtn.hidden = true; }
    }
  }

  function loadWishes() {
    fetch('/api/wishes').then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.ok) return;
      all = d.wishes || [];
      // 自己刚发的那条若还在待审，本地先给自己看到
      var mine = store.get('wish_mine');
      if (mine) {
        try {
          var m = JSON.parse(mine);
          if (!all.some(function (w) { return w.id === m.id; })) all.unshift(m);
        } catch (e) {}
      }
      render(PAGE);
    }).catch(function () {
      if (emptyEl) { emptyEl.hidden = false; emptyEl.textContent = '留言暂时加载不出来，稍后再试'; }
    });
  }
  if (list) loadWishes();

  if (moreBtn) moreBtn.addEventListener('click', function () { render(all.length); });

  // ---- 底部升起的写留言面板
  var sheet = $('#wishSheet'), mask = $('#mask');
  var wForm = $('#wishForm'), wMsg = $('#wishMsg'), wText = $('#wText'), wCount = $('#wCount');

  function openSheet() {
    if (!sheet) return;
    sheet.hidden = false;
    // 下一帧再加 class，否则 transform 起始态来不及生效
    requestAnimationFrame(function () {
      sheet.classList.add('on');
      mask.classList.add('on');
    });
    setTimeout(function () { $('#wName').focus(); }, 300);
  }
  function closeSheet() {
    if (!sheet) return;
    sheet.classList.remove('on');
    mask.classList.remove('on');
    setTimeout(function () { sheet.hidden = true; }, 300);
  }
  if ($('#wishOpen')) $('#wishOpen').addEventListener('click', openSheet);
  if ($('#wishClose')) $('#wishClose').addEventListener('click', closeSheet);
  if (mask) mask.addEventListener('click', closeSheet);

  if (wText && wCount) {
    wText.addEventListener('input', function () { wCount.textContent = String(wText.value.length); });
  }

  // 键盘弹起时把面板顶到键盘之上
  if (window.visualViewport && sheet) {
    var vv = window.visualViewport;
    var fit = function () {
      if (sheet.hidden) return;
      var gap = window.innerHeight - vv.height - vv.offsetTop;
      sheet.style.transform = gap > 40 ? 'translateY(-' + gap + 'px)' : '';
    };
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
  }

  if (wForm) {
    wForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var btn = $('#wishSubmit');
      var name = $('#wName').value.trim();
      var text = wText.value.trim();
      wMsg.textContent = '';
      if (!name) { wMsg.className = 'msg msg--err'; wMsg.textContent = '还不知道怎么称呼您呢'; return; }
      if (text.length < 2) { wMsg.className = 'msg msg--err'; wMsg.textContent = '祝福至少写两个字呀'; return; }
      if (wForm.website.value) { closeSheet(); return; }

      btn.disabled = true;
      btn.textContent = '发送中…';

      fetch('/api/wishes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, text: text })
      }).then(function (r) { return r.json(); }).then(function (d) {
        btn.disabled = false;
        btn.textContent = '写好了';
        if (!d || !d.ok) throw new Error((d && d.error) || '发送失败');
        if (d.wish) {
          all.unshift(d.wish);
          store.set('wish_mine', JSON.stringify(d.wish));
          render(Math.max(PAGE, Math.min(all.length, PAGE)));
        } else {
          var pending = { id: 'local', name: name, text: text, ts: new Date().toISOString() };
          all.unshift(pending);
          store.set('wish_mine', JSON.stringify(pending));
          render(PAGE);
        }
        wText.value = ''; if (wCount) wCount.textContent = '0';
        closeSheet();
      }).catch(function (err) {
        btn.disabled = false;
        btn.textContent = '写好了';
        wMsg.className = 'msg msg--err';
        wMsg.textContent = (err && err.message) || '网络不太好，稍后再试';
      });
    });
  }
})();
