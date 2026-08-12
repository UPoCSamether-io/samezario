// サメザリオ — Canvas ゲームループ（slither.io 形式）
import { SHARKS, BOT_NAMES } from './data.js';
import { paintShark, paintSpriteShark, bodyLength, taper } from './shark-art.js';
import { makeSteer } from './steer.js';

const TAU = Math.PI * 2;
const INK = '#2d2d2d';
const PAPER = '#f4efea';
const YELLOW = '#f3b553';

const PATH_STEP = 5;      // 軌跡サンプリング間隔(px)
const BASE_SPEED = 172;   // px/s
// rad/s の上限。3.3 だと質量 86 まで（＝序盤ずっと）この上限が効いてしまい、
// 体の細さぶんの小回りが殺されて「曲がりが鈍い」状態だった。
// 4.5 にすると上限が効くのは質量 14 まで＝初期値 30 より下なので、
// 序盤は下の旋回半径モデルがそのまま出る。実効 3.3→4.02 rad/s（180度 0.95→0.78秒）。
// 質量 89 以上は元から半径モデル側が下回っていて、値は変わらない
const BASE_TURN = 4.5;
const TURN_RADIUS = 3.2;  // 旋回半径 ≒ 体の半径 × これ
const BOOST_MULT = 1.85;
// ダッシュはサイズではなくスタミナゲージ(0..1)を食う。
// 満タンから約2.4秒でカラ、空から約4.5秒で全快。息切れ後は DASH_MIN まで戻るまで使えない
const DASH_DRAIN = 0.42;
const DASH_REFILL = 0.22;
const DASH_MIN = 0.18;
// 航跡：ダッシュ中だけ残る帯。頭から触れた相手は死ぬ（張った本人は平気）。
// 長さの上限はスタミナが決めるので、囲い込めるかどうかは DASH_DRAIN 側で効く
const WAKE_LIFE = 2.5;    // 残る秒数
const WAKE_STEP = 11;     // サンプル間隔(px)
const WAKE_R = 0.42;      // 太さ ≒ 胴の半径 × これ
const BOT_COUNT = 13;
const BOT_GROWTH = 0.55;
const START_MASS = 30;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[(Math.random() * a.length) | 0];

/** a を b の方向へ最大 max ラジアンだけ回す */
function steer(a, b, max) {
  const d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return a + clamp(d, -max, max);
}

const radiusOf = (m) => 9 + Math.sqrt(m) * 0.72;
const SEGS = 18;          // rope の骨の数。体長は伸びないので固定

/** "M x yl dx dy,...z"（data.js のエリア輪郭）→ 頂点配列 */
function parsePath(d) {
  const m = d.match(/^M(-?[\d.]+) (-?[\d.]+)l(.*)z$/);
  const pts = [[+m[1], +m[2]]];
  for (const pair of m[3].split(',')) {
    const [dx, dy] = pair.trim().split(/\s+/).map(Number);
    const p = pts[pts.length - 1];
    pts.push([p[0] + dx, p[1] + dy]);
  }
  return pts;
}

/**
 * エリア輪郭をプレイエリアにする。
 * 面積が size² になるよう拡大するので、餌の量やカメラなど「広さ」前提の式は今までのまま使える。
 * 内外判定は Path2D + isPointInPath（1回 0.2µs）。変換の影響を受けないよう専用の ctx で引く。
 */
function makeArena(map) {
  const pts = parsePath(map.path);
  let a2 = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a2 += p[0] * q[1] - q[0] * p[1];
  }
  const k = map.size / Math.sqrt(Math.abs(a2) / 2);

  const path = new Path2D();
  path.addPath(new Path2D(map.path), new DOMMatrix().scaleSelf(k));
  const hit = document.createElement('canvas').getContext('2d');
  const inside = (x, y) => hit.isPointInPath(path, x, y);

  const bb = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const [x, y] of pts) {
    bb.x0 = Math.min(bb.x0, x * k); bb.x1 = Math.max(bb.x1, x * k);
    bb.y0 = Math.min(bb.y0, y * k); bb.y1 = Math.max(bb.y1, y * k);
  }
  bb.w = bb.x1 - bb.x0; bb.h = bb.y1 - bb.y0;

  // 外接矩形の 47〜83% しか中身がないので、湧かせる座標は棄却サンプリングで取る
  const spot = () => {
    for (let i = 0; i < 60; i++) {
      const x = rand(bb.x0, bb.x1), y = rand(bb.y0, bb.y1);
      if (inside(x, y)) return { x, y };
    }
    return { ...home };
  };
  const home = (() => {                       // 必ず内側にある1点（湧き場所の最後の砦）
    for (let i = 0; i < 4000; i++) {
      const x = rand(bb.x0, bb.x1), y = rand(bb.y0, bb.y1);
      if (inside(x, y)) return { x, y };
    }
    return { x: (bb.x0 + bb.x1) / 2, y: (bb.y0 + bb.y1) / 2 };
  })();

  /** a から見て「先読み点が内側に入る」向きを探す。見つからなければ null */
  const escape = (x, y, a, look) => {
    for (let i = 1; i <= 8; i++) {
      for (const sgn of [1, -1]) {
        const t = a + sgn * i * 0.39;
        if (inside(x + Math.cos(t) * look, y + Math.sin(t) * look)) return t;
      }
    }
    return null;
  };

  return { path, inside, bb, home, spot, escape };
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
 * net: オンライン対戦（src/net.js）。ホストだけが盤面を進め、ゲストは
 *      「自分のサメを予測で動かしつつ、届いたスナップショットへ寄せる」形で同じ絵を出す。
 *      ボットはホストの中で今までどおり動くので、人が少ない部屋でも盤面は埋まる。
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
  const W = map.size;              // 実効プレイ面積の平方根。餌の量などの基準
  const arena = makeArena(map);    // 実際の外周はエリアの輪郭
  const def = SHARKS.find((s) => s.id === sharkId) || SHARKS[0];
  const stripes = ctx.createPattern(stripeTile(), 'repeat');

  const food = [];
  const sharks = [];
  const fx = [];
  const cam = { x: arena.home.x, y: arena.home.y, zoom: 1, shake: 0 };
  const mouse = { sx: 0, sy: 0 };   // 画面中心からのオフセット(px)
  const keys = new Set();
  // menu = ポーズ画面が出ているか、paused = 世界が止まっているか。
  // オンラインでは世界を止められないので、この2つは一致しない
  let running = true, paused = false, menu = false, last = 0, elapsed = 0, dead = false;

  // ---------- net ----------
  // 「今このブラウザが正か」。ホストが抜けると昇格するので、都度読む
  const authority = () => !net || net.host;
  // 部屋に居る人の数。nid の頭文字でボットと見分ける（ゲスト側は他人が全員 remote）
  const humans = () => sharks.filter((s) => s.nid[0] !== 'b').length;
  let rosterDirty = true;          // サメの顔ぶれが変わった → 次のスナップショットに名簿を載せる
  let nidSeq = 0, fSeq = 0;
  // ホストから盤面が一度でも届いたか。届かないまま SOLO_WAIT 過ぎたら独りに切り替える
  let gotBoard = false, soloTimer = null;
  const SOLO_WAIT = 3000;
  const fAdd = [], fDel = [];      // 前回のスナップショット以降の餌の増減（差分で送る）

  // ---------- entities ----------
  function makeFood(x, y, v, kind) {
    return {
      x, y, v,
      r: 3.6 + Math.sqrt(v) * 1.5,
      kind: kind ?? (Math.random() < 0.11 ? 1 : 0), // 1 = クラッパー(高得点)
      hue: pick([YELLOW, '#a3f0f0', '#f4efea', '#f08a5d', '#9ad9c0']),
      ph: Math.random() * TAU,
    };
  }

  // 餌は数が多いので毎回まるごとは送らない。増えた分・消えた分だけ拾っておく
  function addFood(f) {
    f.id = ++fSeq;
    food.push(f);
    if (net) fAdd.push(f);
    return f;
  }
  function delFood(i) {
    if (net) fDel.push(food[i].id);
    food.splice(i, 1);
  }

  function spawnFood(n) {
    for (let i = 0; i < n; i++) {
      const v = Math.random() < 0.12 ? rand(9, 20) : rand(2.5, 6);
      const p = arena.spot();
      addFood(makeFood(p.x, p.y, v));
    }
  }

  function makeShark(d, isBot, name, nid) {
    let x, y, tries = 0;
    do {
      ({ x, y } = arena.spot());
      tries++;
    } while (isBot && sharks[0] && Math.hypot(x - sharks[0].x, y - sharks[0].y) < 900 && tries < 30);

    const angle = rand(0, TAU);
    rosterDirty = true;
    return {
      def: d, name, isBot,
      // nid = 通信での身元。ボットは 'b0..'、人は接続ID。復活しても同じ nid を引き継ぐ
      nid: nid ?? 'b' + nidSeq++,
      remote: false,             // 位置を通信で貰う側（ゲストから見た他人と、ホストから見た他プレイヤー）
      ex: 0, ey: 0,              // スナップショットとのズレ。数フレームかけて溶かす
      x, y, angle, aim: angle,   // 初回入力が来るまでは湧いた向きへ直進
      mass: START_MASS,
      path: [{ x, y }],
      body: [], wake: [],
      reach: 60,
      // 湧き直後は無敵（同サイズ同士の即死を防ぐ）
      boost: false, cd: 0, skill: 0, guard: 0, slow: 0, rapid: 0, iframe: 3,
      stam: 1, winded: false,
      kills: 0, alive: true,
      wobble: rand(0, TAU),
      // bot only
      goal: null, mood: 0, moodT: 0,
    };
  }

  // attract ではカメラが追う主役もボット。死んだら別の個体に付け替える（下の die 参照）
  let player = makeShark(def, attract, attract ? pick(BOT_NAMES) : name, net?.id);
  sharks.push(player);
  /** 空いた席をボットで埋める。何度呼んでも合計 BOT_COUNT+1 匹を超えない */
  function fillBots() {
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    for (let i = 0; sharks.length < BOT_COUNT + 1; i++) {
      sharks.push(makeShark(pick(SHARKS), true, names[i % names.length]));
    }
  }

  /**
   * 通信が当てにならなくなったら独りの海として続ける。
   * 盤面が空のまま来ることがある（下の見張り参照）ので、ボットと餌もここで補う。
   * 補わないと「サメも餌も居ない海」になり、ゲームとして成立しない
   */
  function goSolo() {
    net = null;
    for (const o of sharks) {
      if (o === player) continue;
      o.remote = false;
      o.isBot = true;
    }
    fillBots();
    if (!food.length) spawnFood(Math.round((W * W) / 14000));
  }

  // ゲストの盤面はホストから丸ごと届く（'full'）。自分でボットも餌も湧かせない
  if (authority()) {
    fillBots();
    spawnFood(Math.round((W * W) / 14000));
  } else {
    // ただし 'full' が来ない事故がある。ホストのタブが裏に回ると rAF が止まり、
    // 'peer' を処理できないので誰も盤面を送ってくれない（相手が端末を伏せただけで起きる）。
    // 待ち続けるとボットも餌も居ない空の海で泳ぐことになるので、諦めて独りに切り替える
    soloTimer = setTimeout(() => {
      if (!running || gotBoard || authority()) return;
      net?.close();
      goSolo();
    }, SOLO_WAIT);
  }

  // ---------- input ----------
  // カーソルは「画面中心からのオフセット」で持つ。
  // ワールド座標で覚えるとカメラが進んだぶん狙点が置き去りになり、
  // カーソルを止めていてもサメがその一点を回り続けてしまう
  const steerGate = makeSteer();   // game.js には別物の steer() が居るので名前を分ける
  const aimAt = (e) => {
    const b = canvas.getBoundingClientRect();
    mouse.sx = e.clientX - b.left - b.width / 2;
    mouse.sy = e.clientY - b.top - b.height / 2;
  };
  const onMove = (e) => { if (steerGate.owns(e)) aimAt(e); };
  // マウスは押しっぱなしでダッシュ。タッチは同じ指が操舵を兼ねていて競合するので
  // ここでは踏まず、HUD の DASH ボタンに任せる（main.js が Space を合成する）
  const onDown = (e) => {
    if (!steerGate.claim(e)) return;
    if (e.pointerType === 'mouse') { if (e.button === 0) player.boost = true; }
    else aimAt(e);        // 指を置いた瞬間からその向きへ進ませる
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
    keys.add(k);
  };
  const onKeyUp = (e) => {
    if (e.key === ' ') player.boost = false;
    keys.delete(e.key.toLowerCase());
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
    // 自分がホストで独りなら誰も待たせないので本当に止める
    paused = v && authority() && humans() <= 1;
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
    if (!s.alive || s.cd > 0 || paused) return;
    const sk = s.def.skill;
    s.cd = sk.cd;
    burst(s.x, s.y, s.def.accent, 18);
    switch (s.def.id) {
      case 'jindaiji': s.guard = sk.dur; break;
      case 'tamagawa': s.rapid = sk.dur; break;
      default: s.skill = sk.dur;
    }
    if (net && s === player && !net.host) net.send({ t: 'sk' });   // 発動はホストにも通す
  }

  // ---------- net: 送る ----------
  const packShark = (o) => [
    o.nid, Math.round(o.x), Math.round(o.y), +o.angle.toFixed(2), Math.round(o.mass),
    (o.alive ? 1 : 0) | (o.boost ? 2 : 0) | (o.skill > 0 ? 4 : 0) | (o.guard > 0 ? 8 : 0) | (o.iframe > 0 ? 16 : 0),
  ];
  const packFood = (f) => [f.id, Math.round(f.x), Math.round(f.y), +f.v.toFixed(1), f.kind];

  /** 入室してきた1人へ、今の盤面をまるごと */
  function sendFull(to) {
    net.send({
      t: 'full', to,
      r: sharks.map((o) => [o.nid, o.name, SHARKS.indexOf(o.def)]),
      s: sharks.map(packShark),
      f: food.map(packFood),
    });
  }

  function sendSnap() {
    const m = { t: 'snap', s: sharks.map(packShark) };
    if (fAdd.length) m.fa = fAdd.map(packFood);
    if (fDel.length) m.fd = fDel.slice();
    if (rosterDirty) {
      m.r = sharks.map((o) => [o.nid, o.name, SHARKS.indexOf(o.def)]);
      rosterDirty = false;
    }
    fAdd.length = fDel.length = 0;
    net.send(m);
  }

  /** ホストの中に、人が操るサメを1匹足す（動かすのは届いた入力） */
  function addPeer({ id, shark, name: nm }) {
    if (sharks.some((o) => o.nid === id)) return;
    const s = makeShark(SHARKS.find((x) => x.id === shark) || SHARKS[0], false, nm, id);
    s.remote = true;
    sharks.push(s);
    sendFull(id);
    if (paused) setPaused(false);   // 独りだから止めていただけ。人が来たら世界を戻す
  }

  // ---------- net: 受ける ----------
  function applySnap(m) {
    gotBoard = true;
    const full = m.t === 'full';
    if (m.r) {
      const keep = new Set(m.r.map((e) => e[0]));
      for (const [nid, nm, di] of m.r) {
        if (nid === player.nid) continue;
        const d = SHARKS[di] || SHARKS[0];
        const s = sharks.find((o) => o.nid === nid);
        if (!s) {
          const o = makeShark(d, false, nm, nid);
          o.remote = true;
          sharks.push(o);
        } else if (s.def !== d) {
          s.def = d; s.path = [{ x: s.x, y: s.y }]; s.wake.length = 0;   // 復活して別のサメになった
        }
      }
      for (let i = sharks.length - 1; i >= 0; i--) {
        if (sharks[i] !== player && !keep.has(sharks[i].nid)) sharks.splice(i, 1);
      }
    }
    if (full) food.length = 0;
    for (const a of m.f ?? m.fa ?? []) {
      const f = makeFood(a[1], a[2], a[3], a[4]);
      f.id = a[0];
      food.push(f);
      if (f.id > fSeq) fSeq = f.id;   // ホストに昇格したとき id が衝突しないように
    }
    if (m.fd) {
      const gone = new Set(m.fd);
      for (let i = food.length - 1; i >= 0; i--) {
        if (!gone.has(food[i].id)) continue;
        const f = food[i];
        if ((f.x - player.x) ** 2 + (f.y - player.y) ** 2 < 90000) burst(f.x, f.y, f.hue, f.kind ? 8 : 3, 60);
        food.splice(i, 1);
      }
    }

    for (const [nid, x, y, ang, mass, flags] of m.s) {
      const s = sharks.find((o) => o.nid === nid);
      if (!s) continue;
      const wasAlive = s.alive;
      s.mass = mass;
      if (s !== player) {
        // 自分のスキル演出だけは押した瞬間から出したいので、ローカルの値を上書きしない
        s.aim = ang;
        s.boost = !!(flags & 2);
        s.skill = flags & 4 ? 0.25 : 0;
        s.guard = flags & 8 ? 0.25 : 0;
        s.iframe = flags & 16 ? 0.25 : 0;
      }
      s.alive = !!(flags & 1);
      if (full || !wasAlive) {                    // 入室直後と復活はワープさせる（補間で盤面を横断させない）
        s.x = x; s.y = y; s.angle = ang; s.ex = s.ey = 0;
        s.path = [{ x, y }]; s.wake.length = 0;
        if (s === player) { cam.x = x; cam.y = y; }
      } else {
        s.ex = x - s.x; s.ey = y - s.y;           // ズレは step で少しずつ詰める
      }
      // ponytail: 死因はスナップショットに乗せていないので、ゲスト側は空のまま
      // （リザルトでは死因の行を出さない）。要るならフラグに1バイト足す
      if (wasAlive && !s.alive) dieFx(s);
    }
  }

  function onNet(m) {
    switch (m.t) {
      case 'peer': if (authority()) addPeer(m); break;
      case 'bye': {
        const i = sharks.findIndex((o) => o.nid === m.id);
        if (i >= 0) { sharks.splice(i, 1); rosterDirty = true; }
        break;
      }
      case 'in': {                                 // ゲストの操作（ホストだけが受け取る）
        const s = sharks.find((o) => o.nid === m.id);
        if (s) { s.aim = m.a; s.boost = !!m.b; }
        break;
      }
      case 'sk': {
        const s = sharks.find((o) => o.nid === m.id);
        if (s) useSkill(s);
        break;
      }
      case 'host':                                 // 昇格。手元の盤面がそのまま正になる
        for (const o of sharks) {
          if (o === player) continue;
          o.remote = true;
          o.isBot = o.nid[0] === 'b';              // ボットはここから自分の頭で泳ぎ直す
          if (o.isBot) o.remote = false;
        }
        rosterDirty = true;
        break;
      case 'full':
      case 'snap':
        if (!authority()) applySnap(m);
        break;
      case 'down':                                 // 回線が切れた。盤面を止めずボット部屋として続ける
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

  // ---------- simulation ----------
  // 軌跡を実測の弧長で等間隔に歩き直す。
  // path の刻みは「PATH_STEP 以上」でしかない（速いほど粗くなる）ので、
  // 添字を距離とみなすとダッシュ中に体が伸びる。
  function bodyOf(s) {
    const r = radiusOf(s.mass);
    const n = SEGS;
    const sp = bodyLength(r, s.def) / n;  // 体長は太さに比例。成長しても伸びず、拡大するだけ
    const out = [{ x: s.x, y: s.y, r: r * taper(0) }];
    const path = s.path;
    let cx = s.x, cy = s.y, i = 0;
    for (let k = 1; k <= n; k++) {
      let d = sp;
      while (d > 0 && i < path.length) {
        const seg = Math.hypot(path[i].x - cx, path[i].y - cy);
        if (seg > d) {
          cx += ((path[i].x - cx) / seg) * d;
          cy += ((path[i].y - cy) / seg) * d;
          d = 0;
        } else {
          cx = path[i].x; cy = path[i].y; d -= seg; i++;
        }
      }
      out.push({ x: cx, y: cy, r: r * taper(k / n) });
    }
    s.reach = sp * n + r;
    return out;
  }

  function endRun(cause) {
    dead = true;
    setTimeout(() => onEnd({
      mass: Math.round(player.mass), kills: player.kills, time: elapsed, cause,
      rank: 1 + sharks.filter((o) => o.alive && o !== player && o.mass > player.mass).length,
    }), 900);
  }

  /** 見た目の死。ゲストはホストの宣告をこれだけで映す（餌のばら撒きと復活はホストが持つ） */
  function dieFx(s, cause) {
    s.alive = false;
    s.wake.length = 0;   // 死んだ本人の航跡が幽霊として残らないように
    cam.shake = s === player ? 26 : 8;
    burst(s.x, s.y, s.def.color, 26, 200);
    if (s === player && !attract) endRun(cause);
  }

  /** how: 'body' | 'wake'（killer が居るとき）。killer が無ければ外壁 */
  function die(s, killer, how) {
    dieFx(s, killer ? `${killer.name} の${how === 'wake' ? '航跡' : '胴体'}` : '外壁');
    // 質量を餌としてばら撒く
    const per = Math.max(4, s.mass / Math.max(6, s.body.length));
    for (const p of s.body) {
      if (Math.random() < 0.75) {
        addFood(makeFood(p.x + rand(-8, 8), p.y + rand(-8, 8), per * rand(0.6, 1.2), 0));
      }
    }
    if (killer) killer.kills++;
    // 人のサメは湧き直さない（本人はリザルトへ抜ける）。湧き直すのはボットだけ
    if (s.isBot) {
      setTimeout(() => {
        if (!running) return;
        const i = sharks.indexOf(s);
        if (i < 0) return;
        sharks[i] = makeShark(pick(SHARKS), true, s.name, s.nid);
        if (s === player) {                     // attract: 別の個体へカメラを切り替える。
          player = sharks[i];                   // 補間で盤面を横断させず、映画のカットのように飛ばす
          cam.x = player.x; cam.y = player.y;
        }
      }, 2200);
    }
  }

  function botThink(s, dt) {
    s.moodT -= dt;
    if (s.moodT <= 0) { s.moodT = rand(1.2, 3.5); s.mood = Math.random(); }

    let tx = s.goal?.x, ty = s.goal?.y;
    // 一番近い餌の塊を狙う
    if (!s.goal || Math.hypot(s.x - tx, s.y - ty) < 40 || Math.random() < 0.02) {
      let best = null, bd = 1e9;
      for (let i = 0; i < food.length; i += 3) {
        const f = food[i];
        const d = (f.x - s.x) ** 2 + (f.y - s.y) ** 2;
        if (d < bd) { bd = d; best = f; }
      }
      s.goal = best ? { x: best.x, y: best.y } : arena.spot();
      tx = s.goal.x; ty = s.goal.y;
    }

    // 自分より小さいサメの前を横切る（攻撃）
    if (s.mood > 0.72) {
      for (const o of sharks) {
        if (o === s || !o.alive || o.mass > s.mass * 0.85) continue;
        const d = Math.hypot(o.x - s.x, o.y - s.y);
        if (d < 620) { tx = o.x + Math.cos(o.angle) * 180; ty = o.y + Math.sin(o.angle) * 180; break; }
      }
    }

    let want = Math.atan2(ty - s.y, tx - s.x);

    // 胴体と航跡を回避。サイズに関係なく当たれば死ぬので相手は選ばない
    for (const o of sharks) {
      if (o === s || !o.alive) continue;
      if (Math.hypot(o.x - s.x, o.y - s.y) <= o.reach + 260) {
        for (let i = 0; i < o.body.length; i += 2) {
          const p = o.body[i];
          if (Math.hypot(p.x - s.x, p.y - s.y) < 190) { want = Math.atan2(s.y - p.y, s.x - p.x); break; }
        }
      }
      for (let i = 0; i < o.wake.length; i += 2) {
        const p = o.wake[i];
        if (Math.hypot(p.x - s.x, p.y - s.y) < 170) { want = Math.atan2(s.y - p.y, s.x - p.x); break; }
      }
    }

    // 壁回避（最優先）。旋回半径が体格に比例するので先読みも比例させる。
    // 形が凹んでいて「中央へ向かう」が壁の向こうを指すことがあるので、
    // 内側に着地する向きを実際に撃って探す
    const look = 200 + radiusOf(s.mass) * 7;
    if (!arena.inside(s.x + Math.cos(s.angle) * look, s.y + Math.sin(s.angle) * look)) {
      want = arena.escape(s.x, s.y, s.angle, look) ?? want;
    }

    s.aim = want;
    s.boost = s.mood > 0.9 && !s.winded;
    if (s.cd <= 0 && Math.random() < 0.004) useSkill(s);
  }

  /** ホストだけが回す判定。餌の増減とサメの生死＝盤面の「正」がここで決まる */
  function resolve(dt) {
    // スキル効果（範囲系）
    for (const s of sharks) {
      if (!s.alive || s.skill <= 0) continue;
      if (s.def.id === 'cinema') {
        for (const o of sharks) {
          if (o === s || !o.alive) continue;
          const d = Math.hypot(o.x - s.x, o.y - s.y);
          if (d > 430) continue;
          const da = Math.abs(((Math.atan2(o.y - s.y, o.x - s.x) - s.angle + Math.PI) % TAU + TAU) % TAU - Math.PI);
          if (da < 0.62) o.slow = 0.2;
        }
      }
      if (s.def.id === 'airport') {
        for (const f of food) {
          const dx = s.x - f.x, dy = s.y - f.y;
          const d = Math.hypot(dx, dy);
          if (d < 300 && d > 1) { f.x += (dx / d) * 480 * dt; f.y += (dy / d) * 480 * dt; }
        }
      }
    }

    // 捕食
    for (const s of sharks) {
      if (!s.alive) continue;
      const r = radiusOf(s.mass) + 6;
      for (let i = food.length - 1; i >= 0; i--) {
        const f = food[i];
        if (Math.abs(f.x - s.x) > r + f.r || Math.abs(f.y - s.y) > r + f.r) continue;
        if ((f.x - s.x) ** 2 + (f.y - s.y) ** 2 < (r + f.r) ** 2) {
          // ボットは餌を完璧に拾えるので、成長を抑えて難易度を整える
          s.mass += f.v * s.def.growth * (f.kind ? 2.2 : 1) * (s.isBot ? BOT_GROWTH : 1);
          if (s === player) burst(f.x, f.y, f.hue, f.kind ? 8 : 3, 60);
          delFood(i);
        }
      }
    }
    const target = Math.round((W * W) / 14000);
    if (food.length < target) spawnFood(Math.min(24, target - food.length));

    // 衝突：頭 vs 他のサメの胴体。スリザリオ同様サイズは関係なく、突っ込んだ側が死ぬ
    for (const s of sharks) {
      if (!s.alive || s.iframe > 0) continue;
      if (s.def.id === 'yokai' && s.skill > 0) continue; // すり抜け
      const hr = radiusOf(s.mass) * 0.45;
      for (const o of sharks) {
        if (o === s || !o.alive) continue;
        let hit = null;   // 何に当たったか。死因の表示に使う
        // 胴体（頭から4節は当たらない＝正面衝突では死なない）
        if (Math.hypot(o.x - s.x, o.y - s.y) <= o.reach + hr) {
          for (let i = 4; i < o.body.length; i++) {
            const p = o.body[i];
            if ((p.x - s.x) ** 2 + (p.y - s.y) ** 2 < (p.r + hr) ** 2) { hit = 'body'; break; }
          }
        }
        // 航跡は本体から離れた場所に残るので、胴体の早期棄却の外で見る
        if (!hit) {
          for (let i = 0; i < o.wake.length; i++) {
            const p = o.wake[i];
            if ((p.x - s.x) ** 2 + (p.y - s.y) ** 2 < (p.r + hr) ** 2) { hit = 'wake'; break; }
          }
        }
        if (!hit) continue;
        if (s.guard > 0) {
          s.guard = 0; s.iframe = 1.2;
          burst(s.x, s.y, YELLOW, 24, 180);
          if (s === player) cam.shake = 14;
        } else {
          die(s, o, hit);
        }
        break;
      }
    }
  }

  function step(dt) {
    elapsed += dt;

    for (const s of sharks) {
      if (!s.alive) continue;
      s.cd = Math.max(0, s.cd - dt);
      s.skill = Math.max(0, s.skill - dt);
      s.guard = Math.max(0, s.guard - dt);
      s.rapid = Math.max(0, s.rapid - dt);
      s.iframe = Math.max(0, s.iframe - dt);
      s.slow = Math.max(0, s.slow - dt);
      s.wobble += dt * 6;

      const r = radiusOf(s.mass);

      if (s.isBot) botThink(s, dt);
      else if (s === player) {
        // 毎フレーム今のカメラでワールド座標へ焼き直す。
        // 中心に近すぎると向きが定まらないので、そのときは直進を保つ
        const wx = cam.x + mouse.sx / cam.zoom, wy = cam.y + mouse.sy / cam.zoom;
        if (Math.hypot(wx - s.x, wy - s.y) > r) s.aim = Math.atan2(wy - s.y, wx - s.x);
      }
      // remote（通信で aim が届くサメ）はここでは何もしない。届いた向きへ泳ぎ続ける

      // ダッシュ（スタミナ消費。サイズは減らない）
      const canBoost = s.boost && !s.winded && s.stam > 0;
      if (canBoost) {
        s.stam = Math.max(0, s.stam - DASH_DRAIN * s.def.boostCost * dt);
        if (s.stam === 0) s.winded = true;
      } else {
        s.stam = Math.min(1, s.stam + DASH_REFILL * dt);
        if (s.winded && s.stam >= DASH_MIN) s.winded = false;
      }

      let sp = BASE_SPEED * s.def.speed * (1 - Math.min(0.26, r / 420));
      if (canBoost) sp *= BOOST_MULT * s.def.boostPower;
      if (s.rapid > 0) sp *= 3.1;
      if (s.slow > 0) sp *= 0.5;

      // 旋回半径を体の太さに比例させる（大きいほど重く曲がる）
      const turn = Math.min(BASE_TURN, sp / (TURN_RADIUS * r)) * s.def.turn;
      s.angle = steer(s.angle, s.aim, turn * dt);

      const px = s.x, py = s.y;
      s.x += Math.cos(s.angle) * sp * dt;
      s.y += Math.sin(s.angle) * sp * dt;

      // 壁：すり抜け中と bot は押し戻し、それ以外は死亡
      const phasing = s.def.id === 'yokai' && s.skill > 0;
      // 湧き直後の無敵は壁にも効かせる。外周向きに湧くと操作前に死ぬことがあった
      if (!arena.inside(s.x, s.y)) {
        if (phasing || s.isBot || s.iframe > 0) {
          s.x = px; s.y = py;                       // 直前の位置へ戻して向きだけ変える
          s.angle = arena.escape(px, py, s.angle, r * 3 + 60) ?? s.angle + Math.PI;
        } else if (authority()) {
          burst(s.x, s.y, '#ba1a1a', 22, 220);
          die(s, null);
          continue;
        }
        // ゲスト：壁での生死もホストが決める。はみ出したまま補正を待つ
      }

      // スナップショットとのズレは数フレームかけて溶かす（見えるワープを作らない）
      if (s.ex || s.ey) {
        const k = Math.min(1, dt * 7);
        s.x += s.ex * k; s.y += s.ey * k;
        s.ex -= s.ex * k; s.ey -= s.ey * k;
      }

      // 航跡：ダッシュ中だけ点を置き、寿命が切れた先頭から消える（尻尾から引っ込む）
      if (canBoost) {
        const w = s.wake[s.wake.length - 1];
        if (!w || (s.x - w.x) ** 2 + (s.y - w.y) ** 2 >= WAKE_STEP * WAKE_STEP) {
          s.wake.push({ x: s.x, y: s.y, r: r * WAKE_R, born: elapsed });
        }
      }
      while (s.wake.length && elapsed - s.wake[0].born > WAKE_LIFE) s.wake.shift();

      // 軌跡サンプリング
      const h = s.path[0];
      if ((s.x - h.x) ** 2 + (s.y - h.y) ** 2 >= PATH_STEP * PATH_STEP) {
        s.path.unshift({ x: s.x, y: s.y });
      }
      const need = Math.ceil(bodyLength(r, s.def) / PATH_STEP) + 3;
      if (s.path.length > need) s.path.length = need;

      s.body = bodyOf(s);
    }

    // ここから先（餌の増減・生死）はホストだけが回す。答えが2つあると盤面が割れる。
    // ゲストは結果をスナップショットで受け取るだけ（吸引で動いた餌もホストの座標が正）
    if (authority()) resolve(dt);

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
    ctx.stroke(arena.path);
    ctx.fillStyle = map.water;
    ctx.fill(arena.path);

    // 水中のドットグリッド（エリアの中だけ）
    ctx.save();
    ctx.clip(arena.path);
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
    ctx.stroke(arena.path);

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

    // 画面端のビネットは #vignette（CSS）。ここで塗ると全画面のラジアルグラデーションを
    // 毎フレーム評価することになり、それだけで 1フレーム 4.8ms 食っていた

    if (mctx) drawMini();
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
    mctx.fill(arena.path);
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

    if (!paused) step(dt);
    draw(t);

    // 通信。ホストは盤面を配り、ゲストは自分の向きとダッシュだけを送る
    if (net) {
      netT += dt;
      const rate = authority() ? 1 / 15 : 1 / 20;
      if (netT >= rate) {
        netT = 0;
        if (authority()) sendSnap();
        else net.send({ t: 'in', a: +player.aim.toFixed(2), b: player.boost ? 1 : 0 });
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
        time: elapsed,
        cd: player.cd, cdMax: player.def.skill.cd,
        stam: player.stam, winded: player.winded,
        boost: !player.winded && player.stam > 0,
        boosting: player.boost && !player.winded && player.stam > 0,
        humans: net ? humans() : 0,
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
