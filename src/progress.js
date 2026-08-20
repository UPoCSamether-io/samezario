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
  claimedSharks: ['cinema'],   // 能動的に獲得したサメ。見本の映画サメは最初から
  scriptTutorialSeen: false,   // 史料画面の遊び方を一度でも閉じたか
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
 * レベルの累計XPしきい値。差分は 1000 + 500n の逓増。
 *
 * 1プレイの到達質量は 1000〜2000（開始 30 から育つ）。旧値は 10 分の 1 の
 * スケールで、レベル1を開始数秒で、脚本が完成するレベル3すら初回プレイの
 * 途中で越えていた。段階0〜3 の虫食いが一度も目に入らないまま終わるので、
 * 曲線の形はそのままに 10 倍した。
 *
 * この値だとレベル3（＝脚本の完成と土偶サメの解放）まで 3〜6 プレイで、
 * 各段階が 1〜2 プレイずつ表示される。全18レベルは 50〜100 プレイの長期目標。
 */
export const LEVEL_XP = [
  1500, 3500, 6000, 9000, 12500, 16500, 21000, 26000, 31500,
  37500, 44000, 51000, 58500, 66500, 75000, 84000, 93500, 103500,
];

const STAGES = 3;   // サメ1種あたりの復元段階数

/** 対戦終了時の到達質量を経験値に入れる。1プレイにつき1回だけ呼ぶこと */
export const addXp = (mass) =>
  // xp は自分自身に積むので、NaN が一度入ると二度と抜けない（level も stageOf も道連れ）
  Number.isFinite(mass) && mass > 0 ? replace({ xp: save.xp + Math.round(mass) }) : save;

export const level = () => LEVEL_XP.filter((t) => save.xp >= t).length;

/**
 * その脚本1本ぜんたいの進み具合。{ratio: 0..1, remain: 完成までの残りXP}。
 *
 * レベルごとに0へ戻さない。段階が変わるたびにバーが空になると、1本を
 * どこまで復元したのかが分からなくなるため、始まりから完成までを1本で見せる。
 */
export function scriptProgress(era) {
  const from = era <= 1 ? 0 : LEVEL_XP[STAGES * (era - 1) - 1];
  const to = LEVEL_XP[STAGES * era - 1];
  return {
    ratio: Math.max(0, Math.min(1, (save.xp - from) / (to - from))),
    remain: Math.max(0, to - save.xp),
  };
}

/** そのサメの復元段階(0..3)。era 1 はレベル0から、era 2 はレベル3から始まる */
export const stageOf = (era) =>
  Math.max(0, Math.min(STAGES, level() - STAGES * (era - 1)));

/** era 0（映画サメ＝見本）は常に解放。それ以外は史料を100%復元して自分で獲得したものだけ */
export const isUnlockedShark = (d) => d.era === 0 || save.claimedSharks.includes(d.id);

/** 史料の復元完了ボタンから呼ぶ。二度押しで配列が伸びないよう冪等にしてある */
export const claimShark = (id) =>
  save.claimedSharks.includes(id)
    ? save
    : replace({ claimedSharks: [...save.claimedSharks, id] });

// 既存セーブの移行。claimedSharks を持たないセーブへ、旧・自動解放条件（level() >= 3*era）で
// 到達済みだったサメを埋める。これが無いと、既にレベル3以上の既存プレイヤーは
// 解放済みだったサメが次回起動でロックへ戻る（save.shark がそれを指していれば不整合になる）。
//
// level() はアロー関数で巻き上げされないので、上の xp/seed の移行ブロックには書けない。
if (!('claimedSharks' in raw)) {
  replace({
    claimedSharks: SHARKS
      .filter((d) => d.era === 0 || level() >= STAGES * d.era)
      .map((d) => d.id),
  });
}

/** 脚本を開いた。赤点を消す */
export const markScriptSeen = () => replace({ seenLevel: level() });

// 脚本が実際に変化しうる最大レベル。データから引くので区分を足せば自動で伸びる
const SCRIPT_MAX = Math.max(0, ...SHARKS.filter((s) => s.script).map((s) => s.era * STAGES));

/** 赤点を出すか。新しい文字が現れたのに脚本を開いていない状態（完成後は頭打ち） */
export const hasNewScript = () => Math.min(level(), SCRIPT_MAX) > Math.min(save.seenLevel, SCRIPT_MAX);
