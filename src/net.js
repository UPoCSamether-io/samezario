// 対戦サーバとの線。JSON を投げて受けるだけで、中身の意味は game.js が知っている。
const URL_ = location.origin.replace(/^http/, 'ws') + '/ws';

/**
 * 部屋に入る。resolve は hello（自分の id とホストかどうか）が返った時点。
 * それ以降のメッセージは attach() で渡したハンドラへ流れる。
 * hello から attach までの間に届いた分は溜めておく — ここを落とすと
 * 「入室したのにホスト側にサメが生えない人」が出る。
 */
export function connect({ map, shark, name }) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL_);
    let queued = [];
    const net = {
      id: null, host: false, ws, onmsg: null,
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
    const timer = setTimeout(() => { ws.close(); fail(); }, 6000);
    const emit = (m) => (net.onmsg ? net.onmsg(m) : queued.push(m));

    ws.onopen = () => net.send({ t: 'join', map, shark, name });
    ws.onerror = () => { clearTimeout(timer); fail(); };
    ws.onclose = () => { clearTimeout(timer); emit({ t: 'down' }); fail(); };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.t === 'hello') {
        clearTimeout(timer);
        net.id = m.id;
        net.host = m.host;
        resolve(net);
        return;
      }
      if (m.t === 'host') net.host = true;
      emit(m);
    };
  });
}
