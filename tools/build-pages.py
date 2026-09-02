#!/usr/bin/env python3
"""
从婚礼页生成回门页 —— 两页 94% 的内容是同一份，不能靠复制粘贴维护。

    python3 tools/build-pages.py
    python3 tools/build-pages.py --check    # 只校验产物是不是最新的，不写文件

怎么工作：

    site/index.html   婚礼页本体。它是【手改的】，是唯一的真身，
                      随便改，改完跑一次这个脚本。
    tools/events.json 只放回门宴跟婚礼页【不一样】的那 24 处。
    →  site/huimen/index.html   生成物，不要手改（改了下次构建就被覆盖）。

index.html 里用 HTML 注释当锚点：

    <p class="k hour"><!--ev:hour-->午时设宴<!--/ev--></p>

注释在浏览器里不显示，build-fonts.py 也会先剔注释再扫字，所以锚点
既不上屏、也不进字体子集，对婚礼页本身零影响。

两个方向的错都会让构建【失败退出】，而不是生成一张错帖：

    · index.html 里有锚点、events.json 里没这个键  →  报「缺键」
    · events.json 里有键、index.html 里找不到锚点  →  报「锚点不存在」

所以以后你改文案不小心动到锚点，是构建报错，不是回门页悄悄留着旧地址。
"""

import argparse
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "site", "index.html")
EVENTS = os.path.join(ROOT, "tools", "events.json")

MARK = re.compile(r"<!--ev:([a-z0-9-]+)-->.*?<!--/ev-->", re.S)

# 生成物在 site/huimen/ 下，比 index.html 深一层，相对路径 assets/… 会 404。
# 统一改成根绝对路径 /assets/…。前面已经有 / 或 . 的（og:image 那个
# https://…/assets/…）必须放过，否则会变成 //assets 或 ./assets。
ASSET = re.compile(r"(?<![./\w])assets/")

BANNER = ("<!-- ⚠ 这个文件是 tools/build-pages.py 从 site/index.html 生成的，别手改。\n"
          "     改文案改 site/index.html，改回门宴专属信息改 tools/events.json，\n"
          "     然后跑：python3 tools/build-pages.py && python3 tools/build-fonts.py -->\n")


def render(src, name, overrides):
    """按锚点替换。返回渲染结果，任何一侧对不上就退出。"""
    missing_key = []
    used = {}

    def one(m):
        key = m.group(1)
        if key not in overrides:
            missing_key.append(key)
            return m.group(0)
        used[key] = used.get(key, 0) + 1
        return overrides[key]

    out = MARK.sub(one, src)

    if missing_key:
        sys.exit("✗ %s：index.html 里有这些锚点，events.json 里却没有对应的键：\n   %s"
                 % (name, "  ".join(sorted(set(missing_key)))))

    dead = [k for k in overrides if k not in used]
    if dead:
        sys.exit("✗ %s：events.json 里这些键在 index.html 里找不到锚点（改文案时动到了？）：\n   %s"
                 % (name, "  ".join(sorted(dead))))

    if "<!--ev:" in out or "<!--/ev-->" in out:
        sys.exit("✗ %s：产物里还残留锚点，说明有一对标记没配好" % name)

    out = ASSET.sub("/assets/", out)
    # banner 插在 <!doctype html> 之后
    return out.replace("<!doctype html>\n", "<!doctype html>\n" + BANNER, 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="只校验产物是不是最新的，不写文件（给 CI / 部署前用）")
    args = ap.parse_args()

    src = open(SRC, encoding="utf-8").read()
    conf = json.load(open(EVENTS, encoding="utf-8"))

    stale = []
    for name, ov in conf.items():
        if name.startswith("_"):
            continue
        ov = {k: v for k, v in ov.items() if not k.startswith("_")}
        dest = os.path.join(ROOT, conf[name]["_out"])
        html = render(src, name, ov)

        old = open(dest, encoding="utf-8").read() if os.path.exists(dest) else None
        if args.check:
            if old != html:
                stale.append(conf[name]["_out"])
            continue

        os.makedirs(os.path.dirname(dest), exist_ok=True)
        open(dest, "w", encoding="utf-8").write(html)
        flag = "（无变化）" if old == html else ""
        print("  %-24s %6.1f KB %s" % (conf[name]["_out"], len(html.encode()) / 1024, flag))

    if args.check:
        if stale:
            sys.exit("✗ 这些页面不是最新的，跑一次 python3 tools/build-pages.py：\n   "
                     + "  ".join(stale))
        print("✓ 生成页均为最新")
    else:
        print("✓ 改完文案记得再跑 python3 tools/build-fonts.py（新字要进子集）")


if __name__ == "__main__":
    main()
