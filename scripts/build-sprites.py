#!/usr/bin/env python3
"""art/sharks の原画を public/img/sharks へ WebP で書き出す。

原画は 2528x1686 (4.26MP) あるが、ゲーム内スプライトは shark-art.js の BAKE_H=256 まで
縮めてから使うので、配信するのは 512px あれば足りる（DPR 2 でも 2 倍の余裕）。
立ち絵は最大 384px 幅で出るので 768px。原寸のまま配ると 1.85MB がタイトル表示に乗る。
"""
import os
from PIL import Image

SRC, DST = 'art/sharks', 'public/img/sharks'
# 立ち絵の最大表示は タイトルの w-[360px]。横 768px あれば DPR 2 でも足りる（高さ 512 で 768 幅）
HEIGHTS = {'sprite': 512, 'side': 512}
QUALITY = 82

os.makedirs(DST, exist_ok=True)
total_src = total_dst = 0
for name in sorted(os.listdir(SRC)):
    if not name.endswith('.png'):
        continue
    src = os.path.join(SRC, name)
    im = Image.open(src).convert('RGBA')
    h = HEIGHTS['side' if name.endswith('_side.png') else 'sprite']
    if im.height > h:
        im = im.resize((round(im.width * h / im.height), h), Image.Resampling.LANCZOS)
    out = os.path.join(DST, name[:-4] + '.webp')
    im.save(out, 'WEBP', quality=QUALITY, method=6)
    a, b = os.path.getsize(src), os.path.getsize(out)
    total_src += a
    total_dst += b
    print(f'{name:22} {a/1024:7.0f}K -> {b/1024:6.0f}K  ({im.width}x{im.height})')
print(f'{"合計":20} {total_src/1024:8.0f}K -> {total_dst/1024:6.0f}K  '
      f'({(1 - total_dst / total_src) * 100:.0f}% 減)')
