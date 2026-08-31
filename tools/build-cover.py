#!/usr/bin/env python3
"""
封面照片的「融纸」处理 —— 构建期烘焙，运行时绝不用 CSS filter（X5 内核掉帧重灾区）。

P1 是纯白无缝棚拍，背景实测 #DAD8DE，偏冷偏紫。直接压在暖米白 #F5F3ED 的页面上
会发脏，像贴了一张灰卡片。这里做一次高光加权的白平衡，把背景校到 #F2EFE7
（比页面底色暗一档 —— 完全等色会让照片漂空，留一丝明度差才有"印在纸上"的实感）。

加权是关键：权重 w = (L/255)^gamma，背景（L≈218）拿到几乎全部校正，
黑礼服（L≈25）几乎不动，肤色介于两者之间只被轻微提亮。
全局等比增益会把整张照片一起提亮 11%，肤色会发飘。

    python3 tools/build-cover.py
"""

import os
import numpy as np
from PIL import Image, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "pics", "2c3e57df05d2543b98404000d7d61a31.jpeg")
OUT_DIR = os.path.join(ROOT, "site", "assets", "img")

TARGET = (0xF2, 0xEF, 0xE7)   # 背景要落到的颜色
GAMMA = 2.0                    # 权重曲线；越大越只作用于高光
WIDTHS = [480, 750, 1080, 1440]

# 取背景的采样点（避开人物）：左上、右上、左中
PROBES = [(0.05, 0.04), (0.95, 0.04), (0.04, 0.42), (0.96, 0.42)]


def main():
    im = ImageOps.exif_transpose(Image.open(SRC)).convert("RGB")
    a = np.asarray(im).astype(np.float64)
    H, W, _ = a.shape

    # 1) 量出背景当前的颜色
    samples = []
    for fx, fy in PROBES:
        x, y = int(W * fx), int(H * fy)
        samples.append(a[max(0, y - 50):y + 50, max(0, x - 50):x + 50].reshape(-1, 3))
    bg = np.concatenate(samples).mean(0)
    print("背景实测  #%02X%02X%02X" % tuple(int(v) for v in bg))
    print("目标      #%02X%02X%02X" % TARGET)

    # 2) 高光权重
    lum = a @ np.array([0.2126, 0.7152, 0.0722])
    w = np.clip(lum / 255.0, 0, 1) ** GAMMA
    w_bg = float((np.clip(bg @ np.array([0.2126, 0.7152, 0.0722]) / 255.0, 0, 1)) ** GAMMA)

    # 3) 解出每通道增益，使背景在加权后正好落到目标色
    gains = []
    for c in range(3):
        want = TARGET[c] / bg[c]
        gains.append(1.0 + (want - 1.0) / w_bg)
    print("通道增益  R%.3f G%.3f B%.3f  (背景权重 %.3f)" % (*gains, w_bg))

    out = a.copy()
    for c in range(3):
        out[:, :, c] *= (1.0 + w * (gains[c] - 1.0))
    out = np.clip(out, 0, 255).astype(np.uint8)

    res = Image.fromarray(out)

    # 4) 校验：背景是否真的落到目标附近
    b = np.asarray(res).astype(float)
    chk = np.concatenate([
        b[max(0, int(H * fy) - 50):int(H * fy) + 50,
          max(0, int(W * fx) - 50):int(W * fx) + 50].reshape(-1, 3)
        for fx, fy in PROBES
    ]).mean(0)
    print("校正后    #%02X%02X%02X" % tuple(int(v) for v in chk))

    # 5) 导出多档 WebP + JPEG 兜底，覆盖原来的 p1-vow-*
    for width in WIDTHS:
        if width > res.width:
            continue
        h = round(res.height * width / res.width)
        r = res.resize((width, h), Image.LANCZOS)
        p = os.path.join(OUT_DIR, "p1-vow-%d.webp" % width)
        r.save(p, "WEBP", quality=82, method=6)
        print("  %-22s %6.1f KB" % (os.path.basename(p), os.path.getsize(p) / 1024))
    for width in (750, 1440):
        h = round(res.height * width / res.width)
        r = res.resize((width, h), Image.LANCZOS)
        p = os.path.join(OUT_DIR, "p1-vow-%d.jpg" % width)
        r.save(p, "JPEG", quality=82, optimize=True, progressive=True)
        print("  %-22s %6.1f KB" % (os.path.basename(p), os.path.getsize(p) / 1024))

    # 6) 顺带存一张校正后的全尺寸，给请柬卡片用
    res.save(os.path.join(ROOT, "build", "_p1-corrected.jpg"), "JPEG", quality=94)
    print("\n完成。原始文件未改动，pics/ 保持不变。")


if __name__ == "__main__":
    main()
