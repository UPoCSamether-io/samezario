// リアルタイム対戦の権威サーバ。
//
// 盤面の正はここ。部屋ごとに src/sim.js の world を持ち、30Hz で回して 15Hz で配る。
// ブラウザから受け取るのは操作だけ（向き・ダッシュ・スキル・ポーズ）で、
// 位置も生死も餌もここが決める。ブラウザ側が動かしているのは「こう答えるはず」という
// 予測で、ズレは次のスナップショットが正す。
//
// 以前はホスト（最初に入った人）のブラウザが正だった。やめた理由は3つ:
// ホストがタブを裏に回すと rAF が止まって部屋ごと凍る、ホストの回線品質が全員に効く、
// ホストのクライアントを書き換えればチートできる。
// 往復も減る —— ゲストの入力は「ゲスト→サーバ→ホスト」、盤面は「ホスト→サーバ→ゲスト」で
// Render を2往復していたのが、今は1往復で閉じる。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { MAPS } from '../src/data.js';
import { createWorld } from '../src/sim.js';

// 1部屋の人数上限。盤面は常に14匹で、空席をボットが埋める（sim.js の BOT_COUNT+1）。
// つまり CAP=14 は「満席なら全員が人」。8 にしていた頃は 60人が8部屋へ散って、
// 半分がボットの海になっていた。14 なら4〜5部屋に集まるうえ、部屋数もボットも減って
// サーバが軽い（0.1 vCPU / 60人で 4.08 → 5.75 msg/s、+41%）
const CAP = 14;
const TICK_MS = 1000 / 30;     // 盤面を進める刻み
const SNAP_EVERY = 2;          // 何ティックごとに配るか（30Hz / 2 = 15Hz）
const rooms = new Map();       // roomId("chofu#1") -> room
let seq = 0;

const send = (ws, m) => {
  // 100秒分も滞留しているならその線は読まれていない。溜め続けるとヒープが持たない
  if (ws.bufferedAmount > 1 << 20) return ws.terminate();
  if (ws.readyState === 1) ws.send(JSON.stringify(m));
};

/**
 * 同じスナップショットを部屋の全員へ。
 * 素直に send() を人数分呼ぶと、同じ盤面を人数ぶん JSON にして人数ぶん UTF-8 に
 * 直すことになる（8人なら8回）。1回だけ作って同じバッファを配る。
 * バイナリフレームで出るので、受け側（src/net.js）は ArrayBuffer も解く。
 */
const sendAll = (members, m, pick) => {
  let buf = null;
  for (const ws of members) {
    if (pick && !pick(ws)) continue;
    if (ws.bufferedAmount > 1 << 20) { ws.terminate(); continue; }
    if (ws.readyState === 1) ws.send((buf ??= Buffer.from(JSON.stringify(m))));
  }
};
const clean = (s) => String(s ?? '').replace(/[\p{C}]/gu, '').trim().slice(0, 10) || 'PLAYER';

/**
 * 部屋をひとつ立てて回し始める。
 * dt は実時間ではなく固定にしてある。詰まったぶんを dt に乗せると、
 * 復帰した1ティックでサメが体半分ぶん進んで壁や相手をすり抜ける。
 * 遅れは「世界がゆっくりになる」形で吸わせるほうが、この規模では安い。
 */
function makeRoom(id, map) {
  const world = createWorld({ map, authority: true, diffs: true });
  world.fillBots();
  world.seedFood();
  const room = { id, map, world, members: new Set(), paused: false, ticks: 0 };
  room.timer = setInterval(() => {
    if (room.paused) return;
    world.step(TICK_MS / 1000);
    world.drainEvents();   // 演出はブラウザの仕事。ここで捨てないと際限なく積む
    if (++room.ticks % SNAP_EVERY) return;

    // 差分を先に確定させてから、入ってきた人へ全部を撮る。この順でないと
    // 「full に載っていた餌」が直後の差分でもう一度届いて、その人の海だけ餌が倍になる
    const diff = world.snapshot();
    sendAll(room.members, diff, (ws) => !ws.needFull);
    if (![...room.members].some((ws) => ws.needFull)) return;
    const full = world.snapshot(true);
    sendAll(room.members, full, (ws) => ws.needFull);
    for (const ws of room.members) ws.needFull = false;
  }, TICK_MS);
  return room;
}

/** 同じマップで空きのある部屋へ。無ければ作る */
function joinRoom(ws, mapId) {
  const key = clean(mapId).replace(/[^a-z0-9_-]/gi, '');
  // 知らないロケ地名は既定のマップへ落とす。world を作れない名前で部屋は立てられない
  const map = MAPS.find((m) => m.id === key) || MAPS[0];
  let room = null;
  for (const [k, r] of rooms) {
    if (k.startsWith(map.id + '#') && r.members.size < CAP) { room = r; break; }
  }
  if (!room) {
    let id = null;
    for (let n = 1; !id; n++) if (!rooms.has(`${map.id}#${n}`)) id = `${map.id}#${n}`;
    room = makeRoom(id, map);
    rooms.set(id, room);
  }
  room.members.add(ws);
  ws.room = room;
  return room;
}

function wire(ws) {
  ws.seen = Date.now();
  ws.on('message', (raw) => {
    ws.seen = Date.now();
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;

    if (m.t === 'join') {
      if (ws.room) return;
      ws.id = 's' + ++seq;
      const room = joinRoom(ws, m.map);
      room.world.addPlayer({ nid: ws.id, sharkId: clean(m.shark), name: clean(m.name) });
      room.paused = false;   // 独りだから止めていた部屋。人が来たら動かす
      ws.needFull = true;    // 盤面は次のティックで撮って送る（上の makeRoom 参照）
      send(ws, { t: 'hello', id: ws.id });
      // 先客にも、この人のことは次のスナップショットの名簿で伝わる（最大 66ms 後）
      return;
    }

    const room = ws.room;
    if (!room) return;
    // 受け付けるのは操作だけ。差出人は ws.id で、自称は一切見ない
    switch (m.t) {
      case 'in':
        room.world.input(ws.id, { aim: m.a, boost: m.b });
        break;
      case 'sk': {
        const s = room.world.sharks.find((o) => o.nid === ws.id);
        if (s) room.world.useSkill(s);
        break;
      }
      case 'pause':
        // 止められるのは独りの部屋だけ。他人が居るのに止めると全員が待たされる
        room.paused = !!m.v && room.world.humans() <= 1;
        break;
    }
  });

  ws.on('error', () => ws.close());   // 落ちた線は close へ流す（例外で落とさない）
  ws.on('close', () => {
    const room = ws.room;
    if (!room) return;
    room.members.delete(ws);
    room.world.removeShark(ws.id);    // 抜けたことは次のスナップショットの名簿で伝わる
    if (room.members.size) { room.world.fillBots(); return; }   // 空いた席はボットへ戻す
    clearInterval(room.timer);        // 誰も見ていない海を回し続けない
    room.world.destroy();
    rooms.delete(room.id);
  });
}

/** 既存の http サーバ（vite dev / 本番）に /ws だけ相乗りさせる */
export function attach(server) {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 1 << 20,
    // 既定は圧縮なし。中継サーバだった頃は「CPU を少し払って通信量を買う」で正しかったが、
    // 盤面をここで回すようになってから逆転した —— zlib がプロセス全体の CPU の 51% を占め、
    // 0.1 vCPU では 1部屋すら回らなくなる（実測 3.9/s → 切ると 14.1/s）。
    // 0.5 CPU / 40人でも 12.7/s・p99 196ms（圧縮）対 15.1/s・p99 69ms（素通し）で、
    // 買えるのは 0.91 → 0.26 GB/時。帯域が先に尽きる見込みが立ったときだけ WS_DEFLATE=on。
    perMessageDeflate: process.env.WS_DEFLATE === 'on'
      && { zlibDeflateOptions: { level: 3 }, threshold: 256 },
  });
  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url, 'http://x').pathname !== '/ws') return;   // vite の HMR は素通し
    wss.handleUpgrade(req, socket, head, wire);
  });

  // FIN の来ない線（回線断・スリープ）は readyState 1 のまま永久に残る。放っておくと
  // 抜けたはずの人のサメが部屋に浮かんだままになり、送信分もヒープに溜まり続ける。
  // ここでは ping を撃たず「無言」だけを見る —— 生きている側は 20Hz で操作を送ってくるので、
  // 黙った線は落ちたか、タブが裏に回って rAF が止まったか。どちらも部屋から外すのが正しい。
  // （盤面はもうサーバが持っているので、ここが遅れても他の人の海は止まらない）
  const dead = Number(process.env.WS_DEAD_MS) || 30_000;
  const sweep = setInterval(() => {
    for (const ws of wss.clients) if (Date.now() - ws.seen > dead) ws.terminate();
  }, Math.min(10_000, dead));
  sweep.unref();   // これが起きているだけでプロセスが終わらなくなるのを防ぐ
  return wss;
}

// ---------- 本番: dist を配りつつ /ws も受ける単体サーバ ----------
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg',
};

export const DIST = fileURLToPath(new URL('../dist', import.meta.url));

// ヘッダを1つも付けていなかったので検証子すら無く、ブラウザは再読み込みのたびに
// 全部（HTML+JS+CSS+画像で約800KB）を取り直していた。届くまでの間サメの原画は
// 焼けず、立ち絵の <img> は空、フォントは代替のまま —— これが「再読み込み後に
// 画面遷移するとフォールバックになる／カクつく」の正体。
// /assets は vite が中身のハッシュを名前に入れるので、内容が変われば URL も変わる = immutable。
// ponytail: /img はハッシュが付かないので1日で頭打ち。差し替えを即出したいならファイル名を変える
const cacheFor = (p) =>
  (p.startsWith('/assets/') ? 'public, max-age=31536000, immutable'
    : p === '/' || p.endsWith('.html') ? 'no-cache'
      : 'public, max-age=86400');

export async function serveStatic(req, res) {
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (p === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }).end('OK'); return; }
  if (p.includes('..')) { res.writeHead(403).end(); return; }
  const file = join(DIST, p === '/' ? 'index.html' : p);
  try {
    const buf = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file)] || 'application/octet-stream',
      'cache-control': cacheFor(p),
    }).end(buf);
  } catch {
    // 見つからない URL は index.html を返す（SPA）。中身は HTML なので毎回確かめさせる。
    //
    // 読んでから書く。writeHead() を .end() のレシーバに置くと、await readFile が
    // 転ぶ前にヘッダが出てしまい、下の catch の writeHead が ERR_HTTP_HEADERS_SENT を
    // 投げる。request ハンドラの中の未捕捉例外はプロセスを落とすので、dist が無い箱では
    // 「知らない URL を誰か1人が叩くと全部屋の全員が切断される」になっていた。
    let html;
    try { html = await readFile(join(DIST, 'index.html')); }
    catch { res.writeHead(404).end('build first: npm run build'); return; }
    res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-cache' }).end(html);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const http = createServer(serveStatic);
  attach(http);
  const port = Number(process.env.PORT) || 5174;
  http.listen(port, () => console.log(`samezario http://localhost:${port}`));
}
