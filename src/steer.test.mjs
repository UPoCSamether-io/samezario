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

// 7. フローティング仮想ジョイスティックの相対ドラッグとデッドゾーン
{
  const s = makeSteer({ deadzone: 6, maxR: 40 });
  const t1 = { pointerType: 'touch', pointerId: 1, clientX: 100, clientY: 200 };
  assert.equal(s.claim(t1), true);

  // デッドゾーン未満（移動距離 3px）は null（向き変更なし）
  const movedSmall = { pointerType: 'touch', pointerId: 1, clientX: 103, clientY: 200 };
  assert.equal(s.move(movedSmall), null, 'デッドゾーン未満は null');

  // 右方向へのドラッグ（dx=20, dy=0） -> 角度 0 rad
  const movedRight = { pointerType: 'touch', pointerId: 1, clientX: 120, clientY: 200 };
  const aimRight = s.move(movedRight);
  assert.ok(Math.abs(aimRight - 0) < 1e-5, '右へのドラッグで 0 rad');

  // 下方向へのドラッグ（dx=0, dy=20） -> 角度 π/2 rad
  const movedDown = { pointerType: 'touch', pointerId: 1, clientX: 100, clientY: 220 };
  const aimDown = s.move(movedDown);
  assert.ok(Math.abs(aimDown - Math.PI / 2) < 1e-5, '下へのドラッグで π/2 rad');

  // マウスの move は null（マウスは画面中心基準で別処理）
  assert.equal(s.move({ pointerType: 'mouse', pointerId: 1, clientX: 150, clientY: 250 }), null);
}

// 8. 最大半径を超えたときの動的追従（dynamic follow）
{
  const s = makeSteer({ deadzone: 6, maxR: 40 });
  s.claim({ pointerType: 'touch', pointerId: 1, clientX: 100, clientY: 100 });

  // 右に 100px スワイプ（maxR=40 を超える）
  s.move({ pointerType: 'touch', pointerId: 1, clientX: 200, clientY: 100 });
  const stick = s.getTouchStick();
  assert.ok(stick, 'スティック情報が取得できる');
  assert.equal(stick.cx, 200);
  assert.equal(stick.cy, 100);
  // 原点が指に引き寄せられ、現在地から 40px 手前（ox = 200 - 40 = 160）へ動く
  assert.equal(stick.ox, 160);
  assert.equal(stick.oy, 100);

  // 指を離すとリセット
  s.release({ pointerId: 1 });
  assert.equal(s.getTouchStick(), null, 'release でスティック情報が消える');
}

console.log('steer ok');

