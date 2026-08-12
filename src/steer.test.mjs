// 操舵ポインタの調停の最小チェック: node src/steer.test.mjs
// 「誰が操舵を名乗れるか / いつ解放されるか」だけを見る。
import assert from 'node:assert/strict';
import { makeSteer } from './steer.js';

const touch = (id) => ({ pointerType: 'touch', pointerId: id });
const mouse = { pointerType: 'mouse', pointerId: 1 };

// 1. マウスは1本しか存在しないので常に素通し
{
  const s = makeSteer();
  assert.equal(s.claim(mouse), true, 'マウスは名乗れる');
  assert.equal(s.owns(mouse), true, 'マウスは常に操舵できる');
}

// 2. 最初に触れた指だけが操舵を名乗れる
{
  const s = makeSteer();
  assert.equal(s.claim(touch(10)), true, '1本目は名乗れる');
  assert.equal(s.owns(touch(10)), true);
  assert.equal(s.claim(touch(11)), false, '2本目は名乗れない');
  assert.equal(s.owns(touch(11)), false, '2本目の動きは操舵に使わない');
}

// 3. マウスが居ても指の調停は独立して動く（touch が id を埋める）
{
  const s = makeSteer();
  s.claim(touch(10));
  assert.equal(s.owns(mouse), true, 'マウスは指に関係なく通る');
}

// 4. 離した指の権利は次の指へ渡る
{
  const s = makeSteer();
  s.claim(touch(10));
  s.release(touch(10));
  assert.equal(s.claim(touch(11)), true, '解放後は次の指が名乗れる');
  assert.equal(s.owns(touch(11)), true);
}

// 5. 操舵していない指を離しても、操舵中の指の権利は奪われない。
//    ここを取り違えると DASH ボタンから指を離した瞬間に操舵が切れる
{
  const s = makeSteer();
  s.claim(touch(10));
  s.claim(touch(11));
  s.release(touch(11));
  assert.equal(s.owns(touch(10)), true, '操舵中の指は生きたまま');
  assert.equal(s.claim(touch(12)), false, '席はまだ空いていない');
}

// 6. pointercancel も release で解放する。取りこぼすと id が埋まったままになり、
//    以後どの指も操舵を名乗れず操作不能になる
{
  const s = makeSteer();
  s.claim(touch(10));
  s.release(touch(10));   // pointercancel からもこれを呼ぶ
  assert.equal(s.claim(touch(11)), true, 'cancel 後も次の指が入れる');
}

console.log('steer ok');
