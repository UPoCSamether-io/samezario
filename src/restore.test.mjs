import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, maskSet, protectedEnds, STAGE_RATIO, renderHTML } from './restore.js';
import { plainText } from './ruby.js';

const SAMPLE = '｜三万年前《さんまんねんまえ》の｜調布《ちょうふ》は、｜寒《さむ》かった。\nあいだの｜行《ぎょう》。\nまだ、｜誰《だれ》も｜知《し》らない。';

test('tokenize: 1文字1要素になり、ルビ塊には読みと塊IDが付く', () => {
  const toks = tokenize(SAMPLE);
  assert.equal(toks.map((t) => t.ch).join(''), '三万年前の調布は、寒かった。\nあいだの行。\nまだ、誰も知らない。');
  const mi = toks.findIndex((t) => t.ch === '三');
  assert.equal(toks[mi].ruby, 'さんまんねんまえ');
  assert.equal(toks[mi].block, toks[mi + 3].block);   // 三万年前 は同じ塊
  assert.equal(toks.find((t) => t.ch === 'の').ruby, null);
});

test('tokenize: ruby.js と同じ記法解釈になっている（記法が食い違ったら落ちる）', () => {
  assert.equal(tokenize(SAMPLE).map((t) => t.ch).join(''), plainText(SAMPLE));
});

test('maskSet: 同じ seed なら何度呼んでも同じ結果になる', () => {
  const toks = tokenize(SAMPLE);
  const a = maskSet(toks, 0.4, 12345);
  const b = maskSet(toks, 0.4, 12345);
  assert.deepEqual([...a].sort(), [...b].sort());
});

test('maskSet: seed が違えば伏せる場所が違う（ジグソーの前提）', () => {
  const toks = tokenize(SAMPLE);
  const a = maskSet(toks, 0.4, 1);
  const b = maskSet(toks, 0.4, 2);
  assert.notDeepEqual([...a].sort(), [...b].sort());
});

test('maskSet: ratio が小さいほど真部分集合になる（入れ子性）', () => {
  const toks = tokenize(SAMPLE);
  const wide = maskSet(toks, 0.40, 7);
  const narrow = maskSet(toks, 0.12, 7);
  assert.ok(narrow.size < wide.size);
  for (const i of narrow) assert.ok(wide.has(i), `添字 ${i} が広い方に含まれていない`);
});

test('maskSet: 句読点・改行は伏せない（文の骨格が消えると推測できなくなる）', () => {
  const toks = tokenize(SAMPLE);
  for (const i of maskSet(toks, 0.9, 3)) {
    assert.ok(!/[\s、。「」（）〜ー・—]/.test(toks[i].ch), `記号 ${toks[i].ch} が伏せられた`);
  }
});

test('protectedEnds + maskSet: 冒頭行と末尾行は伏せない（引きを担う行が壊れる）', () => {
  const toks = tokenize(SAMPLE);
  const keep = protectedEnds(toks);
  for (const i of maskSet(toks, 0.9, 3, keep)) assert.ok(!keep.has(i));
  assert.ok(keep.has(0), '冒頭行の先頭が保護されていない');
  assert.ok(keep.has(toks.length - 1), '末尾行の末尾が保護されていない');
});

test('STAGE_RATIO: 4段階で単調減少し、最後は0', () => {
  assert.deepEqual(STAGE_RATIO, [0.40, 0.25, 0.12, 0]);
});

test('renderHTML: 伏せていない塊にはふりがなが付く', () => {
  const toks = tokenize('｜調布《ちょうふ》のうみ');
  const html = renderHTML(toks, new Set());
  assert.match(html, /<ruby>調布<rp>\(<\/rp><rt>ちょうふ<\/rt><rp>\)<\/rp><\/ruby>/);
  assert.match(html, /のうみ/);
});

test('renderHTML: 塊が1文字でも欠けたらふりがなを出さない（答えが漏れるため）', () => {
  const toks = tokenize('｜調布《ちょうふ》のうみ');
  const bi = toks.findIndex((t) => t.ch === '布');
  const html = renderHTML(toks, new Set([bi]));
  assert.ok(!html.includes('ちょうふ'), 'ふりがなが答えを漏らしている');
  assert.match(html, /調/);
  assert.match(html, /■/);
});

test('renderHTML: マスクが空なら本文がそのまま出る', () => {
  const toks = tokenize(SAMPLE);
  const html = renderHTML(toks, new Set());
  assert.ok(!html.includes('■'));
  assert.match(html, /まだ、/);
});

test('renderHTML: added の文字はハイライトされる', () => {
  const toks = tokenize('あいうえお');
  const html = renderHTML(toks, new Set(), new Set([2]));
  assert.match(html, /<mark class="fresh">う<\/mark>/);
});

test('renderHTML: HTML特殊文字をエスケープする', () => {
  const toks = tokenize('<script>&"');
  const html = renderHTML(toks, new Set());
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;script&gt;&amp;&quot;/);
});

import { scriptView } from './restore.js';

test('scriptView: 段階が進むと読める文字が増える', () => {
  const counts = [0, 1, 2, 3].map((s) => scriptView(SAMPLE, 99, s).readable);
  for (let i = 1; i < counts.length; i++) {
    assert.ok(counts[i] >= counts[i - 1], `段階${i} で読める文字が減っている`);
  }
  assert.ok(counts[3] > counts[0], '最終段階が初期段階より読める');
});

test('scriptView: 段階3で完全復元される', () => {
  const v = scriptView(SAMPLE, 99, 3);
  assert.equal(v.readable, v.total);
  assert.ok(!v.html.includes('■'));
});

test('scriptView: 段階0では新出ゼロ、段階1以降は新出がある', () => {
  assert.equal(scriptView(SAMPLE, 99, 0).added, 0);
  assert.ok(scriptView(SAMPLE, 99, 1).added > 0, '段階1 に新出文字がない');
  assert.ok(scriptView(SAMPLE, 99, 3).added > 0, '段階3 に新出文字がない');
});

test('scriptView: 新出文字はハイライトされて出力される', () => {
  const v = scriptView(SAMPLE, 99, 1);
  assert.match(v.html, /<mark class="fresh">/);
});

test('scriptView: 二人の seed を突き合わせると読める文字が増える（ジグソー）', () => {
  const a = scriptView(SAMPLE, 1, 0);
  const b = scriptView(SAMPLE, 2, 0);
  assert.equal(a.readable, b.readable);        // 同じ段階なら量は同じ
  assert.notEqual(a.html, b.html);             // 場所は違う
});
