#!/usr/bin/env node
// 権威サーバに人数分ぶら下がって、配信が痩せないかを測る。
//
//   node scripts/loadtest.mjs --clients 40 --seconds 30 [--url ws://host/ws] [--maps chofu,jindaiji]
//
// 見るのは「1秒あたり何回スナップショットが届いたか」。サーバは固定 dt で回すので、
// CPU が足りなくなると setInterval が遅れ、盤面がスローモーションになる。
// つまり受信レートの低下がそのまま「重い」の実測値になる（目標 15/s）。
// 間隔の p95/最大は、平均では見えない「たまに固まる」を捕まえるために出す。
import { WebSocket } from 'ws';

const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const N = Number(arg('clients', 40));
const SECONDS = Number(arg('seconds', 30));
const URL_ = arg('url', 'ws://localhost:5199/ws');
const MAPS = arg('maps', 'chofu').split(',');
const SHARKS = ['cinema', 'yokai', 'tamagawa', 'jindaiji', 'airport'];

const pct = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : NaN);
const clients = [];

for (let i = 0; i < N; i++) {
  const c = {
    i, map: MAPS[i % MAPS.length],
    ws: new WebSocket(URL_),
    snaps: 0, bytes: 0, gaps: [], last: 0, joined: 0, err: null,
  };
  c.ws.on('error', (e) => { c.err = e.message; });
  c.ws.on('open', () => c.ws.send(JSON.stringify({
    t: 'join', map: c.map, shark: SHARKS[i % SHARKS.length], name: 'L' + i,
  })));
  c.ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.t === 'hello') {
      c.joined = Date.now();
      // 本物のクライアントと同じ 20Hz。狙いは動かし続ける
      // （向きが固定だとボットの回避も餌の分布も偏って、実戦より軽く出る）
      let a = Math.random() * 6.28;
      c.beat = setInterval(() => {
        a += (Math.random() - 0.5) * 0.6;
        c.ws.send(JSON.stringify({ t: 'in', a: +a.toFixed(2), b: Math.random() < 0.3 ? 1 : 0 }));
        if (Math.random() < 0.005) c.ws.send(JSON.stringify({ t: 'sk' }));
      }, Number(arg('in-ms', 50)));
      return;
    }
    // 最初の full に載っている人の nid のうち一番若いもの＝その部屋を立てた人。
    // 後から入った人の名簿にも必ず居るので、部屋の識別子として使える
    // （8で割って推定していたら CAP を変えた後も 8 部屋と表示して、まんまと騙された）
    if (m.t === 'full' && !c.room) {
      const humans = m.r.map((e) => e[0]).filter((id) => id[0] !== 'b');
      c.room = humans.map((id) => +id.slice(1)).sort((a, b) => a - b)[0] ?? c.i;
    }
    if (m.t !== 'snap' && m.t !== 'full') return;
    const now = Date.now();
    if (c.last) c.gaps.push(now - c.last);
    c.last = now;
    c.snaps++;
  });
  clients.push(c);
}

// 接続がそろうまで待ってから測りはじめる（立ち上がりの山を平均に混ぜない）。
// 締め上げた CPU に大人数で当てると握手そのものが詰まるので、そろうまで待つ
for (let i = 0; i < 30 && clients.filter((c) => c.joined).length < N; i++) {
  await new Promise((r) => setTimeout(r, 500));
}
await new Promise((r) => setTimeout(r, 1500));
const live = clients.filter((c) => c.joined && c.ws.readyState === 1 && c.ws._socket);
// 帯域は TCP の実バイトで数える。message イベントの長さは「解凍後」なので、
// それで測ると圧縮を入れても切っても同じ数字が出て、判断を誤る（実際に一度誤った）
for (const c of live) { c.snaps = 0; c.gaps = []; c.base = c.ws._socket.bytesRead; }

const t0 = Date.now();
await new Promise((r) => setTimeout(r, SECONDS * 1000));
const dur = (Date.now() - t0) / 1000;

for (const c of clients) { clearInterval(c.beat); c.ws.close(); }

const rates = live.map((c) => c.snaps / dur).sort((a, b) => a - b);
const gaps = live.flatMap((c) => c.gaps).sort((a, b) => a - b);
const bytes = live.reduce((s, c) => s + ((c.ws._socket?.bytesRead ?? c.base) - c.base), 0);
const failed = clients.length - live.length;
const occupancy = {};
for (const c of live) occupancy[c.room] = (occupancy[c.room] || 0) + 1;
const sizes = Object.values(occupancy).sort((a, b) => b - a);

const f = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '-');
console.log(`
接続        ${live.length} / ${clients.length}${failed ? `  （失敗 ${failed}）` : ''}
部屋        ${sizes.length}（人数の内訳 ${sizes.join('/')}）
計測        ${f(dur)} 秒

スナップショット受信レート（目標 15/s。落ちていれば盤面がスローになっている）
  最悪      ${f(rates[0], 2)} /s
  下位5%    ${f(pct(rates, 0.05), 2)} /s
  中央      ${f(pct(rates, 0.5), 2)} /s

配信間隔（目標 66ms。p99 と最大が「たまに固まる」）
  p50 ${f(pct(gaps, 0.5), 0)}ms   p95 ${f(pct(gaps, 0.95), 0)}ms   p99 ${f(pct(gaps, 0.99), 0)}ms   最大 ${f(gaps[gaps.length - 1], 0)}ms

帯域（TCP の実バイト＝回線に流れた量。Render 無料枠は月 5GB）
  1人あたり ${f(bytes / live.length / dur / 1024)} KB/s
  この人数で ${f((bytes / dur) * 3600 / 1024 / 1024 / 1024, 2)} GB/時
`);

const worst = rates[0];
process.exit(worst >= 13 ? 0 : 1);   // 15/s に対して 13 を下回ったら赤
