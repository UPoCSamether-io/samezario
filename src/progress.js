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

import { SHARKS, MAPS } from './data.js';
import { STAGE_RATIO } from './salvage.js';

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
  seenLevel: 0,   // 史料を最後に開いたときのレベル。赤点の消灯判定
  seenXp: 0,      // 同じく、そのときの累計XP。ゲージをどこから伸ばすかの起点
  claimedSharks: ['cinema'],   // 能動的に獲得したサメ。見本の映画サメは最初から
  salvageTutorialSeen: false,   // 史料画面の遊び方を一度でも閉じたか
  played: [],     // 対戦を1試合終えたエリアの id。tier の「遊べば解放」はこれだけを見る
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
// seenXp が無いセーブは今の位置を起点にする。0 のままだと、次に史料を開いた瞬間に
// バーが 0 から一気に伸びて「この1プレイで全部稼いだ」という嘘の動きになる
if (!('seenXp' in raw)) save.seenXp = save.xp;
if (!save.seed) save.seed = ((Math.random() * 0xffffffff) >>> 0) || 1;
persist();

/** 唯一の書き込み口。組み立て済みの次の状態で置き換える */
export function replace(next) {
  Object.assign(save, next);
  persist();
  return save;
}

// tier の解放判定用。MAPS 側から引く（played には tier を持たない id しか積まない前提）
const tierOf = (id) => MAPS.find((m) => m.id === id)?.tier;

/**
 * エリアが開いているか。解放の道は2本ある。
 *   1) 現地写真（従来どおり。map.unlocked / save.unlocked ＝ clearSpot が書く）
 *   2) tier。ひとつ下の tier のエリアで一度でも対戦を終えていれば開く（save.played ＝ markPlayed が書く）
 * 2) は U☆PoC 審査会のデモ用に足した「甘い解放」。1) を置き換えるものではなく、
 * どちらか先に満たしたほうで開く。tier を書いていないエリア（今は無い）は対象外
 */
export const isUnlocked = (map) =>
  map.unlocked
  || save.unlocked.includes(map.id)
  || (map.tier > 1 && save.played.some((id) => tierOf(id) === map.tier - 1));
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
 * 対戦を1試合終えた。tier の「遊べば解放」に使う唯一の書き込み口（main.js の
 * showResult からだけ呼ぶ）。points/unlocked には触れない —— clearSpot/markShared の
 * 書き込み口をこの機能のために増やさず、played という別の列で解放を導出する
 */
export function markPlayed(mapId) {
  if (save.played.includes(mapId)) return save;
  return replace({ played: [...save.played, mapId] });
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
 * レベルの累計XPしきい値。二次式 250x^2 + 1250x を x=0.5 刻みで引き、50 単位で丸めたもの。
 *
 * 1プレイの到達質量は 1000〜2000（開始 30 から育つ）。かつては x=1 刻みの18件で、
 * 最初の変化が 1,500XP。1プレイでは届かないことがあり、初回プレイの結果で
 * 1文字も増えないという「最初のごほうびが遠い」状態だった。刻みを半分にして
 * 最初の変化を 700XP へ下げてある（1プレイ目で必ず泥が落ちる）。
 *
 * 曲線そのものは変えていないので、各幕の完成XP（6,000 / 16,500 / 31,500 /
 * 51,000 / 75,000 / 103,500）は1XPも動いていない。既存セーブの xp もそのまま
 * 使える（段階が細かくなるだけで巻き戻らない）。
 */
export const LEVEL_XP = [
  700, 1500, 2450, 3500, 4700, 6000, 7450, 9000, 10700, 12500, 14450, 16500,
  18700, 21000, 23450, 26000, 28700, 31500, 34450, 37500, 40700, 44000, 47450, 51000,
  54700, 58500, 62450, 66500, 70700, 75000, 79450, 84000, 88700, 93500, 98450, 103500,
];

// サメ1種あたりの復元段階数。STAGE_RATIO の「段階0から完成まで」の刻み数と
// 必ず一致していなければならない（ずれると史料が完成しないまま次の幕へ進む、
// あるいは完成しても最後の泥が落ちない）ので、数えて出す。
const STAGES = STAGE_RATIO.length - 1;

/** 対戦終了時の到達質量を経験値に入れる。1プレイにつき1回だけ呼ぶこと */
export const addXp = (mass) => {
  // xp は自分自身に積むので、NaN が一度入ると二度と抜けない（level も stageOf も道連れ）
  if (!Number.isFinite(mass) || mass <= 0) return save;
  replace({ xp: save.xp + Math.round(mass) });
  return save;
};

export const level = () => LEVEL_XP.filter((t) => save.xp >= t).length;

/** 幕1本ぶんのXP区間 [始まり, 完成]。era 1 だけ 0 から始まる */
const span = (era) => [era <= 1 ? 0 : LEVEL_XP[STAGES * (era - 1) - 1], LEVEL_XP[STAGES * era - 1]];

/**
 * その史料1本ぜんたいの進み具合。{ratio: 0..1, remain: 完成までの残りXP}。
 *
 * レベルごとに0へ戻さない。段階が変わるたびにバーが空になると、1本を
 * どこまで復元したのかが分からなくなるため、始まりから完成までを1本で見せる。
 *
 * xp を渡せる形にしてあるのは、史料画面が「前に開いたときの位置（seenXp）」を
 * 同じ物差しで欲しがるため。省略時は現在値。
 */
export function salvageProgress(era, xp = save.xp) {
  const [from, to] = span(era);
  return {
    ratio: Math.max(0, Math.min(1, (xp - from) / (to - from))),
    remain: Math.max(0, to - xp),
  };
}

/**
 * 幕の中の段階の区切り（両端を除く STAGES-1 個）を、ゲージ上の位置(%)で返す。
 *
 * 等間隔にしてはいけない。XPのしきい値は逓増する（700, 1500, 2450, …）ので、
 * 等間隔に置くと「あと少しで文字が増える」の位置が実際とずれて嘘になる。
 */
export const stageTicks = (era) => {
  const [from, to] = span(era);
  return LEVEL_XP.slice(STAGES * (era - 1), STAGES * era - 1)
    .map((t) => ((t - from) / (to - from)) * 100);
};

/** そのサメの復元段階(0..STAGES)。era 1 はレベル0から、era 2 はレベル6から始まる */
export const stageOf = (era) =>
  Math.max(0, Math.min(STAGES, level() - STAGES * (era - 1)));

// 解放は claimedSharks が唯一の真実。era 0（映画サメ＝見本）だけが常に解放。
// 第1〜6幕はすべて史料を持つので、解放の道は「100%復元して獲得ボタンを押す」の1本だけ。
//
// レベル到達での自動解放はもう無い。ただし claimedSharks を持たない旧セーブだけは、
// このファイル末尾の移行で旧・自動解放条件のまま埋める。埋めずに史料ゲートへ移すと、
// レベルで解放済みだったサメが既存プレイヤーから黙って消える（save.shark がそれを
// 指していたら不整合にもなる）。
export const isUnlockedShark = (d) => d.era === 0 || save.claimedSharks.includes(d.id);

// 史料の章一覧。SHARKS から導出する。専用の配列を持たない（下の SALVAGE_MAX が
// SHARKS を見ているので、本文を別配列へ移すと赤点通知が死ぬ）
export const chapters = () => SHARKS.filter((d) => d.salvageText).sort((a, b) => a.era - b.era);

/** 前の幕のサメを獲得するまで、次の幕はロック */
export const chapterLocked = (i) => {
  const cs = chapters();
  return i > 0 && !save.claimedSharks.includes(cs[i - 1].id);
};

/** 進入時に見せる章。復元中の1本、無ければ最後に開いている1本 */
export function defaultChapter() {
  const cs = chapters();
  const i = cs.findIndex((d, k) => !chapterLocked(k) && stageOf(d.era) < STAGES);
  // 完成済みだが未獲得（Claim ボタンを出したい）ときは、開いている最後の章に留める
  return i >= 0 ? i : Math.max(0, cs.findLastIndex((_, k) => !chapterLocked(k)));
}

/**
 * 復元しきったのに、まだ獲得していない章。無ければ null。
 *
 * リザルトの告知に使う。「サメが使えるようになった」と書いてはいけない —— 解放は
 * 史料画面で自分でボタンを押したときだけ起きる。ここで告げるのは「史料が全部読める
 * ようになった」ことまでで、その先はプレイヤーの手に残す
 */
export const unclaimedFinishedChapter = () =>
  chapters().find((d) => stageOf(d.era) >= STAGES && !save.claimedSharks.includes(d.id)) || null;

/** 史料の復元完了ボタンから呼ぶ。二度押しで配列が伸びないよう冪等にしてある */
export const claimShark = (id) =>
  save.claimedSharks.includes(id)
    ? save
    : replace({ claimedSharks: [...save.claimedSharks, id] });

// 既存セーブの移行。claimedSharks を持たないセーブへ、旧・自動解放条件（level() >= STAGES*era）で
// 到達済みだったサメを埋める。これが無いと、既に第1幕を完成させていた既存プレイヤーは
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

// 旧キー scriptTutorialSeen の移行（機能名を「サルベージ」に改名したときの置き土産）。
// 無いと、遊び方を一度閉じた既存プレイヤーへもう一度あの全画面シートが出る。
// 壊れはしないが、次に開いたときいきなり被さるのは事故に見える
if (!('salvageTutorialSeen' in raw) && raw.scriptTutorialSeen) {
  replace({ salvageTutorialSeen: true });
}

/** 史料を開いた。赤点を消し、次に開いたときのゲージの起点を今の位置にする */
export const markSalvageSeen = () => replace({ seenLevel: level(), seenXp: save.xp });

// 史料が実際に変化しうる最大レベル。データから引くので区分を足せば自動で伸びる
const SALVAGE_MAX = Math.max(0, ...SHARKS.filter((s) => s.salvageText).map((s) => s.era * STAGES));

/** 赤点を出すか。新しい文字が現れたのに史料を開いていない状態（完成後は頭打ち） */
export const hasNewSalvage = () => Math.min(level(), SALVAGE_MAX) > Math.min(save.seenLevel, SALVAGE_MAX);
