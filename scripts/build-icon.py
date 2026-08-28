#!/usr/bin/env python3
"""ホーム画面アイコン public/icon-512.png を映画サメの原画から起こす。

マスカブル（Android が円や角丸で切り抜く）を兼ねるので、サメは中央 76% に収める。
安全域は「中心から半径 40%」なので、鼻先と尾びれの先が円の外に出ない大きさが上限。
"""
from PIL import Image

SIZE, FRAC, BG = 512, 0.76, (0x21, 0x30, 0x52, 0xff)

im = Image.open('art/sharks/cinema.png').convert('RGBA')
im = im.crop(im.getbbox())
w = round(SIZE * FRAC)
im = im.resize((w, round(im.height * w / im.width)), Image.Resampling.LANCZOS)

icon = Image.new('RGBA', (SIZE, SIZE), BG)
icon.alpha_composite(im, ((SIZE - im.width) // 2, (SIZE - im.height) // 2))
icon.save('public/icon-512.png', optimize=True)
print(f'public/icon-512.png  {SIZE}x{SIZE}  サメ {im.width}x{im.height}')
