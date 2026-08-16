#!/usr/bin/env python3
"""エリア図（色分け PNG）から各エリアの輪郭を取り、path 文字列にする。

    python3 scripts/trace-areas.py

出したものは `scripts/seal-arms.mjs` の ORIGINAL に貼る。そこで細い腕を落としてから
data.js の path になる ——「元絵を差し替えて輪郭を取り直し、同じスクリプトを通す」の
前半がこれ。出力形式は seal-arms.mjs と同じ "M x yl dx dy,...z"。

手順は 色で分類 → 収縮で境界のアンチエイリアスを切る → 最大の塊だけ残す → 膨張で戻す
→ 穴を埋める → Moore 近傍で外周を1本たどる → Douglas-Peucker で間引き。
色は元絵の実測値。塗り足しやアンチエイリアスがあるので厳密一致ではなく最近傍で拾う。
"""
from PIL import Image, ImageDraw, ImageFilter

SRC = 'public/img/chofu_map.png'
VIEW_W = 1103                  # index.html の viewBox と揃っていること
# data.js の MAPS[].id → 元絵の塗り色
PALETTE = {
    'chofu':    (185, 84, 72),
    'jindaiji': (95, 120, 142),
    'tamagawa': (0, 0, 0),
    'airport':  (211, 164, 32),
    'sengawa':  (89, 133, 98),
}
BG = (255, 255, 255)           # 余白。エリアの外はここへ落ちる
CLEAN = 5                      # 収縮/膨張のカーネル辺長(px)。境界の橋を切る幅
SIMPLIFY = 1.6                 # 輪郭の間引き許容誤差(px)。seal-arms.mjs と同じ値


def classify(img):
    """各画素を最近傍の PALETTE 色へ。返すのは id → 二値 Image('1')"""
    refs = list(PALETTE.values()) + [BG]
    lut = {}
    raw = img.tobytes()
    px = [tuple(raw[i:i + 3]) for i in range(0, len(raw), 3)]
    out = {k: Image.new('L', img.size, 0) for k in PALETTE}
    buf = {k: bytearray(len(px)) for k in PALETTE}
    for i, c in enumerate(px):
        j = lut.get(c)
        if j is None:
            j = min(range(len(refs)), key=lambda k: sum(
                (c[t] - refs[k][t]) ** 2 for t in range(3)))
            lut[c] = j
        if j < len(PALETTE):
            buf[list(PALETTE)[j]][i] = 255
    for k in PALETTE:
        out[k].frombytes(bytes(buf[k]))
    return out


def erode(m, n=1):
    for _ in range(n):
        m = m.filter(ImageFilter.MinFilter(3))
    return m


def dilate(m, n=1):
    for _ in range(n):
        m = m.filter(ImageFilter.MaxFilter(3))
    return m


def deepest(m):
    """一番奥まった画素。収縮しきる直前まで残るのは最大の塊なので、その種を返す"""
    prev = m
    while True:
        nxt = erode(prev)
        if not nxt.getbbox():
            g = prev.load()
            x0, y0, x1, y1 = prev.getbbox()
            return next(((x, y) for y in range(y0, y1) for x in range(x0, x1) if g[x, y]),
                        None)
        prev = nxt


def largest(m):
    """最大の連結成分だけ残す（収縮でちぎれた小片を捨てる）"""
    seed = deepest(m)
    if seed is None:
        raise SystemExit('塗りが見つからない。PALETTE の色が元絵と合っていない')
    flood = m.convert('L')
    ImageDraw.floodfill(flood, seed, 128)
    return flood.point(lambda v: 255 if v == 128 else 0)


def fill_holes(m):
    """外側から塗って、届かなかった空白を穴として埋める"""
    inv = m.point(lambda v: 0 if v else 255)
    pad = Image.new('L', (m.width + 2, m.height + 2), 255)
    pad.paste(inv, (1, 1))
    ImageDraw.floodfill(pad, (0, 0), 128)
    outside = pad.crop((1, 1, m.width + 1, m.height + 1))
    return outside.point(lambda v: 0 if v == 128 else 255)


# 8近傍を反時計回りに（seal-arms.mjs の trace と同じ並び）
N8 = [(1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1)]


def trace(m):
    """Moore 近傍で外周を1本たどる。返すのは画素座標の閉路"""
    w, h = m.size
    g = m.load()
    at = lambda x, y: 0 <= x < w and 0 <= y < h and g[x, y]
    sx, sy = next((x, y) for y in range(h) for x in range(w) if g[x, y])
    out = [(sx, sy)]
    cx, cy, d = sx, sy, 0
    for _ in range(w * h * 8):
        for k in range(8):
            nd = (d + 6 + k) % 8            # 前回来た方向の右手から探す
            nx, ny = cx + N8[nd][0], cy + N8[nd][1]
            if at(nx, ny):
                cx, cy, d = nx, ny, nd
                break
        else:
            break
        if (cx, cy) == (sx, sy):
            break
        out.append((cx, cy))
    return out


def simplify(pts, eps):
    """Douglas-Peucker"""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a]
        bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        ln = (dx * dx + dy * dy) ** 0.5 or 1
        far, fd = -1, eps
        for i in range(a + 1, b):
            d = abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / ln
            if d > fd:
                fd, far = d, i
        if far > 0:
            keep[far] = True
            stack += [(a, far), (far, b)]
    return [p for p, k in zip(pts, keep) if k]


def emit(pts):
    r = lambda v: int(round(v))
    seg = [f'{r(pts[i][0]) - r(pts[i - 1][0])} {r(pts[i][1]) - r(pts[i - 1][1])}'
           for i in range(1, len(pts))]
    return f'M{r(pts[0][0])} {r(pts[0][1])}l' + ','.join(seg) + 'z'


def area(pts):
    a = 0
    for i, (x0, y0) in enumerate(pts):
        x1, y1 = pts[(i + 1) % len(pts)]
        a += x0 * y1 - x1 * y0
    return abs(a) / 2


img = Image.open(SRC).convert('RGB')
if img.width != VIEW_W:
    raise SystemExit(f'元絵の幅が viewBox と違う: {img.width} != {VIEW_W}')

masks = classify(img)
for name in PALETTE:
    m = fill_holes(dilate(largest(erode(masks[name], CLEAN // 2)), CLEAN // 2))
    ring = simplify(trace(m), SIMPLIFY)
    pts = [(x + 0.5, y + 0.5) for x, y in ring]
    print(f'// {name}  塗り{m.histogram()[255]}px  '
          f'輪郭の面積{round(area(pts))}  頂点{len(pts)}')
    print(f"  {name}: {{ size: ????, d: '{emit(pts)}' }},")
