// 対戦サーバとの線。JSON を投げて受けるだけで、中身の意味は game.js が知っている。
const BASE_URL = import.meta.env.VITE_WS_URL || location.origin;
const URL_ = BASE_URL.replace(/^http/, 'ws') + '/ws';

/**
 * 部屋に入る。resolve は hello（サーバが振った自分の id）が返った時点。
 * それ以降のメッセージは attach() で渡したハンドラへ流れる。
 * hello から attach までの間に届いた分は溜めておく — ここを落とすと
 * 入室直後に一度だけ届く 'full'（盤面まるごと）を取りこぼす。
 */
export function connect({ map, shark, name }) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL_);
    // サーバは同じスナップショットを1回だけ作って全員へ配るので、届くのはバイナリ。
    // 既定の Blob だと読むのに await が要って順序が崩れるため、同期で解ける型にする
    ws.binaryType = 'arraybuffer';
    const decoder = new TextDecoder();
    let queued = [];
    const net = {
      id: null, ws, onmsg: null,
      attach(fn) {
        net.onmsg = fn;
        const q = queued;
        queued = [];
        for (const m of q) fn(m);
      },
      send: (m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); },
      close: () => { net.onmsg = null; ws.close(); },
    };
    const fail = () => reject(new Error('サーバに接続できません'));
    // サーバが居ない時はここで待たされる。開始が遅れるだけなので短く
    const timer = setTimeout(() => { ws.close(); fail(); }, 2500);
    const emit = (m) => (net.onmsg ? net.onmsg(m) : queued.push(m));

    ws.onopen = () => net.send({ t: 'join', map, shark, name });
    ws.onerror = () => { clearTimeout(timer); fail(); };
    ws.onclose = () => { clearTimeout(timer); emit({ t: 'down' }); fail(); };
    ws.onmessage = (e) => {
      const m = JSON.parse(typeof e.data === 'string' ? e.data : decoder.decode(e.data));
      if (m.t === 'hello') {
        clearTimeout(timer);
        net.id = m.id;
        resolve(net);
        return;
      }
      emit(m);
    };
  });
}
