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
import { MAPS } from '../src/data.js';
import { makeArena } from '../src/sim.js';

const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const N = Number(arg('clients', 40));
const SECONDS = Number(arg('seconds', 30));
const URL_ = arg('url', 'ws://localhost:5199/ws');
const MAP_KEYS = arg('maps', 'chofu').split(',');
const SHARKS = ['cinema', 'yokai', 'tamagawa', 'jindaiji', 'airport'];

const arenas = new Map(MAPS.map((m) => [m.id, makeArena(m)]));
const pct = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : NaN);
const clients = [];

const safeSend = (ws, msg) => {
  if (ws && ws.readyState === 1) {
    try { ws.send(msg); } catch {}
  }
};

function setupClient(c) {
  clearInterval(c.beat);
  c.alive = false;
  c.last = 0;                 // 再接続をまたぐ穴は「サーバが固まった」ではないので間隔に混ぜない
  c.reconnectAt = c.joined ? Date.now() : 0;
  const ws = new WebSocket(URL_);
  c.ws = ws;
  ws.on('error', (e) => { c.err = e.message; });
  ws.on('close', () => { c.bytesPrev += ws._socket?.bytesRead ?? 0; });
  ws.on('open', () => {
    safeSend(ws, JSON.stringify({
      t: 'join', map: c.map, shark: SHARKS[c.i % SHARKS.length], name: 'L' + c.i,
    }));
  });
  ws.on('message', (raw) => {
    if (c.ws !== ws) return;
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'hello') {
      c.nid = m.id;
      if (c.reconnectAt) c.rejoins.push(Date.now() - c.reconnectAt);
      c.joined = Date.now();
      c.alive = true;
      clearInterval(c.beat);
      c.beat = setInterval(() => {
        if (!c.alive || ws.readyState !== 1) return;
        // 壁回避: 進行方向に壁があればアリーナ内部/中心方向へ旋回
        const look = 280;
        const lx = c.x + Math.cos(c.angle) * look;
        const ly = c.y + Math.sin(c.angle) * look;
        if (!c.arena.inside(lx, ly)) {
          c.angle = c.arena.escape(c.x, c.y, c.angle, 380)
            ?? Math.atan2(c.arena.home.y - c.y, c.arena.home.x - c.x);
        } else {
          c.angle += (Math.random() - 0.5) * 0.45;
        }
        safeSend(ws, JSON.stringify({
          t: 'in',
          a: +c.angle.toFixed(2),
          b: Math.random() < 0.28 ? 1 : 0,
        }));
        if (Math.random() < 0.008) safeSend(ws, JSON.stringify({ t: 'sk' }));
      }, Number(arg('in-ms', 50)));
      return;
    }

    if (m.t === 'full' && !c.room) {
      const humans = m.r?.map((e) => e[0]).filter((id) => id[0] !== 'b') ?? [];
      c.room = humans.map((id) => +id.slice(1)).sort((a, b) => a - b)[0] ?? c.i;
    }
    if (m.t !== 'snap' && m.t !== 'full') return;

    if (m.s && c.nid) {
      const me = m.s.find((e) => e[0] === c.nid);
      if (me) {
        c.x = me[1];
        c.y = me[2];
        c.mass = me[4];
        const isAlive = !!(me[5] & 1);
        c.alive = isAlive;
        if (!isAlive && !c.rejoining) {
          c.rejoining = true;
          c.deaths = (c.deaths || 0) + 1;
          clearInterval(c.beat);
          setTimeout(() => {
            try { ws.close(); } catch {}
            c.rejoining = false;
            setupClient(c);
          }, 600);
        }
      }
    }

    const now = Date.now();
    if (c.last) c.gaps.push(now - c.last);
    c.last = now;
    c.snaps++;
  });
}

// 入退室を繰り返す係。この子たちの受信レートは当然痩せるので、盤面の重さを測る
// 母集団からは外し、代わりに「入り直すのに何秒かかったか」を出す。
const CHURN_MS = Number(arg('churn-ms', 0));
const CHURN_FROM = CHURN_MS ? Math.max(1, Math.round(N * 0.75)) : N;

for (let i = 0; i < N; i++) {
  const mapKey = MAP_KEYS[i % MAP_KEYS.length];
  const arena = arenas.get(mapKey) || arenas.get('chofu');
  const c = {
    i, map: mapKey, arena, churn: i >= CHURN_FROM,
    x: arena.home.x, y: arena.home.y, angle: Math.random() * 6.28,
    snaps: 0, bytesPrev: 0, gaps: [], last: 0, joined: 0, err: null,
    alive: false, deaths: 0, rejoining: false, rejoins: [], reconnectAt: 0,
  };
  clients.push(c);
  setupClient(c);
}

// 接続がそろうまで待ってから測りはじめる
for (let i = 0; i < 30 && clients.filter((c) => c.joined).length < N; i++) {
  await new Promise((r) => setTimeout(r, 500));
}
await new Promise((r) => setTimeout(r, 1500));
const live = clients.filter((c) => c.joined && c.ws.readyState === 1 && c.ws._socket);
for (const c of live) {
  c.snaps = 0; c.gaps = []; c.rejoins = [];
  c.bytesPrev = -c.ws._socket.bytesRead;   // 以降 close のたびに加算されるので、開始時点を0に合わせる
}

const t0 = Date.now();
let aliveSamples = [];
const sampler = setInterval(() => {
  aliveSamples.push(live.filter((c) => c.alive).length);
}, 500);

const churners = live.filter((c) => c.churn);
const churn = CHURN_MS && churners.length ? setInterval(() => {
  const c = churners[Math.floor(Math.random() * churners.length)];
  if (c.rejoining) return;
  clearInterval(c.beat);
  try { c.ws.close(); } catch {}
  setupClient(c);
}, CHURN_MS) : null;

await new Promise((r) => setTimeout(r, SECONDS * 1000));
clearInterval(sampler);
if (churn) clearInterval(churn);
const dur = (Date.now() - t0) / 1000;

for (const c of clients) { clearInterval(c.beat); c.ws.close(); }

const steady = live.filter((c) => !c.churn);
const rates = steady.map((c) => c.snaps / dur).sort((a, b) => a - b);
const gaps = steady.flatMap((c) => c.gaps).sort((a, b) => a - b);
const rejoins = live.flatMap((c) => c.rejoins).sort((a, b) => a - b);
const bytes = live.reduce((s, c) => s + c.bytesPrev + (c.ws.readyState === 1 ? (c.ws._socket?.bytesRead ?? 0) : 0), 0);
const failed = clients.length - live.length;
const occupancy = {};
for (const c of live) occupancy[c.room] = (occupancy[c.room] || 0) + 1;
const sizes = Object.values(occupancy).sort((a, b) => b - a);
const avgAlive = aliveSamples.length
  ? aliveSamples.reduce((a, b) => a + b, 0) / aliveSamples.length
  : live.length;
const minAlive = aliveSamples.length ? Math.min(...aliveSamples) : live.length;

const f = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '-');
console.log(`
接続        ${live.length} / ${clients.length}${failed ? `  （失敗 ${failed}）` : ''}
生存アクティブ  平均 ${f(avgAlive, 1)} / ${live.length} 匹 （最低 ${minAlive} 匹）
部屋        ${sizes.length}（人数の内訳 ${sizes.join('/')}）
計測        ${f(dur)} 秒

スナップショット受信レート（居座り ${steady.length} 匹。目標 15/s。落ちていれば盤面がスローになっている）
  最悪      ${f(rates[0], 2)} /s
  下位5%    ${f(pct(rates, 0.05), 2)} /s
  中央      ${f(pct(rates, 0.5), 2)} /s

配信間隔（目標 66ms。p99 と最大が「たまに固まる」）
  p50 ${f(pct(gaps, 0.5), 0)}ms   p95 ${f(pct(gaps, 0.95), 0)}ms   p99 ${f(pct(gaps, 0.99), 0)}ms   最大 ${f(gaps[gaps.length - 1], 0)}ms

${rejoins.length ? `入り直し（close → hello。${rejoins.length} 回 / 入退室係 ${churners.length} 匹）
  p50 ${f(pct(rejoins, 0.5), 0)}ms   p95 ${f(pct(rejoins, 0.95), 0)}ms   最大 ${f(rejoins[rejoins.length - 1], 0)}ms
` : ''}
帯域（TCP の実バイト＝回線に流れた量。AWS の外向きは月 100GB まで無料）
  1人あたり ${f(bytes / live.length / dur / 1024)} KB/s
  この人数で ${f((bytes / dur) * 3600 / 1024 / 1024 / 1024, 2)} GB/時
`);

const worst = rates[0];
process.exit(worst >= 13 ? 0 : 1);
   // 15/s に対して 13 を下回ったら赤
