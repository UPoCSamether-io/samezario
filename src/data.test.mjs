import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SHARKS } from './data.js';
import { scriptView, STAGE_RATIO } from './restore.js';

test('全サメが era を持ち、1..6 が重複なく揃っている', () => {
  for (const d of SHARKS) assert.equal(typeof d.era, 'number', `${d.id} に era がない`);
  const eras = SHARKS.map((d) => d.era).filter((e) => e > 0).sort();
  assert.deepEqual(eras, [1, 2, 3, 4, 5, 6]);
  assert.equal(SHARKS.filter((d) => d.era === 0).length, 1, '見本は1種だけ');
});

test('SHARKS は era 順に並んでいる（見本が先頭）', () => {
  assert.equal(SHARKS[0].era, 0);
  const rest = SHARKS.slice(1).map((d) => d.era);
  assert.deepEqual(rest, [...rest].sort((a, b) => a - b));
});

test('土偶サメと近藤イサメが存在する', () => {
  const dogu = SHARKS.find((d) => d.id === 'dogu');
  const kondo = SHARKS.find((d) => d.id === 'kondo');
  assert.ok(dogu, '土偶サメがない');
  assert.ok(kondo, '近藤イサメがない');
  assert.equal(dogu.era, 1);
  assert.equal(kondo.era, 4);
});

test('区分1・2（土偶サメ・多摩川サメ）が script を持つ（スコープは2本）', () => {
  const withScript = SHARKS.filter((d) => d.script);
  assert.equal(withScript.length, 2);
  assert.deepEqual(withScript.map((d) => d.id).sort(), ['dogu', 'tamagawa']);
});

test('script は改行を含み、ルビ記法が閉じている', () => {
  const { script } = SHARKS.find((d) => d.id === 'dogu');
  assert.ok(script.includes('\n'));
  assert.equal((script.match(/《/g) || []).length, (script.match(/》/g) || []).length);
  assert.equal((script.match(/｜/g) || []).length, (script.match(/《/g) || []).length);
});

test('全サメが描画に必要なパラメータを持つ', () => {
  for (const d of SHARKS) {
    for (const k of ['id', 'name', 'en', 'color', 'accent', 'speed', 'turn', 'growth', 'aspect', 'skill', 'lore']) {
      assert.ok(d[k] !== undefined, `${d.id} に ${k} がない`);
    }
  }
});

test('本物の脚本は段階が進むほど読める文字が確実に増える', () => {
  const { script } = SHARKS.find((d) => d.id === 'dogu');
  const views = STAGE_RATIO.map((_, s) => scriptView(script, 20260819, s));

  for (let s = 1; s < views.length; s++) {
    assert.ok(
      views[s].readable > views[s - 1].readable,
      `段階${s} で読める文字が増えていない（${views[s - 1].readable} -> ${views[s].readable}）`,
    );
    assert.ok(views[s].added > 0, `段階${s} で新出文字が1文字も無い`);
  }
  assert.equal(views[views.length - 1].readable, views[0].total, '最終段階で全文が読めていない');
  assert.equal(views[0].added, 0, '段階0に新出があるのはおかしい');
});

test('史料を持つのは era 1 と 2 の2本で、章の見出しが揃っている', () => {
  const chapters = SHARKS.filter((d) => d.script).sort((a, b) => a.era - b.era);
  assert.deepEqual(chapters.map((d) => d.era), [1, 2]);
  for (const d of chapters) {
    assert.equal(typeof d.scriptTitle, 'string', `${d.id} に scriptTitle がない`);
    assert.equal(typeof d.scriptTagline, 'string', `${d.id} に scriptTagline がない`);
    assert.ok(d.scriptTitle.length > 0 && d.scriptTagline.length > 0);
  }
});

test('史料の本文が全4段階で描画でき、ルビ記法が壊れていない', () => {
  for (const d of SHARKS.filter((s) => s.script)) {
    for (let stage = 0; stage < STAGE_RATIO.length; stage++) {
      const v = scriptView(d.script, 12345, stage);
      assert.ok(v.total > 0, `${d.id} stage${stage}: 本文が空`);
      // ルビ記法が生のまま残っていたら tokenize が拾えていない
      assert.ok(!/[|｜《》]/.test(v.html), `${d.id} stage${stage}: 未解釈のルビ記法が残っている`);
    }
    // 完成段階では伏せ字が1つも残らない
    assert.ok(!scriptView(d.script, 12345, STAGE_RATIO.length - 1).html.includes('■'));
  }
});

test('第1幕の本文は凍結されている（変更するとマスク位置が総ずれする）', () => {
  const dogu = SHARKS.find((d) => d.id === 'dogu');
  // 内容そのもののハッシュで固定する。誤字修正であっても、公開済みの本文を変えると
  // 復元途中のプレイヤーの読めていた文章が壊れる（restore.js の maskSet は KEEP 文字
  // （空白・句読点など）を除いた cand を作ってから Fisher-Yates で伏せ字位置を決めるので、
  // script.length や scriptView().total が変わらない編集――たとえば「、」1字を漢字に
  // 差し替える――でも cand.length が変わり、全プレイヤーの伏せ字位置が丸ごとズレる。
  // 文字数だけを見る旧アサーションはこの種の編集を素通りさせていたため、
  // 本文全体のハッシュに切り替えて穴を塞ぐ
  const sha = createHash('sha256').update(dogu.script, 'utf8').digest('hex');
  assert.equal(sha, '8f82e7945b66ff8c88bd27e3682cdc0ea32d2dfad2344221c992c5e03a612723', '第1幕の本文が変更されている');
});
