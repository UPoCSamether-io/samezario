// サメザリオ — ブラウザ側。描画と入力と「サーバの答えの先読み」だけを持つ。
//
// 盤面そのものは src/sim.js（サーバと共有）。ここは world を回して絵にするだけで、
// 餌の増減や生死は決めない —— オンラインなら world.authority=false で
// サーバの宣告を待ち、繋がらなければ world.goSolo() で自分が正になる。
import { BOT_NAMES } from './data.js';
import { paintShark, paintSpriteShark } from './shark-art.js';
import { makeSteer } from './steer.js';
import { createWorld, radiusOf, clamp, rand, pick, TAU } from './sim.js';

const INK = '#2d2d2d';
const PAPER = '#f4efea';
const YELLOW = '#f3b553';

/**
 * 外周を描くための Path2D。sim が当たり判定に使っている頂点そのものから引くので、
 * 「見えている壁」と「死ぬ壁」が定義上ズレない（以前は SVG の path 文字列から
 * 別々に作っていた）。
 */
function arenaOutline(arena) {
  const { xs, ys, n } = arena.poly;
  const p = new Path2D();
  p.moveTo(xs[0], ys[0]);
  for (let i = 1; i < n; i++) p.lineTo(xs[i], ys[i]);
  p.closePath();
  return p;
}

function stripeTile() {
  const c = document.createElement('canvas');
  const s = (c.width = c.height = 34);
  const g = c.getContext('2d');
  g.fillStyle = INK;
  g.fillRect(0, 0, s, s);
  g.strokeStyle = YELLOW;
  g.lineWidth = 11;
  for (let i = -s; i <= s * 2; i += s) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i + s, s); g.stroke();
  }
  return c;
}

/**
 * attract: タイトル背面のデモ再生。操作を受け付けず、主役が死んでも湧き直す。
 * net: オンライン対戦（src/net.js）。盤面の正はサーバで、ここが持っているのは
 *      「サーバがこう答えるはず」という予測。自分のサメは押した瞬間から動かし、
 *      15Hz で届くスナップショットへズレを溶かしながら寄せる。
 *      ボットもサーバの中で泳ぐので、人が少ない部屋でも盤面は埋まる。
 */
export function startGame({ canvas, mini, sharkId, map, onEnd, onHud, attract = false, net = null, name = 'YOU' }) {
  const ctx = canvas.getContext('2d');
  const mctx = mini?.getContext('2d');
  // 表示サイズは毎フレーム読むと同期レイアウトを踏む（画面遷移中は1フレーム 36ms）。
  // ResizeObserver なら変わったときだけ、レイアウト済みの値が降ってくる
  const size = { cw: canvas.clientWidth, ch: canvas.clientHeight };
  const ro = new ResizeObserver(([e]) => {
    size.cw = Math.round(e.contentRect.width);
    size.ch = Math.round(e.contentRect.height);
  });
  ro.observe(canvas);

  // 盤面。オンラインなら正はサーバなので authority=false —— 動かしはするが、
  // 餌の増減と生死は決めずスナップショットを待つ（＝先読み）
  const world = createWorld({ map, authority: !net });
  const { arena, sharks, food, W } = world;
  const outline = arenaOutline(arena);
  const stripes = ctx.createPattern(stripeTile(), 'repeat');

  const fx = [];
  const cam = { x: arena.home.x, y: arena.home.y, zoom: 1, shake: 0 };
  const mouse = { sx: 0, sy: 0 };   // 画面中心からのオフセット(px)
  // menu = ポーズ画面が出ているか、paused = 世界が止まっているか。
  // 他人が居る部屋では世界を止められないので、この2つは一致しない
  let running = true, paused = false, menu = false, last = 0, dead = false;

  // attract ではカメラが追う主役もボット。死んだら別の個体に付け替える（respawn イベント）
  let player = world.addPlayer({
    nid: net?.id, sharkId, isBot: attract,
    name: attract ? pick(BOT_NAMES) : name,
  });

  // サーバから盤面が一度でも届いたか。届かないまま SOLO_WAIT 過ぎたら独りに切り替える
  let gotBoard = false, soloTimer = null;
  const SOLO_WAIT = 3000;

  /** サーバが当てにならなくなったら独りの海として続ける */
  function goSolo() {
    net = null;
    world.goSolo(player.nid);
  }

  if (net) {
    // 盤面はサーバから丸ごと届く（'full'）。自分ではボットも餌も湧かせない。
    // ただし届かない事故に備える —— 待ち続けるとボットも餌も居ない空の海で泳ぐことになる
    soloTimer = setTimeout(() => {
      if (!running || gotBoard) return;
      net?.close();
      goSolo();
    }, SOLO_WAIT);
  } else {
    world.fillBots();
    world.seedFood();
  }

  // ---------- input ----------
  // PC（マウス）: カーソルは「画面中心からのオフセット」で持つ。
  // スマホ（タッチ）: 指を置いた位置を起点とする「フローティング仮想ジョイスティック」。
  // 画面のどこでも親指を小さく倒すだけで全方向に直感的に旋回できる。
  const steerGate = makeSteer();   // game.js には別物の steer() が居るので名前を分ける
  let pointerMode = 'mouse';
  const aimAt = (e) => {
    const b = canvas.getBoundingClientRect();
    mouse.sx = e.clientX - b.left - b.width / 2;
    mouse.sy = e.clientY - b.top - b.height / 2;
  };
  const onMove = (e) => {
    if (!steerGate.owns(e)) return;
    if (e.pointerType === 'mouse') {
      pointerMode = 'mouse';
      aimAt(e);
    } else {
      pointerMode = 'touch';
      const newAim = steerGate.move(e);
      if (newAim !== null && player.alive) player.aim = newAim;
    }
  };
  // マウスは押しっぱなしでダッシュ。タッチは同じ指が操舵を兼ねていて競合するので
  // ここでは踏まず、HUD の DASH ボタンに任せる（main.js が Space を合成する）
  const onDown = (e) => {
    if (!steerGate.claim(e)) return;
    if (e.pointerType === 'mouse') {
      pointerMode = 'mouse';
      if (e.button === 0) player.boost = true;
      aimAt(e);
    } else {
      pointerMode = 'touch';
    }
  };
  const onUp = (e) => {
    if (e.pointerType === 'mouse' && e.button === 0) player.boost = false;
    steerGate.release(e);
  };
  // 通知やシステムジェスチャに pointer を奪われると pointerup は来ない。
  // ここで戻さないとブーストが張り付き、操舵の席も埋まったままになる
  const onCancel = (e) => { player.boost = false; steerGate.release(e); };
  const onKey = (e) => {
    const k = e.key.toLowerCase();
    if (k === ' ') { e.preventDefault(); player.boost = true; }
    if (k === 'e' || k === 'shift') useSkill(player);
    if (k === 'escape') setPaused(!menu);
  };
  const onKeyUp = (e) => {
    if (e.key === ' ') player.boost = false;
  };
  const onBlur = () => { player.boost = false; if (!dead) setPaused(true); };

  if (!attract) {
    window.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
  }

  function setPaused(v) {
    if (dead) return;
    menu = v;
    // 他人が居る部屋では世界を止められない（メニューだけ開く）。
    // 独りなら誰も待たせないので本当に止める。オンラインでも同じで、
    // サーバがその部屋の tick ごと止める（server/index.mjs の 'pause'）
    paused = v && world.humans() <= 1;
    if (net) net.send({ t: 'pause', v: paused ? 1 : 0 });
    onHud?.({ paused: v });
  }

  // 縦に傾けたとき。案内を出すだけだと、端末を戻している間もサメは泳ぎ続けて
  // 食われる。条件式は style.css の #rotate-hint とまったく同じものを使う。
  // resize / orientationchange は回転アニメーション中に何度も走るので matchMedia を使う。
  // 注: setPaused は他人が居る部屋では世界を止められない（メニューが開くだけ）。
  // これは blur や Esc とまったく同じ既存の挙動で、ここだけ特別扱いはしない
  const portraitMQ = matchMedia('(orientation: portrait) and (pointer: coarse)');
  const onPortrait = (e) => { if (e.matches) setPaused(true); };
  if (!attract) {
    portraitMQ.addEventListener('change', onPortrait);
    // change は「状態が変わった瞬間」にしか飛ばない。メニューは縦でも遊べるので、
    // 縦のまま ACTION! を押すと案内だけ出て世界は動き続ける（実測: 1.5秒で mass 38→55）。
    // 開始時の状態を自分で一度読む必要がある
    if (portraitMQ.matches) setPaused(true);
  }

  // ---------- skills ----------
  function useSkill(s) {
    if (paused || !s.alive || s.cd > 0) return;
    world.useSkill(s);                                // 演出は skill イベントで出る
    if (net && s === player) net.send({ t: 'sk' });   // 発動はサーバにも通す
  }

  // ---------- net ----------
  // 送るのは操作だけ（向き・ダッシュ・スキル・ポーズ）。盤面はサーバから降ってくる。
  function onNet(m) {
    switch (m.t) {
      case 'full':
      case 'snap':
        gotBoard = true;
        world.applySnapshot(m, player.nid);
        break;
      case 'down':      // 回線が切れた。盤面を止めずボット部屋として続ける
        goSolo();
        break;
    }
  }
  if (net) net.attach(onNet);   // hello 〜 ここ の間に届いた分もまとめて流れてくる

  function burst(x, y, color, n = 10, spread = 90) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), sp = rand(30, spread);
      fx.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, dur: rand(0.3, 0.7), r: rand(2, 6), color });
    }
  }

  function endRun(cause) {
    dead = true;
    setTimeout(() => onEnd({
      mass: Math.round(player.mass), kills: player.kills, time: world.elapsed, cause,
      rank: 1 + sharks.filter((o) => o.alive && o !== player && o.mass > player.mass).length,
    }), 900);
  }

  /**
   * sim が「何が起きたか」だけを積んでくるので、ここで絵と音と画面遷移にする。
   * 自分で回した結果でも、サーバの宣告を applySnapshot が翻訳した結果でも同じ道を通る
   * —— オンラインとオフラインで演出が食い違わないのはこのため。
   */
  function onEvent(e) {
    const s = e.shark;
    switch (e.k) {
      case 'eat':
        // 自分の口元か、目の届く範囲（300px）で消えた粒だけ弾けさせる
        if (s === player) burst(e.x, e.y, e.hue, e.kind ? 8 : 3, 60);
        else if (!s && (e.x - player.x) ** 2 + (e.y - player.y) ** 2 < 90000) {
          burst(e.x, e.y, e.hue, e.kind ? 8 : 3, 60);
        }
        break;
      case 'wall': burst(e.x, e.y, '#ba1a1a', 22, 220); break;
      case 'skill': burst(s.x, s.y, s.def.accent, 18); break;
      case 'guard':
        burst(s.x, s.y, YELLOW, 24, 180);
        if (s === player) cam.shake = 14;
        break;
      case 'die':
        cam.shake = s === player ? 26 : 8;
        burst(s.x, s.y, s.def.color, 26, 200);
        if (s === player && !attract) endRun(e.cause);
        break;
      case 'respawn':
        // attract: 主役が死んだら別の個体へカメラを切り替える。
        // 補間で盤面を横断させず、映画のカットのように飛ばす
        if (e.nid !== player.nid) break;
        player = e.shark;
        cam.x = player.x; cam.y = player.y;
        break;
      case 'warp':
        if (s === player) { cam.x = s.x; cam.y = s.y; }
        break;
    }
  }

  function step(dt) {
    // 操舵。マウス操作時は毎フレーム今のカメラでワールド座標へ焼き直す
    // （ワールド座標で覚えるとカメラが進んだぶん狙点が置き去りになる）。
    // 中心に近すぎると向きが定まらないので、そのときは直進を保つ。
    // タッチ操作時は onMove でフローティング仮想スティックの相対ドラッグから
    // 直接 aim が更新されるため、ここでは上書きしない
    if (!attract && player.alive && pointerMode === 'mouse') {
      const wx = cam.x + mouse.sx / cam.zoom, wy = cam.y + mouse.sy / cam.zoom;
      if (Math.hypot(wx - player.x, wy - player.y) > radiusOf(player.mass)) {
        player.aim = Math.atan2(wy - player.y, wx - player.x);
      }
    }

    world.step(dt);
    for (const e of world.drainEvents()) onEvent(e);

    // エフェクト
    for (let i = fx.length - 1; i >= 0; i--) {
      const p = fx[i];
      p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.93; p.vy *= 0.93;
      if (p.t >= p.dur) fx.splice(i, 1);
    }

    // カメラ
    const pr = radiusOf(player.mass);
    // 狭い画面を 1280px 相当の視界まで引き上げる。
    // 見える幅 = cw / (base * fit)。fit = cw/1280 が効く範囲では cw が約分されて
    // 1280/base に落ち着き、画面幅によらず一定になる（同じサイズなら実測: 844px も
    // 1280px も 1219）。上限を 1 で止めてあるので 1280 より広い画面は補正されず、
    // そのぶん広く見える（同じサイズなら実測: 1920px で 1829）。これはデスクトップの
    // 見え方を変えないための意図的な割り切りで、補正前の 2.27 倍差が 1.5 倍差に縮む、
    // という改善に留まる。
    // 下限 0.62 は、これ以上引くと自分の頭が小さすぎて見えなくなるため
    // （cw 794px 未満で効きはじめる。実機で詰める調整つまみ）
    const fit = clamp(size.cw / 1280, 0.62, 1);
    const wantZoom = clamp(64 / (44 + pr), 0.34, 1.05) * fit;
    cam.zoom += (wantZoom - cam.zoom) * Math.min(1, dt * 2.2);
    if (player.alive) {
      cam.x += (player.x - cam.x) * Math.min(1, dt * 9);
      cam.y += (player.y - cam.y) * Math.min(1, dt * 9);
    }
    cam.shake *= 0.88;
  }

  // ---------- rendering ----------
  function drawShark(s, t) {
    const b = s.body;
    if (b.length < 3) return;
    const lw = 3.2 / cam.zoom;
    const phasing = s.def.id === 'yokai' && s.skill > 0;
    ctx.save();
    if (phasing) ctx.globalAlpha = 0.45;
    if (s.iframe > 0 && Math.floor(s.iframe * 14) % 2) ctx.globalAlpha = 0.4;

    const hr = b[0].r;
    if (!paintSpriteShark(ctx, b, s.def)) {
      paintShark(ctx, b, s.angle, s.def, { lw, wobble: s.wobble });  // 画像ロード前
    }
    ctx.restore();

    // --- スキル演出 ---
    if (s.def.id === 'cinema' && s.skill > 0) {
      ctx.save();
      const g = ctx.createRadialGradient(s.x, s.y, hr, s.x, s.y, 430);
      g.addColorStop(0, 'rgba(243,181,83,.55)');
      g.addColorStop(1, 'rgba(243,181,83,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(s.x, s.y);
      ctx.arc(s.x, s.y, 430, s.angle - 0.62, s.angle + 0.62); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    if (s.guard > 0) {
      ctx.save();
      ctx.strokeStyle = YELLOW; ctx.lineWidth = 4 / cam.zoom;
      ctx.setLineDash([14 / cam.zoom, 9 / cam.zoom]);
      ctx.lineDashOffset = -t * 40;
      ctx.beginPath(); ctx.arc(s.x, s.y, radiusOf(s.mass) * 2.4, 0, TAU); ctx.stroke();
      ctx.restore();
    }
    if (s.def.id === 'airport' && s.skill > 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(243,181,83,.7)'; ctx.lineWidth = 3 / cam.zoom;
      ctx.setLineDash([20 / cam.zoom, 14 / cam.zoom]);
      ctx.lineDashOffset = t * 160;
      ctx.beginPath(); ctx.arc(s.x, s.y, 300, 0, TAU); ctx.stroke();
      ctx.restore();
    }

    // 名前
    if (cam.zoom > 0.4 || s === player) {
      ctx.save();
      ctx.font = `700 ${Math.max(12, hr * 0.75)}px "Space Grotesk", sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 5 / cam.zoom; ctx.strokeStyle = INK; ctx.lineJoin = 'round';
      const ny = s.y - hr - 12 / cam.zoom;
      ctx.strokeText(s.name, s.x, ny);
      ctx.fillStyle = s === player ? YELLOW : PAPER;
      ctx.fillText(s.name, s.x, ny);
      ctx.restore();
    }
  }

  function draw(t) {
    const dpr = Math.min(2, devicePixelRatio || 1);
    const { cw, ch } = size;
    if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
      canvas.width = cw * dpr; canvas.height = ch * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#101f23';         // 場外。水はエリアの形に塗る
    ctx.fillRect(0, 0, cw, ch);

    const sx = cam.shake ? rand(-cam.shake, cam.shake) : 0;
    const sy = cam.shake ? rand(-cam.shake, cam.shake) : 0;
    ctx.save();
    // attract は主役を中央に置くとタイトルのサメと重なる。左三分の一に寄せて逃がす
    const ax = attract ? 0.22 : 0.5;   // cam を画面のどこに置くか（0=左端, 0.5=中央）
    ctx.translate(cw * ax + sx, ch / 2 + sy);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);

    // 描画範囲。ax が中央でないと cam の左右で見える幅が変わる
    const hh = ch / 2 / cam.zoom;
    const vx0 = cam.x - (cw * ax) / cam.zoom, vx1 = cam.x + (cw * (1 - ax)) / cam.zoom;
    const vy0 = cam.y - hh, vy1 = cam.y + hh;

    // エリア。危険帯を外側だけに出したいので、
    // 輪郭を太くストローク → 内側を水で塗り潰す → 境界線、の順で重ねる
    const wallW = 64;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = stripes;
    ctx.lineWidth = wallW * 2;
    ctx.stroke(outline);
    ctx.fillStyle = map.water;
    ctx.fill(outline);

    // 水中のドットグリッド（エリアの中だけ）
    ctx.save();
    ctx.clip(outline);
    const G = 60;
    ctx.fillStyle = 'rgba(244,239,234,.10)';
    for (let x = Math.floor(vx0 / G) * G; x < vx1; x += G) {
      for (let y = Math.floor(vy0 / G) * G; y < vy1; y += G) {
        ctx.fillRect(x, y, 4, 4);
      }
    }
    ctx.restore();

    ctx.strokeStyle = INK;
    ctx.lineWidth = 6 / cam.zoom;
    ctx.stroke(outline);

    // 餌
    for (const f of food) {
      if (f.x < vx0 - 20 || f.x > vx1 + 20 || f.y < vy0 - 20 || f.y > vy1 + 20) continue;
      const p = 1 + Math.sin(t * 2.4 + f.ph) * 0.12;
      const r = f.r * p;
      ctx.lineWidth = 2 / cam.zoom;
      ctx.strokeStyle = INK;
      if (f.kind) {
        ctx.save();
        ctx.translate(f.x, f.y); ctx.rotate(f.ph + t * 0.5);
        ctx.fillStyle = PAPER; ctx.fillRect(-r, -r * 0.6, r * 2, r * 1.6);
        ctx.fillStyle = INK; ctx.fillRect(-r, -r, r * 2, r * 0.55);
        ctx.strokeRect(-r, -r, r * 2, r * 2 * 0.8);
        ctx.restore();
      } else {
        ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, TAU);
        ctx.fillStyle = f.hue; ctx.fill(); ctx.stroke();
      }
    }

    // 航跡。当たり判定があるので画面外カリングはしない（見えない死因を作らない）
    ctx.lineCap = ctx.lineJoin = 'round';
    for (const s of sharks) {
      const w = s.wake;
      if (!s.alive || w.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(w[0].x, w[0].y);
      for (let i = 1; i < w.length; i++) ctx.lineTo(w[i].x, w[i].y);
      const wr = w[w.length - 1].r;
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = s.def.accent;
      ctx.lineWidth = wr * 2;
      ctx.stroke();
      // 流れる破線で「触れると危ない帯」と分かるようにする
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = PAPER;
      ctx.lineWidth = Math.max(1.5 / cam.zoom, wr * 0.45);
      ctx.setLineDash([9 / cam.zoom, 13 / cam.zoom]);
      ctx.lineDashOffset = -t * 70;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;

    // サメ（小さい順に描いて大物を前面へ）。画面外は捨てる —
    // rope は1匹あたり SEGS 回 drawImage するので、映らない分を描かないのが一番効く
    const alive = sharks.filter((s) => s.alive).sort((a, b) => a.mass - b.mass);
    for (const s of alive) {
      if (s.x + s.reach < vx0 || s.x - s.reach > vx1) continue;
      if (s.y + s.reach < vy0 || s.y - s.reach > vy1) continue;
      drawShark(s, t);
    }

    // パーティクル
    for (const p of fx) {
      const k = 1 - p.t / p.dur;
      ctx.globalAlpha = k;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * k, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // タッチ操舵中のフローティング仮想ジョイスティック描画
    if (!attract && player.alive) drawJoystick();

    // 画面端のビネットは #vignette（CSS）。ここで塗ると全画面のラジアルグラデーションを
    // 毎フレーム評価することになり、それだけで 1フレーム 4.8ms 食っていた

    if (mctx) drawMini();
  }

  function drawJoystick() {
    const stick = steerGate.getTouchStick(canvas.getBoundingClientRect());
    if (!stick) return;
    const { ox, oy, cx, cy, maxR, deadzone } = stick;

    ctx.save();
    // ベース円（外枠リング）
    ctx.beginPath();
    ctx.arc(ox, oy, maxR, 0, TAU);
    ctx.fillStyle = 'rgba(33, 48, 82, 0.38)';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(244, 239, 234, 0.5)';
    ctx.stroke();

    // 十字ガイド線
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(244, 239, 234, 0.22)';
    ctx.beginPath();
    ctx.moveTo(ox - maxR * 0.65, oy); ctx.lineTo(ox + maxR * 0.65, oy);
    ctx.moveTo(ox, oy - maxR * 0.65); ctx.lineTo(ox, oy + maxR * 0.65);
    ctx.stroke();

    // デッドゾーン円
    ctx.beginPath();
    ctx.arc(ox, oy, deadzone, 0, TAU);
    ctx.fillStyle = 'rgba(45, 45, 45, 0.25)';
    ctx.fill();

    // 接続線（ベース中心 -> ノブ）
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(cx, cy);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(243, 181, 83, 0.55)';
    ctx.stroke();

    // ノブ（現在位置）
    const knobR = 18;
    ctx.beginPath();
    ctx.arc(cx, cy, knobR, 0, TAU);
    ctx.fillStyle = 'rgba(243, 181, 83, 0.85)';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = INK;
    ctx.stroke();

    // ノブ中心のドット
    ctx.beginPath();
    ctx.arc(cx, cy, 3.5, 0, TAU);
    ctx.fillStyle = INK;
    ctx.fill();

    ctx.restore();
  }

  function drawMini() {
    const s = mini.width;
    const bb = arena.bb;
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.clearRect(0, 0, s, s);
    // エリアの外接矩形を枠内に収め、以降はワールド座標のまま描く
    const k = (s - 8) / Math.max(bb.w, bb.h);
    mctx.setTransform(k, 0, 0, k,
      4 - bb.x0 * k + (s - 8 - bb.w * k) / 2,
      4 - bb.y0 * k + (s - 8 - bb.h * k) / 2);

    mctx.fillStyle = 'rgba(33,48,82,.85)';
    mctx.fill(outline);
    mctx.fillStyle = 'rgba(243,181,83,.35)';
    const fd = 1.5 / k;
    for (let i = 0; i < food.length; i += 9) mctx.fillRect(food[i].x, food[i].y, fd, fd);
    mctx.lineWidth = 1 / k;
    for (const o of sharks) {
      if (!o.alive) continue;
      mctx.beginPath();
      mctx.arc(o.x, o.y, (o === player ? 4 : 2.6) / k, 0, TAU);
      mctx.fillStyle = o === player ? YELLOW : '#e07a6a';
      mctx.fill();
      mctx.strokeStyle = INK; mctx.stroke();
    }
    // 視界枠
    mctx.strokeStyle = 'rgba(244,239,234,.6)';
    mctx.setLineDash([3 / k, 3 / k]);
    const vw = size.cw / cam.zoom;
    const vh = size.ch / cam.zoom;
    mctx.strokeRect(cam.x - vw / 2, cam.y - vh / 2, vw, vh);
    mctx.setLineDash([]);
    mctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // ---------- loop ----------
  let hudT = 0, netT = 0;
  function frame(now) {
    if (!running) return;
    const t = now / 1000;
    const dt = last ? Math.min(0.05, t - last) : 0;
    last = t;

    // 独りだから止めていただけの場合、人が入ってきたら世界を戻す
    // （サーバ側も入室で tick を再開している）
    if (paused && world.humans() > 1) setPaused(false);

    if (!paused) step(dt);
    draw(t);

    // 送るのは自分の操作だけ。盤面は onNet が受け取る
    if (net) {
      netT += dt;
      if (netT >= 1 / 20) {
        netT = 0;
        net.send({ t: 'in', a: +player.aim.toFixed(2), b: player.boost ? 1 : 0 });
      }
    }

    hudT += dt;
    if (hudT > 0.08) {
      hudT = 0;
      const board = sharks.filter((s) => s.alive).sort((a, b) => b.mass - a.mass).slice(0, 5);
      onHud?.({
        mass: Math.round(player.mass),
        rank: 1 + sharks.filter((o) => o.alive && o !== player && o.mass > player.mass).length,
        alive: sharks.filter((s) => s.alive).length,
        time: world.elapsed,
        cd: player.cd, cdMax: player.def.skill.cd,
        stam: player.stam, winded: player.winded,
        boost: !player.winded && player.stam > 0,
        boosting: player.boost && !player.winded && player.stam > 0,
        humans: net ? world.humans() : 0,
        board: board.map((s) => ({
          name: s.name, mass: Math.round(s.mass), me: s === player, human: s.nid[0] !== 'b',
        })),
      });
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // デバッグ用の覗き穴（コンソールから盤面を確認する）。裏で回る attract に奪わせない
  if (!attract) window.__sz = { cam, sharks, player, food, W, arena };

  return {
    stop() {
      running = false; dead = true;
      world.destroy();
      ro.disconnect();
      clearTimeout(soloTimer);
      if (net) net.onmsg = null;
      window.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      portraitMQ.removeEventListener('change', onPortrait);
    },
    resume: () => setPaused(false),
  };
}
