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
  kids: false,        // こどもモード（ふりがな表示）の有効無効
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
export const save = Object.assign(createDefaults(), read());

export const persist = () => localStorage.setItem(KEY, JSON.stringify(save));

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
