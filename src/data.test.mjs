import test from 'node:test';
import assert from 'node:assert/strict';
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

test('区分1（土偶サメ）だけが script を持つ（スコープは1本）', () => {
  const withScript = SHARKS.filter((d) => d.script);
  assert.equal(withScript.length, 1);
  assert.equal(withScript[0].id, 'dogu');
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
