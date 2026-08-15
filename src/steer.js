// 操舵ポインタの調停とフローティング仮想ジョイスティック。
// タッチは指が何本も降ってくるが、サメを操舵していいのは最初にキャンバスへ
// 触れた1本だけ。これが無いと DASH ボタンを押した親指まで操舵を名乗り、
// ダッシュするたびにサメがボタンの方（右下）へ吸い寄せられる。
// マウスは1本しか存在しないので調停せず素通しする。
//
// スマホ（タッチ操作）では、画面中心基準の絶対角ではなく、指を置いた位置からの
// 相対ドラッグ（フローティング仮想スティック）で旋回方向を決める。
// 指が最大半径を超えて動いた場合は原点が動的に追従（dynamic follow）するため、
// 画面端へ大きくスワイプした後でも即座に反対方向へ切り返せる。
export function makeSteer({ deadzone = 6, maxR = 46 } = {}) {
  let id = null;
  let origin = null;
  let current = null;
  let active = false;

  return {
    // canvas の pointerdown で呼ぶ。操舵を名乗れたら true
    claim(e) {
      if (e.pointerType === 'mouse') return true;
      if (id === null) {
        id = e.pointerId;
        origin = { x: e.clientX, y: e.clientY };
        current = { x: e.clientX, y: e.clientY };
        active = true;
      }
      return e.pointerId === id;
    },
    // pointermove で呼ぶ。この指の動きを操舵に使ってよいか
    owns(e) {
      return e.pointerType === 'mouse' || e.pointerId === id;
    },
    // pointermove でタッチの相対変位から角度（ラジアン）を算出。
    // デッドゾーン未満またはマウスなら null を返す
    move(e) {
      if (!this.owns(e)) return null;
      if (e.pointerType === 'mouse') return null;
      if (!active || !origin) return null;

      let dx = e.clientX - origin.x;
      let dy = e.clientY - origin.y;
      let dist = Math.hypot(dx, dy);

      // 最大半径を超えたら原点を指へ引き寄せる（dynamic follow）
      if (dist > maxR) {
        const r = maxR / dist;
        origin.x = e.clientX - dx * r;
        origin.y = e.clientY - dy * r;
        dx *= r;
        dy *= r;
        dist = maxR;
      }
      current.x = e.clientX;
      current.y = e.clientY;

      if (dist >= deadzone) {
        return Math.atan2(dy, dx);
      }
      return null;
    },
    // pointerup と pointercancel の両方から呼ぶ。
    // cancel 側を忘れると（通知やシステムジェスチャに pointer を奪われたとき）
    // id が埋まったままになり、以後どの指も操舵できなくなる
    release(e) {
      if (e.pointerId === id) {
        id = null;
        origin = null;
        current = null;
        active = false;
      }
    },
    // 描画用のジョイスティック状態取得
    getTouchStick(rect) {
      if (!active || !origin || !current) return null;
      const left = rect?.left ?? 0;
      const top = rect?.top ?? 0;
      return {
        ox: origin.x - left,
        oy: origin.y - top,
        cx: current.x - left,
        cy: current.y - top,
        maxR,
        deadzone,
      };
    },
  };
}

