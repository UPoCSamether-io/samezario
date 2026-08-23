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

test('stageOf: era 1 はレベル0-6、era 2 はレベル6で0段階目に現れる', () => {
  P.replace({ xp: 0 });
  assert.equal(P.stageOf(1), 0);
  assert.equal(P.stageOf(2), 0);
  P.replace({ xp: P.LEVEL_XP[5] });          // レベル6 = 6,000XP
  assert.equal(P.level(), 6);
  assert.equal(P.stageOf(1), 6, '古代が復元完了していない');
  assert.equal(P.stageOf(2), 0, '奈良が段階0で現れていない');
});

test('stageOf: 6を超えて増えない', () => {
  P.replace({ xp: P.LEVEL_XP[P.LEVEL_XP.length - 1] });
  assert.equal(P.stageOf(1), 6);
});

// 段階を細かくした狙いそのもの。1プレイの到達質量は 1000〜2000 なので、
// 初回プレイの結果でレベル1に届かないと「遊んだのに史料が1文字も増えない」になる
test('LEVEL_XP: 最初のしきい値は1プレイの到達質量（1000〜2000）より下', () => {
  assert.ok(P.LEVEL_XP[0] < 1000, `初回プレイで届かない（${P.LEVEL_XP[0]}XP）`);
  P.replace({ xp: 1000 });
  assert.ok(P.stageOf(1) > 0, '1プレイぶんのXPで史料が1段階も進まない');
});

// 段階を倍にしても各幕の完成XPは動かさない、というのが移行の前提
// （動かすと復元途中の既存プレイヤーが巻き戻る）
test('LEVEL_XP: 各幕の完成XPは 6000/16500/31500/51000/75000/103500 のまま', () => {
  const goals = [6000, 16500, 31500, 51000, 75000, 103500];
  goals.forEach((xp, i) => {
    P.replace({ xp });
    assert.equal(P.stageOf(i + 1), 6, `第${i + 1}幕が ${xp}XP で完成していない`);
    assert.equal(P.salvageProgress(i + 1).remain, 0);
  });
});

test('isUnlockedShark: era 0（見本）は常に解放、それ以外は claimShark するまでレベルだけでは解放されない', () => {
  const dogu = SHARKS.find((s) => s.era === 1);
  P.replace({ xp: 0, claimedSharks: ['cinema'] });
  assert.equal(P.isUnlockedShark({ era: 0 }), true);
  assert.equal(P.isUnlockedShark(dogu), false);
  P.replace({ xp: P.LEVEL_XP[5] });   // 旧・自動解放条件（第1幕の完成）に達しても
  assert.equal(P.isUnlockedShark(dogu), false, 'レベルだけでは解放されない');
  P.claimShark(dogu.id);
  assert.equal(P.isUnlockedShark(dogu), true, 'Claim後は解放');
});

test('レベルがいくつでも、史料がある章のサメは先回りして配られない', () => {
  const dogu = SHARKS.find((s) => s.id === 'dogu');
  P.replace({ xp: 0, claimedSharks: ['cinema'] });
  P.addXp(P.LEVEL_XP[P.LEVEL_XP.length - 1]);   // 最大レベル
  assert.ok(!P.save.claimedSharks.includes('dogu'),
    '史料がある章は100%復元して自分で押すのが解放の意味。先回りで配ると獲得ボタンが無意味になる');
});

test('isUnlockedShark: 史料のあるサメ（土偶）はレベルが最大でも自動解放されない', () => {
  const dogu = SHARKS.find((s) => s.id === 'dogu');
  P.replace({ xp: P.LEVEL_XP[P.LEVEL_XP.length - 1], claimedSharks: ['cinema'] });
  assert.equal(P.isUnlockedShark(dogu), false, '史料がある章は claim 抜きで解放されてはいけない');
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

test('markSalvageSeen: seenLevel が現在のレベルに揃い、赤点判定が消える', () => {
  P.replace({ xp: P.LEVEL_XP[5], seenLevel: 0 });
  assert.ok(P.level() > P.save.seenLevel, '赤点が点いていない');
  P.markSalvageSeen();
  assert.equal(P.save.seenLevel, P.level());
});

test('markSalvageSeen: seenXp も今の位置へ進む（次に開いたときのゲージの起点）', () => {
  P.replace({ xp: 3000, seenXp: 0 });
  assert.equal(P.salvageProgress(1, P.save.seenXp).ratio, 0, '起点が動いてしまっている');
  P.markSalvageSeen();
  assert.equal(P.save.seenXp, 3000);
  assert.equal(P.salvageProgress(1, P.save.seenXp).ratio, P.salvageProgress(1).ratio,
    '開いた直後なのに起点と現在値がずれている（もう一度開くとバーが動く）');
});

test('salvageProgress: xp を渡すとその位置の比率になる（省略時は現在値）', () => {
  P.replace({ xp: 6000 });
  assert.equal(P.salvageProgress(1, 0).ratio, 0);
  assert.equal(P.salvageProgress(1, 3000).ratio, 0.5);
  assert.equal(P.salvageProgress(1).ratio, 1);
});

// 目盛りを等間隔で置くと「あと少しで文字が増える」の位置が実際とずれる。
// XPのしきい値は逓増するので、間隔は必ず右へ行くほど広がる
test('stageTicks: 段階数-1 本が昇順で 0..100 の内側に並び、等間隔ではない', () => {
  for (const era of [1, 2, 6]) {
    const t = P.stageTicks(era);
    assert.equal(t.length, 5, `era${era}: 目盛りが5本でない`);
    assert.ok(t[0] > 0 && t[4] < 100, `era${era}: 両端に目盛りが載っている`);
    const gaps = t.map((x, i) => x - (i ? t[i - 1] : 0));
    for (let i = 1; i < gaps.length; i++) {
      assert.ok(gaps[i] > gaps[i - 1], `era${era}: 間隔 ${i} が広がっていない（等間隔になっている）`);
    }
  }
});

// 目盛りは「あと何回で文字が増えるか」を数える印なので、塗りに飲まれる位置と
// 段階が上がる位置が一致していなければ意味がない
test('stageTicks: k本目の目盛りは、段階が k+1 へ上がるちょうどその位置', () => {
  const ticks = P.stageTicks(1);
  ticks.forEach((pct, k) => {
    P.replace({ xp: P.LEVEL_XP[k] });
    assert.equal(P.stageOf(1), k + 1, `段階が ${k + 1} になっていない`);
    assert.ok(Math.abs(P.salvageProgress(1).ratio * 100 - pct) < 0.001,
      `段階${k + 1} に上がる位置(${P.salvageProgress(1).ratio * 100}%)と目盛り(${pct}%)がずれている`);
  });
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

test('hasNewSalvage: レベルが seenLevel を超えたときだけ赤点が点く', () => {
  P.replace({ xp: P.LEVEL_XP[5], seenLevel: P.LEVEL_XP.length });
  assert.equal(P.hasNewSalvage(), false, '既読なのに赤点が点いている');
  P.replace({ seenLevel: 0 });
  assert.equal(P.hasNewSalvage(), true, '新出があるのに赤点が点かない');
});

test('hasNewSalvage: 史料が完成する最大レベル(妖怪=era6→レベル36)の先では、赤点は点かない', () => {
  // 最終幕を読み終えた状態から、さらにXPを積む。頭打ちなので赤点は点かない
  P.replace({ xp: P.LEVEL_XP[35] * 2, seenLevel: 36 });
  assert.equal(P.hasNewSalvage(), false, '史料完成後のXP加算で赤点が誤って点いている');
});

test('hasNewSalvage: 第2幕の完成後も、第3幕の泥が落ちれば赤点が点く', () => {
  P.replace({ xp: P.LEVEL_XP[13], seenLevel: 12 });
  assert.equal(P.hasNewSalvage(), true);
});

test('salvageProgress: 史料1本を通した割合と、完成までの残りXPを返す', () => {
  // era 1（土偶）は 0 -> LEVEL_XP[5]（6,000XP）が1本ぶん
  const goal = P.LEVEL_XP[5];
  P.replace({ xp: 0 });
  assert.deepEqual(P.salvageProgress(1), { ratio: 0, remain: goal });

  P.replace({ xp: Math.round(goal / 2) });
  const mid = P.salvageProgress(1);
  assert.ok(Math.abs(mid.ratio - 0.5) < 0.01, `半分で ratio が ${mid.ratio}`);

  // 段階が上がってもバーは0へ戻らない。レベル1をまたいだ直後でも割合は増え続ける
  P.replace({ xp: P.LEVEL_XP[0] });
  const afterLevelUp = P.salvageProgress(1);
  assert.ok(afterLevelUp.ratio > 0, 'レベルアップでバーが空に戻っている');
  assert.ok(Math.abs(afterLevelUp.ratio - P.LEVEL_XP[0] / goal) < 0.01);
});

test('salvageProgress: 完成後は満杯で止まり、残りは0（マイナスを出さない）', () => {
  P.replace({ xp: P.LEVEL_XP[5] * 3 });
  assert.deepEqual(P.salvageProgress(1), { ratio: 1, remain: 0 });
});

test('salvageProgress: era 2 は era 1 の完成地点から始まる（前の区間ぶんは数えない）', () => {
  P.replace({ xp: P.LEVEL_XP[5] });          // era1 完成 = era2 の起点
  assert.equal(P.salvageProgress(2).ratio, 0, 'era2 が途中から始まっている');
  assert.equal(P.salvageProgress(2).remain, P.LEVEL_XP[11] - P.LEVEL_XP[5]);
});

test('claimedSharks に無いサメは、レベルがいくつでも解放されない', async () => {
  const store = { 'samezario.save': JSON.stringify({ v: 1, xp: 999999, claimedSharks: ['cinema'] }) };
  globalThis.localStorage = {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => { store[k] = String(v); },
  };
  const m = await import('./progress.js?claim1');
  const dogu = SHARKS.find((s) => s.id === 'dogu');
  assert.equal(m.level() > 6, true, '前提: レベルは第1幕の完成を超えている');
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
  // xp 9000 は第1幕の完成（6,000XP）を越えている → 旧条件で dogu が解放済みだった
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
  // 16,500XP（レベル12）で第2幕が完成する。seenLevel が追いつくまで赤点が点く
  m.replace({ xp: 16500, seenLevel: 6 });
  assert.equal(m.level(), 12);
  assert.equal(m.hasNewSalvage(), true, 'レベル6の新出をまだ見ていない');
  m.markSalvageSeen();
  assert.equal(m.hasNewSalvage(), false);
});

test('salvageProgress(2) は 6,000XP で0、16,500XP で1', async () => {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => { store[k] = String(v); },
  };
  const m = await import('./progress.js?sp2');
  m.replace({ xp: 6000 });
  assert.equal(m.salvageProgress(2).ratio, 0);
  m.replace({ xp: 16500 });
  assert.equal(m.salvageProgress(2).ratio, 1);
  assert.equal(m.salvageProgress(2).remain, 0);
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
  // ここが今回の回帰対象。第1幕が復元完了(stageOf=6)しても claim していなければ
  // 第2幕はまだロック中なので、defaultChapter はロック中の章を返してはいけない
  P.replace({ xp: P.LEVEL_XP[5], claimedSharks: ['cinema'] });
  assert.equal(P.stageOf(1), 6, '前提: 第1幕は復元完了している');
  assert.equal(P.chapterLocked(1), true, '前提: 土偶未獲得なので第2幕はロック中');
  assert.equal(P.defaultChapter(), 0, '完成済み未獲得なのにロック中の第2幕へ飛んでいる');
});

test('defaultChapter: 第1幕を獲得済みで第2幕が進行中ならそちらへ進む', () => {
  P.replace({ xp: P.LEVEL_XP[5], claimedSharks: ['cinema', 'dogu'] });
  assert.equal(P.defaultChapter(), 1);
});

test('defaultChapter: 完成・獲得済みの先に未完成の章があれば、そこへ進む', () => {
  P.replace({ xp: P.LEVEL_XP[11], claimedSharks: ['cinema', 'dogu', 'tamagawa'] });
  assert.equal(P.stageOf(2), 6, '前提: 第2幕も復元完了している');
  assert.equal(P.defaultChapter(), 2, '第3幕（未完成）が次の行き先');
});

test('unclaimedFinishedChapter: 最終段階に到達した未獲得の章だけを返す', async () => {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => { store[k] = String(v); },
  };
  const m = await import('./progress.js?jcc');

  m.replace({ xp: 0, claimedSharks: ['cinema'] });
  assert.equal(m.unclaimedFinishedChapter(), null, '復元途中では告知しない');

  m.replace({ xp: 6000, claimedSharks: ['cinema'] });   // 6,000XP = 第1幕が完成
  assert.equal(m.unclaimedFinishedChapter()?.id, 'dogu', '完成した未獲得の章を返す');

  m.replace({ xp: 6000, claimedSharks: ['cinema', 'dogu'] });
  assert.equal(m.unclaimedFinishedChapter(), null, '獲得済みなら告知しない');

  m.replace({ xp: 16500, claimedSharks: ['cinema', 'dogu'] });   // 16,500XP = 第2幕が完成
  assert.equal(m.unclaimedFinishedChapter()?.id, 'tamagawa');
});
