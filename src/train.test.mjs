// 鉄橋の電車（影と音）の素の計算の最小チェック: node src/train.test.mjs
// 「いつ鉄橋の上にいるか」「録音のどこを鳴らすか」「距離で音量がどう落ちるか」だけを見る。
import assert from 'node:assert/strict';
import {
  TRAIN_LEN, TRAIN_SPEED, TRAIN_PERIOD, TRAIN_SHIFT, CLACK_FAR,
  trainRun, trainRuns, trainNearest, clackVol,
} from './train.js';

const HALF = 4500;
const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// 1. 下りの鉄橋。周期の頭で先頭が手前の端に居て、最後尾が向こうの端を抜けたら null（次の1本まで鳴らない）
const end = (2 * HALF + TRAIN_LEN) / TRAIN_SPEED;   // 入ってから最後尾が抜けるまでの秒数
{
  const r = trainRun(0, HALF, 0);
  assert.equal(r.k, 0);
  assert.equal(r.line, 0);
  assert.equal(r.dir, 1, '下り（+向き）');
  assert.equal(r.head, -HALF);
  assert.equal(r.ph, 0, '鉄橋に入った瞬間が録音の 0 秒');
  assert.equal(r.hi - r.lo, TRAIN_LEN, '占める範囲は編成の長さ');
  assert.ok(end < TRAIN_PERIOD, '1本の鉄橋の上では次の1本より前に渡り終える（同時に1本だけ）');
  assert.ok(trainRun(end - 0.01, HALF, 0), '抜ける直前はまだ居る');
  assert.equal(trainRun(end + 0.01, HALF, 0), null, '渡り終えたら居ない');
  const nx = trainRun(TRAIN_PERIOD + 1, HALF, 0);
  assert.equal(nx.k, 2, '下りは偶数本目');
  assert.ok(close(nx.ph, 1), '次の1本も入った瞬間から数え直す');
}

// 2. 上りの鉄橋。下りと同じ周期で TRAIN_SHIFT（半周期）遅れて走り、全体では10秒ごとに1本
{
  assert.equal(TRAIN_PERIOD, 20);
  assert.equal(TRAIN_SHIFT, 10, '位相差 10秒');
  assert.equal(trainRun(TRAIN_SHIFT - 0.01, HALF, 1), null, '上りの1本目は TRAIN_SHIFT から（試合の頭に途中から居ない）');
  const up = trainRun(TRAIN_SHIFT + 1, HALF, 1);
  assert.equal(up.k, 1, '上りは奇数本目');
  assert.equal(up.dir, -1, '上り（-向き）');
  assert.equal(up.lo, HALF - TRAIN_SPEED, '上りは +端から入ってきて、先頭は -向きの端（lo）');
  assert.ok(close(up.ph, 1), '入った瞬間が 0');
  assert.equal(trainRun(TRAIN_SHIFT + TRAIN_PERIOD, HALF, 1).k, 3);
  assert.equal(trainRun(TRAIN_SHIFT + TRAIN_PERIOD, HALF, 1).ph, 0);
  // 鉄橋に入る時刻を全部拾うと、10秒おきに k が 0, 1, 2, 3 … と1つずつ増える
  for (let k = 0; k < 6; k++) {
    const r = trainRuns(k * 10, HALF)[k % 2];
    assert.ok(r && r.k === k && r.ph === 0, `${k} 本目は ${k * 10} 秒に入る`);
  }
}

// 3. すれ違い。下りが渡り終える前に上りが入るので、その間は2本とも返る
{
  assert.ok(end > TRAIN_SHIFT, '渡るのに10秒より長く掛かる（だから2本ぶん要る）');
  const both = trainRuns(TRAIN_SHIFT + 1, HALF);
  assert.ok(both[0] && both[1], 'すれ違う間は2本とも走っている');
  assert.equal(both[0].k, 0);
  assert.equal(both[1].k, 1);
  const one = trainRuns(end + 0.01, HALF);
  assert.ok(!one[0] && one[1], '下りが抜けたら上りだけ');
  assert.equal(trainRuns(TRAIN_SHIFT + end + 0.01, HALF)[1], null, '上りも抜けたら上りの鉄橋は空く');
}

// 4. いちばん近い点。中心線が y 軸（n = (0,1)）、流れが x 軸（f = (1,0)）の鉄橋で試す
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

// 5. 音量は近いほど大きく、CLACK_FAR で 0、その先も 0（負にならない）
{
  assert.equal(clackVol(0), 1);
  assert.ok(clackVol(300) > clackVol(800));
  assert.equal(clackVol(CLACK_FAR), 0);
  assert.equal(clackVol(CLACK_FAR * 3), 0);
}
