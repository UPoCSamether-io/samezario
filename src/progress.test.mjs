// セーブデータの不変条件。見るのは「同じ達成で二度ポイントが入らないこと」に尽きる。
// progress.js は localStorage を import 時には読むだけ（失敗しても初期値へ落ちる）なので、
// 先に偽物を置いてから動的 import すれば Node でそのまま回せる。
import assert from 'node:assert/strict';
import { MAPS } from './data.js';

const store = {};
globalThis.localStorage = {
  getItem: (k) => store[k] ?? null,
  setItem: (k, v) => { store[k] = String(v); },
};

const { save, clearSpot, markShared, isUnlocked, isCleared } = await import('./progress.js');

const jindaiji = MAPS.find((m) => m.id === 'jindaiji');
const chofu = MAPS.find((m) => m.id === 'chofu');

// 初期状態: 調布だけ開いていて 0pt
assert.ok(isUnlocked(chofu));
assert.ok(!isUnlocked(jindaiji));
assert.equal(save.points, 0);
assert.ok(!isCleared(jindaiji.spot));

// 照合成功 → エリアが開き、スポットのポイントが入る
clearSpot(jindaiji, 88);
assert.ok(isUnlocked(jindaiji));
assert.ok(isCleared(jindaiji.spot));
assert.equal(save.points, jindaiji.spot.points);
assert.equal(save.spots[jindaiji.spot.id].score, 88);
assert.equal(save.spots[jindaiji.spot.id].shared, false);

// 同じスポットをもう一度撮ってもポイントは増えない（記録の一致度だけ伸びる）
clearSpot(jindaiji, 95);
assert.equal(save.points, jindaiji.spot.points, '二重加算');
assert.equal(save.spots[jindaiji.spot.id].score, 95);
assert.equal(save.unlocked.filter((id) => id === 'jindaiji').length, 1, '解放リストの重複');

// 一致度が下がった撮り直しで記録を削らない
clearSpot(jindaiji, 70);
assert.equal(save.spots[jindaiji.spot.id].score, 95);

// シェアはスポットごとに1回だけ
const before = save.points;
markShared(jindaiji.spot);
assert.equal(save.points, before + jindaiji.spot.share);
markShared(jindaiji.spot);
assert.equal(save.points, before + jindaiji.spot.share, 'シェアの二重加算');
assert.equal(save.spots[jindaiji.spot.id].shared, true);

// 撮っていないスポットはシェアできない
const kept = save.points;
markShared(chofu.spot);
assert.equal(save.points, kept);

// 解放済みエリアのスポット（ボーナス）は、解放ではなくポイントだけを増やす
const opened = [...save.unlocked];
clearSpot(chofu, 91);
assert.equal(save.points, kept + chofu.spot.points);
assert.deepEqual([...save.unlocked].sort(), [...new Set([...opened, 'chofu'])].sort());

// 書いたものが localStorage に残り、読み直せる形になっていること
{
  const raw = JSON.parse(store['samezario.save']);
  assert.equal(raw.v, 1, 'スキーマ版が無いと壊れたキャッシュを捨てられない');
  assert.equal(raw.points, save.points);
  assert.equal(raw.spots[jindaiji.spot.id].shared, true);
}

console.log('progress ok');
