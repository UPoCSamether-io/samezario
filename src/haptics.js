// 手元の触覚。Web Haptics（navigator.vibrate）の薄い皮1枚だけ。
//
// 実際に震えるのは Android の Chrome / Firefox で、iOS の Safari もデスクトップも
// vibrate そのものを持っていない。持っていない端末では「何も起きない」が正しい
// 振る舞いなので、端末を見分ける分岐は書かず、投げて捨てる。
//
// 呼ぶ側が「震わせるかどうか」を判断しないのが要点 —— 判断をここ1か所に閉じてあれば、
// 後から止める口（設定）を足すときに触るのもここだけで済む。

/**
 * パターンは [震える, 休む, 震える, ...] のミリ秒。偶数番目が震え、奇数番目が休み。
 * 数値ひとつを渡すと「その長さだけ震える」になる。
 */
export const HAPTIC = {
  // 裏ボスの復活。画面の揺れ（game.js の QUAKE_DUR）と同じ 1.2 秒に合わせてある。
  // 手だけが先に静まると、揺れているのが画面だけになって地響きに聞こえない。
  // 短く2回突いてから長く唸らせるのは、地面が割れてから何かが出てくる順番のため
  bossRevive: [140, 70, 140, 70, 620],
};

// 1回で震わせ続けてよい上限(ms)。パターンを組み違えて延々と震え続けるのを、
// 端末ではなくこちら側で止める。上限に当たったぶんは切り落とす
const MAX_MS = 3000;

/**
 * パターンを navigator.vibrate へ渡せる形に均す。DOM を触らない素の関数
 * （振動そのものは端末任せで検査できないので、検査できるのはここまで）。
 *
 * ・数値ひとつでも配列でも受ける
 * ・有限でない値・負の値は 0 に丸める（1つでも混ざると仕様上は投げる実装がある）
 * ・合計が MAX_MS を超えたら、超えたところで切る
 * ・末尾の休みは落とす。休みで終わっても何も起きないうえ、次の1発を待たせる
 * ・震える区間が1つも残らなければ null（＝呼ばない）
 */
export function normalize(pattern) {
  const raw = Array.isArray(pattern) ? pattern : [pattern];
  const out = [];
  let total = 0;
  for (const v of raw) {
    const ms = Math.round(Number.isFinite(v) && v > 0 ? v : 0);
    if (total + ms >= MAX_MS) { out.push(MAX_MS - total); total = MAX_MS; break; }
    out.push(ms);
    total += ms;
  }
  while (out.length && (out.length % 2 === 0 || out[out.length - 1] === 0)) out.pop();
  return out.length ? out : null;
}

/**
 * 震わせる。鳴らせなかったときも黙って false を返すだけで、呼び側は結果を見なくていい。
 *
 * nav / doc を差し替えられるのは検査のため。既定は今のタブのもの。
 * ・vibrate を持たない端末では何もしない
 * ・裏へ回っているタブは無視する（ブラウザ側も弾くが、実装によっては投げる）
 * ・ユーザー操作を1度も挟んでいないタブでは、ブラウザが黙って捨てる
 */
export function buzz(pattern, nav = globalThis.navigator, doc = globalThis.document) {
  if (!nav || typeof nav.vibrate !== 'function') return false;
  if (doc && doc.hidden) return false;
  const p = normalize(pattern);
  if (!p) return false;
  try { return nav.vibrate(p) !== false; } catch { return false; }
}

/** 震えを今すぐ止める。ポーズや画面遷移で、鳴りっぱなしを持ち越さないために使う */
export function hush(nav = globalThis.navigator) {
  if (!nav || typeof nav.vibrate !== 'function') return;
  try { nav.vibrate(0); } catch { /* 止められなくても数百ミリ秒で勝手に終わる */ }
}
