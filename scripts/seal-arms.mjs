// エリア輪郭から「細すぎる腕」を落とすワンショット道具。
//
//   node scripts/seal-arms.mjs           # 幅の実測レポートだけ出す
//   node scripts/seal-arms.mjs --emit    # data.js に貼る path 文字列を出す
//
// やっていること = 二値画像のオープニング（収縮 → 最大の塊だけ残す → 膨張）。
// 収縮で切れた腕は独立した島になるので、最大成分だけ拾えば消える。
// 出力は入力と同じ "M x yl dx dy,...z" 形式なので、ロケ地選択画面もそのまま動く。
//
// 入力は下の ORIGINAL が原本。data.js を上書きしても、ここから作り直せる。

const MIN_PASSAGE = 360;   // 通路の最小幅(ワールドpx)。これより細い腕は落とす
const GRID = 600;          // ラスタ解像度（viewBox 1103 幅に対して）
const SIMPLIFY = 1.6;      // 輪郭の間引き許容誤差(グリッドpx)
const VIEW_W = 1103;

// data.js 取り込み時点の原本。--emit の出力で data.js の path を差し替える。
const ORIGINAL = {
  chofu: { size: 4200, d: 'M349 541l37 11,10 5,107 38,119 14,3 0,17 -11,6 -2,7 7,14 22,8 9,9 28,40 12,8 -2,6 -4,4 0,4 4,1 16,-5 5,-44 8,-12 28,-1 6,-3 4,-19 48,-7 75,-13 65,-5 7,-4 0,-51 -22,-110 -3,-7 -6,-18 -36,-157 -49,-7 -6,23 -75,2 -12,-25 -23,-1 -5,26 -66,3 -4,31 -82z' },
  jindaiji: { size: 4600, d: 'M628 113l2 0,6 7,9 37,0 6,4 15,2 2,0 5,2 2,6 31,2 2,1 9,2 2,7 28,6 32,2 1,1 4,9 81,8 39,-1 15,1 4,5 5,3 13,0 9,-5 5,1 5,-2 7,-2 1,-5 14,-4 4,1 4,-8 17,-1 6,-3 3,-13 36,-3 3,-2 9,-8 11,0 8,-6 6,-9 5,-6 -1,-6 7,-7 -1,-1 -2,-6 1,-1 -2,-12 2,-10 -3,-6 1,-2 -2,-9 -1,-7 1,-44 -7,-8 1,-108 -37,-6 -6,-7 -2,-6 -6,0 -5,2 -1,-1 -8,3 -12,5 -5,3 -10,-2 -2,2 -4,-2 -7,2 -1,-1 -3,2 -1,-2 -2,0 -14,-2 -1,0 -3,3 -2,0 -4,-2 -1,-1 -14,2 -3,0 -6,-2 -1,1 -25,-2 -1,-1 -7,16 -19,0 -4,-26 -20,0 -6,-2 -2,-7 -31,4 -39,2 -3,0 -7,3 -3,-2 -3,0 -9,2 -1,-1 -7,2 -15,2 -1,6 -62,2 -1,0 -12,5 -5,15 3,2 -14,5 -5,25 -8,19 5,1 2,10 2,17 8,9 0,11 -4,5 0,8 -4,8 0,14 -6,73 -18z' },
  tamagawa: { size: 5000, d: 'M848 267l7 0,30 19,7 8,7 22,50 -11,15 0,38 33,4 13,11 22,1 13,-3 7,-7 6,-7 3,-4 9,-7 7,-13 5,0 4,5 15,21 7,10 12,0 66,7 15,7 22,19 -3,4 4,11 62,-4 4,-12 1,2 84,-5 5,-29 14,-8 0,-28 -22,-5 0,-13 14,-4 1,-8 -9,-4 -8,-13 -14,2 -18,-12 4,2 15,-3 3,-28 -6,-21 -9,-4 -4,3 -7,-23 -8,-5 -5,-7 -12,-26 -9,-77 36,-8 0,-22 -8,-14 -3,-6 -6,-8 -27,-25 -34,0 -7,-3 -2,0 -3,2 -4,9 -7,14 -38,15 -34,-3 -7,5 -5,3 0,7 -18,-3 -7,6 -7,2 1,-4 -22,-3 1,-4 -4,-1 -5,0 -6,4 -3,-1 -8,3 -3,7 2,13 10,10 3,11 0,34 -8,13 -1,37 44,-4 18,15 6,6 0,3 -2,9 -33,19 -14,17 -16,18 -12,-16 -6,-11 -2,-6 -6,-9 -20,0 -4,5 -5,7 -2,-3 -11,-11 6,-8 -6,-2 -13,3 -14,6 -7,9 -1,-6 -21,-38 -14,-6 -5,3 -5,12 -1z' },
  airport: { size: 4400, d: 'M133 33l10 0,7 5,25 49,26 22,2 0,9 10,0 27,-4 4,-4 1,-34 5,-2 2,-1 15,7 6,0 26,18 5,5 5,-2 14,-9 6,-3 15,11 3,5 -18,7 -6,11 0,4 4,2 53,9 1,4 4,0 22,14 8,5 1,5 5,0 4,-13 26,26 8,8 -29,5 -5,4 0,19 15,13 7,18 20,-1 6,-6 6,-5 -1,-1 15,5 -6,5 0,9 7,-1 11,24 5,6 0,14 -10,6 4,4 92,-14 47,-5 5,-3 0,-26 -10,-2 1,0 4,-2 1,0 4,-2 1,0 4,-2 1,-10 25,-3 12,-2 1,0 4,-2 1,0 4,-2 1,-10 25,-1 7,-2 1,-2 9,-3 3,-18 45,0 2,27 25,0 5,-15 45,-9 34,-5 5,-6 -2,-45 -28,-53 -10,-20 -2,-13 -11,0 -2,-52 -54,-3 -112,-22 -26,-20 -3,-8 -6,84 -196,4 -4,10 1,1 -17,4 -4,11 1,1 -2,10 -45,-15 -63,-38 -13,-5 -5,-1 -5,0 -6,5 -5,31 -9,0 -12,-43 -13,-4 -4,3 -17,-6 -4,0 -6,17 -50,9 -21,6 -21z' },
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
