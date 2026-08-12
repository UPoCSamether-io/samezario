// エリア輪郭の幾何。DOM を触らないので Node からも読める（geo.test.mjs）。
//
// getTotalLength / getPointAtLength でやらないのには理由がある。renderMaps() は
// #s-map がまだ display:none のまま、モジュール読み込み時に走る。WebKit は
// 描画オブジェクトを持たない要素に対してこれらを 0 で返すので、iPhone だけ
// 重心が求まらず鍵の位置がずれていた。Blink は描画の有無に関係なく計算するため
// Chrome の開発者ツールでは再現しない —— 「実機でだけ出る」の正体がこれ。
// パス文字列だけで完結させておけば、いつ呼ばれても、どのエンジンでも同じ値になる。

/** "M x yl dx dy,...z"（data.js のエリア輪郭）→ 頂点配列 */
export function parseAreaPath(d) {
  const m = String(d).match(/^M(-?[\d.]+) (-?[\d.]+)l(.*)z$/);
  if (!m) throw new Error('area path の形が違う: ' + String(d).slice(0, 32));
  const pts = [[+m[1], +m[2]]];
  for (const pair of m[3].split(',')) {
    const [dx, dy] = pair.trim().split(/\s+/).map(Number);
    const p = pts[pts.length - 1];
    pts.push([p[0] + dx, p[1] + dy]);
  }
  return pts;
}

/**
 * 多角形の面積加重重心。
 * 面積が 0（＝一直線に潰れた輪郭）のときだけ頂点の平均へ逃がす。
 */
export function centroidOfPath(d) {
  const pts = parseAreaPath(d);
  let a2 = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    const f = x0 * y1 - x1 * y0;
    a2 += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  if (!a2) {
    const n = pts.length;
    return {
      x: pts.reduce((s, p) => s + p[0], 0) / n,
      y: pts.reduce((s, p) => s + p[1], 0) / n,
    };
  }
  return { x: cx / (3 * a2), y: cy / (3 * a2) };
}
