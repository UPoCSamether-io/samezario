// セーブデータの不変条件。見るのは「同じ達成を二度記録しても壊れないこと」に尽きる。
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

// 初期状態: 調布だけ開いている
assert.ok(isUnlocked(chofu));
assert.ok(!isUnlocked(jindaiji));
assert.ok(!isCleared(jindaiji.spot));

// 照合成功 → エリアが開き、記録が残る
clearSpot(jindaiji, 88);
assert.ok(isUnlocked(jindaiji));
assert.ok(isCleared(jindaiji.spot));
assert.equal(save.spots[jindaiji.spot.id].score, 88);
assert.equal(save.spots[jindaiji.spot.id].shared, false);

// 同じスポットをもう一度撮っても解放リストは重複しない（記録の一致度だけ伸びる）
clearSpot(jindaiji, 95);
assert.equal(save.spots[jindaiji.spot.id].score, 95);
assert.equal(save.unlocked.filter((id) => id === 'jindaiji').length, 1, '解放リストの重複');

// 一致度が下がった撮り直しで記録を削らない
clearSpot(jindaiji, 70);
assert.equal(save.spots[jindaiji.spot.id].score, 95);

// シェアはスポットごとに1回だけ記録される
markShared(jindaiji.spot);
assert.equal(save.spots[jindaiji.spot.id].shared, true);
markShared(jindaiji.spot);
assert.equal(save.spots[jindaiji.spot.id].shared, true, 'シェア記録の重複');

// 撮っていないスポットはシェア扱いにならない
markShared(chofu.spot);
assert.ok(!save.spots[chofu.spot.id]);

// 解放済みエリアのスポット（ボーナス）は、解放ではなく記録だけを残す
const opened = [...save.unlocked];
clearSpot(chofu, 91);
assert.ok(isCleared(chofu.spot));
assert.deepEqual([...save.unlocked].sort(), [...new Set([...opened, 'chofu'])].sort());

// 書いたものが localStorage に残り、読み直せる形になっていること
{
  const raw = JSON.parse(store['samezario.save']);
  assert.equal(raw.v, 1, 'スキーマ版が無いと壊れたキャッシュを捨てられない');
  assert.equal(raw.spots[jindaiji.spot.id].shared, true);
}

// 既知の版だが値が違う（未来のスキーマ）ものは初期値にフォールバックすること
{
  store['samezario.save'] = JSON.stringify({ v: 999, unlocked: ['tamagawa'] });
  const mod = await import('./progress.js?v=invalid-schema');
  assert.deepEqual(mod.save.unlocked, ['chofu']);
}

// v を持たない旧セーブ（このスキーマ導入より前の main.js 直書き時代）は、
// 壊れたキャッシュとして捨てずに引き継ぐこと。これが無いと、デプロイ済みの
// 既存プレイヤーが次のアクセスで解放エリア・ベストスコア・選んだサメを丸ごと失う
{
  store['samezario.save'] = JSON.stringify({
    unlocked: ['chofu', 'jindaiji'], best: 42, shark: 'yokai', name: 'たろう',
  });
  const mod = await import('./progress.js?v=legacy-no-version');
  assert.deepEqual(mod.save.unlocked, ['chofu', 'jindaiji'], '旧セーブの解放エリアが引き継がれない');
  assert.equal(mod.save.best, 42, '旧セーブのベストスコアが引き継がれない');
  assert.equal(mod.save.shark, 'yokai', '旧セーブの選択サメが引き継がれない');
  assert.equal(mod.save.name, 'たろう', '旧セーブの名前が引き継がれない');
  assert.equal(mod.save.v, 1, '引き継いだ後は現行のスキーマ版が補われること');
}

console.log('progress ok');
