// 多摩川の京王線の鉄橋を渡る電車（見た目と音だけ。sim は知らない）。
// 影の絵（game.js の drawTrain / trainArt）と通り過ぎる音（N7 / N7b）が同じ電車を
// 見るよう、編成の寸法と時刻の決め方をここにまとめる。DOM も Web Audio も触らないので
// Node からそのまま試せる（train.test.mjs）。
//
// 時刻は world.envT だけから出す —— envT はスナップショットで全員にそろうので、
// 同じ部屋なら同じ時に通り、同じ時に鳴る。乱数は使わない。

// 京王の通勤車（1両 20m × 幅 2.8m）を縦横比そのままで縮めた。幅は鉄橋の影（130px）の
// 4割ほどにして、桁の上に収まって見えるようにする
export const TRAIN_W = 52;                    // 車体の幅(px)
export const TRAIN_CAR = 360;                 // 1両の長さ(px)。20m : 2.8m ≒ 7 : 1
export const TRAIN_GAP = 18;                  // 車両の継ぎ目のすき間(px)。引きの絵でも切れ目が見える最小くらい
export const TRAIN_CARS = 8;                  // 編成の両数。相模原線の8両編成
export const TRAIN_LEN = TRAIN_CARS * TRAIN_CAR + (TRAIN_CARS - 1) * TRAIN_GAP;
// 速さ(px/s)。画面（PC で横 1300px 前後）を先頭が 2秒ほどで抜け、編成全体は1点を 4〜5秒で
// 通り過ぎる。サメ（200px/s 前後）よりずっと速く、「横を電車が通った」に見える速さ
export const TRAIN_SPEED = 700;
// 1本の鉄橋で見た、電車の間隔(秒)。鉄橋の端から端まで（約 9000px）を 13秒ほどで渡るので、
// 1本の鉄橋の上には同時に1本だけ（渡り終えてから次が入るまで 7秒ほど空く）。
// 2本の鉄橋（下流側＝下り、上流側＝上り）がそれぞれこの間隔で走り、位相を TRAIN_SHIFT
// ずらすので、全体では 10秒ごとに1本、下り・上りが交互に来る（N7c で「10秒ごと」に）。
// 1本が渡るのに 13秒ほど要るので、下りが渡り終える前の 3秒ほどは上りと2本同時に走る
// （2本は鉄橋の同じ端ですれ違う）。音も鉄橋ごとに別に鳴らすので、ぶつ切りにはならない
export const TRAIN_PERIOD = 20;
// 上り（上流側の鉄橋）の、下りに対する遅れ(秒)。半周期ずらして全体で等間隔にする
export const TRAIN_SHIFT = TRAIN_PERIOD / 2;
// 鉄橋の本数（0 が下り＝下流側、1 が上り＝上流側）
export const TRAIN_LINES = 2;

// ---- 電車の音（N7 / N7b。鳴らすのは audio.js、録音は public/audio/電車.mp3） ----
// 電車の音が聞こえなくなる距離(px、ワールド座標)。編成のいちばん近い点からこれだけ離れたら 0。
// 画面1枚ぶん（PC で 1300px 前後）の外まで少し聞こえ、2画面先ではもう聞こえない
export const CLACK_FAR = 2000;
// 距離に対する落ち方。1 で直線、2 で二乗。近くを通るときだけはっきり聞こえるよう、
// 他人の死の音（game.js の spatial、0.6乗）よりずっと急に落とす。
// N7d で 2 → 1.5 にゆるめた（少し離れた所でも小さすぎないように）。
// 600px で 0.58、1000px で 0.35、1200px で 0.25 くらい
export const CLACK_CURVE = 1.5;

/**
 * 鉄橋 line（0 が下り、1 が上り）の上をいま走っている編成。half は鉄橋の中心から端までの長さ
 * （game.js の bridgeArt）。鉄橋ごとに TRAIN_PERIOD 秒に1本、上りは TRAIN_SHIFT 秒遅れて走る。
 * 先頭が鉄橋の手前の端（-half）にいる所から、最後尾が向こうの端を抜けるまでだけ返し、
 * それ以外（渡り終えてから次の1本が来るまで）は null。上りの1本目は envT = TRAIN_SHIFT から
 * （試合の頭で鉄橋の途中に居たりしない）。
 *   k    全体で何本目か（偶数が下り、奇数が上り。2本の鉄橋を合わせて 10秒ごとに1つ増える）
 *   line どの鉄橋か（0 下り / 1 上り）
 *   dir  鉄橋の中心線に沿って進む向き（+1 / -1）
 *   ph   渡り始めてからの秒数（先頭が手前の端にいる瞬間が 0）。録音の再生位置にそのまま使う
 *   head 先頭の位置。進む向きに測った、中心線に沿った距離（-half から増えていく）
 *   lo, hi 編成が占める範囲。中心線に沿った座標（dir を掛けた後）で lo < hi
 */
export function trainRun(env, half, line = 0) {
  const e = env - line * TRAIN_SHIFT;
  if (e < 0) return null;
  const n = Math.floor(e / TRAIN_PERIOD);
  const ph = e - n * TRAIN_PERIOD;
  const head = -half + TRAIN_SPEED * ph;
  if (head - TRAIN_LEN > half) return null;
  const dir = line ? -1 : 1;
  const a0 = dir * (head - TRAIN_LEN), a1 = dir * head;
  return { k: n * TRAIN_LINES + line, line, dir, ph, head, lo: Math.min(a0, a1), hi: Math.max(a0, a1) };
}

/** 2本の鉄橋それぞれの trainRun。[下り, 上り] で、走っていない方は null */
export function trainRuns(env, half) {
  const out = [];
  for (let l = 0; l < TRAIN_LINES; l++) out.push(trainRun(env, half, l));
  return out;
}

/**
 * 聞き手 (x, y) から見た、編成のいちばん近い点。br は bridgeArt() の戻り値
 * （cx, cy, nx, ny ＝ 中心線の向き, fx, fy ＝ 流れの向き, track ＝ 2本のずれ）。
 * 編成は太さを無視して、中心線上の線分 lo〜hi とみなす（幅 52px は距離 2000px に比べて誤差）
 */
export function trainNearest(br, run, x, y) {
  const off = br.track[run.dir > 0 ? 1 : 0];
  const ox = br.cx + br.fx * off, oy = br.cy + br.fy * off;
  const along = (x - ox) * br.nx + (y - oy) * br.ny;
  const a = Math.max(run.lo, Math.min(run.hi, along));
  const px = ox + br.nx * a, py = oy + br.ny * a;
  return { x: px, y: py, d: Math.hypot(x - px, y - py) };
}

/** 距離(px)から電車の音の音量の倍率（0〜1）。CLACK_FAR で 0 */
export function clackVol(d) {
  const v = 1 - d / CLACK_FAR;
  return v > 0 ? v ** CLACK_CURVE : 0;
}
