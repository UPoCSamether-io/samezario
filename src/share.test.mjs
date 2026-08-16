import assert from 'node:assert/strict';
import {
  HASHTAGS, projectUrl, shortLore, shareText, textWithUrl, tweetUrl,
  photoFile, classifyError, shareUnlock, explainShare,
} from './share.js';
import { MAPS } from './data.js';

const map = MAPS.find((m) => m.id === 'jindaiji');
const spot = map.spot;
const URL_ = 'https://example.test/';

// ---------- 文面 ----------

// クエリは落とす（?demo=1 のまま配ると、受け取った人が判定を飛ばした状態で開く）
assert.equal(projectUrl({ origin: 'https://a.test', pathname: '/game/' }), 'https://a.test/game/');
assert.equal(projectUrl(null), '');

// 歴史紹介は先頭の一文だけ。長い解説はここで切れる
{
  const s = shortLore(spot);
  assert.ok(s.endsWith('。') || s.endsWith('…'), s);
  assert.ok(s.length <= 70, `長すぎる: ${s.length}`);
  assert.ok(!s.includes('\n'));
  assert.equal(shortLore({ desc: 'あ'.repeat(200) }), 'あ'.repeat(69) + '…');
  assert.equal(shortLore({ desc: '' }), '');
  assert.equal(shortLore(null), '');
}

// 共有文にはロケ地名・歴史・ハッシュタグが載る
{
  const t = shareText(map, spot);
  assert.ok(t.includes(spot.name), 'スポット名');
  assert.ok(t.includes(`『${map.name}エリア』`), 'エリア名');
  assert.ok(t.includes(shortLore(spot)), '歴史紹介');
  for (const h of HASHTAGS) assert.ok(t.includes(h), h);
  // URL は share() が別に受け取るので文面には入れない（二重表示よけ）
  assert.ok(!t.includes('http'), 'URL を文面に混ぜない');

  // desc が無いスポットでもダッシュだけ残らず綺麗に出る
  const tNoLore = shareText(map, { id: 'test', name: 'テスト場所', desc: '' });
  assert.ok(tNoLore.includes('📍テスト場所\n#サメザリオ'));
  assert.ok(!tNoLore.includes('—'));
}

// コピー・X へ渡すときだけ URL を足す
assert.equal(textWithUrl('本文', URL_), `本文\n${URL_}`);
assert.equal(textWithUrl('本文', ''), '本文');

// X の投稿画面。ハッシュタグの # やスペースが素通りしないこと
{
  const u = tweetUrl('a b#c', URL_);
  assert.ok(u.startsWith('https://twitter.com/intent/tweet?text='));
  assert.ok(u.includes('a%20b%23c'), u);
  assert.ok(u.includes(`url=${encodeURIComponent(URL_)}`));
  assert.ok(!tweetUrl('x', '').includes('url='));
}

// ---------- キャンセルと失敗の区別 ----------

assert.equal(classifyError(Object.assign(new Error('x'), { name: 'AbortError' })), 'cancelled');
assert.equal(classifyError(Object.assign(new Error('x'), { code: 20 })), 'cancelled');
assert.equal(classifyError(Object.assign(new Error('x'), { name: 'NotAllowedError' })), 'failed');
assert.equal(classifyError(new Error('boom')), 'failed');
assert.equal(classifyError(null), 'failed');

// ---------- 写真 ----------

{
  const f = photoFile(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }), spot);
  assert.ok(f instanceof File);
  assert.equal(f.name, `samezario-${spot.id}.jpg`);
  assert.equal(f.type, 'image/jpeg');
  assert.equal(photoFile(null, spot), null);
}

// ---------- 一本道 ----------

const photo = () => new Blob([new Uint8Array(8)], { type: 'image/jpeg' });
const abort = () => Object.assign(new Error('cancel'), { name: 'AbortError' });

/** 呼ばれたものを記録するだけの deps */
function stub({ share, canShare = () => true, writeText, open } = {}) {
  const log = { shared: [], copied: [], opened: [] };
  return {
    log,
    deps: {
      url: URL_,
      nav: share ? { share: (d) => (log.shared.push(d), share(d)), canShare } : {},
      clipboard: writeText ? { writeText: (t) => (log.copied.push(t), writeText(t)) } : null,
      open: open ? (...a) => (log.opened.push(a), open(...a)) : null,
    },
  };
}

// ① 対応端末：写真ごと共有シートへ。文面と URL も一緒に載る
{
  const { log, deps } = stub({ share: async () => {} });
  const r = await shareUnlock({ map, spot, photo: photo() }, deps);
  assert.deepEqual([r.ok, r.via, r.cancelled, r.withPhoto], [true, 'share', false, true]);
  assert.equal(log.shared[0].files.length, 1);
  assert.equal(log.shared[0].url, URL_);
  assert.ok(log.shared[0].text.includes(spot.name));
}

// canShare が写真を拒む端末では、文だけで共有する（丸ごと失敗させない）
{
  const { log, deps } = stub({ share: async () => {}, canShare: () => false });
  const r = await shareUnlock({ map, spot, photo: photo() }, deps);
  assert.deepEqual([r.ok, r.via, r.withPhoto], [true, 'share-text', false]);
  assert.equal(log.shared[0].files, undefined, '写真は渡さない');
}

// 写真つきで弾かれたら、文だけでもう一度だけ試す
{
  const { log, deps } = stub({
    share: async (d) => { if (d.files) throw new Error('DataError'); },
  });
  const r = await shareUnlock({ map, spot, photo: photo() }, deps);
  assert.deepEqual([r.ok, r.via, r.withPhoto], [true, 'share-text', false]);
  assert.equal(log.shared.length, 2);
}

// ② キャンセルは成功にしない。フォールバックへも落とさない（勝手にコピー・投稿しない）
{
  const { log, deps } = stub({
    share: async () => { throw abort(); },
    writeText: async () => {}, open: () => ({}),
  });
  const r = await shareUnlock({ map, spot, photo: photo() }, deps);
  assert.deepEqual([r.ok, r.cancelled, r.via], [false, true, 'share']);
  assert.deepEqual([log.copied.length, log.opened.length], [0, 0]);
}

// 写真つきを閉じた後、文だけの再試行でも閉じたらキャンセル
{
  const { deps } = stub({
    share: async (d) => { if (d.files) throw new Error('DataError'); throw abort(); },
  });
  const r = await shareUnlock({ map, spot, photo: photo() }, deps);
  assert.deepEqual([r.ok, r.cancelled], [false, true]);
}

// ③ 非対応ブラウザ：共有文をコピー。URL 込みで1本になる
{
  const { log, deps } = stub({ writeText: async () => {}, open: () => ({}) });
  const r = await shareUnlock({ map, spot, photo: photo() }, deps);
  assert.deepEqual([r.ok, r.via, r.cancelled], [true, 'copy', false]);
  assert.equal(log.copied[0], textWithUrl(shareText(map, spot), URL_));
  assert.equal(log.opened.length, 0, 'コピーできたら X は開かない');
}

// ④ コピーもできなければ X の投稿画面
{
  const opened = { opener: {} };
  const { log, deps } = stub({
    writeText: async () => { throw new Error('NotAllowedError'); },
    open: () => opened,
  });
  const r = await shareUnlock({ map, spot }, deps);
  assert.equal(r.via, 'tweet');
  assert.ok(log.opened[0][0].includes('twitter.com/intent/tweet'));
  assert.deepEqual(log.opened[0].slice(1), ['_blank']);
  assert.equal(opened.opener, null, '投稿先から元画面を操作させない');
}

// ポップアップブロックで開けなかったら成功にしない（文面は手で拾えるよう返す）
{
  const { deps } = stub({ open: () => null });
  const r = await shareUnlock({ map, spot }, deps);
  assert.deepEqual([r.ok, r.via, r.cancelled], [false, 'none', false]);
  assert.ok(r.text.includes(URL_));
}

// open が undefined を返した場合も開けていない判定
{
  const { deps } = stub({ open: () => undefined });
  const r = await shareUnlock({ map, spot }, deps);
  assert.deepEqual([r.ok, r.via, r.cancelled], [false, 'none', false]);
}

// 手立てが何も無い環境でも例外にしない
{
  const r = await shareUnlock({ map, spot }, { nav: {}, clipboard: null, open: null, url: URL_ });
  assert.deepEqual([r.ok, r.via], [false, 'none']);
}

// 同じスポットを何度でも共有できる（このモジュールは回数を持たない）
{
  const { log, deps } = stub({ share: async () => {} });
  for (let i = 0; i < 3; i++) {
    assert.equal((await shareUnlock({ map, spot, photo: photo() }, deps)).ok, true);
  }
  assert.equal(log.shared.length, 3);
}

// ---------- 文言 ----------

for (const via of ['share', 'share-text', 'copy', 'tweet', 'none']) {
  assert.ok(explainShare({ via }).length > 0, via);
}

// 全スポットで文面が組める（データが増えたときの取りこぼしよけ）
for (const m of MAPS) {
  const t = shareText(m, m.spot);
  assert.ok(t.includes(m.spot.name) && t.includes(HASHTAGS[0]), m.id);
  assert.ok(t.length < 140, `${m.id}: 共有文が長すぎる（${t.length}字）`);
}

console.log('share ok');
