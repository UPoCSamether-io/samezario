import assert from 'node:assert/strict';
import { parseAreaPath, centroidOfPath, insidePath } from './geo.js';
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
// 深大寺だけを残してあるのは、輪郭を引き直しても形が変わっていない唯一のエリアだから
// （他は #52 で南部を切り出したので、当時の実測値とは比べられない）
{
  const m = MAPS.find((v) => v.id === 'jindaiji');
  assert.ok(m, 'jindaiji が data.js に無い');
  const c = centroidOfPath(m.path);
  assert.ok(Math.abs(c.x - 536) <= 2 && Math.abs(c.y - 368) <= 2,
    `jindaiji: ${JSON.stringify(c)} != 536,368`);
}

// 実データ全部を、まったく別の解き方（1px の走査線で塗って画素の平均を取る）と突き合わせる。
// centroidOfPath は符号付き面積の重み付け和なので、共通の間違いに落ちる余地がない。
// エリアを描き直しても効き続ける形にしてあるのが、上の実測ピンとの違い
{
  const rasterCentroid = (pts) => {
    const ys = pts.map((p) => p[1]);
    let n = 0, sx = 0, sy = 0;
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
      const wy = y + 0.5, xs = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        if ((a[1] <= wy) === (b[1] <= wy)) continue;
        xs.push(a[0] + ((wy - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
      xs.sort((p, q) => p - q);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        for (let x = Math.ceil(xs[i] - 0.5); x <= Math.floor(xs[i + 1] - 0.5); x++) {
          n++; sx += x + 0.5; sy += wy;
        }
      }
    }
    return { x: sx / n, y: sy / n };
  };

  for (const m of MAPS) {
    const c = centroidOfPath(m.path), r = rasterCentroid(parseAreaPath(m.path));
    assert.ok(Math.abs(c.x - r.x) <= 1.5 && Math.abs(c.y - r.y) <= 1.5,
      `${m.id}: 多角形 ${JSON.stringify(c)} と走査線 ${JSON.stringify(r)} が食い違う`);
  }
}

// 内外判定。正方形の中と外、そして実データでは重心が必ず内側に来ること
{
  const sq = 'M0 0l10 0,0 10,-10 0z';
  assert.ok(insidePath(sq, 5, 5), '正方形の中');
  assert.ok(!insidePath(sq, 15, 5) && !insidePath(sq, 5, -1), '正方形の外');
  for (const m of MAPS) {
    const c = centroidOfPath(m.path);
    assert.ok(insidePath(m.path, c.x, c.y), `${m.id} の重心が輪郭の外にある`);
  }
}

// #52 のエリア構成。5ロケ地がそろっていて、南の多摩川が調布駅・飛行場より南にあること
{
  assert.deepEqual(MAPS.map((m) => m.id),
    ['chofu', 'jindaiji', 'tamagawa', 'airport', 'sengawa']);
  const cen = Object.fromEntries(MAPS.map((m) => [m.id, centroidOfPath(m.path)]));
  assert.ok(cen.tamagawa.y > cen.chofu.y, '多摩川が調布駅・布田より北にある');
  assert.ok(cen.tamagawa.y > cen.airport.y, '多摩川が調布飛行場より北にある');
  assert.ok(cen.sengawa.x > cen.chofu.x, 'つつじヶ丘・仙川が調布駅・布田より西にある');
  assert.ok(cen.airport.x < cen.chofu.x, '調布飛行場が調布駅・布田より東にある');
}

console.log('geo ok');
