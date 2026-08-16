import assert from 'node:assert/strict';
import { parseAreaPath, centroidOfPath } from './geo.js';
import { MAPS } from './data.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// 相対 lineto を絶対座標へ畳めているか
{
  const pts = parseAreaPath('M10 20l5 0,0 5,-5 0z');
  assert.deepEqual(pts, [[10, 20], [15, 20], [15, 25], [10, 25]]);
}

// 正方形の重心は中心
{
  const c = centroidOfPath('M0 0l10 0,0 10,-10 0z');
  assert.ok(near(c.x, 5) && near(c.y, 5), `square: ${JSON.stringify(c)}`);
}

// 重心は「頂点の平均」ではない。辺の刻み方に引きずられないことを見る
// （下辺だけ細かく分割した正方形。頂点平均なら下へ寄るが、重心は動かない）
{
  const c = centroidOfPath('M0 0l2 0,2 0,2 0,2 0,2 0,0 10,-10 0z');
  assert.ok(near(c.x, 5) && near(c.y, 5), `dense edge: ${JSON.stringify(c)}`);
}

// 巻き方向が逆でも同じ点（符号付き面積が両方に効くので打ち消す）
{
  const cw = centroidOfPath('M0 0l10 0,0 10,-10 0z');
  const ccw = centroidOfPath('M0 0l0 10,10 0,0 -10z');
  assert.ok(near(cw.x, ccw.x) && near(cw.y, ccw.y), 'winding');
}

// 実データ。重心が自分の外接矩形の内側に来ること（外れたら位置決めに使えない）
for (const m of MAPS) {
  const pts = parseAreaPath(m.path);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const c = centroidOfPath(m.path);
  assert.ok(c.x > Math.min(...xs) && c.x < Math.max(...xs), `${m.id} x out of bbox`);
  assert.ok(c.y > Math.min(...ys) && c.y < Math.max(...ys), `${m.id} y out of bbox`);
}

// ブラウザで実測した値との突き合わせ。DOM 版（getPointAtLength を 256 点）が
// 出していた重心と一致すること。ズレたらどちらかの実装が壊れている。
// 深大寺だけを見るのは、#52 で区割りを引き直しても位置が動かなかった唯一のエリアだから
// （他は南部を切り出したり作り直したりしたので、当時の実測値とは比べられない）
{
  const m = MAPS.find((v) => v.id === 'jindaiji');
  assert.ok(m, 'jindaiji が data.js に無い');
  const c = centroidOfPath(m.path);
  assert.ok(Math.abs(c.x - 536) <= 2 && Math.abs(c.y - 368) <= 2,
    `jindaiji: ${JSON.stringify(c)} != 536,368`);
}

console.log('geo ok');
