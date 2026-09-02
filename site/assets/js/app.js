/* ============================================================================
   金正旭 · 刘俊懿  婚礼请柬
   ---------------------------------------------------------------------------
   工程约定（改之前先读）：

   · HTML 的默认状态 = 动画的终态。初始隐藏只写在 CSS 的 html.js 选择器下。
     这个文件整个挂掉、IntersectionObserver 不被支持、脚本被运营商劫持，
     页面依然是完整可读的静态页。表单带真实 action，导航是真实 <a href>
     —— JS 只做接管，不做承载。

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
  var meta = function (n) { var m = $('meta[name="' + n + '"]'); return m ? m.content : ''; };

  // ------------------------------------------------------------ 这是哪一场
  // 婚礼页和回门页是同一份 HTML 生成的、同一份 JS、同一个域名。
  // 场次只写在 <meta name="ev-key">，日期只写在 <meta name="ev-at">。
  var EV = meta('ev-key') || 'wedding';

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

  // 「已回复」的状态必须按场次分开存。两页同域共用一个 localStorage，
  // 用同一个 key 的话，在婚礼页回复过的亲戚打开回门页会直接看到
  // 「收到了 · 那天见」—— 他一个字都没回，你在后台也永远等不到这条回执。
  // 留言墙相反：两页共用同一个 /api/wishes，wish_mine 就不该分场。
  var RSVP_KEY = 'rsvp_v1_' + EV;

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

  // ------------------------------------------------------------ 相册横滑
  // 圆点跟着手指走。不监听 scroll —— X5 惯性滑动期间 scroll 回调节流极粗，
  // 圆点会一顿一顿地跳。改用以 .reel 自己为 root 的 IntersectionObserver，
  // 再把 root 用 rootMargin 缩成正中一道窄条：压住这道条的那张就是当前那张。
  // 这样宽屏上同时看得见两张时也不会两颗点一起亮。
  var reel = $('#reel');
  var dots = $$('#dots i');
  if (reel && dots.length && 'IntersectionObserver' in window) {
    var shots = $$('.shot', reel);
    var mark = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        var i = shots.indexOf(e.target);
        dots.forEach(function (d, j) { d.classList.toggle('on', j === i); });
      });
    }, { root: reel, rootMargin: '0px -45% 0px -45%', threshold: 0 });
    shots.forEach(function (el) { mark.observe(el); });
  }

  // ------------------------------------------------------------ 倒计时 + 月环
  // 日期【只】写在 HTML 的 <meta name="ev-at"> 里。婚礼页和回门页共用这一份 JS，
  // 从前这四行是写死的 2026-09-26 —— 那样回门页的倒计时会指着婚礼那天。
  var AT   = meta('ev-at') || '2026-09-26T12:00:00+08:00';
  var YMD  = AT.slice(0, 10);                                  // 2026-09-26
  var EVENT     = new Date(AT).getTime();
  var DAY_START = new Date(YMD + 'T00:00:00+08:00').getTime();
  var DAY_END   = DAY_START + 86400000;

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

    var left = EVENT - now;
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

  // 月环。从前它画的是「一年走到今天」的进度，只有婚礼当天才闭合成满月 ——
  // 而那天没人会专门打开请柬来看，等于这个设计谁也看不见。现在改成：
  // 谁划到这一屏，月亮就当着谁的面合上，而且是【跟着手指】合的。
  // 环不再承载「还剩多久」的信息了 —— 那件事环心的数字一直在说，说得比环准。
  //
  // 两条路，能力判定选一条，选定之后另一条一步都不走：
  //   scrub  支持 animation-timeline: view() —— 整段交给 CSS，滑多少合多少，
  //          停手就停住，往回滑就往回退。合成器驱动，没有一个 scroll 回调。
  //   timed  老浏览器 —— 进视口后自己走 1.6 秒。终态跟 scrub 一模一样。
  var RING_MS = 1600;   // 跟 style.css 的 --d-ring 一致；只是 transitionend 的兜底，差几十毫秒无妨
  if (prog) {
    var lit = function () { if (ring) ring.classList.add('full'); };
    var close = function () {
      // .armed 才把过渡装回去（见 style.css）。装完等一帧再改值，
      // 让空环这个起点先落定 —— 同一帧里又装过渡又改值，老 WebKit 上会漏掉动画。
      ring.classList.add('armed');
      var go = function () {
        prog.style.strokeDashoffset = '0';
        // 先合线、后亮面，两拍。transitionend 在后台标签页里可能永远不来，加兜底。
        var t = setTimeout(lit, RING_MS + 120);
        prog.addEventListener('transitionend', function once(e) {
          if (e.propertyName !== 'stroke-dashoffset') return;
          prog.removeEventListener('transitionend', once);
          clearTimeout(t);
          lit();
        });
      };
      if (window.requestAnimationFrame) requestAnimationFrame(go); else setTimeout(go, 32);
    };
    var scrub = false;
    try {
      scrub = !lite && !!(window.CSS && CSS.supports && CSS.supports('animation-timeline', 'view()'));
    } catch (e) {}

    // 降级路径：html.lite 把 transition 全禁了，这里设值即到位，直接就是满月。
    if (lite) { prog.style.strokeDashoffset = '0'; lit(); }
    else if (scrub) { ring.classList.add('scrub'); }   // 剩下的全在 style.css 里，JS 不再插手
    else if ('IntersectionObserver' in window) {
      var ro = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) { ro.unobserve(e.target); close(); } });
      }, { threshold: 0.4 });
      ro.observe(ring);
    } else { prog.style.strokeDashoffset = '0'; lit(); }
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
    // 已经回过话了，就别再催「9 月 15 日前给我们回个信息」
    var why = $('#rsvpWhy'); if (why) why.hidden = true;
    var bits = [rec.attending === 'no' ? '您选了：恐怕来不了' : '您选了：准时赴宴'];
    if (rec.attending !== 'no' && rec.guests) bits.push('共 ' + rec.guests + ' 位');
    if (rec.side) bits.push(rec.side);
    $('#rsvpSum').textContent = bits.join(' · ');
  }

  // 老访客的键没有场次后缀（回门页上线前存的），回落一次，
  // 免得他们回来看到空表单，以为回执没提交成功又填一遍。
  var saved = store.get(RSVP_KEY) || (EV === 'wedding' ? store.get('rsvp_v1') : null);
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
        event: EV,
        name: name,
        attending: $('#rGo').value,
        guests: parseInt(rGuests.value, 10) || 1,
        side: $('#rSide').value,
        phone: $('#rPhone').value.trim(),
        note: $('#rNote').value.trim()
      };

      btn.disabled = true;
      btn.textContent = '发送中…';
      rsvpMsg.textContent = '';

      fetch('/api/rsvp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rec)
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (!d || !d.ok) throw new Error((d && d.error) || '没发出去，再试一次');
        store.set(RSVP_KEY, JSON.stringify(rec));
        showDone(rec);
      }).catch(function (err) {
        btn.disabled = false;
        btn.textContent = '发送回复';
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
