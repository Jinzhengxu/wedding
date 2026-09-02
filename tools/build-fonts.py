#!/usr/bin/env python3
"""
字体子集化 —— 构建期跑一次，产物自托管，运行时完全不依赖 Google。

为什么这么做：
  站点里「标题级」的中文是固定文案（新人姓名、日期、板块小标题），字数很少，
  精确子集成一个 70KB 上下的 woff2 就够了。而「留言墙」这类用户输入的中文是
  不可预知的，那部分一律用系统字体 —— 绝不让它去踩子集字体缺字的坑，
  同一行里半截思源宋体半截系统黑体是最难看的。

  Google Fonts 的 css2 接口支持 &text= 精确子集，且返回的是可变字体，
  多个字重共用同一个文件，所以按 URL 去重后只下一份。

用法：
    python3 tools/build-fonts.py              # 扫描 site/ 下 HTML/CSS 里的静态中文
    python3 tools/build-fonts.py --dry-run    # 只打印将要请求的字符集，不下载

产物（文件名里带内容哈希，见下）：
    site/assets/fonts/serif-sc.<hash>.woff2
    site/assets/fonts/garamond.<hash>.woff2
    site/assets/fonts/fonts.css
并就地改写 site/ 下每张页面里那行 <link rel="preload">，指向新的哈希文件名
（婚礼页和生成的回门页一起改，构建顺序不用变，还是 build-pages -> build-fonts）。

为什么文件名要带哈希：
  这个脚本每次都按页面上【实际出现的字】重新烧一份子集，同一个文件名，
  内容却随文案变。而 woff2 在 server.js 里吃的是 max-age=31536000。
  两件事撞在一起出过一个一年不会自愈的 bug：早期访客缓存了一份 372 字的旧子集，
  后来文案里新添的「设宪举建伟夫妇」不在其中，浏览器逐字回退到系统字体 ——
  一行宋体里蹦出七个黑体字。名字带上内容哈希，改了字就是新 URL，旧缓存自然作废。
"""

import argparse
import glob
import hashlib
import os
import re
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, "site")
FONT_DIR = os.path.join(SITE, "assets", "fonts")

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

FAMILY_CSS = {"serif-sc": "Serif SC", "garamond": "Garamond Web"}

# 标题区一定会用到的字。即便 HTML 里此刻没写，也先烧进子集，
# 免得以后改一句文案就整块缺字。
ALWAYS = (
    "金正旭刘俊懿"
    "金宪举刘建伟夫妇谨订"
    "先生女士新郎新娘"
    "谨定于公历农历丙午年八月十六中秋"
    "二〇二六年九月廿六日星期六"
    "零一二三四五六七八九十百千万"
    "山东省济南市槐荫区兴福寺路号"
    "美悦云禧酒店五楼云颂厅宴会"
    "我们结婚了敬备喜筵恭候光临台光"
    "花好月圆人长久良辰吉日喜结连理"
    "相册照片时光倒计时地点导航"
    "回执出席赴约祝福留言墙寄语"
    "距离婚礼还有天时分秒"
    "请点击开启音乐关闭复制地址已复制"
    "查看更多滑动向下卷起中式礼服"
    "确认提交成功感谢您的祝福期待与您相见"
    "姓名称呼人数几位电话备注男方女方双方好友亲友"
    "无法到场遗憾送上"
    "缓缓落下第一次见面到今天"
    "、。，·；：？！“”‘’（）【】—…《》"
)

LATIN = (
    "0123456789"
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    "abcdefghijklmnopqrstuvwxyz"
    " .,:;&'’\"-–—/()?!·"
)

# 中日韩统一表意文字 + CJK 标点 + 全角符号
CJK_RANGES = ((0x3000, 0x303F), (0x4E00, 0x9FFF), (0xFF00, 0xFFEF), (0x3400, 0x4DBF))


def is_cjk(ch):
    o = ord(ch)
    return any(lo <= o <= hi for lo, hi in CJK_RANGES)


def scan_static_text():
    """收集 site/ 下 HTML/CSS 里出现的中文（跳过 script/style 里的代码）。"""
    chars = set()
    for dirpath, _dirs, files in os.walk(SITE):
        norm = dirpath.replace("\\", "/")
        if "/assets/img" in norm or "/server" in norm or "/assets/fonts" in norm:
            continue
        for fn in files:
            if not fn.endswith((".html", ".css")):
                continue
            with open(os.path.join(dirpath, fn), encoding="utf-8") as f:
                src = f.read()
            if fn.endswith(".html"):
                src = re.sub(r"<script\b.*?</script>", " ", src, flags=re.S | re.I)
                src = re.sub(r"<style\b.*?</style>", " ", src, flags=re.S | re.I)
                # 注释里的中文不上屏。不剔掉的话，源码里那些解释设计决策的
                # 长注释会把子集从 200 字撑到 700 字，字体从 73KB 涨到 267KB。
                src = re.sub(r"<!--.*?-->", " ", src, flags=re.S)
                # alt / aria-label / title 正常情况下不上屏（读屏走系统语音，
                # alt 只在图裂时出现），没必要为它们扩子集。
                src = re.sub(r'\b(?:alt|aria-label|title|content)\s*=\s*"[^"]*"', " ", src)
            else:  # .css —— 只有 content 属性会真的渲染出字来
                src = re.sub(r"/\*.*?\*/", " ", src, flags=re.S)
                src = " ".join(m[1] for m in
                               re.findall(r"content\s*:\s*(['\"])(.*?)\1", src, flags=re.S))
            chars.update(ch for ch in src if is_cjk(ch))
    return "".join(sorted(chars))


def fetch_css(family, weights, text):
    spec = family + ":wght@" + ";".join(str(w) for w in weights)
    url = ("https://fonts.googleapis.com/css2?family="
           + urllib.parse.quote(spec, safe=":;@+")
           + "&text=" + urllib.parse.quote(text)
           + "&display=swap")
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=45) as r:
        return r.read().decode("utf-8")


def download(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=90) as r:
        return r.read()


BLOCK_RE = re.compile(
    r"@font-face\s*\{[^}]*?font-weight:\s*(\d+);[^}]*?src:\s*url\((https://[^)]+)\)", re.S)


def harvest(css):
    out = {}
    for w, url in BLOCK_RE.findall(css):
        out.setdefault(int(w), url)
    return out


PRELOAD_RE = re.compile(r'(<link rel="preload" href="/?assets/fonts/)serif-sc[^"]*\.woff2(")')


def rewrite_preload(fn):
    """把每张页面里那行 <link rel="preload"> 指到新的哈希文件名上。

    preload 的 href 必须跟 fonts.css 里 @font-face 的 src 【一模一样】，
    差一个字符浏览器就会下两份字体，控制台还甩一条 preload 没被用上的警告。
    与其让人手改，不如烧字体的时候顺手改掉 —— 少一个会忘的步骤。

    生成页（site/huimen/index.html）也一起改，而不是等 build-pages.py 再跑一遍：
    构建顺序是 build-pages -> build-fonts（子集要扫生成页上的字，见 README），
    如果这里只改婚礼页，就得再回头跑一次 build-pages，多一个会忘的步骤，
    而且 deploy.sh 的 --check 会因为两页不一致直接把部署拦下来。
    两页写同一个哈希，--check 依旧过得去。"""
    if not fn:
        raise SystemExit("!! 没拿到 serif-sc 的文件名，preload 没法改")
    hit = 0
    for p in sorted(glob.glob(os.path.join(SITE, "**", "index.html"), recursive=True)):
        with open(p, encoding="utf-8") as f:
            src = f.read()
        new, n = PRELOAD_RE.subn(r"\g<1>%s\g<2>" % fn, src)
        if n == 0:
            continue
        hit += 1
        if new != src:
            with open(p, "w", encoding="utf-8") as f:
                f.write(new)
            print("  %s preload -> %s" % (os.path.relpath(p, ROOT), fn))
    if hit == 0:
        raise SystemExit("!! site/ 下没找到那行字体 preload，改不动")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    os.makedirs(FONT_DIR, exist_ok=True)

    cjk = "".join(sorted(set(ALWAYS) | set(scan_static_text())))
    latin = "".join(sorted(set(LATIN)))

    print("中文静态字集：%d 字" % len(cjk))
    print("拉丁字集：    %d 字" % len(latin))
    if args.dry_run:
        print(cjk)
        return 0

    css_lines = ["/* 构建产物 —— 由 tools/build-fonts.py 生成，请勿手改 */"]
    total = [0]
    written = []          # 这一轮真正写出的 woff2 文件名
    preload = [None]      # 要写进 index.html 那行 preload 的文件名

    def pull(family, weights, text, stem):
        """拉一个字族的子集。Google 返回的是可变字体，多个字重共用同一个文件，
        所以按 URL 去重，一个文件配一条带字重区间的 @font-face。

        文件名带内容哈希：同样的字烧出同样的名字（改一行注释不会白白换 URL），
        字变了名字才变，于是浏览器那份 max-age=31536000 的旧缓存自动失效。"""
        urls = harvest(fetch_css(family, weights, text))
        if not urls:
            raise SystemExit("!! 没能从 Google Fonts 拿到 %s 的字体 URL" % family)
        groups = {}
        for w, u in urls.items():
            groups.setdefault(u, []).append(w)
        for url, ws in sorted(groups.items(), key=lambda kv: min(kv[1])):
            stem_w = stem if len(groups) == 1 else "%s-%d" % (stem, min(ws))
            data = download(url)
            fn = "%s.%s.woff2" % (stem_w, hashlib.sha1(data).hexdigest()[:8])
            with open(os.path.join(FONT_DIR, fn), "wb") as f:
                f.write(data)
            written.append(fn)
            if stem == "serif-sc" and preload[0] is None:
                preload[0] = fn
            total[0] += len(data)
            rng = "%d %d" % (min(ws), max(ws)) if min(ws) != max(ws) else str(min(ws))
            print("  %-28s %6.1f KB   字重 %s" % (fn, len(data) / 1024, rng))
            css_lines.append(
                "@font-face{font-family:'%s';font-style:normal;font-weight:%s;"
                "font-display:swap;src:url(%s) format('woff2')}"
                % (FAMILY_CSS[stem], rng, fn))

    pull("Noto+Serif+SC", [300, 400, 600], cjk, "serif-sc")
    pull("EB+Garamond", [400, 500], latin, "garamond")

    with open(os.path.join(FONT_DIR, "fonts.css"), "w", encoding="utf-8") as f:
        f.write("\n".join(css_lines) + "\n")

    # 上一轮的哈希文件留在目录里只会跟着镜像一起发出去，白占体积。
    for old in glob.glob(os.path.join(FONT_DIR, "*.woff2")):
        if os.path.basename(old) not in written:
            os.remove(old)
            print("  删除旧子集 %s" % os.path.basename(old))

    rewrite_preload(preload[0])

    print("\n合计 %.1f KB  ->  %s" % (total[0] / 1024, FONT_DIR))
    print("提醒：子集只覆盖静态标题文案；留言墙等用户输入内容走系统字体。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
