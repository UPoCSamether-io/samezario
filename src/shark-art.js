// サメの見た目。ゲーム内とキャラ選択プレビューで共有する描画関数。
const TAU = Math.PI * 2;
const INK = '#2d2d2d';
const PAPER = '#f4efea';

// ---------------------------------------------------------------- スプライト
// サメごとの原画 /img/sharks/<id>.webp を rope（胴体の点列）に沿って短冊状に貼る。
// 配信するのは art/sharks の原寸 2528x1686 を scripts/build-sprites.py で 512px へ落とした版。
const BAKE_H = 256;     // 焼き込み解像度（配信元の 512px からさらに半分に落とす）
const PROBE_H = 256;    // 余白を探すときの高さ。原寸(4.26MP)を走査すると1枚 190ms 主スレッドが止まる
const FAT = 1.12;       // 胴の最大半径 → スプライト高さの倍率。絵ごとに def.fat で上書きできる
const ASPECT0 = 1.7;    // ロード前の仮の縦横比（実測 1.60〜1.91 の中間）

const SPRITES = new Map(); // id -> {canvas, aspect}。値 null = ロード中

/**
 * 透明な余白を落として BAKE_H に縮小する。絵ごとに余白量も原寸も違うので必須。
 * 余白の探索は PROBE_H まで縮めた版で行い、見つけた枠を原寸へ戻してから切る。
 * 縮小で薄まった縁を落とさないよう、枠はプローブの1px分ふくらませる。
 */
function bake(img) {
  const ph = Math.min(PROBE_H, img.height);
  const pw = Math.max(1, Math.round((img.width / img.height) * ph));
  const s = document.createElement('canvas');
  s.width = pw; s.height = ph;
  const g = s.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, pw, ph);
  const d = g.getImageData(0, 0, pw, ph).data;
  let x0 = pw, y0 = ph, x1 = -1, y1 = -1;
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      if (d[(y * pw + x) * 4 + 3] < 8) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) { x0 = y0 = 0; x1 = pw - 1; y1 = ph - 1; }   // 全部透明。切らずにそのまま
  const kx = img.width / pw, ky = img.height / ph;
  const sx = Math.max(0, Math.floor((x0 - 1) * kx));
  const sy = Math.max(0, Math.floor((y0 - 1) * ky));
  const w = Math.min(img.width, Math.ceil((x1 + 2) * kx)) - sx;
  const h = Math.min(img.height, Math.ceil((y1 + 2) * ky)) - sy;

  const c = document.createElement('canvas');
  c.height = BAKE_H;
  c.width = Math.round((w / h) * BAKE_H);
  c.getContext('2d').drawImage(img, sx, sy, w, h, 0, 0, c.width, c.height);
  return { canvas: c, aspect: c.width / c.height };
}

/** サメ種のスプライト。初回呼び出しで読み込みを始め、間に合うまでは null */
function spriteOf(def) {
  if (!SPRITES.has(def.id)) {
    SPRITES.set(def.id, null);
    const img = new Image();
    img.src = `/img/sharks/${def.id}.webp`;
    // onload 直後に drawImage すると 4.26MP のデコードを主スレッドへ引き込む。
    // decode() を待てば裏で終わっており、bake は縮小と走査だけになる
    img.decode().then(() => SPRITES.set(def.id, bake(img)), () => {});
  }
  return SPRITES.get(def.id);
}

/**
 * 全種の画像を先に読ませる。ブラウザ側の入口(main.js)から一度呼ぶ。
 * spriteOf は「最初に描かれた瞬間」に読み始めるので、これが無いとキャラ選択で
 * サメを切り替えるたび、その種の画像が届くまでベクター版が一瞬出る。
 */
export const preloadSharks = (defs) => defs.forEach(spriteOf);

/**
 * 胴の半径 r のサメの体長。伸びずに太さと一緒に拡大する。
 * 縦横比は data.js の def.aspect（scripts/sprite-aspect.py が bake() と同じトリムで測った値）。
 * 焼き上がりの実測ではなく定数を使うのは、これが当たり判定の寸法だから：
 * spriteOf() を読むと画像のロード完了で体長が変わり、同じ盤面でも当たる／当たらないが変わる。
 * それに、サーバ側の sim.js は document を持たないので spriteOf() を呼べない。
 */
export const bodyLength = (r, def) => r * 2 * (def.fat ?? FAT) * (def.aspect ?? ASPECT0);

/**
 * body の点列を骨として原画を曲げる（rope）。
 * 短冊は骨ごとに回すので、曲がった関節の外側には「高さ×角度差」の楔が開く。
 * 重ねる量を体の高さと角度差から出すのが要点：長さの一定割合（旧 8%）だと
 * 体がでかいほど楔だけが伸びて足りなくなり、旋回中に胴が細切れに見えていた。
 * 埋めるときは元画像の切り出し幅も一緒に伸ばす（引き伸ばすと絵が歪むため）。
 * 画像未ロードなら false を返すので、呼び側はベクター版へ落とす。
 */
export function paintSpriteShark(ctx, body, def) {
  const sp = spriteOf(def);
  const n = body.length;
  if (!sp || n < 2) return false;
  const src = sp.canvas;
  let R = 0;
  for (const p of body) if (p.r > R) R = p.r;
  const h = R * 2 * (def.fat ?? FAT);
  const sw = src.width / (n - 1);
  const ang = [];
  for (let i = 0; i < n - 1; i++) {
    ang.push(Math.atan2(body[i + 1].y - body[i].y, body[i + 1].x - body[i].x));
  }
  for (let i = 0; i < n - 1; i++) {
    const a = body[i], b = body[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    // 次の骨との角度差。外側に開く楔の奥行きは (高さ/2) × 角度差
    const d = i + 1 < ang.length
      ? Math.abs(((ang[i + 1] - ang[i] + Math.PI) % TAU + TAU) % TAU - Math.PI) : 0;
    const over = Math.min(len, len * 0.04 + h * 0.5 * d);   // 上限は短冊1枚ぶん
    const cut = Math.min(sw * (1 + over / len), src.width - i * sw);
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(ang[i]);
    ctx.drawImage(src, i * sw, 0, cut, src.height, 0, -h / 2, (cut / sw) * len, h);
    ctx.restore();
  }
  return true;
}

/** 0=頭 → 1=尾 の胴体の太さ倍率 */
export function taper(t) {
  if (t < 0.06) return 0.6 + (t / 0.06) * 0.26;            // 丸い鼻先
  if (t < 0.3) return 0.86 + ((t - 0.06) / 0.24) * 0.14;   // 肩で最大
  if (t < 0.46) return 1;
  return Math.max(0.1, 1 - Math.pow((t - 0.46) / 0.54, 1.3) * 0.92);
}

/** 色を暗くする（#rrggbb 前提） */
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.round(Math.min(255, Math.max(0, v * k)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

/**
 * body: [{x, y, r}] 頭が index 0。
 * angle: 頭の向き(rad)。wobble: ひれの揺れ位相。lw: 輪郭線の太さ。
 */
export function paintShark(ctx, body, angle, def, { lw = 3.2, wobble = 0 } = {}) {
  const n = body.length;
  if (n < 4) return;
  const hr = body[0].r;

  // 各点の「前方向」と左右のオフセット
  const fwd = [], left = [], right = [];
  for (let i = 0; i < n; i++) {
    const p = body[i];
    const a = Math.atan2(
      body[Math.max(0, i - 1)].y - body[Math.min(n - 1, i + 1)].y,
      body[Math.max(0, i - 1)].x - body[Math.min(n - 1, i + 1)].x);
    fwd.push(a);
    const nx = Math.cos(a + Math.PI / 2) * p.r, ny = Math.sin(a + Math.PI / 2) * p.r;
    left.push([p.x + nx, p.y + ny]);
    right.push([p.x - nx, p.y - ny]);
  }

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw;
  const finFill = shade(def.color, 0.72);
  // ひれは胴体の最大幅を基準にする（頭半径だと胴に埋もれる）
  let R = 0;
  for (const p of body) if (p.r > R) R = p.r;

  // 頭からの弧長 d の位置・前方向を返す。ひれは体の長さでなく頭からの距離で固定する
  // （胴が伸びる .io 形式なので、割合で置くと巨大化時に後ろへ流れてしまう）
  const step = Math.hypot(body[1].x - body[0].x, body[1].y - body[0].y) || R * 0.5;
  const at = (d) => {
    const f = Math.min(n - 1.001, Math.max(0, d / step));
    const i = f | 0, k = f - i;
    const a = body[i], b = body[i + 1];
    return {
      x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k,
      r: a.r + (b.r - a.r) * k, a: fwd[i],
    };
  };

  // --- 尾びれ（三日月）---
  const tp = body[n - 1], ta = fwd[n - 1], Rt = R * 0.78;
  const ux = Math.cos(ta), uy = Math.sin(ta);          // 前
  const px = Math.cos(ta + Math.PI / 2), py = Math.sin(ta + Math.PI / 2); // 横
  const T = (b, s) => [tp.x - ux * Rt * b + px * Rt * s, tp.y - uy * Rt * b + py * Rt * s];
  ctx.beginPath();
  ctx.moveTo(...T(-0.2, 0));
  ctx.quadraticCurveTo(...T(1.1, 0.9), ...T(2.3, 1.5));
  ctx.quadraticCurveTo(...T(1.5, 0.5), ...T(0.9, 0.05));
  ctx.quadraticCurveTo(...T(1.4, -0.5), ...T(1.9, -1.15));
  ctx.quadraticCurveTo(...T(0.9, -0.7), ...T(-0.2, 0));
  ctx.closePath();
  ctx.fillStyle = def.accent; ctx.fill(); ctx.stroke();

  // --- 胸びれ ---
  const fp = at(R * 1.7), fa = fp.a;
  const fux = Math.cos(fa), fuy = Math.sin(fa);
  for (const sgn of [1, -1]) {
    const qx = Math.cos(fa + sgn * Math.PI / 2), qy = Math.sin(fa + sgn * Math.PI / 2);
    const swing = 1 + Math.sin(wobble + (sgn > 0 ? 0 : 0.5)) * 0.1;
    const P = (f, s) => [fp.x + fux * R * f + qx * R * s * swing, fp.y + fuy * R * f + qy * R * s * swing];
    ctx.beginPath();
    ctx.moveTo(...P(0.5, 0.4));
    ctx.quadraticCurveTo(...P(0.05, 1.5), ...P(-1.25, 1.85));
    ctx.quadraticCurveTo(...P(-0.95, 0.85), ...P(-1.2, 0.3));
    ctx.closePath();
    ctx.fillStyle = def.accent; ctx.fill(); ctx.stroke();
  }

  // --- 胴体 ---
  ctx.beginPath();
  ctx.moveTo(left[0][0], left[0][1]);
  for (let i = 1; i < n; i++) ctx.lineTo(left[i][0], left[i][1]);
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  ctx.arc(body[0].x, body[0].y, hr, angle - Math.PI / 2, angle + Math.PI / 2);
  ctx.closePath();
  ctx.fillStyle = def.color;
  ctx.fill(); ctx.stroke();

  // --- 背びれ（背骨に沿った涙形）---
  const dp = at(R * 3.0), da = dp.a;
  const dux = Math.cos(da), duy = Math.sin(da);
  const dqx = Math.cos(da + Math.PI / 2), dqy = Math.sin(da + Math.PI / 2);
  const D = (f, s) => [dp.x + dux * R * f + dqx * R * s, dp.y + duy * R * f + dqy * R * s];
  ctx.beginPath();
  ctx.moveTo(...D(1.0, 0));
  ctx.quadraticCurveTo(...D(0.35, 0.42), ...D(-1.5, 0.04));
  ctx.quadraticCurveTo(...D(0.35, -0.42), ...D(1.0, 0));
  ctx.closePath();
  ctx.fillStyle = finFill; ctx.fill(); ctx.stroke();

  // --- 鼻先のハイライト ---
  ctx.beginPath();
  ctx.ellipse(body[0].x + Math.cos(angle) * hr * 0.2, body[0].y + Math.sin(angle) * hr * 0.2,
    hr * 0.62, hr * 0.46, angle, 0, TAU);
  ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.fill();

  // --- 鰓 ---
  if (hr > 13) {
    ctx.lineWidth = Math.max(1, lw * 0.7);
    ctx.strokeStyle = 'rgba(45,45,45,.5)';
    for (let k = 0; k < 3; k++) {
      const gp = at(R * (0.85 + k * 0.32)), ga = gp.a;
      for (const sgn of [1, -1]) {
        const ax = Math.cos(ga + sgn * Math.PI / 2), ay = Math.sin(ga + sgn * Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(gp.x + ax * gp.r * 0.52, gp.y + ay * gp.r * 0.52);
        ctx.lineTo(gp.x + ax * gp.r * 0.94, gp.y + ay * gp.r * 0.94);
        ctx.stroke();
      }
    }
    ctx.strokeStyle = INK;
  }

  // --- 目 ---
  const er = Math.max(1.7, hr * 0.2);
  for (const sgn of [1, -1]) {
    const ea = angle + sgn * 0.78;
    const ex = body[0].x + Math.cos(ea) * hr * 0.66, ey = body[0].y + Math.sin(ea) * hr * 0.66;
    ctx.lineWidth = Math.max(1, lw * 0.7);
    ctx.beginPath(); ctx.arc(ex, ey, er, 0, TAU);
    ctx.fillStyle = PAPER; ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.arc(ex + Math.cos(angle) * er * 0.32, ey + Math.sin(angle) * er * 0.32, er * 0.52, 0, TAU);
    ctx.fillStyle = INK; ctx.fill();
  }
}

/** その場で泳いでいる風のサメ（頭は右向き = angle 0）。キャラ選択・図鑑のプレビュー用。 */
export function swimBody(cx, cy, len, r, t, n = 22) {
  const body = [];
  const sway = Math.sin(t * 1.9) * len * 0.02;
  for (let i = 0; i <= n; i++) {
    const k = i / n; // 0 = 頭
    body.push({
      x: cx + len * (0.5 - k),
      y: cy + sway + Math.sin(t * 2.6 + k * 2.2) * (1 + k * k * len * 0.03),
      r: r * taper(k),
    });
  }
  return body;
}
