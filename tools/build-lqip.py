#!/usr/bin/env python3
"""
生成 lqip.css —— 每张照片一个 24px 宽的内联 base64 占位图。

在这套设计里 LQIP 不只是优化，它是唯一的「正在加载」信号：
页面本身就是大片纸白，弱网下如果不铺底色，空页面看起来和加载失败没有区别。

从 build-photos.py 已导出的最小一档 WebP 反推，不是从 pics/ 的原图 ——
这样封面 P1 拿到的是白平衡校正之后的颜色，不会出现「占位偏冷、真图偏暖」的一跳。
取最小一档而不是写死 480：P3、P5 的 srcset 起点就是 750，为了占位图单独
多导一档 480，等于往仓库里放一个页面永远不会请求的文件。

    python3 tools/build-photos.py && python3 tools/build-lqip.py

CSS 类名不带版本号（.lq-p1-vow），因为 lqip.css 自己是 no-cache 的产物，
换照片跟着重新生成就行，不像照片文件那样要靠改名破缓存。
"""

import base64
import io
import os
import re
import sys
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG = os.path.join(ROOT, "site", "assets", "img")
OUT = os.path.join(ROOT, "site", "assets", "css", "lqip.css")

NAMES = ["p1-vow", "p2-studio", "p3-close", "p4-arch", "p5-red"]


def smallest_webp(name):
    """<name>-<ver>-<width>.webp 里宽度最小的那个。"""
    pat = re.compile(r"^%s-v\d+-(\d+)\.webp$" % re.escape(name))
    found = [(int(m.group(1)), f) for f in os.listdir(IMG) for m in [pat.match(f)] if m]
    if not found:
        sys.exit("✗ 找不到 %s 的导出档，先跑 python3 tools/build-photos.py" % name)
    return min(found)[1]


def main():
    lines = ["/* 构建产物 —— 由 tools/build-lqip.py 生成，请勿手改 */"]
    total = 0
    for n in NAMES:
        src = smallest_webp(n)
        im = Image.open(os.path.join(IMG, src)).convert("RGB")
        w = 24
        h = max(1, round(im.height * w / im.width))
        lq = im.resize((w, h), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.6))
        buf = io.BytesIO()
        lq.save(buf, "WEBP", quality=58)
        uri = "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()
        total += len(uri)
        lines.append(".lq-%s{background-image:url(%s)}" % (n, uri))
        print("  %-12s %4d B   ← %s" % (n, len(uri), src))
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print("\n合计 %.1f KB -> %s" % (total / 1024, OUT))


if __name__ == "__main__":
    main()
