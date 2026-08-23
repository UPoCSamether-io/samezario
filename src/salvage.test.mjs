import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, maskSet, protectedEnds, STAGE_RATIO, renderHTML } from './salvage.js';
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

test('STAGE_RATIO: 7段階で単調減少し、最後は0', () => {
  assert.deepEqual(STAGE_RATIO, [0.40, 0.32, 0.25, 0.185, 0.12, 0.06, 0]);
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
  const toks = tokenize('<salvageText>&"');
  const html = renderHTML(toks, new Set());
  assert.ok(!html.includes('<salvageText>'));
  assert.match(html, /&lt;salvageText&gt;&amp;&quot;/);
});

import { salvageView } from './salvage.js';

const LAST = STAGE_RATIO.length - 1;

// SAMPLE は伏せられる文字が5つしかなく、隣り合う段階（0.40 と 0.32）が同じ数に
// 丸まって「新出ゼロ」になる。段階の差を見る側では長い本文を使う（本物の史料は
// 400字超で、そちらは data.test.mjs が全6幕ぶん見ている）
const LONG = `${SAMPLE}
`.repeat(8);

test('salvageView: 段階が進むと読める文字が増える', () => {
  const counts = STAGE_RATIO.map((_, s) => salvageView(SAMPLE, 99, s).readable);
  for (let i = 1; i < counts.length; i++) {
    assert.ok(counts[i] >= counts[i - 1], `段階${i} で読める文字が減っている`);
  }
  assert.ok(counts[LAST] > counts[0], '最終段階が初期段階より読める');
});

test('salvageView: 最終段階で完全復元される', () => {
  const v = salvageView(SAMPLE, 99, LAST);
  assert.equal(v.readable, v.total);
  assert.ok(!v.html.includes('■'));
});

test('salvageView: 段階0では新出ゼロ、段階1以降は新出がある', () => {
  assert.equal(salvageView(LONG, 99, 0).added, 0);
  for (let s = 1; s <= LAST; s++) {
    assert.ok(salvageView(LONG, 99, s).added > 0, `段階${s} に新出文字がない`);
  }
});

test('salvageView: 新出文字はハイライトされて出力される', () => {
  const v = salvageView(LONG, 99, 1);
  assert.match(v.html, /<mark class="fresh">/);
});

test('salvageView: 二人の seed を突き合わせると読める文字が増える（ジグソー）', () => {
  const a = salvageView(SAMPLE, 1, 0);
  const b = salvageView(SAMPLE, 2, 0);
  assert.equal(a.readable, b.readable);        // 同じ段階なら量は同じ
  assert.notEqual(a.html, b.html);             // 場所は違う
});
