// セーブデータ。localStorage の 'samezario.save' を専有する唯一のモジュール。
//
// エリアの解放とポイントの書き込み口は clearSpot / markShared のふたつしかなく、
// どちらも「次の状態を全部組み立てて replace() で丸ごと置き換える」形にしてある。
// UPoC_Samether.io/docs/06 の「クライアント側で points += 100 のような差分加算を書かない」
// —— 二重加算を規約ではなく構造で潰す、という原則をそのまま持ってきた。
// 判定をサーバへ移したら replace() にサーバの返したスナップショットを渡せばよく、
// 呼び出し側は変わらない。
//
// shark / name / best / seenHowto は進捗ではなく「前回の選択」や既読の印なので、
// main.js が直接書いて persist() する（従来どおり）。混ぜないよう、この2系統だけは意識して分けてある。

import { SHARKS } from './data.js';

const KEY = 'samezario.save';   // index.html のタイトル用インラインスクリプトも同じキーを読む

// v は将来スキーマを変えたとき、壊れた古いキャッシュを捨てるための版。
// 項目を足すだけなら上げない。read() が版違いを丸ごと捨てるので、上げると
// 解放もポイントも消える（足りない項目は下の Object.assign が既定値で埋める）。
// spots[spotId] = { at, score, shared }
const createDefaults = () => ({
  v: 1,
  unlocked: ['chofu'],
  best: 0,
  shark: SHARKS[0].id,
  name: '',
  points: 0,
  spots: {},
  seenHowto: false,   // 遊び方を一度でも閉じたか。初回だけ自動で挟むための印
  xp: 0,          // 累計経験値。レベル・解放・復元段階はすべてここから導出する
  seed: 0,        // 虫食い位置の種。初回だけ生成し、以後変えない
  seenLevel: 0,   // 脚本を最後に開いたときのレベル。赤点の消灯判定
});

const DEFAULTS = createDefaults();

function read() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (!v || typeof v !== 'object' || v.v !== DEFAULTS.v) return {};
    return v;
  } catch {
    return {};   // 壊れたセーブは黙って初期値へ。ここで例外を出すと起動しない
  }
}

// 参照を配るので、これ自体は差し替えず中身を書き換える（main.js が握っている）
const raw = read();
export const save = Object.assign(createDefaults(), raw);

export const persist = () => localStorage.setItem(KEY, JSON.stringify(save));

// 既存セーブの移行。xp を持たないセーブは、これまでの最高記録を経験値として引き継ぐ。
// v を上げると解放とポイントが消えるので、ここで埋める。
//
// 埋めたら必ず書き戻す。seed は乱数なので、保存しないまま次の起動を迎えると
// 別の値が生まれ、マスク位置が総入れ替えになって復元途中の文章が壊れる。
if (!('xp' in raw)) save.xp = save.best;
if (!save.seed) save.seed = ((Math.random() * 0xffffffff) >>> 0) || 1;
persist();

/** 唯一の書き込み口。組み立て済みの次の状態で置き換える */
export function replace(next) {
  Object.assign(save, next);
  persist();
  return save;
}

export const isUnlocked = (map) => map.unlocked || save.unlocked.includes(map.id);
export const isCleared = (spot) => !!(spot && save.spots[spot.id]);
export const isShared = (spot) => !!(spot && save.spots[spot.id]?.shared);

/**
 * 照合成功。エリアを開けてポイントを入れる。
 * 2周目以降は「開いているものをもう一度開く」だけでポイントは増えない（記録の一致度は伸びる）。
 */
export function clearSpot(map, score = 100) {
  const spot = map.spot;
  const had = save.spots[spot.id];
  return replace({
    unlocked: save.unlocked.includes(map.id) ? save.unlocked : [...save.unlocked, map.id],
    points: save.points + (had ? 0 : spot.points),
    spots: {
      ...save.spots,
      [spot.id]: {
        at: had?.at ?? Date.now(),
        score: Math.max(had?.score ?? 0, score),
        shared: !!had?.shared,
      },
    },
  });
}

/**
 * シェア完了。スポットごとに1回だけ加点する。
 * X API が有料で実投稿は検証できないので、シェアシートが完了した時点で入れる割り切り
 * （UPoC_Samether.io README「PoC としての割り切り」）。
 */
export function markShared(spot) {
  const rec = save.spots[spot.id];
  if (!rec || rec.shared) return save;
  return replace({
    points: save.points + spot.share,
    spots: { ...save.spots, [spot.id]: { ...rec, shared: true } },
  });
}

/**
 * レベルの累計XPしきい値。差分は 100 + 50n の逓増。
 *
 * ponytail: 1プレイあたりの到達質量の実分布が未計測なので暫定値。
 * save.best から分布を取って差し替える。他のロジックから独立させてあるので
 * ここだけ差し替えれば済む。
 */
export const LEVEL_XP = [
  150, 350, 600, 900, 1250, 1650, 2100, 2600, 3150,
  3750, 4400, 5100, 5850, 6650, 7500, 8400, 9350, 10350,
];

const STAGES = 3;   // サメ1種あたりの復元段階数

/** 対戦終了時の到達質量を経験値に入れる。1プレイにつき1回だけ呼ぶこと */
export const addXp = (mass) =>
  // xp は自分自身に積むので、NaN が一度入ると二度と抜けない（level も stageOf も道連れ）
  Number.isFinite(mass) && mass > 0 ? replace({ xp: save.xp + Math.round(mass) }) : save;

export const level = () => LEVEL_XP.filter((t) => save.xp >= t).length;

/** そのサメの復元段階(0..3)。era 1 はレベル0から、era 2 はレベル3から始まる */
export const stageOf = (era) =>
  Math.max(0, Math.min(STAGES, level() - STAGES * (era - 1)));

/** era 0（映画サメ＝見本）は常に解放。それ以外は 3*era に到達で解放 */
export const isUnlockedShark = (d) => d.era === 0 || level() >= STAGES * d.era;

/** 脚本を開いた。赤点を消す */
export const markScriptSeen = () => replace({ seenLevel: level() });

/** 赤点を出すか。新しい文字が現れたのに脚本を開いていない状態 */
export const hasNewScript = () => level() > save.seenLevel;
