// 操舵ポインタの調停。
// タッチは指が何本も降ってくるが、サメを操舵していいのは最初にキャンバスへ
// 触れた1本だけ。これが無いと DASH ボタンを押した親指まで操舵を名乗り、
// ダッシュするたびにサメがボタンの方（右下）へ吸い寄せられる。
// マウスは1本しか存在しないので調停せず素通しする。
export function makeSteer() {
  let id = null;
  return {
    // canvas の pointerdown で呼ぶ。操舵を名乗れたら true
    claim(e) {
      if (e.pointerType === 'mouse') return true;
      if (id === null) id = e.pointerId;
      return e.pointerId === id;
    },
    // pointermove で呼ぶ。この指の動きを操舵に使ってよいか
    owns(e) {
      return e.pointerType === 'mouse' || e.pointerId === id;
    },
    // pointerup と pointercancel の両方から呼ぶ。
    // cancel 側を忘れると（通知やシステムジェスチャに pointer を奪われたとき）
    // id が埋まったままになり、以後どの指も操舵できなくなる
    release(e) {
      if (e.pointerId === id) id = null;
    },
  };
}
