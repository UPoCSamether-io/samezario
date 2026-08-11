// リアルタイム対戦の中継サーバ。
// 盤面の正は「その部屋に最初に入った人」のブラウザ（ホスト）で、ここがするのは部屋割りと
// メッセージの配り直しだけ。ゲストの入力はホストへ、ホストのスナップショットは全員へ流す。
// ponytail: ホスト権限モデル。ホストのクライアントを書き換えればチートできるし、
// ホストの回線が全員に効く。気になったら server 側で game.js を回す（DOM 依存の切り離しが要る）。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const CAP = 8;                 // 1部屋の人数上限。残りはボットが埋める
const rooms = new Map();       // roomId("chofu#1") -> { members:Set<ws>, host:ws }
let seq = 0;

const send = (ws, m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };
const clean = (s) => String(s ?? '').replace(/[\p{C}]/gu, '').trim().slice(0, 10) || 'PLAYER';

/** 同じマップで空きのある部屋へ。無ければ作る */
function joinRoom(ws, map) {
  const key = clean(map).replace(/[^a-z0-9_-]/gi, '') || 'x';
  let id = null, room = null;
  for (const [k, r] of rooms) {
    if (k.startsWith(key + '#') && r.members.size < CAP) { id = k; room = r; break; }
  }
  if (!room) {
    for (let n = 1; !id; n++) if (!rooms.has(`${key}#${n}`)) id = `${key}#${n}`;
    room = { members: new Set(), host: ws };
    rooms.set(id, room);
  }
  room.members.add(ws);
  ws.room = room;
  ws.roomId = id;
  return room;
}

function wire(ws) {
  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;

    if (m.t === 'join') {
      if (ws.room) return;
      ws.id = 's' + ++seq;
      ws.shark = clean(m.shark);
      ws.pname = clean(m.name);
      const room = joinRoom(ws, m.map);
      // 先客のことは hello では教えない。ホストが 'full' で盤面ごと送ってくる
      send(ws, { t: 'hello', id: ws.id, host: room.host === ws });
      for (const o of room.members) {
        if (o !== ws) send(o, { t: 'peer', id: ws.id, shark: ws.shark, name: ws.pname });
      }
      return;
    }

    const room = ws.room;
    if (!room) return;
    m.id = ws.id;                                  // 差出人はサーバが刻む（自称させない）
    if (m.to) {                                    // 名指し（ホスト → 入室直後の1人へ全状態）
      for (const o of room.members) if (o.id === m.to) send(o, m);
    } else if (room.host === ws) {                 // ホストの配信は全員へ
      for (const o of room.members) if (o !== ws) send(o, m);
    } else {                                       // ゲストの入力はホストだけが要る
      send(room.host, m);
    }
  });

  ws.on('close', () => {
    const room = ws.room;
    if (!room) return;
    room.members.delete(ws);
    if (!room.members.size) { rooms.delete(ws.roomId); return; }
    // ホストが抜けたら次の人へ委譲。全員が同じ盤面を回しているので、旗を立て替えるだけで続く
    if (room.host === ws) {
      room.host = [...room.members][0];
      send(room.host, { t: 'host' });
    }
    for (const o of room.members) send(o, { t: 'bye', id: ws.id });
  });
}

/** 既存の http サーバ（vite dev / 本番）に /ws だけ相乗りさせる */
export function attach(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });
  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url, 'http://x').pathname !== '/ws') return;   // vite の HMR は素通し
    wss.handleUpgrade(req, socket, head, wire);
  });
  return wss;
}

// ---------- 本番: dist を配りつつ /ws も受ける単体サーバ ----------
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg',
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dist = fileURLToPath(new URL('../dist', import.meta.url));
  const http = createServer(async (req, res) => {
    const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (p.includes('..')) { res.writeHead(403).end(); return; }
    const file = join(dist, p === '/' ? 'index.html' : p);
    try {
      const buf = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' }).end(buf);
    } catch {
      try {
        res.writeHead(200, { 'content-type': 'text/html' }).end(await readFile(join(dist, 'index.html')));
      } catch { res.writeHead(404).end('build first: npm run build'); }
    }
  });
  attach(http);
  const port = Number(process.env.PORT) || 5174;
  http.listen(port, () => console.log(`samezario http://localhost:${port}`));
}
