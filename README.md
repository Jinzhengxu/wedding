# 金正旭 · 刘俊懿 婚礼邀请函

**两场酒席，两个页面，同一份源码：**

| | 日子 | 席设 | 网址 |
|---|---|---|---|
| 婚礼 | 2026.09.26 星期六 中午 · 农历八月十六 | 济南美悦云禧酒店 5 楼云颂厅 | `/` |
| 回门宴 | 2026.09.12 星期六 17:30 · 农历八月初二 | 蒙阴天佑园大酒店 | `/huimen/` |

回执两场分开统计，留言墙两场共用一面。

---

## 改文案：改哪个文件

**`site/index.html` 是婚礼页本体，也是回门页的模板。** 想改哪句话就直接改它。
回门页 `site/huimen/index.html` 是【生成的】，手改会被下次构建覆盖。

```bash
python3 tools/build-pages.py     # 改完文案先跑这个
python3 tools/build-fonts.py     # 再跑这个（新字要进子集）
```

两页只有 24 处不一样（日期、席设、地址、落款、地图链接……），
在 index.html 里用注释标成锚点：

```html
<p class="k hour"><!--ev:hour-->午时设宴<!--/ev--></p>
```

回门宴那 24 处的内容写在 `tools/events.json`。注释不上屏、也不进字体子集。

**锚点动了会报错，不会静默出错。** events.json 少一个键、多一个键、
或者你改文案时把 `<!--ev:xxx-->` 删掉了，`build-pages.py` 都直接退出并指出是哪个键。
所以不用担心「改了婚礼页忘了改回门页」——那种情况是构建失败，不是上线一张错帖。

`python3 tools/build-pages.py --check` 只校验产物是不是最新的，不写文件（部署前跑）。

---

## 跑起来

```bash
node site/server/server.js              # 默认 127.0.0.1:8080
PORT=3000 HOST=0.0.0.0 node site/server/server.js
```

启动时会打印管理后台地址，密钥存在 `site/server/data/admin-key.txt`。

后台能看：回执名单、预计到场人数、导出 CSV、隐藏不合适的留言。
数据就是两个纯文本文件，直接备份即可：

```
site/server/data/rsvp.jsonl      宾客回执
site/server/data/wishes.jsonl    祝福留言
site/server/data/moderation.jsonl 隐藏/恢复留言的操作流水
```

留言默认发出即显示（过一层敏感词/广告拦截，可疑的自动转待审）。
想改成全部先审后发：`PREMODERATE=1 node site/server/server.js`。

---

## 还需要你补的信息

页面里这几处标了 `▼ 待填`，搜一下就能找到：

| 位置 | 内容 | 现在写的是 |
|---|---|---|
| `site/index.html` `#go` 电话行 | **新人或伴郎的手机号**（注释掉的三行，去掉注释换成真号即可） | 只有酒店前台 0531-88590967 |
| `site/index.html` `#rite` 底部 | 中式敬茶环节的**时段** | 整屏没有文字（「中式 · 婚书」那个标题已删）。HTML 注释里留了现成的一块，知道时段就放出来 |
| `site/index.html` `#rsvp` | 回执**截止日期** | 婚礼页 9 月 15 日；回门页 9 月 5 日（在 `events.json` 的 `rsvp-why`） |
| `site/index.html` `#foot` | 婚礼页的**女方双亲姓名** | 婚礼页只落了男方：「金宪举　刘建伟　夫妇　谨订」。两家合发要写成「金宪举　刘建伟　　刘树亮　李萍　夫妇　谨订」，两组之间空两格。（回门页已经是女方落款，不用改） |
| `tools/events.json` `go-addr` / `tie-addr` | 天佑园大酒店的**门牌地址**和**厅名** | 只写到「山东省临沂市蒙阴县」。有街道号就补上，长辈照着地址找路比按图标找路多 |
| `tools/build-cards.py` `CARDS` | 同上，喜帖图里的地址是**烧进像素**的 | 改完地址两边都要改，然后重跑 `build-cards.py` |

改完文案后必须重跑一次字体子集化，否则新字会缺：

```bash
python3 tools/build-fonts.py
```

---

## 上线前一定要做的三件事

1. **四个地图按钮在真机上各点一遍（两页各两个）。** 现在用的是"按名称搜索"的网页链接
   （`uri.amap.com/search`、`api.map.baidu.com/geocoder`），没有写死经纬度。
   **回门页那两个尤其要点** —— 「天佑园大酒店」这个关键词能不能在蒙阴唯一命中，
   没在真机上验证过。落点不准就去高德/腾讯坐标拾取器取一个 GCJ-02 坐标，
   把链接换成 `marker?position=经度,纬度` 的形式（改 `tools/events.json` 的 `go-nav`）。
2. **拿给双方父母各看一次**，问一句"这像不像一份帖子"。
3. **找一位 60 岁以上的家人**，计时看他多久能找到酒店地址。超过 15 秒就得再放大字号。

---

## 构建脚本

原图放在 `pics/`，脚本不会改动它们。中间产物在 `build/`（不发布）。

```bash
python3 tools/build-pages.py    # 从婚礼页生成回门页（改文案后必跑）
python3 tools/build-cover.py    # 封面 P1 的白平衡校正 + 多档导出
python3 tools/build-cards.py    # 微信分享方图 + 两场各一张可长按保存的喜帖
python3 tools/build-lqip.py     # 图片模糊占位图（内联 base64）
python3 tools/build-fonts.py    # 中文字体子集化（改文案后必跑）
```

`build-pages.py` 要跑在 `build-fonts.py` 【前面】：字体子集是扫 `site/` 下
所有 HTML 得出的，回门页没生成，那几个新字（初、晚、宴、蒙、阴、佑、沂……）就不进子集。

### 为什么要子集化字体

思源宋体全量 15MB 上不了手机。脚本会扫描 HTML 里真正会显示的字（现在 331 个），
只打包这些字形 —— 130KB。**注意：子集只覆盖固定文案。** 留言墙和表单里
用户输入的任意汉字一律走系统字体（CSS 里的 `--f-ugc`），
不这么做的话同一段文字里会一半宋体一半黑体，比全用黑体难看得多。

### 为什么封面照片要做白平衡

P1 的棚拍背景实测是 `#DAD8DE`，偏冷偏紫。直接压在暖米白的页面上会发脏，
像贴了一张灰卡片。`build-cover.py` 做的是**高光加权**的白平衡：背景被校到 `#F1EEE6`，
黑礼服几乎不动，肤色只被轻微提亮。全局等比提亮会让肤色发飘。

---

## 部署

纯静态 + 一个零依赖 Node 服务。Nginx 反代示例：

```nginx
server {
    listen 443 ssl http2;
    server_name  你的域名;

    ssl_certificate     /path/fullchain.pem;
    ssl_certificate_key /path/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-For   $remote_addr;   # 限流按真实 IP 才准
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

开机自启（systemd）：

```ini
[Unit]
Description=wedding invitation
After=network.target

[Service]
WorkingDirectory=/srv/wedding/site
ExecStart=/usr/bin/node server/server.js
Environment=PORT=8080
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

**务必上 HTTPS。** 微信对 http 链接会加拦截提示。

---

## 背景音乐

`site/assets/audio/bgm.mp3` —— 巴赫《G 弦上的咏叹调》（BWV 1068），
美国空军军乐团弦乐队演奏，**公有领域**（美国政府作品），可自由使用。
2.2MB / 96kbps / 3 分 03 秒，带淡入淡出和响度归一化。

想换成自己的歌，覆盖这个文件即可，页面会自动用新的。
文件不存在时音乐按钮不会报错，只是点了没声音。

微信里不能自动播放，所以做了一个「点这里开音乐」的引导气泡，
弹一次之后记进 localStorage 不再打扰。

---

## 几条改代码前要知道的规矩

写在 `site/assets/css/style.css` 开头，这里重复一遍要点：

0. **两页共用一份 JS 和 CSS。** 页面靠 `<meta name="ev-key">` 和 `<meta name="ev-at">`
   报出自己是哪一场、哪一天。日期【只】写在 meta 里，倒计时从那儿读 ——
   别再往 app.js 里写死日期，写死了回门页就会倒计时到婚礼那天。
   （月环不读日期：从前它画的是「一年走到今天」，只有婚礼当天才闭合成满月，
   而那天没人会专门打开请柬看。现在改成划到第 6 屏就当场闭合，谁翻到谁看见。）
   「已回复」的状态按场次分开存（`rsvp_v1_婚礼场次名`），留言墙两场共用不分。
1. **答案在第二屏。** 几号、几点、在哪、怎么去、怎么回复，全在帖芯那张卡里，
   一屏截得全（实测 573px）。亲戚不转链接，只截图发家族群。
2. **金只做线。** 金永远不做填充、不做正文色、不做大色块。
3. **最后一眼必须是红。** 中式 → 回执 → 留言 → 落款连续四屏红底，不切回纸白。
4. **相册横滑，不竖着摞。** 三张婚纱照并列，没有先后，横着放一屏看完 ——
   竖排要占三屏，整页从 8208px 缩到 7182px。用原生 `scroll-snap`，不引 swiper：
   X5 的惯性滑动是内核给的，自己用 `touchmove` + `transform` 写的一定更涩。
   右边永远露出下一张的一条边 —— 微信里没有 hover，那条边比任何提示文字都管用。

禁止用的东西（都在微信 X5 内核或低端安卓上有具体代价）：
`position:sticky`、`backdrop-filter`、`text-shadow`、`scroll-behavior:smooth`、
监听 scroll 驱动动画、大图运行时 `filter`、用 `innerHTML` 渲染用户输入、
`iosamap://` 这类自定义 scheme（微信必拦）。

页面在**完全没有 JS** 的情况下依然完整可读：初始隐藏样式只写在 `html.js` 选择器下，
表单带真实 `action`，导航是真实 `<a href>`。
