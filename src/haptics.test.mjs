// 手元の触覚（src/haptics.js）。実際に震えるかは端末任せで検査できないので、
// 「navigator.vibrate へ何を渡したか」と「渡さずに済ませた場面」だけを見る。
import assert from 'node:assert/strict';
import { HAPTIC, normalize, buzz, hush } from './haptics.js';

/** 呼ばれた引数を溜める偽の navigator。ret で戻り値を差し替える */
function fakeNav(ret = true) {
  const calls = [];
  return { calls, vibrate: (p) => { calls.push(p); return ret; } };
}

// 1. パターンの均し方
{
  assert.deepEqual(normalize([140, 70, 620]), [140, 70, 620]);
  assert.deepEqual(normalize(200), [200], '数値ひとつを受けられない');

  // 末尾の休みは落とす（休みで終わっても何も起きず、次の1発を待たせるだけ）
  assert.deepEqual(normalize([100, 50]), [100], '末尾の休みが残っている');
  assert.deepEqual(normalize([100, 50, 0]), [100], '末尾の 0 が残っている');

  // 壊れた値は 0 へ丸める。1つでも混ざると投げる実装があるので、ここで潰す
  assert.deepEqual(normalize([100, NaN, 80]), [100, 0, 80]);
  assert.deepEqual(normalize([100, -50, 80]), [100, 0, 80]);

  // 震える区間が残らなければ呼ばない
  assert.equal(normalize([]), null);
  assert.equal(normalize([0]), null);
  assert.equal(normalize(-1), null);

  // 上限で切る。組み違えて延々と震え続けるのを端末任せにしない
  const long = normalize([5000, 100, 5000]);
  assert.equal(long.reduce((a, b) => a + b, 0), 3000, '3秒を超えて震えるパターンが通った');
}

// 2. 震わせる／震わせない
{
  const nav = fakeNav();
  assert.equal(buzz([120, 60, 120], nav, null), true);
  assert.deepEqual(nav.calls, [[120, 60, 120]]);

  // vibrate を持たない端末（iOS Safari・デスクトップ）では何もしない
  assert.equal(buzz([120], {}, null), false, 'vibrate の無い端末で呼んでいる');
  assert.equal(buzz([120], null, null), false, 'navigator が無い場所で呼んでいる');

  // 裏へ回ったタブでは呼ばない
  const hidden = fakeNav();
  assert.equal(buzz([120], hidden, { hidden: true }), false);
  assert.equal(hidden.calls.length, 0, '裏のタブで震わせようとした');

  // 中身の無いパターンは投げない
  const empty = fakeNav();
  assert.equal(buzz([0, 0], empty, null), false);
  assert.equal(empty.calls.length, 0);

  // 端末に断られても例外にしない（呼び側は戻り値を見ないで済む）
  assert.equal(buzz([120], fakeNav(false), null), false);
  const boom = { vibrate: () => { throw new Error('no'); } };
  assert.equal(buzz([120], boom, null), false, 'vibrate が投げると落ちる');
}

// 3. 止める口。ポーズや画面遷移で鳴りっぱなしを持ち越さないために要る
{
  const nav = fakeNav();
  hush(nav);
  assert.deepEqual(nav.calls, [0]);
  hush({});          // vibrate が無くても落ちない
  hush(null);
}

// 4. 用意してあるパターンは、そのまま渡せる形になっている
{
  for (const [name, p] of Object.entries(HAPTIC)) {
    assert.ok(normalize(p), `HAPTIC.${name} が震えないパターンになっている`);
    assert.deepEqual(normalize(p), p, `HAPTIC.${name} は均す前から正しい形で持つ`);
  }
}
