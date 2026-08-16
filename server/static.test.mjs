// 配信ヘッダの最小チェック: node server/static.test.mjs
// 見るのは1点だけ ——「再読み込みで取り直させないか」。ここが抜けていた頃は
// 毎回 800KB を落とし直し、届くまでサメも文字もフォールバックのまま出ていた。
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { DIST, serveStatic } from './index.mjs';

if (!existsSync(DIST)) {
  console.log('skip: dist が無い（npm run build のあとで効く）');
  process.exit(0);
}

const http = createServer(serveStatic);
await new Promise((r) => http.listen(0, r));
const base = `http://localhost:${http.address().port}`;
const cc = async (p) => (await fetch(base + p)).headers.get('cache-control');

// HTML は毎回確かめる。ここを固めると新しいビルドが出ていかない
assert.equal(await cc('/'), 'no-cache');

// 画像はハッシュが付かないので永久ではないが、再読み込みでは取り直さない長さ
assert.match(await cc('/img/sharks/cinema.webp'), /max-age=\d{4,}/);
assert.match(await cc('/img/sharks/cinema_side.webp'), /max-age=\d{4,}/);

// /assets はビルドごとに名前が変わるので、実際に配っている名前を index.html から拾う
const html = await (await fetch(`${base}/`)).text();
const asset = html.match(/\/assets\/[\w.-]+\.js/)?.[0];
assert.ok(asset, 'index.html に /assets の js が見当たらない');
assert.equal(await cc(asset), 'public, max-age=31536000, immutable');

// 知らない URL は index.html に落ちる。その中身は HTML なので固めない
assert.equal(await cc('/nope/deep/link'), 'no-cache');

http.close();
console.log('ok static cache headers');
