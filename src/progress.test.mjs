// セーブデータの不変条件。見るのは「同じ達成で二度ポイントが入らないこと」に尽きる。
// progress.js は localStorage を import 時には読むだけ（失敗しても初期値へ落ちる）なので、
// 先に偽物を置いてから動的 import すれば Node でそのまま回せる。
import assert from 'node:assert/strict';
import { MAPS, SHARKS } from './data.js';

const store = {};
globalThis.localStorage = {
  getItem: (k) => store[k] ?? null,
  setItem: (k, v) => { store[k] = String(v); },
};

const { save, clearSpot, markShared, isUnlocked, isCleared } = await import('./progress.js');

const jindaiji = MAPS.find((m) => m.id === 'jindaiji');
const chofu = MAPS.find((m) => m.id === 'chofu');

// 初期状態: 調布だけ開いていて 0pt
assert.ok(isUnlocked(chofu));
assert.ok(!isUnlocked(jindaiji));
assert.equal(save.points, 0);
assert.ok(!isCleared(jindaiji.spot));

// 照合成功 → エリアが開き、スポットのポイントが入る
clearSpot(jindaiji, 88);
assert.ok(isUnlocked(jindaiji));
assert.ok(isCleared(jindaiji.spot));
assert.equal(save.points, jindaiji.spot.points);
assert.equal(save.spots[jindaiji.spot.id].score, 88);
assert.equal(save.spots[jindaiji.spot.id].shared, false);

// 同じスポットをもう一度撮ってもポイントは増えない（記録の一致度だけ伸びる）
clearSpot(jindaiji, 95);
assert.equal(save.points, jindaiji.spot.points, '二重加算');
assert.equal(save.spots[jindaiji.spot.id].score, 95);
assert.equal(save.unlocked.filter((id) => id === 'jindaiji').length, 1, '解放リストの重複');

// 一致度が下がった撮り直しで記録を削らない
clearSpot(jindaiji, 70);
assert.equal(save.spots[jindaiji.spot.id].score, 95);

// シェアはスポットごとに1回だけ
const before = save.points;
markShared(jindaiji.spot);
assert.equal(save.points, before + jindaiji.spot.share);
markShared(jindaiji.spot);
assert.equal(save.points, before + jindaiji.spot.share, 'シェアの二重加算');
assert.equal(save.spots[jindaiji.spot.id].shared, true);

// 撮っていないスポットはシェアできない
const kept = save.points;
markShared(chofu.spot);
assert.equal(save.points, kept);

// 解放済みエリアのスポット（ボーナス）は、解放ではなくポイントだけを増やす
const opened = [...save.unlocked];
clearSpot(chofu, 91);
assert.equal(save.points, kept + chofu.spot.points);
assert.deepEqual([...save.unlocked].sort(), [...new Set([...opened, 'chofu'])].sort());

// 書いたものが localStorage に残り、読み直せる形になっていること
{
  const raw = JSON.parse(store['samezario.save']);
  assert.equal(raw.v, 1, 'スキーマ版が無いと壊れたキャッシュを捨てられない');
  assert.equal(raw.points, save.points);
  assert.equal(raw.spots[jindaiji.spot.id].shared, true);
}

// 壊れたセーブやスキーマバージョン違いは初期値にフォールバックすること
{
  store['samezario.save'] = JSON.stringify({ v: 999, points: 99999, unlocked: ['tamagawa'] });
  const mod = await import('./progress.js?v=invalid-schema');
  assert.equal(mod.save.points, 0);
  assert.deepEqual(mod.save.unlocked, ['chofu']);
}

// 遊び方の既読。初回だけ自動で挟むかの判断がこれ1つに乗っているので、
// 既定が「未読」であることと、書いたら残ることを見る（書き手は main.js）
{
  store['samezario.save'] = JSON.stringify({ v: 1, points: 7, unlocked: ['chofu'] });
  const mod = await import('./progress.js?v=no-howto-field');
  assert.equal(mod.save.seenHowto, false, '既定は未読');
  assert.equal(mod.save.points, 7, '項目を足しただけで古いセーブを捨てない');

  mod.save.seenHowto = true;
  mod.persist();
  assert.equal(JSON.parse(store['samezario.save']).seenHowto, true);
}

// 後から足したフィールドを持たない古いセーブデータ。既定値に落ちつつ、
// 既存の値は保たれること（かつて kids で見ていたのと同じ経路。ふりがなを
// 常時表示にしてフィールドごと消したので seenHowto で代表させる）
{
  store['samezario.save'] = JSON.stringify({ v: 1, points: 10, unlocked: ['chofu'] });
  const mod = await import('./progress.js?v=missing-newer-field');
  assert.equal(mod.save.seenHowto, false, '未定義のフィールドは既定値に落ちる');
  assert.equal(mod.save.points, 10, '古いセーブを壊さない');

  mod.save.seenHowto = true;
  mod.persist();
  assert.equal(JSON.parse(store['samezario.save']).seenHowto, true);
}

console.log('progress ok');

import test from 'node:test';

const P = await import('./progress.js');

test('addXp: 到達質量が累計XPに加算される', () => {
  const before = P.save.xp;
  P.addXp(120.7);
  assert.equal(P.save.xp, before + 121);   // 丸める
});

test('level: LEVEL_XP のしきい値を超えるたびに1つ上がる', () => {
  P.replace({ xp: 0 });
  assert.equal(P.level(), 0);
  P.replace({ xp: P.LEVEL_XP[0] });
  assert.equal(P.level(), 1);
  P.replace({ xp: P.LEVEL_XP[0] - 1 });
  assert.equal(P.level(), 0);
  P.replace({ xp: P.LEVEL_XP[P.LEVEL_XP.length - 1] });
  assert.equal(P.level(), P.LEVEL_XP.length);
});

test('stageOf: era 1 はレベル0-3、era 2 はレベル3で0段階目に現れる', () => {
  P.replace({ xp: 0 });
  assert.equal(P.stageOf(1), 0);
  assert.equal(P.stageOf(2), 0);
  P.replace({ xp: P.LEVEL_XP[2] });          // レベル3
  assert.equal(P.level(), 3);
  assert.equal(P.stageOf(1), 3, '古代が復元完了していない');
  assert.equal(P.stageOf(2), 0, '奈良が段階0で現れていない');
});

test('stageOf: 3を超えて増えない', () => {
  P.replace({ xp: P.LEVEL_XP[P.LEVEL_XP.length - 1] });
  assert.equal(P.stageOf(1), 3);
});

test('isUnlockedShark: era 0（見本）は常に解放、それ以外は claimShark するまでレベルだけでは解放されない', () => {
  const dogu = SHARKS.find((s) => s.era === 1);
  P.replace({ xp: 0, claimedSharks: ['cinema'] });
  assert.equal(P.isUnlockedShark({ era: 0 }), true);
  assert.equal(P.isUnlockedShark(dogu), false);
  P.replace({ xp: P.LEVEL_XP[2] });   // 旧・自動解放条件（レベル3）に達しても
  assert.equal(P.isUnlockedShark(dogu), false, 'レベルだけでは解放されない');
  P.claimShark(dogu.id);
  assert.equal(P.isUnlockedShark(dogu), true, 'Claim後は解放');
});

test('seed: 生成済みで、0 ではない（虫食い位置が固定されること）', () => {
  assert.equal(typeof P.save.seed, 'number');
  assert.notEqual(P.save.seed, 0);
});

test('既存セーブの移行: xp を持たないセーブは best を引き継ぐ', async () => {
  // 別モジュールとして読み直す。localStorage を先に古い形のセーブで埋めておく
  store['samezario.save'] = JSON.stringify({ v: 1, unlocked: ['chofu'], best: 4321, points: 0, spots: {} });
  const fresh = await import('./progress.js?migrate');
  assert.equal(fresh.save.xp, 4321, 'best が引き継がれていない');
  assert.notEqual(fresh.save.seed, 0, 'seed が生成されていない');
});

test('markScriptSeen: seenLevel が現在のレベルに揃い、赤点判定が消える', () => {
  P.replace({ xp: P.LEVEL_XP[2], seenLevel: 0 });
  assert.ok(P.level() > P.save.seenLevel, '赤点が点いていない');
  P.markScriptSeen();
  assert.equal(P.save.seenLevel, P.level());
});

test('seed: 一度生成したら次の起動でも変わらない（マスク位置が総入れ替えになる）', async () => {
  store['samezario.save'] = JSON.stringify({ v: 1, unlocked: ['chofu'], best: 100, points: 0, spots: {} });
  const first = await import('./progress.js?seed-1');
  const seed = first.save.seed;
  assert.ok(seed, 'seed が生成されていない');
  assert.equal(JSON.parse(store['samezario.save']).seed, seed, 'seed が localStorage に書き戻されていない');

  const second = await import('./progress.js?seed-2');
  assert.equal(second.save.seed, seed, '起動のたびに seed が振り直されている');
});

test('addXp: NaN や負の質量では xp を汚さない（一度入ると回復不能なため）', () => {
  P.replace({ xp: 500 });
  P.addXp(NaN);
  P.addXp(-10);
  P.addXp(undefined);
  assert.equal(P.save.xp, 500);
});

test('hasNewScript: レベルが seenLevel を超えたときだけ赤点が点く', () => {
  P.replace({ xp: P.LEVEL_XP[2], seenLevel: P.LEVEL_XP.length });
  assert.equal(P.hasNewScript(), false, '既読なのに赤点が点いている');
  P.replace({ seenLevel: 0 });
  assert.equal(P.hasNewScript(), true, '新出があるのに赤点が点かない');
});

test('hasNewScript: 脚本が完成する最大レベル(多摩川=era2→レベル6)を超えたら、未読でも赤点は点かない', () => {
  // レベル7（脚本には無関係のレベルアップ）。seenLevel はレベル6の完成をすでに見ている
  P.replace({ xp: P.LEVEL_XP[6], seenLevel: 6 });
  assert.equal(P.hasNewScript(), false, '脚本完成後のレベルアップで赤点が誤って点いている');
});

test('scriptProgress: 脚本1本を通した割合と、完成までの残りXPを返す', () => {
  // era 1（土偶）は 0 -> LEVEL_XP[2] が1本ぶん
  const goal = P.LEVEL_XP[2];
  P.replace({ xp: 0 });
  assert.deepEqual(P.scriptProgress(1), { ratio: 0, remain: goal });

  P.replace({ xp: Math.round(goal / 2) });
  const mid = P.scriptProgress(1);
  assert.ok(Math.abs(mid.ratio - 0.5) < 0.01, `半分で ratio が ${mid.ratio}`);

  // 段階が上がってもバーは0へ戻らない。レベル1をまたいだ直後でも割合は増え続ける
  P.replace({ xp: P.LEVEL_XP[0] });
  const afterLevelUp = P.scriptProgress(1);
  assert.ok(afterLevelUp.ratio > 0, 'レベルアップでバーが空に戻っている');
  assert.ok(Math.abs(afterLevelUp.ratio - P.LEVEL_XP[0] / goal) < 0.01);
});

test('scriptProgress: 完成後は満杯で止まり、残りは0（マイナスを出さない）', () => {
  P.replace({ xp: P.LEVEL_XP[2] * 3 });
  assert.deepEqual(P.scriptProgress(1), { ratio: 1, remain: 0 });
});

test('scriptProgress: era 2 は era 1 の完成地点から始まる（前の区間ぶんは数えない）', () => {
  P.replace({ xp: P.LEVEL_XP[2] });          // era1 完成 = era2 の起点
  assert.equal(P.scriptProgress(2).ratio, 0, 'era2 が途中から始まっている');
  assert.equal(P.scriptProgress(2).remain, P.LEVEL_XP[5] - P.LEVEL_XP[2]);
});

test('claimedSharks に無いサメは、レベルがいくつでも解放されない', async () => {
  const store = { 'samezario.save': JSON.stringify({ v: 1, xp: 999999, claimedSharks: ['cinema'] }) };
  globalThis.localStorage = {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => { store[k] = String(v); },
  };
  const m = await import('./progress.js?claim1');
  const dogu = SHARKS.find((s) => s.id === 'dogu');
  assert.equal(m.level() > 3, true, '前提: レベルは3を超えている');
  assert.equal(m.isUnlockedShark(dogu), false, 'Claim前は未解放');
  m.claimShark('dogu');
  assert.equal(m.isUnlockedShark(dogu), true, 'Claim後は解放');
});

test('claimShark は冪等（二度押しで配列が伸びない）', async () => {
  const store = { 'samezario.save': JSON.stringify({ v: 1, xp: 0, claimedSharks: ['cinema'] }) };
  globalThis.localStorage = {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => { store[k] = String(v); },
  };
  const m = await import('./progress.js?claim2');
  m.claimShark('dogu');
  m.claimShark('dogu');
  assert.deepEqual(m.save.claimedSharks, ['cinema', 'dogu']);
});

test('claimedSharks を持たない既存セーブは、旧・自動解放条件で埋められる', async () => {
  // xp 9000 = LEVEL_XP[3] 到達 → 旧条件では level()>=3 の dogu が解放済みだった
  const store = { 'samezario.save': JSON.stringify({ v: 1, xp: 9000, unlocked: ['chofu', 'tamagawa'], points: 200 }) };
  globalThis.localStorage = {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => { store[k] = String(v); },
  };
  const m = await import('./progress.js?claim3');
  assert.ok(m.save.claimedSharks.includes('dogu'), '到達済みのサメが取り上げられていない');
  assert.ok(m.save.claimedSharks.includes('cinema'), '見本は常に入る');
  assert.equal(m.save.v, 1, 'スキーマ版を上げていない');
  assert.deepEqual(m.save.unlocked, ['chofu', 'tamagawa'], 'エリア解放が保持されている');
  assert.equal(m.save.points, 200, 'ポイントが保持されている');
  // 書き戻されていること（次回起動で再計算に頼らない）
  assert.ok(JSON.parse(store['samezario.save']).claimedSharks.includes('dogu'));
});

test('第2幕が入って、赤点がレベル6まで反応する', async () => {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => { store[k] = String(v); },
  };
  const m = await import('./progress.js?smax');
  // レベル6（16,500XP）で第2幕が完成する。seenLevel が追いつくまで赤点が点く
  m.replace({ xp: 16500, seenLevel: 3 });
  assert.equal(m.level(), 6);
  assert.equal(m.hasNewScript(), true, 'レベル6の新出をまだ見ていない');
  m.markScriptSeen();
  assert.equal(m.hasNewScript(), false);
});

test('scriptProgress(2) はレベル3で0、レベル6で1', async () => {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => { store[k] = String(v); },
  };
  const m = await import('./progress.js?sp2');
  m.replace({ xp: 6000 });
  assert.equal(m.scriptProgress(2).ratio, 0);
  m.replace({ xp: 16500 });
  assert.equal(m.scriptProgress(2).ratio, 1);
  assert.equal(m.scriptProgress(2).remain, 0);
});

test('chapterLocked: 第1幕は claimedSharks に関係なく常にロックされない', () => {
  P.replace({ claimedSharks: [] });
  assert.equal(P.chapterLocked(0), false, 'claimedSharks が空でも第1幕はロックされない');
  P.replace({ claimedSharks: ['cinema', 'dogu', 'tamagawa'] });
  assert.equal(P.chapterLocked(0), false);
});

test('chapterLocked: 第2幕は前の幕（土偶）を獲得するまでロック', () => {
  P.replace({ claimedSharks: ['cinema'] });
  assert.equal(P.chapterLocked(1), true, '土偶未獲得なのにロックが外れている');
  P.replace({ claimedSharks: ['cinema', 'dogu'] });
  assert.equal(P.chapterLocked(1), false, '土偶獲得後もロックが残っている');
});

test('defaultChapter: 第1幕が進行中ならそこに留まる', () => {
  P.replace({ xp: 0, claimedSharks: ['cinema'] });
  assert.equal(P.defaultChapter(), 0);
});

test('defaultChapter: 第1幕が完成済みだが未獲得なら、ロック中の第2幕へは飛ばず第1幕に留まる', () => {
  // ここが今回の回帰対象。第1幕が復元完了(stageOf=3)しても claim していなければ
  // 第2幕はまだロック中なので、defaultChapter はロック中の章を返してはいけない
  P.replace({ xp: P.LEVEL_XP[2], claimedSharks: ['cinema'] });
  assert.equal(P.stageOf(1), 3, '前提: 第1幕は復元完了している');
  assert.equal(P.chapterLocked(1), true, '前提: 土偶未獲得なので第2幕はロック中');
  assert.equal(P.defaultChapter(), 0, '完成済み未獲得なのにロック中の第2幕へ飛んでいる');
});

test('defaultChapter: 第1幕を獲得済みで第2幕が進行中ならそちらへ進む', () => {
  P.replace({ xp: P.LEVEL_XP[2], claimedSharks: ['cinema', 'dogu'] });
  assert.equal(P.defaultChapter(), 1);
});

test('defaultChapter: 両方完成・獲得済みなら最後の章（第2幕）に留まる', () => {
  P.replace({ xp: P.LEVEL_XP[5], claimedSharks: ['cinema', 'dogu', 'tamagawa'] });
  assert.equal(P.stageOf(2), 3, '前提: 第2幕も復元完了している');
  assert.equal(P.defaultChapter(), 1);
});

test('justCompletedChapter: 段階3に到達した未獲得の章だけを返す', async () => {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => { store[k] = String(v); },
  };
  const m = await import('./progress.js?jcc');

  m.replace({ xp: 0, claimedSharks: ['cinema'] });
  assert.equal(m.justCompletedChapter(), null, '復元途中では告知しない');

  m.replace({ xp: 6000, claimedSharks: ['cinema'] });   // レベル3 = 第1幕が完成
  assert.equal(m.justCompletedChapter()?.id, 'dogu', '完成した未獲得の章を返す');

  m.replace({ xp: 6000, claimedSharks: ['cinema', 'dogu'] });
  assert.equal(m.justCompletedChapter(), null, '獲得済みなら告知しない');

  m.replace({ xp: 16500, claimedSharks: ['cinema', 'dogu'] });   // レベル6 = 第2幕が完成
  assert.equal(m.justCompletedChapter()?.id, 'tamagawa');
});
