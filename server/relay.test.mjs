// 権威サーバの最小チェック: node server/relay.test.mjs
// 「盤面がサーバで進んでいるか / 操作が効くか / 名乗りを信じていないか /
//  出入りで部屋が壊れないか」だけを見る。物理そのものは src/sim.test.mjs 側。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { attach } from './index.mjs';

const http = createServer();
attach(http);
await new Promise((r) => http.listen(0, r));
let url = `ws://localhost:${http.address().port}/ws`;

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
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms));
const take = (c) => c.inbox.splice(0);
/** 直近のスナップショットから、その人のサメの行 [nid,x,y,angle,mass,flags] を拾う */
const lastRow = (msgs, id) => {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const row = msgs[i].s?.find((r) => r[0] === id);
    if (row) return row;
  }
  return null;
};

const a = client('A');
await settle();

// 1. 入室した本人には盤面がまるごと届く。空席はボットが埋まっている
const full = take(a).find((m) => m.t === 'full');
assert.ok(full, 'full が届く');
assert.equal(full.r.length, 14, '部屋は人＋ボットで 14 匹（人が増えても総数は変わらない）');
assert.ok(full.r.some((e) => e[0] === a.hello.id && e[1] === 'A'), '自分が名簿に居る');
assert.ok(full.f.length > 500, `餌が湧いている: ${full.f.length}`);

// 2. 後から入った B も名簿に載り、A 側にも伝わる
const b = client('B');
await settle();
const rosterA = take(a).filter((m) => m.r).pop();
assert.ok(rosterA?.r.some((e) => e[0] === b.hello.id), 'A に B の入室が伝わる');
assert.equal(rosterA.r.length, 14, '人が増えても総数は 14');

// 3. 盤面がサーバで進んでいる（誰も snap を送っていないのに位置が変わる）
await settle();
const p1 = lastRow(take(a), a.hello.id);
await settle();
const p2 = lastRow(take(a), a.hello.id);
assert.ok(p1 && p2, 'スナップショットが 15Hz で流れている');
assert.notEqual(`${p1[1]},${p1[2]}`, `${p2[1]},${p2[2]}`, 'サメが動いている');

// 4. 操作が効く。ダッシュを押すと、次のスナップショットで旗（bit 2）が立つ
//    角度の収束ではなく旗で見るのは、寄るまでの時間が体格と壁で変わるため
const BOOST = 2;
const prevRow = lastRow(take(a), a.hello.id);
const targetX = prevRow ? prevRow[1] + 5 : 500;
const targetY = prevRow ? prevRow[2] + 5 : 500;
a.ws.send(JSON.stringify({ t: 'in', a: 0, b: 1, x: targetX, y: targetY }));
await settle();
const newRow = lastRow(take(a), a.hello.id);
assert.ok(newRow[5] & BOOST, 'A のダッシュがサーバに届く');


// 5. 差出人は線で決まる。他人の id を騙っても、点くのは自分の旗だけ
b.ws.send(JSON.stringify({ t: 'in', a: 0, b: 1, id: a.hello.id }));
a.ws.send(JSON.stringify({ t: 'in', a: 0, b: 0 }));   // A は自分で消しにいく
await settle();
const msgs = take(b);
assert.ok(!(lastRow(msgs, a.hello.id)[5] & BOOST), 'A は騙りに操作されない');
assert.ok(lastRow(msgs, b.hello.id)[5] & BOOST, '点いたのは騙った本人の旗');

// 6. 抜けたら名簿から消え、空いた席はボットが埋め直す
b.ws.close();
await settle();
const after = take(a).filter((m) => m.r).pop();
assert.ok(after, '名簿が更新される');
assert.ok(!after.r.some((e) => e[0] === b.hello.id), 'B が名簿から消える');
assert.equal(after.r.length, 14, '総数は 14 のまま');

// 6.5 満席（CAP=14）まで人が入ると、ボットは1匹も残らない。
//     addPlayer が「一番小さいボットと入れ替える」形なので、ここが崩れると
//     14匹の枠を超えて海が混むか、逆に人が入れなくなる
{
  const room = [];
  for (let i = 0; i < 14; i++) room.push(client('F' + i, 'tamagawa'));
  await settle(600);
  const r = take(room[0]).filter((m) => m.r).pop()?.r ?? take(room[1]).filter((m) => m.r).pop().r;
  assert.equal(r.length, 14, '満席でも総数は14');
  assert.deepEqual(r.filter((e) => e[0][0] === 'b'), [], '満席ならボットは居ない');

  // 15人目は別の部屋へ（＝そちらはボットで埋まる）
  const over = client('F15', 'tamagawa');
  await settle(600);
  const r2 = take(over).find((m) => m.t === 'full').r;
  assert.equal(r2.length, 14);
  assert.equal(r2.filter((e) => e[0][0] === 'b').length, 13, '新しい部屋は13匹がボット');
  assert.ok(!r2.some((e) => e[0] === room[0].hello.id), '満席の部屋とは混ざらない');
  for (const c of room) c.ws.close();
  over.ws.close();
}

// 7. 別のマップは別の部屋（混ざらない）
const d = client('D', 'jindaiji');
await settle();
assert.ok(take(d).find((m) => m.t === 'full').r.every((e) => e[0] !== a.hello.id), '部屋をまたいで漏れない');

// 8. 知らないロケ地名でも部屋は立つ（既定のマップへ落ちる）
const e = client('E', '../../etc/passwd');
await settle();
assert.ok(take(e).find((m) => m.t === 'full'), '不正なマップ名でも盤面は届く');

a.ws.close(); d.ws.close(); e.ws.close(); http.close();

// 9. 独りなら世界を止められる。他人が居るなら止められない
const http2 = createServer();
attach(http2);
await new Promise((r) => http2.listen(0, r));
url = `ws://localhost:${http2.address().port}/ws`;

const g = client('G');
await settle();
take(g);
g.ws.send(JSON.stringify({ t: 'pause', v: 1 }));
await settle(100);
take(g);
await settle(200);
assert.equal(take(g).length, 0, '独りならスナップショットごと止まる');

const h = client('H');                       // 人が来たら動き出す
await settle();
assert.ok(take(g).length > 0, '入室で再開する');
g.ws.send(JSON.stringify({ t: 'pause', v: 1 }));
await settle();
assert.ok(take(g).length > 0, '他人が居るなら止められない');

g.ws.close(); h.ws.close(); http2.close();

// 10. 黙った線は切られる（FIN の来ない落ち方）
process.env.WS_DEAD_MS = '300';
const http3 = createServer();
attach(http3);
await new Promise((r) => http3.listen(0, r));
url = `ws://localhost:${http3.address().port}/ws`;

const i = client('I'), j = client('J');
await settle();
// I は黙ったまま。J だけ喋り続ける
const beat = setInterval(() => j.ws.send(JSON.stringify({ t: 'in', a: 0, b: 0 })), 50);
await settle(900);
clearInterval(beat);
assert.equal(i.ws.readyState, 3, 'I の線は閉じられている');
assert.ok(!take(j).filter((m) => m.r).pop()?.r.some((e) => e[0] === i.hello.id), 'I は名簿から消える');

j.ws.close(); http3.close();
console.log('relay ok');
