// エリア輪郭から「細すぎる腕」を落とすワンショット道具。
//
//   node scripts/seal-arms.mjs           # 幅の実測レポートだけ出す
//   node scripts/seal-arms.mjs --emit    # data.js に貼る path 文字列を出す
//
// やっていること = 二値画像のオープニング（収縮 → 最大の塊だけ残す → 膨張）。
// 収縮で切れた腕は独立した島になるので、最大成分だけ拾えば消える。
// 出力は入力と同じ "M x yl dx dy,...z" 形式なので、ロケ地選択画面もそのまま動く。
//
// 入力は下の ORIGINAL が原本 —— `scripts/trace-areas.py` が元絵から起こした輪郭そのもの。
// data.js を上書きしても、元絵 → trace-areas.py → ここ、の順でいつでも作り直せる。

const MIN_PASSAGE = 360;   // 通路の最小幅(ワールドpx)。これより細い腕は落とす
const GRID = 600;          // ラスタ解像度（viewBox 1103 幅に対して）
const SIMPLIFY = 1.6;      // 輪郭の間引き許容誤差(グリッドpx)
const VIEW_W = 1103;

// data.js 取り込み時点の原本。--emit の出力で data.js の path を差し替える。
const ORIGINAL = {
  chofu: { size: 4200, d: 'M382 548l124 42,114 14,19 -11,12 2,23 32,10 29,41 13,18 -7,-1 22,-40 7,-7 3,-34 82,-3 24,-30 -3,-22 -10,-26 4,-30 -20,-51 22,-39 -12,-17 0,-2 19,-9 2,-14 -17,-50 -21,-20 0,-10 -8,-8 9,-6 0,-17 -26,0 -6,71 -182,4 -2z' },
  jindaiji: { size: 4600, d: 'M626 115l4 4,43 172,16 118,14 6,-7 -2,0 3,9 42,-55 134,26 35,9 28,41 12,35 -17,4 1,-21 9,-1 7,-15 4,-13 0,-35 -13,-8 -27,-25 -34,-6 0,-16 11,-7 0,-5 -3,-7 2,-30 -6,-70 -6,-71 -24,-18 -8,-18 -5,-14 -7,-6 0,15 -55,-3 -90,3 0,10 -16,0 -15,-20 -16,-9 -39,21 -161,19 0,2 -17,25 -8,46 15,16 0,122 -33z' },
  tamagawa: { size: 4400, d: 'M199 649l3 0,45 36,28 12,5 35,3 7,26 -2,19 28,8 -12,4 1,12 9,20 0,49 20,15 18,4 -6,1 -16,19 -1,37 14,51 -23,9 2,25 18,27 -3,20 9,29 4,-6 56,-14 68,-56 -21,-109 -4,-24 -41,-159 -50,-54 -32,-75 -14,-24 -25,-1 -3,62 -84z' },
  airport: { size: 4400, d: 'M135 36l12 1,27 50,35 30,0 27,-42 8,-1 21,6 7,-1 24,23 9,0 17,-10 0,-1 19,16 0,1 -18,18 1,2 53,3 3,9 0,1 24,24 13,-8 17,0 15,11 5,16 0,9 -28,3 -2,35 23,13 15,-3 8,-9 0,0 15,17 3,2 14,19 4,15 0,17 -9,2 99,-12 46,-74 188,-9 2,-20 -1,-8 -38,-28 -14,-43 -35,-3 1,-56 77,-6 5,-35 -36,-3 -111,-25 -28,-24 -6,81 -192,3 -3,13 -1,1 -19,14 -1,9 -40,0 -18,-13 -55,-41 -15,-2 -9,2 -4,32 -10,1 -16,-45 -15,0 -20,-4 -2,33 -97z' },
  sengawa: { size: 5000, d: 'M848 267l35 21,8 24,4 3,63 -10,34 27,10 21,9 22,-2 11,-16 13,-6 12,-14 5,-3 4,5 20,25 9,5 9,1 65,13 36,4 3,19 -1,11 60,-15 4,1 85,-34 17,-35 -22,-19 14,-23 -27,1 -21,-15 7,2 14,-33 -7,-17 -8,-1 -5,2 -3,-3 -3,-22 -9,-10 -15,-27 -8,-9 2,-48 22,-5 5,-14 7,-11 -1,-36 -11,-9 -27,-26 -37,4 -16,51 -122,-10 -46,29 15,15 0,45 -8,32 39,1 22,18 5,8 -4,10 -32,51 -44,-30 -11,-10 -23,0 -4,11 -5,-4 -11,-1 -2,-9 5,-6 -3,-3 -10,4 -18,14 -7,-6 -21,-46 -20,33 -5z' },
};

/** "M x yl dx dy,dx dy,...z" → [[x,y],...] */
function parse(d) {
  const m = d.match(/^M(-?[\d.]+) (-?[\d.]+)l(.*)z$/);
  if (!m) throw new Error('想定外の path 形式');
  const pts = [[+m[1], +m[2]]];
  for (const pair of m[3].split(',')) {
    const [dx, dy] = pair.trim().split(/\s+/).map(Number);
    const p = pts[pts.length - 1];
    pts.push([p[0] + dx, p[1] + dy]);
  }
  return pts;
}

const emit = (pts) => {
  const r = (v) => Math.round(v);
  let out = `M${r(pts[0][0])} ${r(pts[0][1])}l`;
  const seg = [];
  for (let i = 1; i < pts.length; i++) {
    seg.push(`${r(pts[i][0]) - r(pts[i - 1][0])} ${r(pts[i][1]) - r(pts[i - 1][1])}`);
  }
  return out + seg.join(',') + 'z';
};

const area = (pts) => {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
};

/** 走査線でポリゴンを二値グリッドへ。1px = scale ビューボックス単位 */
function raster(pts, w, h, scale) {
  const g = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const wy = (y + 0.5) * scale;
    const xs = [];
    for (let i = 0, n = pts.length; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      if ((a[1] <= wy) === (b[1] <= wy)) continue;
      xs.push(a[0] + ((wy - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const x0 = Math.max(0, Math.ceil(xs[i] / scale - 0.5));
      const x1 = Math.min(w - 1, Math.floor(xs[i + 1] / scale - 0.5));
      for (let x = x0; x <= x1; x++) g[y * w + x] = 1;
    }
  }
  return g;
}

/** on=1 の画素から見た「0までの距離」。2パスのチャンファー(3,4)/3 */
function distance(g, w, h, on) {
  const D = new Float32Array(w * h);
  const BIG = 1e9;
  for (let i = 0; i < D.length; i++) D[i] = (g[i] === on) ? BIG : 0;
  const relax = (i, j, c) => { if (D[j] + c < D[i]) D[i] = D[j] + c; };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!D[i]) continue;
      if (x > 0) relax(i, i - 1, 3);
      if (y > 0) relax(i, i - w, 3);
      if (x > 0 && y > 0) relax(i, i - w - 1, 4);
      if (x < w - 1 && y > 0) relax(i, i - w + 1, 4);
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!D[i]) continue;
      if (x < w - 1) relax(i, i + 1, 3);
      if (y < h - 1) relax(i, i + w, 3);
      if (x < w - 1 && y < h - 1) relax(i, i + w + 1, 4);
      if (x > 0 && y < h - 1) relax(i, i + w - 1, 4);
    }
  }
  for (let i = 0; i < D.length; i++) D[i] /= 3;
  return D;
}

/** 最大の連結成分だけ残す（収縮でちぎれた腕を捨てる） */
function largestBlob(g, w, h) {
  const seen = new Uint8Array(w * h);
  let best = null, bestN = 0;
  for (let s = 0; s < g.length; s++) {
    if (!g[s] || seen[s]) continue;
    const stack = [s], cells = [];
    seen[s] = 1;
    while (stack.length) {
      const i = stack.pop();
      cells.push(i);
      const x = i % w, y = (i / w) | 0;
      if (x > 0 && g[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack.push(i - 1); }
      if (x < w - 1 && g[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack.push(i + 1); }
      if (y > 0 && g[i - w] && !seen[i - w]) { seen[i - w] = 1; stack.push(i - w); }
      if (y < h - 1 && g[i + w] && !seen[i + w]) { seen[i + w] = 1; stack.push(i + w); }
    }
    if (cells.length > bestN) { bestN = cells.length; best = cells; }
  }
  const out = new Uint8Array(w * h);
  for (const i of best) out[i] = 1;
  return { grid: out, n: bestN };
}

/** Moore 近傍で外周を1本たどる。返すのは画素座標の閉路 */
function trace(g, w, h) {
  let start = -1;
  for (let i = 0; i < g.length && start < 0; i++) if (g[i]) start = i;
  const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h && g[y * w + x]) ? 1 : 0;
  // 8近傍を反時計回りに
  const N8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const sx = start % w, sy = (start / w) | 0;
  const out = [[sx, sy]];
  let cx = sx, cy = sy, dir = 0;
  for (let guard = 0; guard < w * h * 8; guard++) {
    let moved = false;
    for (let k = 0; k < 8; k++) {
      const d = (dir + 6 + k) % 8;          // 前回来た方向の右手から探す
      const nx = cx + N8[d][0], ny = cy + N8[d][1];
      if (!at(nx, ny)) continue;
      cx = nx; cy = ny; dir = d; moved = true;
      break;
    }
    if (!moved) break;
    if (cx === sx && cy === sy) break;
    out.push([cx, cy]);
  }
  return out;
}

/** Douglas–Peucker */
function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let far = -1, fd = eps;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
      if (d > fd) { fd = d; far = i; }
    }
    if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// ---------------------------------------------------------------- 本処理
const doEmit = process.argv.includes('--emit');
const results = {};

for (const [id, { size, d }] of Object.entries(ORIGINAL)) {
  const pts = parse(d);
  const aVB = area(pts);                       // ビューボックス単位の面積
  const worldPerVB = size / Math.sqrt(aVB);    // 「面積が size² になる」倍率
  const scale = VIEW_W / GRID;                 // 1グリッドpx = 何ビューボックス単位か
  const W = GRID, H = Math.round(960 / scale);

  const g = raster(pts, W, H, scale);
  const dIn = distance(g, W, H, 1);            // 内側から外側までの距離(グリッドpx)
  const kPx = (MIN_PASSAGE / 2) / worldPerVB / scale;

  // レポート用：内側画素の何割が「半幅 kPx 未満」＝細い場所か
  let inside = 0, thin = 0;
  for (let i = 0; i < g.length; i++) if (g[i]) { inside++; if (dIn[i] < kPx) thin++; }

  // オープニング：収縮 → 最大成分 → 膨張
  const eroded = new Uint8Array(g.length);
  for (let i = 0; i < g.length; i++) eroded[i] = dIn[i] >= kPx ? 1 : 0;
  const blob = largestBlob(eroded, W, H);
  const dOut = distance(blob.grid, W, H, 0);   // 収縮後の塊までの距離
  const opened = new Uint8Array(g.length);
  for (let i = 0; i < g.length; i++) opened[i] = dOut[i] <= kPx ? 1 : 0;

  const ring = simplify(trace(opened, W, H), SIMPLIFY);
  const outPts = ring.map(([x, y]) => [(x + 0.5) * scale, (y + 0.5) * scale]);
  const aOut = area(outPts);

  results[id] = {
    元の面積: Math.round(aVB),
    処理後の面積: Math.round(aOut),
    残った割合: +(aOut / aVB).toFixed(3),
    細い場所の割合: +(thin / inside).toFixed(3),
    通路の最小幅px: +(kPx * 2 * scale * worldPerVB).toFixed(0),
    頂点数: `${pts.length} → ${outPts.length}`,
    path: emit(outPts),
  };
}

for (const [id, r] of Object.entries(results)) {
  const { path, ...stats } = r;
  console.log(id, JSON.stringify(stats));
}
if (doEmit) {
  console.log('\n--- data.js の path をこれで置き換える ---');
  for (const [id, r] of Object.entries(results)) console.log(`\n// ${id}\npath: '${r.path}',`);
}
