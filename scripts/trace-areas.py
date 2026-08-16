#!/usr/bin/env python3
"""エリア図（色分け PNG）から各エリアの輪郭を取り、path 文字列にする。

    python3 scripts/trace-areas.py

出したものは `scripts/seal-arms.mjs` の ORIGINAL に貼る。そこで細い腕を落としてから
data.js の path になる ——「元絵を差し替えて輪郭を取り直し、同じスクリプトを通す」の
前半がこれ。出力形式は seal-arms.mjs と同じ "M x yl dx dy,...z"。

元絵はエリアどうしを白い線で区切って描いてある。色ごとに拾っただけだと、その線の幅が
そのまま**エリア間の隙間**として地図に残り、ロケ地選択画面が継ぎ目だらけになる。
なので色で拾ったあと、白い区切り線を左右のエリアで分け合わせて（SEAM の膨張競争）
外周だけを元に戻す。こうすると5エリアが隙間なく敷き詰まる。

手順:
  色で分類 → 白い区切り線を奪い合って埋める → 外周を閉じ直す → 最大の塊だけ残す
  → 穴を埋める → 隣と少しだけ重ねる → Moore 近傍で外周を1本たどる
  → viewBox 座標へ写す → Douglas-Peucker で間引く

色は元絵の実測値。塗り足しやアンチエイリアスがあるので厳密一致ではなく最近傍で拾う。
"""
from PIL import Image, ImageChops, ImageDraw, ImageFilter

SRC = 'public/img/chofu_map.png'
VIEW_W, VIEW_H = 1103, 960     # index.html の viewBox と揃っていること
MARGIN = 36                    # viewBox の余白(px)。元絵の描画範囲をここに収める
# data.js の MAPS[].id → 元絵の塗り色
PALETTE = {
    'chofu':    (189, 82, 74),
    'jindaiji': (99, 121, 144),
    'tamagawa': (2, 0, 1),
    'airport':  (211, 164, 32),
    'sengawa':  (94, 134, 100),
}
BG = (255, 255, 255)           # 余白。エリアの外はここへ落ちる
SEAM = 14                      # 白い区切り線の最大幅(元絵px)。これだけ膨張して奪い合う
OVERLAP = 3                    # 隣と重ねる幅(元絵px)。境界のヘアラインを消す
SIMPLIFY = 1.6                 # 輪郭の間引き許容誤差(viewBox px)。seal-arms.mjs と同じ値

FULL, NONE = 255, 0


# ---------------------------------------------------------------- 画素の操作
def classify(img):
    """各画素を最近傍の PALETTE 色へ。返すのは id → 二値 Image('L')"""
    refs = list(PALETTE.values()) + [BG]
    lut, raw = {}, img.tobytes()
    px = [tuple(raw[i:i + 3]) for i in range(0, len(raw), 3)]
    buf = {k: bytearray(len(px)) for k in PALETTE}
    keys = list(PALETTE)
    for i, c in enumerate(px):
        j = lut.get(c)
        if j is None:
            j = min(range(len(refs)), key=lambda k: sum(
                (c[t] - refs[k][t]) ** 2 for t in range(3)))
            lut[c] = j
        if j < len(keys):
            buf[keys[j]][i] = FULL
    out = {}
    for k in keys:
        m = Image.new('L', img.size, NONE)
        m.frombytes(bytes(buf[k]))
        out[k] = m
    return out


def erode(m, n=1):
    for _ in range(n):
        m = m.filter(ImageFilter.MinFilter(3))
    return m


def dilate(m, n=1):
    for _ in range(n):
        m = m.filter(ImageFilter.MaxFilter(3))
    return m


AND = ImageChops.darker
OR = ImageChops.lighter
NOT = ImageChops.invert


def fill_seams(masks):
    """白い区切り線を、両側のエリアが1画素ずつ奪い合って埋める（多始点の幅優先）。

    埋めたあとの外周は SEAM ぶん外へふくらんでいるので、同じだけ縮めて閉じ直す。
    閉じる = 膨張してから収縮。区切り線は内側なので埋まったまま、外周だけが元に戻る。
    """
    claimed = None
    for m in masks.values():
        claimed = m if claimed is None else OR(claimed, m)
    silhouette = fill_holes(erode(dilate(claimed, SEAM), SEAM))

    grown = dict(masks)
    for _ in range(SEAM):
        for k in grown:
            fresh = AND(dilate(grown[k]), NOT(claimed))
            grown[k] = OR(grown[k], fresh)
            claimed = OR(claimed, fresh)
    return {k: AND(v, silhouette) for k, v in grown.items()}, silhouette


def deepest(m):
    """一番奥まった画素 ≒ 最大の塊の中。1/4 に縮めてから収縮しきる直前を拾う。

    縮めるのは速さのため（元絵は 200万画素あって、等倍で収縮を繰り返すと帰ってこない）。
    小片は 1/4 の時点でほぼ消えるので、探しているものと逆に転ぶことはない。
    """
    small = m.resize((m.width // 4, m.height // 4), Image.BOX)
    prev = small.point(lambda v: FULL if v > 127 else NONE)
    while True:
        nxt = erode(prev)
        if not nxt.getbbox():
            break
        prev = nxt
    box = prev.getbbox()
    if not box:
        raise SystemExit('塗りが見つからない。PALETTE の色が元絵と合っていない')
    g, src = prev.load(), m.load()
    sx, sy = next((x, y) for y in range(box[1], box[3])
                  for x in range(box[0], box[2]) if g[x, y])
    # 1/4 の1画素は元絵の 4x4。そのどこかは必ず塗られている
    return next((x, y) for y in range(sy * 4, sy * 4 + 4)
                for x in range(sx * 4, sx * 4 + 4) if src[x, y])


def largest(m):
    """最大の連結成分だけ残す（分類のノイズで飛んだ小片を捨てる）"""
    out = m.point(lambda v: FULL if v else NONE)
    ImageDraw.floodfill(out, deepest(m), 1)
    return out.point(lambda v: FULL if v == 1 else NONE)


def fill_holes(m):
    """外側から塗って、届かなかった空白を穴として埋める"""
    pad = Image.new('L', (m.width + 2, m.height + 2), FULL)
    pad.paste(NOT(m), (1, 1))
    ImageDraw.floodfill(pad, (0, 0), 128)
    outside = pad.crop((1, 1, m.width + 1, m.height + 1))
    return outside.point(lambda v: NONE if v == 128 else FULL)


# ---------------------------------------------------------------- 輪郭
# 8近傍を反時計回りに（seal-arms.mjs の trace と同じ並び）
N8 = [(1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1)]


def trace(m):
    """Moore 近傍で外周を1本たどる。返すのは画素座標の閉路"""
    w, h = m.size
    g = m.load()
    box = m.getbbox()
    at = lambda x, y: 0 <= x < w and 0 <= y < h and g[x, y]
    sx, sy = next((x, y) for y in range(box[1], box[3])
                  for x in range(box[0], box[2]) if g[x, y])
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


# ---------------------------------------------------------------- 本処理
img = Image.open(SRC).convert('RGB')
masks = classify(img)
filled, silhouette = fill_seams(masks)

# 元絵の描画範囲を viewBox の内側（MARGIN の余白つき）へ、縦横比そのままで収める
bx0, by0, bx1, by1 = silhouette.getbbox()
scale = min((VIEW_W - 2 * MARGIN) / (bx1 - bx0), (VIEW_H - 2 * MARGIN) / (by1 - by0))
ox = (VIEW_W - (bx1 - bx0) * scale) / 2
oy = (VIEW_H - (by1 - by0) * scale) / 2
to_view = lambda x, y: ((x + 0.5 - bx0) * scale + ox, (y + 0.5 - by0) * scale + oy)

print(f'// 元絵 {img.width}x{img.height} / 描画範囲 {bx1 - bx0}x{by1 - by0} '
      f'→ viewBox {VIEW_W}x{VIEW_H} に {scale:.4f} 倍で配置')
for name in PALETTE:
    m = AND(dilate(fill_holes(largest(filled[name])), OVERLAP), silhouette)
    ring = simplify([to_view(x, y) for x, y in trace(m)], SIMPLIFY)
    print(f'// {name}  塗り{m.histogram()[FULL]}px  '
          f'輪郭の面積{round(area(ring))}  頂点{len(ring)}')
    print(f"  {name}: {{ size: ????, d: '{emit(ring)}' }},")
