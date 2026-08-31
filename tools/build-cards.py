#!/usr/bin/env python3
"""
生成两张构建期图片：

1. share-400.jpg —— 微信分享缩略图。微信取页面里第一张 ≥300×300 的图，
   不认 og: 标签。用 P5 中式红裁方，第一眼就有喜气；白纱的反差留给点进来之后。

2. invite-card.png (1080×1440) —— 可长按保存到相册的喜帖。
   中国人分享 H5 的真实方式是截图和长按保存，不是点分享按钮。
   运行时用 html2canvas 生成是错的（180KB，X5 上中文常渲染成方框），构建期烘焙。

    python3 tools/build-cards.py
"""

import os
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG = os.path.join(ROOT, "site", "assets", "img")
PICS = os.path.join(ROOT, "pics")

SERIF = "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc"
SERIF_B = "/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc"
SC_FACE = 2  # TTC 里 Noto Serif CJK SC 的 face index

PAPER = (0xF5, 0xF3, 0xED)
INK = (0x1F, 0x2A, 0x22)
INK2 = (0x56, 0x60, 0x56)
GOLD = (0xA9, 0x85, 0x4A)


def font(bold, size):
    return ImageFont.truetype(SERIF_B if bold else SERIF, size, index=SC_FACE)


def text_w(d, s, f, tracking=0):
    if tracking == 0:
        return d.textlength(s, font=f)
    return sum(d.textlength(c, font=f) for c in s) + tracking * (len(s) - 1)


def draw_tracked(d, xy, s, f, fill, tracking=0, anchor_center_x=None):
    """PIL 没有字距，逐字画。中文标题不拉字距就没有请柬的呼吸感。"""
    x, y = xy
    if anchor_center_x is not None:
        x = anchor_center_x - text_w(d, s, f, tracking) / 2
    for c in s:
        d.text((x, y), c, font=f, fill=fill)
        x += d.textlength(c, font=f) + tracking


def rule(d, cx, y, width, color=GOLD, h=2):
    d.rectangle([cx - width // 2, y, cx + width // 2, y + h - 1], fill=color)


# ------------------------------------------------------------------ 分享方图
def build_share():
    src = ImageOps.exif_transpose(Image.open(os.path.join(
        PICS, "e6045543dfefb11bbc66230fe7dade7a.jpeg"))).convert("RGB")
    W, H = src.size
    # 取两人 + 右侧「婚书」立轴，方裁
    side = int(W * 0.98)
    x = (W - side) // 2
    y = int(H * 0.12)
    sq = src.crop((x, y, x + side, y + side)).resize((400, 400), Image.LANCZOS)
    p = os.path.join(IMG, "share-400.jpg")
    sq.save(p, "JPEG", quality=88, optimize=True)
    print("share-400.jpg      %6.1f KB" % (os.path.getsize(p) / 1024))


# ------------------------------------------------------------------ 喜帖卡
def build_card():
    CW, CH = 1080, 1440
    PH = 726                       # 照片区高度
    card = Image.new("RGB", (CW, CH), PAPER)
    cx = CW // 2

    # --- 上半：P1（已做过融纸白平衡，背景就是象牙色，与卡面无缝）
    photo = Image.open(os.path.join(ROOT, "build", "_p1-corrected.jpg")).convert("RGB")
    photo = photo.resize((CW, round(photo.height * CW / photo.width)), Image.LANCZOS)
    top = int(photo.height * 0.045)
    card.paste(photo.crop((0, top, CW, top + PH)), (0, 0))

    # 下缘向纸面化开：用带 alpha 渐变的纸色层合成，而不是逐行覆盖
    # （逐行覆盖会把照片内容抹成横向色带）
    fade_h = 200
    veil = Image.new("RGB", (CW, fade_h), PAPER)
    mask = Image.linear_gradient("L").resize((CW, fade_h))   # 上 0 → 下 255
    card.paste(veil, (0, PH - fade_h), mask)

    d = ImageDraw.Draw(card)
    d.rectangle([0, PH, CW, CH], fill=PAPER)

    y = PH + 26
    rule(d, cx, y, 84); y += 46

    # 姓名两组，中间留一条竖金线。每组宽 3*76 + 2*22 = 272，
    # 所以中心必须各偏 (272 + 间隙 90) / 2 = 181，否则会撞在一起。
    nf = font(True, 74)
    draw_tracked(d, (0, y), "金正旭", nf, INK, tracking=22, anchor_center_x=cx - 181)
    draw_tracked(d, (0, y), "刘俊懿", nf, INK, tracking=22, anchor_center_x=cx + 181)
    d.rectangle([cx - 1, y + 22, cx, y + 74], fill=GOLD)
    y += 116

    draw_tracked(d, (0, y), "二〇二六年九月二十六日", font(False, 40), INK,
                 tracking=6, anchor_center_x=cx)
    y += 60
    draw_tracked(d, (0, y), "星期六　农历丙午年八月十六", font(False, 28), INK2,
                 tracking=3, anchor_center_x=cx)
    y += 58

    rule(d, cx, y, 600, (0xDF, 0xDB, 0xD0), h=1); y += 30

    draw_tracked(d, (0, y), "11:58 典礼　·　12:18 开席", font(False, 36), INK,
                 tracking=2, anchor_center_x=cx)
    y += 56
    draw_tracked(d, (0, y), "美悦云禧酒店　5楼 云颂厅", font(True, 36), INK,
                 tracking=4, anchor_center_x=cx)
    y += 54
    draw_tracked(d, (0, y), "山东省济南市槐荫区兴福寺路2660号", font(False, 26), INK2,
                 tracking=2, anchor_center_x=cx)
    y += 54

    rule(d, cx, y, 600, (0xDF, 0xDB, 0xD0), h=1); y += 34

    draw_tracked(d, (0, y), "敬备喜筵　恭候光临", font(False, 33), INK,
                 tracking=10, anchor_center_x=cx)
    y += 54
    draw_tracked(d, (0, y), "金正旭　刘俊懿　敬邀", font(False, 26), INK2,
                 tracking=6, anchor_center_x=cx)
    y += 40

    assert y < CH - 40, "喜帖卡内容溢出：y=%d" % y
    rule(d, cx, CH - 54, 56)

    p = os.path.join(ROOT, "build", "invite-card.png")
    card.save(p, "PNG", optimize=True)
    print("invite-card.png    %6.1f KB  %dx%d" % (os.path.getsize(p) / 1024, CW, CH))

    # 同时存一份 JPEG，页面上用它（PNG 对照片来说太大）
    pj = os.path.join(IMG, "invite-card.jpg")
    card.save(pj, "JPEG", quality=90, optimize=True, progressive=True)
    print("invite-card.jpg    %6.1f KB" % (os.path.getsize(pj) / 1024))


if __name__ == "__main__":
    build_share()
    build_card()
