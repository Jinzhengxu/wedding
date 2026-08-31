#!/usr/bin/env python3
"""
生成 lqip.css —— 每张照片一个 24px 宽的内联 base64 占位图。

在这套设计里 LQIP 不只是优化，它是唯一的「正在加载」信号：
页面本身就是大片纸白，弱网下如果不铺底色，空页面看起来和加载失败没有区别。

从已导出的 480w WebP 反推，所以封面 P1 拿到的是白平衡校正之后的颜色，
不会出现"占位偏冷、真图偏暖"的一跳。

    python3 tools/build-lqip.py
"""

import base64
import io
import os
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG = os.path.join(ROOT, "site", "assets", "img")
OUT = os.path.join(ROOT, "site", "assets", "css", "lqip.css")

NAMES = ["p1-vow", "p2-studio", "p3-close", "p4-arch", "p5-red"]


def main():
    lines = ["/* 构建产物 —— 由 tools/build-lqip.py 生成，请勿手改 */"]
    total = 0
    for n in NAMES:
        src = os.path.join(IMG, n + "-480.webp")
        im = Image.open(src).convert("RGB")
        w = 24
        h = max(1, round(im.height * w / im.width))
        lq = im.resize((w, h), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.6))
        buf = io.BytesIO()
        lq.save(buf, "WEBP", quality=58)
        uri = "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()
        total += len(uri)
        lines.append(".lq-%s{background-image:url(%s)}" % (n, uri))
        print("  %-12s %4d B" % (n, len(uri)))
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print("\n合计 %.1f KB -> %s" % (total / 1024, OUT))


if __name__ == "__main__":
    main()
