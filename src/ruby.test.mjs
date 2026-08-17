import test from 'node:test';
import assert from 'node:assert/strict';
import { rubify, plainText, esc } from './ruby.js';

test('esc: 特殊文字をエスケープする', () => {
  assert.equal(esc('サメ & <魚> "大"'), 'サメ &amp; &lt;魚&gt; &quot;大&quot;');
  assert.equal(esc(''), '');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('rubify: 正常系（全角・半角パイプ、複数ルビ）', () => {
  assert.equal(
    rubify('｜布多天神社《ふだてんじんじゃ》'),
    '<ruby>布多天神社<rp>(</rp><rt>ふだてんじんじゃ</rt><rp>)</rp></ruby>'
  );
  assert.equal(
    rubify('|深大寺《じんだいじ》'),
    '<ruby>深大寺<rp>(</rp><rt>じんだいじ</rt><rp>)</rp></ruby>'
  );
  assert.equal(
    rubify('｜調布《ちょうふ》の｜深大寺《じんだいじ》 山門'),
    '<ruby>調布<rp>(</rp><rt>ちょうふ</rt><rp>)</rp></ruby>の<ruby>深大寺<rp>(</rp><rt>じんだいじ</rt><rp>)</rp></ruby> 山門'
  );
  assert.equal(rubify('ルビなしテキスト'), 'ルビなしテキスト');
  assert.equal(rubify(''), '');
  assert.equal(rubify(null), '');
});

test('rubify: エスケープとルビの混在・安全性', () => {
  assert.equal(
    rubify('｜A&B《えー&びー》 <tag>'),
    '<ruby>A&amp;B<rp>(</rp><rt>えー&amp;びー</rt><rp>)</rp></ruby> &lt;tag&gt;'
  );
});

test('rubify: 壊れた記法（単独パイプ、閉じなし等）は平文として安全に出力', () => {
  assert.equal(rubify('｜布多天神社'), '｜布多天神社');
  assert.equal(rubify('《ふだてんじんじゃ》'), '《ふだてんじんじゃ》');
  assert.equal(rubify('｜布多天神社《ふだ'), '｜布多天神社《ふだ');
  assert.equal(rubify('｜《ふだ》'), '｜《ふだ》');
});

test('plainText: ルビ記法から親文字のみを抽出', () => {
  assert.equal(plainText('｜布多天神社《ふだてんじんじゃ》'), '布多天神社');
  assert.equal(plainText('|深大寺《じんだいじ》'), '深大寺');
  assert.equal(plainText('｜調布《ちょうふ》の｜深大寺《じんだいじ》 山門'), '調布の深大寺 山門');
  assert.equal(plainText('通常のテキスト'), '通常のテキスト');
  assert.equal(plainText(''), '');
  assert.equal(plainText(null), '');
});
