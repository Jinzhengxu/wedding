#!/usr/bin/env python3
"""
五张照片的全部上站产物 —— 一张表说清哪张图、导哪几档、要不要做色彩处理。

    python3 tools/build-photos.py
    python3 tools/build-photos.py --check    # 只报差异，不写文件

【为什么文件名里带 -v2-】
server.js 给照片挂的是 max-age=31536000，一年内不回源。所以照片这一类
「文件名固定、内容不会变」的东西才敢吃长缓存 —— 换照片就必须换文件名，
否则老访客手上那张旧照片一年不会自愈（字体子集踩过这个坑，见 README）。
v1 是 2026-08-31 上站的那一版，v2 是这次换的这一版。下次再换照片，
把 VER 改成 v3，旧文件删掉，HTML 里的路径跟着改。

【源图】
P2 是原片。其余四张是 2026-09-03 用 gpt-image 按原片重绘的定稿，
挑图记录在生成目录的 SOURCE.txt 里。P2 试过三轮都漂脸（全身照脸太小，
模型靠先验补），按原片保留。

【P1 为什么要单独做白平衡】
封面要压在暖米白 #F5F3ED 的页面上。v2 的棚拍背景实测 #F4E8DD，偏粉；
v1 的原片是 #DAD8DE，偏冷偏紫 —— 两种都不是纸的颜色，直接放上去像贴了
一张色卡。这里做一次高光加权的白平衡，把背景校到 #F2EFE7（比页面底色暗
一档 —— 完全等色会让照片漂空，留一丝明度差才有「印在纸上」的实感）。

加权是关键：权重 w = (L/255)^gamma，背景（L≈233）拿到几乎全部校正，
黑礼服（L≈25）几乎不动，肤色介于两者之间只被轻微提亮。
全局等比增益会把整张照片一起提亮，肤色会发飘。

【P5 会报两个颜色】
中式那一屏的红是 CSS 画的，照片压在上面。脚本会量出照片上下沿的红，
对不上就去改 style.css 的 --red-top / --red，接缝才看不见。
"""

import argparse
import os
import sys

import numpy as np
from PIL import Image, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PICS = os.path.join(ROOT, "pics")
IMG = os.path.join(ROOT, "site", "assets", "img")
BUILD = os.path.join(ROOT, "build")

VER = "v2"

WEBP_Q = 82
JPG_Q = 82

# 每张图导哪几档，是照着 index.html 里的 srcset 定的 —— 那边加一档，这里加一档。
# 源图只有 1024 宽的，最高一档就到 1024：把 1024 拉成 1080 只是把字节数变大。
PHOTOS = [
    dict(name="p1-vow",    src="p1-vow.png",   webp=[480, 750, 1024], jpg=[750], balance=True),
    dict(name="p2-studio", src="975669408ba9a252c08e75324a32ed82.jpeg", webp=[480, 750], jpg=[750]),
    dict(name="p3-close",  src="p3-close.png", webp=[750, 1080],      jpg=[750]),
    dict(name="p4-arch",   src="p4-arch.png",  webp=[480, 750],       jpg=[750]),
    dict(name="p5-red",    src="p5-red.png",   webp=[750, 1024],      jpg=[750], probe_red=True),
]

# ---------------------------------------------------------------- P1 白平衡
TARGET = (0xF2, 0xEF, 0xE7)   # 背景要落到的颜色
GAMMA = 2.0                    # 权重曲线；越大越只作用于高光
# 取背景的采样点（避开人物）：左上、右上、左中、右中
PROBES = [(0.05, 0.04), (0.95, 0.04), (0.04, 0.42), (0.96, 0.42)]
LUMA = np.array([0.2126, 0.7152, 0.0722])


def sample(a, probes):
    H, W, _ = a.shape
    out = []
    for fx, fy in probes:
        x, y = int(W * fx), int(H * fy)
        r = max(2, min(H, W) // 20)
        out.append(a[max(0, y - r):y + r, max(0, x - r):x + r].reshape(-1, 3))
    return np.concatenate(out).mean(0)


def white_balance(im):
    a = np.asarray(im).astype(np.float64)
    bg = sample(a, PROBES)
    print("    背景实测  #%02X%02X%02X  →  目标 #%02X%02X%02X" %
          (*[int(v) for v in bg], *TARGET))

    w = np.clip((a @ LUMA) / 255.0, 0, 1) ** GAMMA
    w_bg = float(np.clip((bg @ LUMA) / 255.0, 0, 1) ** GAMMA)

    out = a.copy()
    gains = []
    for c in range(3):
        g = 1.0 + (TARGET[c] / bg[c] - 1.0) / w_bg
        gains.append(g)
        out[:, :, c] *= (1.0 + w * (g - 1.0))
    print("    通道增益  R%.3f G%.3f B%.3f  (背景权重 %.3f)" % (*gains, w_bg))

    res = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))
    chk = sample(np.asarray(res).astype(np.float64), PROBES)
    print("    校正后    #%02X%02X%02X" % tuple(int(v) for v in chk))
    return res


# ------------------------------------------------------------- P5 上下沿红
def probe_red(im):
    """#rite 的红底是 CSS 渐变，照片压在上面。量出照片上下沿的红，好对接缝。

    用中位数不用均值：上沿有一角婚书立轴的米黄，均值会被它拉偏一大截。
    """
    b = np.asarray(im).astype(np.float64)
    H = b.shape[0]
    top = np.median(b[:max(1, int(H * 0.02))].reshape(-1, 3), axis=0)
    bot = np.median(b[int(H * 0.98):].reshape(-1, 3), axis=0)
    print("    照片上沿  #%02X%02X%02X   → style.css --red-top" % tuple(int(v) for v in top))
    print("    照片下沿  #%02X%02X%02X   → style.css --red"     % tuple(int(v) for v in bot))
    return top, bot


# ------------------------------------------------------------------- 导出
def emit(res, name, widths, ext, check, report):
    for width in widths:
        if width > res.width:
            sys.exit("✗ %s：源图只有 %d 宽，导不出 %dw" % (name, res.width, width))
        h = round(res.height * width / res.width)
        r = res.resize((width, h), Image.LANCZOS) if width != res.width else res
        fn = "%s-%s-%d.%s" % (name, VER, width, ext)
        p = os.path.join(IMG, fn)
        if check:
            report.append(("缺" if not os.path.exists(p) else "有", fn))
            continue
        if ext == "webp":
            r.save(p, "WEBP", quality=WEBP_Q, method=6)
        else:
            r.save(p, "JPEG", quality=JPG_Q, optimize=True, progressive=True)
        print("      %-24s %5dx%-5d %6.1f KB" % (fn, width, h, os.path.getsize(p) / 1024))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只报缺哪些产物，不写文件")
    args = ap.parse_args()

    os.makedirs(BUILD, exist_ok=True)
    report, total = [], 0

    for ph in PHOTOS:
        print("\n%s  ←  pics/%s" % (ph["name"], ph["src"]))
        im = ImageOps.exif_transpose(Image.open(os.path.join(PICS, ph["src"]))).convert("RGB")
        print("    源图 %dx%d" % im.size)

        if ph.get("balance"):
            im = white_balance(im)
            # 喜帖卡要的是校正之后的全尺寸，不是页面上任何一档
            if not args.check:
                im.save(os.path.join(BUILD, "_p1-corrected.jpg"), "JPEG", quality=94)
        if ph.get("probe_red"):
            probe_red(im)

        emit(im, ph["name"], ph["webp"], "webp", args.check, report)
        emit(im, ph["name"], ph["jpg"], "jpg", args.check, report)

    if args.check:
        miss = [f for s, f in report if s == "缺"]
        for s, f in report:
            print("  %s  %s" % (s, f))
        if miss:
            sys.exit("\n✗ 缺 %d 个产物，跑一次 python3 tools/build-photos.py" % len(miss))
        print("\n✓ 产物齐全")
        return

    for f in sorted(os.listdir(IMG)):
        if ("-%s-" % VER) in f:
            total += os.path.getsize(os.path.join(IMG, f))
    print("\n完成。%d 个产物合计 %.1f KB。原图未改动。" %
          (sum(len(p["webp"]) + len(p["jpg"]) for p in PHOTOS), total / 1024))
    print("接着跑：build-lqip.py（占位图）、build-cards.py（分享图与喜帖）")


if __name__ == "__main__":
    main()
