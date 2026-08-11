// 中継サーバの最小チェック: node server/relay.test.mjs
// 「誰がホストか / どっち向きに配るか / ホストが抜けたら誰が継ぐか」だけを見る。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { attach } from './index.mjs';

const http = createServer();
attach(http);
await new Promise((r) => http.listen(0, r));
const url = `ws://localhost:${http.address().port}/ws`;

/** 接続して join し、hello を待つ。以降のメッセージは inbox に溜める */
function client(name, map = 'chofu') {
  const ws = new WebSocket(url);
  const c = { ws, name, inbox: [], hello: null };
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.t === 'hello') c.hello = m; else c.inbox.push(m);
  });
  ws.on('open', () => ws.send(JSON.stringify({ t: 'join', map, shark: 'cinema', name })));
  return c;
}
const settle = () => new Promise((r) => setTimeout(r, 120));
const take = (c) => c.inbox.splice(0);

const a = client('A'), b = client('B'), c = client('C');
await settle();

// 1. 最初の1人がホスト、あとはゲスト
assert.equal(a.hello.host, true, 'A がホスト');
assert.equal(b.hello.host, false);
assert.equal(c.hello.host, false);

// 2. ホストには入室が通知され、ゲストにも届く（名前は10文字に丸められる）
assert.deepEqual(take(a).map((m) => [m.t, m.name]), [['peer', 'B'], ['peer', 'C']]);
take(b); take(c);

// 3. ゲストの入力はホストだけに届き、差出人はサーバが刻む
b.ws.send(JSON.stringify({ t: 'in', a: 1.5, b: 1, id: 'なりすまし' }));
await settle();
assert.deepEqual(take(a), [{ t: 'in', a: 1.5, b: 1, id: b.hello.id }]);
assert.deepEqual(take(c), [], 'ゲストの入力は他のゲストへ流さない');

// 4. ホストのスナップショットは全員へ
a.ws.send(JSON.stringify({ t: 'snap', s: [] }));
await settle();
assert.equal(take(b).length, 1);
assert.equal(take(c).length, 1);

// 5. 名指し（入室直後の1人へ盤面をまるごと）はその人だけに
a.ws.send(JSON.stringify({ t: 'full', to: c.hello.id, f: [] }));
await settle();
assert.deepEqual(take(b), []);
assert.equal(take(c)[0].t, 'full');

// 6. ホストが抜けたら次の人が継ぎ、全員に退室が伝わる
a.ws.close();
await settle();
const bMsgs = take(b), cMsgs = take(c);
assert.ok(bMsgs.some((m) => m.t === 'host'), 'B が昇格');
assert.ok(!cMsgs.some((m) => m.t === 'host'), 'C は昇格しない');
assert.ok(bMsgs.some((m) => m.t === 'bye' && m.id === a.hello.id));
assert.ok(cMsgs.some((m) => m.t === 'bye' && m.id === a.hello.id));

// 7. 新ホストの配信が全員へ回る（＝委譲後も線が繋がっている）
b.ws.send(JSON.stringify({ t: 'snap', s: [] }));
await settle();
assert.equal(take(c).length, 1);

// 8. 別のマップは別の部屋（混ざらない）
const d = client('D', 'jindaiji');
await settle();
assert.equal(d.hello.host, true, '別マップなら1人目はホスト');
assert.deepEqual(take(b), [], '部屋をまたいで漏れない');

b.ws.close(); c.ws.close(); d.ws.close();
http.close();
console.log('relay ok');
