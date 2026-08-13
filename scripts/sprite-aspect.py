#!/usr/bin/env python3
"""焼き上がりスプライトの縦横比を測る。data.js の SHARKS[].aspect の出どころ。

shark-art.js の bake()（透明な余白を落として BAKE_H へ縮小）と同じ手順を踏む。
当たり判定の寸法になる値なので、原画を差し替えたら測り直して data.js を書き換えること。

    python3 scripts/sprite-aspect.py
"""
import math
import os
from PIL import Image

BAKE_H, PROBE_H = 256, 256      # shark-art.js と同じ
SRC = 'public/img/sharks'

for name in sorted(os.listdir(SRC)):
    if not name.endswith('.webp') or name.endswith('_side.webp'):
        continue
    img = Image.open(os.path.join(SRC, name)).convert('RGBA')

    # 余白の探索は PROBE_H まで縮めた版で（原寸の走査は主スレッドが 190ms 止まる、の再現）
    ph = min(PROBE_H, img.height)
    pw = max(1, round(img.width / img.height * ph))
    alpha = img.resize((pw, ph)).getchannel('A')
    box = alpha.point([0] * 8 + [255] * 248).getbbox()      # alpha < 8 は無いものとして扱う
    if box is None:                                   # 全部透明。切らずにそのまま
        x0, y0, x1, y1 = 0, 0, pw - 1, ph - 1
    else:
        x0, y0, x1, y1 = box[0], box[1], box[2] - 1, box[3] - 1   # getbbox は右下排他

    # 見つけた枠を原寸へ戻す。縮小で薄まった縁を落とさないようプローブ1px分ふくらませる
    kx, ky = img.width / pw, img.height / ph
    sx = max(0, math.floor((x0 - 1) * kx))
    sy = max(0, math.floor((y0 - 1) * ky))
    w = min(img.width, math.ceil((x1 + 2) * kx)) - sx
    h = min(img.height, math.ceil((y1 + 2) * ky)) - sy

    cw = round(w / h * BAKE_H)
    print(f'{name[:-5]:10} {img.width}x{img.height} -> {cw}x{BAKE_H}  aspect: {cw / BAKE_H:.2f},')
