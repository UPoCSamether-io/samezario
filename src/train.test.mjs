// 鉄橋の電車（影と音）の素の計算の最小チェック: node src/train.test.mjs
// 「いつ鉄橋の上にいるか」「打音の拍」「距離で音量がどう落ちるか」だけを見る。
import assert from 'node:assert/strict';
import {
  TRAIN_LEN, TRAIN_SPEED, TRAIN_PERIOD, TRAIN_PITCH, TRAIN_AXLES, CLACK_FAR,
  trainRun, trainNearest, clackVol, nextClack,
} from './train.js';

const HALF = 4500;
const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// 1. 周期の頭で先頭が手前の端に居て、最後尾が向こうの端を抜けたら null（次の1本まで鳴らない）
{
  const r = trainRun(0, HALF);
  assert.equal(r.k, 0);
  assert.equal(r.dir, 1, '偶数本目は下り（+向き）');
  assert.equal(r.head, -HALF);
  assert.equal(r.hi - r.lo, TRAIN_LEN, '占める範囲は編成の長さ');
  const end = (2 * HALF + TRAIN_LEN) / TRAIN_SPEED;   // 最後尾が抜ける時刻
  assert.ok(end < TRAIN_PERIOD, '次の1本より前に渡り終える');
  assert.ok(trainRun(end - 0.01, HALF), '抜ける直前はまだ居る');
  assert.equal(trainRun(end + 0.01, HALF), null, '渡り終えたら居ない');
  const up = trainRun(TRAIN_PERIOD + 1, HALF);
  assert.equal(up.dir, -1, '奇数本目は上り');
  assert.equal(up.lo, HALF - TRAIN_SPEED, '上りは +端から入ってきて、先頭は -向きの端（lo）');
}

// 2. いちばん近い点。中心線が y 軸（n = (0,1)）、流れが x 軸（f = (1,0)）の鉄橋で試す
{
  const br = { cx: 0, cy: 0, nx: 0, ny: 1, fx: 1, fy: 0, track: [-105, 105] };
  const run = { dir: 1, lo: -1000, hi: 500 };   // 下りは track[1]（x = 105）を走る
  const a = trainNearest(br, run, 405, 0);
  assert.ok(close(a.d, 300) && close(a.x, 105) && close(a.y, 0), '横に居れば真横の点');
  const b = trainNearest(br, run, 105, 900);
  assert.ok(close(b.d, 400) && close(b.y, 500), '先頭より先なら先頭が近い');
  const c = trainNearest(br, { dir: -1, lo: -1000, hi: 500 }, -105, -1200);
  assert.ok(close(c.d, 200) && close(c.x, -105), '上りは track[0] を走り、最後尾が近い');
}

// 3. 音量は近いほど大きく、CLACK_FAR で 0、その先も 0（負にならない）
{
  assert.equal(clackVol(0), 1);
  assert.ok(clackVol(300) > clackVol(800));
  assert.equal(clackVol(CLACK_FAR), 0);
  assert.equal(clackVol(CLACK_FAR * 3), 0);
}

// 4. 打音の拍。1両ぶん（TRAIN_PITCH / TRAIN_SPEED 秒）に車軸の数だけ鳴り、
//    ガタン（2・3）とゴトン（0・1）は 2連打ずつ、その間は 1両の中でいちばん長く空く
{
  const pitchT = TRAIN_PITCH / TRAIN_SPEED;
  let t = 100;   // 適当な時刻から数える
  const hits = [];
  let c = nextClack(t);
  while (c.t < t + pitchT * 3) { hits.push(c); c = nextClack(c.t); }
  assert.equal(hits.length, TRAIN_AXLES.length * 3, '1両ぶんに4発、同じ打音を2回数えない');
  for (let i = 1; i < hits.length; i++) assert.ok(hits[i].t > hits[i - 1].t, '時刻は進む一方');
  // 並びは 0,1,2,3 の繰り返し
  hits.forEach((h, i) => assert.equal(h.axle, (hits[0].axle + i) % TRAIN_AXLES.length));
  // 同じ車軸どうしはちょうど 1両ぶん空く
  assert.ok(close(hits[4].t - hits[0].t, pitchT, 1e-6));
  // 2連打の間は 0.1秒より短く、休みは 0.3秒前後
  const gap = (a) => {
    const h = hits.find((x) => x.axle === a);
    const n = hits[hits.indexOf(h) + 1];
    return n.t - h.t;
  };
  assert.ok(gap(0) < 0.1 && gap(2) < 0.1, 'タタン');
  assert.ok(gap(1) > 0.25, 'ゴトンの後はひと休み');
  // ちょうど打音の時刻を渡しても、その打音は返さない
  const at = nextClack(hits[5].t);
  assert.ok(close(at.t, hits[6].t, 1e-6));
}
