// サメザリオ — ブラウザ側。描画と入力と「サーバの答えの先読み」だけを持つ。
//
// 盤面そのものは src/sim.js（サーバと共有）。ここは world を回して絵にするだけで、
// 餌の増減や生死は決めない —— オンラインなら world.authority=false で
// サーバの宣告を待ち、繋がらなければ world.goSolo() で自分が正になる。
import { BOT_NAMES } from './data.js';
import { plainText } from './ruby.js';
import { paintShark, paintSpriteShark } from './shark-art.js';
import { makeSteer } from './steer.js';
import { sfx } from './audio.js';
import { createWorld, radiusOf, clamp, rand, pick, TAU } from './sim.js';

const INK = '#2d2d2d';
const PAPER = '#f4efea';
const YELLOW = '#f3b553';
const MINT = '#a3f0f0';

/**
 * #rrggbb にアルファを足す。グラデーションの端を透明へ落とすときに使う ——
 * 'transparent' は「透明な黒」なので、混ぜると縁が黒ずむ。
 */
function hexA(hex, a) {
  return hex + Math.round(clamp(a, 0, 1) * 255).toString(16).padStart(2, '0');
}

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

// 水中のドット。60px ごとに fillRect を撒くと、引きの絵ほど重くなる —— 撒く数は
// 見えている面積、つまり 1/zoom² で増え、育ちきると 1フレーム 363 → 3458 回になる
// （zoom は 1.05 → 0.34 まで引く）。タイル1枚を敷き詰めれば、大きさに関係なく 1回で済む。
function dotTile() {
  const c = document.createElement('canvas');
  c.width = c.height = 60;                 // = 旧 G。ドットの間隔を変えないための値
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(244,239,234,.10)';
  g.fillRect(0, 0, 4, 4);
  return c;
}

// 河川敷の砂利。水中のドットと同じ「タイル1枚を敷き詰める」やり方だが、
// 粒を不揃いに散らして、水面のドットと見分けが付くようにする
function gravelTile() {
  const c = document.createElement('canvas');
  c.width = c.height = 72;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(244,239,234,.13)';
  for (const [x, y, r] of [[9, 13, 3.4], [31, 6, 2.2], [52, 20, 4], [19, 38, 2.8],
    [62, 45, 2.4], [40, 57, 3.6], [6, 62, 2.6], [66, 68, 3]]) {
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
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
  // 環境ギミック（#83）。効き目そのものは sim.js が決めていて、ここは見せ方だけ。
  // ギミックの無いエリアでは null なので、以下はまるごと素通りする
  const gim = world.gimmick;
  // 盤面に名前を出すのは湧水ゾーンだけ（急流と気流は流れそのものが見えていれば足りる）
  const gimLabel = plainText(gim?.def.label);
  const stripes = ctx.createPattern(stripeTile(), 'repeat');
  const dots = ctx.createPattern(dotTile(), 'repeat');
  const gravel = ctx.createPattern(gravelTile(), 'repeat');

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
    // 止まった世界でフィルムだけ回らせない。押しっぱなしなら再開の1フレーム目で鳴り直す
    if (paused && !attract) { sfx.dash(false); wasBoosting = false; }
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
    if (dead) return;   // sim が death を2回積んでも XP を二重加算しない
    dead = true;
    setTimeout(() => onEnd({
      mass: Math.round(player.mass), kills: player.kills, time: world.elapsed, cause,
      rank: 1 + sharks.filter((o) => o.alive && o !== player && o.mass > player.mass).length,
    }), 900);
  }

  /**
   * 画面のどこで起きた音か。距離は画面座標（＝ズーム込み）で測るので、育って引きの絵に
   * なるほど遠くの出来事は小さくなる。画面8枚ぶん離れたら無音。
   *
   * 減衰は二乗だと画面の外へ出た時点でほぼ聞こえなくなり、盤面が静かになりすぎた。
   * 0.6乗まで寝かせて、遠くの出来事も「遠くで起きている」と分かる音量で残す
   */
  function spatial(x, y) {
    const dx = (x - cam.x) * cam.zoom, dy = (y - cam.y) * cam.zoom;
    const half = Math.max(size.cw, size.ch) * 0.5 || 1;
    const far = Math.hypot(dx, dy) / (half * 8);
    return { vol: clamp(1 - far, 0, 1) ** 0.6, pan: clamp(dx / half, -1, 1) };
  }

  /**
   * sim が「何が起きたか」だけを積んでくるので、ここで絵と音と画面遷移にする。
   * 自分で回した結果でも、サーバの宣告を applySnapshot が翻訳した結果でも同じ道を通る
   * —— オンラインとオフラインで演出が食い違わないのはこのため。
   */
  function onEvent(e) {
    const s = e.shark;
    switch (e.k) {
      case 'eat': {
        // 自分の口元か、目の届く範囲（300px）で消えた粒だけ弾けさせる
        if (s && s !== player) break;
        const d2 = (e.x - player.x) ** 2 + (e.y - player.y) ** 2;
        if (!s && d2 >= 90000) break;
        burst(e.x, e.y, e.hue, e.kind ? 8 : 3, 60);
        // 音は自分が食べたぶんだけ。オンラインでは「誰が食べたか」をサーバが送って
        // こない（applySnapshot は shark:null で積む）ので、口の届く距離で肩代わりする
        // 口の半径ちょうどでは半分取りこぼす。粒が消えた点はサーバが決めていて、
        // こちらの座標は予測なので、実測で 2倍の半径 + 30px ぶんズレていた
        // （自分の口元は 18〜27px、他人が食べた粒は 250px 先。間は広いので余裕をとる）
        const mouth = radiusOf(player.mass) * 2 + 30;
        if (!attract && (s === player || d2 < mouth * mouth)) sfx.eat();
        break;
      }
      case 'wall': burst(e.x, e.y, '#ba1a1a', 22, 220); break;
      case 'skill':
        burst(s.x, s.y, s.def.accent, 18);
        if (s === player && !attract) sfx.skill();
        break;
      case 'guard':
        burst(s.x, s.y, YELLOW, 24, 180);
        if (s === player) cam.shake = 14;
        break;
      case 'die': {
        cam.shake = s === player ? 26 : 8;
        burst(s.x, s.y, s.def.color, 26, 200);
        if (attract) break;
        if (s === player) { sfx.die(); endRun(e.cause); break; }
        // 他人の最期も聞こえる。遠いほど小さく、画面の左右どちらで起きたかで振る
        const { vol, pan } = spatial(s.x, s.y);
        if (vol > 0.03) sfx.die(vol * 0.7, pan);
        break;
      }
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

  let wasBoosting = false;
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

    // ダッシュは sim がイベントを出さない（boost はフラグ）ので、立ち上がりをここで拾う。
    // hud（0.08秒ごと）で拾うと押した音が遅れて聞こえるため毎フレーム見る
    const boosting = player.alive && player.boost && !player.winded && player.stam > 0;
    if (boosting !== wasBoosting && !attract) sfx.dash(boosting);
    wasBoosting = boosting;

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

  // ---------- 環境ギミックの見せ方 ----------
  // 目的は2つだけ。「流れがどちらを向いているか」と「いまゾーンの中に居るか」。
  // 効き目の値は sim.js から引くので、絵と盤面が食い違うことはない。

  // 見出しの大きさ。ワールド px 固定にすると引きの絵（zoom 0.34）で読めなくなり、
  // 画面 px 固定にすると寄った絵で画面を覆う。下限だけ画面側で押さえる
  const labelPx = () => Math.max(30, 26 / cam.zoom);

  /** ワールド座標に置く見出し。サメの名前と同じ「白抜き＋墨の縁」 */
  function worldLabel(text, x, y, px, fill) {
    ctx.save();
    ctx.font = `700 ${px}px "Space Grotesk", "M PLUS Rounded 1c", sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 5 / cam.zoom;
    ctx.strokeStyle = INK;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  /**
   * ワールドの矩形 box を、流れ（ang）の座標系へ移したときの外接範囲。
   * この (u, v) の上に格子を置くと、行は流れに直交して並び、
   * 流すのは u を増やすだけで済む。
   */
  function flowBox(ang, box) {
    const co = Math.cos(-ang), si = Math.sin(-ang);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, y] of [[box.x0, box.y0], [box.x1, box.y0], [box.x0, box.y1], [box.x1, box.y1]]) {
      const u = x * co - y * si, v = x * si + y * co;
      if (u < u0) u0 = u;
      if (u > u1) u1 = u;
      if (v < v0) v0 = v;
      if (v > v1) v1 = v;
    }
    return { u0, u1, v0, v1 };
  }

  /**
   * 流れを矢羽根（>）の列で見せて、流れの速さで流す。向きは矢羽根そのものが指す。
   * 1個ずつ stroke() すると引きの絵で数百回になるので、1本の Path にまとめて1回で描く。
   */
  function chevrons(t, ang, speed, box, gap, span, style, lw, cap = 700) {
    const { u0, u1, v0, v1 } = flowBox(ang, box);
    const wing = Math.min(24, gap * 0.3);
    const p = new Path2D();
    let n = 0;
    for (let v = Math.ceil(v0 / gap) * gap; v <= v1 && n < cap; v += gap) {
      // 行ごとに位相をずらす。揃えると格子に見えて水に見えない
      const drift = (t * speed + (v / gap) * span * 0.37) % span;
      for (let u = Math.ceil((u0 - drift) / span) * span + drift; u <= u1 && n < cap; u += span) {
        p.moveTo(u - wing, v - wing);
        p.lineTo(u, v);
        p.lineTo(u - wing, v + wing);
        n++;
      }
    }
    ctx.save();
    ctx.rotate(ang);
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.strokeStyle = style;
    ctx.lineWidth = lw;
    ctx.stroke(p);
    ctx.restore();
  }

  /**
   * 流れの筋。矢羽根と同じく流れの座標系で格子ごと流すので、粒が1本ずつ
   * 巻き戻ることがない（ワールドの軸に並べて巻き戻すと、戻る量が格子と噛み合わず
   * 行に1本ぶんの穴が流れていく）。こちらも Path を1本にまとめて1回で描く。
   *
   * cap は保険。いちばん引いた絵（zoom 0.34）の急流で 445 本、4K 幅でも 1218 本なので、
   * 1800 なら切り捨てが見えることはない。1本の Path なので本数は stroke() の回数に響かない。
   */
  function streaks(t, ang, speed, box, gap, span, len, style, lw, alpha, cap = 1800) {
    const { u0, u1, v0, v1 } = flowBox(ang, box);
    const p = new Path2D();
    let n = 0;
    for (let v = Math.ceil(v0 / gap) * gap; v <= v1 && n < cap; v += gap) {
      // 行ごとに位相をずらす。揃えると格子に見えて水に見えない
      const drift = (t * speed + (v / gap) * span * 0.37) % span;
      // 端は len/2 ぶん外から始める。画面の縁で粒が生え際を見せないため
      for (let u = Math.ceil((u0 - len - drift) / span) * span + drift;
        u <= u1 + len && n < cap; u += span) {
        p.moveTo(u - len / 2, v);
        p.lineTo(u + len / 2, v);
        n++;
      }
    }
    ctx.save();
    ctx.rotate(ang);
    ctx.lineCap = 'round';
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = style;
    ctx.lineWidth = lw;
    ctx.stroke(p);
    ctx.restore();
  }

  /**
   * 多摩川の上下3帯。上＝河川敷（凪）、中＝流れ、下＝急流。
   * 帯の色も筋の密度・長さ・速さも sim.js の流速そのものから出すので、
   * 絵と盤面が食い違うことはない。
   */
  function drawCurrent(t, view) {
    const bb = arena.bb;
    const bands = gim.bands;
    const maxSpeed = Math.max(...bands.map((b) => b.speed));

    // 帯の色。境目で切らず、流速を細かく引いた1本のグラデーションで溶かす ——
    // 帯ごとに矩形を敷くと、どの帯も自分の両端で透明に落ちて、境目に無着色の
    // 継ぎ目が出る。透明側は同じ色のアルファ0（hexA）にして、黒を混ぜない
    const tint = ctx.createLinearGradient(0, bb.y0, 0, bb.y1);
    for (let i = 0; i <= 24; i++) {
      const sp = gim.currentSpeedAt(bb.y0 + (i / 24) * bb.h);
      tint.addColorStop(i / 24, hexA(sp ? MINT : PAPER, 0.04 + (sp / maxSpeed) * 0.13));
    }
    ctx.fillStyle = tint;
    ctx.fillRect(bb.x0, bb.y0, bb.w, bb.h);

    for (let i = 0, y0 = bb.y0; i < bands.length; y0 = bands[i++].y) {
      const y1 = bands[i].y;
      // 見えている範囲との重なりだけを描く。エリアは 10536 × 5453 あるので、
      // 全面へ撒くと引きの絵で毎フレーム数千本になる（矢羽根が view を見ていたのと同じ理由）
      const box = {
        x0: Math.max(view.x0, bb.x0), x1: Math.min(view.x1, bb.x1),
        y0: Math.max(view.y0, y0), y1: Math.min(view.y1, y1),
      };
      if (box.x0 >= box.x1 || box.y0 >= box.y1) continue;

      const speed = gim.currentSpeedAt((y0 + y1) / 2);
      const strength = speed / maxSpeed;

      if (speed) {
        const gap = 240 - strength * 100;        // 流れに直交する行の間隔
        const span = gap * 1.6;                  // 流れに沿った粒の間隔
        const len = 36 + strength * 150;
        const lw = Math.max(1.4 / cam.zoom, 1.8 + strength * 2.4);
        streaks(t, gim.def.dir, speed, box, gap, span, len, PAPER, lw, 0.1 + strength * 0.38);
        // 急流にだけ白波を重ねる。格子をずらしてあるので筋の上には乗らない
        if (strength > 0.7) {
          streaks(t, gim.def.dir, speed * 1.3, box, gap * 1.7, span * 0.75, len * 0.3,
            PAPER, lw * 0.85, 0.1 + strength * 0.2);
        }
      } else {
        // 河川敷は砂利を敷いて「水ではない」と分かるようにする。水中のドットと同じ
        // タイル敷きなので、広さに関係なく数回で済む。下端は溶かして切り口を出さない
        const fade = gim.def.blend * bb.h * 2;
        ctx.save();
        ctx.fillStyle = gravel;
        ctx.fillRect(bb.x0, y0, bb.w, y1 - y0 - fade);
        for (let k = 0; k < 6; k++) {
          ctx.globalAlpha = 1 - (k + 0.5) / 6;
          ctx.fillRect(bb.x0, y1 - fade + (fade / 6) * k, bb.w, fade / 6 + 1);
        }
        ctx.restore();
      }
    }
  }

  /** 飛行場のプロペラ気流。滑走路の帯は凪の間もうっすら残す＝「ここで吹く」と先に分かる */
  function drawGust(t, view) {
    const r = gim.runway;
    const lv = gim.level(world.envT);

    ctx.save();
    ctx.translate(r.x0, r.y0);
    ctx.rotate(r.ang);
    const g = ctx.createLinearGradient(0, -r.w, 0, r.w);
    g.addColorStop(0, 'rgba(243,181,83,0)');
    g.addColorStop(0.5, `rgba(243,181,83,${(0.05 + lv * 0.2).toFixed(3)})`);
    g.addColorStop(1, 'rgba(243,181,83,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, -r.w, r.len, r.w * 2);

    ctx.strokeStyle = `rgba(243,181,83,${(0.3 + lv * 0.45).toFixed(3)})`;
    ctx.lineWidth = Math.max(2.5 / cam.zoom, 3);
    ctx.setLineDash([90, 70]);
    ctx.lineDashOffset = -t * (50 + lv * 400);
    ctx.beginPath();
    ctx.moveTo(0, -r.w); ctx.lineTo(r.len, -r.w);
    ctx.moveTo(0, r.w); ctx.lineTo(r.len, r.w);
    ctx.stroke();
    // センターライン。路面標識と同じ刻みにしておくと、凪の間も滑走路として読める
    ctx.strokeStyle = `rgba(243,181,83,${(0.16 + lv * 0.3).toFixed(3)})`;
    ctx.lineWidth = Math.max(2 / cam.zoom, 2.5);
    ctx.setLineDash([150, 150]);
    ctx.lineDashOffset = -t * (50 + lv * 400);
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(r.len, 0);
    ctx.stroke();
    ctx.restore();

    if (lv > 0.02) {
      // 矢羽根は帯の中だけ。走査する範囲も帯の外接矩形と視界の重なりに絞る
      const bx0 = Math.min(r.x0, r.x1) - r.w, bx1 = Math.max(r.x0, r.x1) + r.w;
      const by0 = Math.min(r.y0, r.y1) - r.w, by1 = Math.max(r.y0, r.y1) + r.w;
      const box = {
        x0: Math.max(view.x0, bx0), x1: Math.min(view.x1, bx1),
        y0: Math.max(view.y0, by0), y1: Math.min(view.y1, by1),
      };
      if (box.x0 < box.x1 && box.y0 < box.y1) {
        ctx.save();
        ctx.translate(r.x0, r.y0);
        ctx.rotate(r.ang);
        ctx.beginPath();
        ctx.rect(0, -r.w, r.len, r.w * 2);
        ctx.clip();
        ctx.rotate(-r.ang);
        ctx.translate(-r.x0, -r.y0);
        ctx.globalAlpha = 0.15 + lv * 0.6;
        chevrons(t, r.ang, gim.def.push * 1.7, box, 130, 270, YELLOW, Math.max(2.2 / cam.zoom, 3));
        ctx.restore();
      }
    }
  }

  /** 深大寺の湧水。縁の破線が「ここから中」の線で、泡は t だけで決まる（端末で絵が割れない） */
  function drawSprings(t) {
    for (let i = 0; i < gim.springs.length; i++) {
      const z = gim.springs[i];
      const here = (player.x - z.x) ** 2 + (player.y - z.y) ** 2 < z.r * z.r;
      const pulse = 0.5 + 0.5 * Math.sin(t * 1.6 + i * 2.1);

      const g = ctx.createRadialGradient(z.x, z.y, z.r * 0.12, z.x, z.y, z.r);
      g.addColorStop(0, `rgba(163,240,240,${((here ? 0.26 : 0.14) + pulse * 0.05).toFixed(3)})`);
      g.addColorStop(1, 'rgba(163,240,240,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.fill();

      ctx.save();
      ctx.strokeStyle = MINT;
      ctx.globalAlpha = here ? 0.95 : 0.45;
      ctx.lineWidth = Math.max(2.5 / cam.zoom, here ? 5 : 3.5);
      ctx.setLineDash([30, 22]);
      ctx.lineDashOffset = -t * 36;
      ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.stroke();
      ctx.restore();

      ctx.fillStyle = 'rgba(163,240,240,.45)';
      for (let k = 0; k < 9; k++) {
        const ph = (t * 0.33 + k * 0.111 + i * 0.37) % 1;
        const a = k * 2.4 + i * 1.7;
        const rr = z.r * (0.1 + 0.6 * ph);
        ctx.beginPath();
        ctx.arc(z.x + Math.cos(a) * rr, z.y + Math.sin(a) * rr - ph * z.r * 0.3, 3 + (1 - ph) * 7, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = here ? 1 : 0.6;
      worldLabel(gimLabel, z.x, z.y + z.r - 30, labelPx(), MINT);
      ctx.globalAlpha = 1;
    }
  }

  /** 水の中に敷く層。サメより後ろ、餌より後ろ */
  function drawEnvBack(t, view) {
    if (!gim) return;
    ctx.save();
    ctx.clip(outline);          // 流れも渦も湧水も水の中だけ。壁の外へはみ出させない
    if (gim.kind === 'current') drawCurrent(t, view);
    if (gim.kind === 'gust') drawGust(t, view);
    if (gim.kind === 'spring') drawSprings(t);
    ctx.restore();
  }

  /**
   * いま自分に効いているものを、自機のまわりで直接見せる。
   * 矢印は「押されている向き」なので、自分の向きとの差がそのまま得か損かになる。
   *
   * 多摩川はここを通さない。流れは自分の位置ではなく「いまどの帯に居るか」で
   * 決まるので、カメラを追う帯の見出し（drawCurrent）のほうが読みやすい。
   */
  function drawEnvFront(t) {
    if (!gim || !player.alive) return;
    if (gim.kind === 'current') return;
    const wind = gim.windAt(player.x, player.y, world.envT);
    const hr = radiusOf(player.mass);

    if (wind.x || wind.y) {
      const m = Math.hypot(wind.x, wind.y);
      const len = hr * 1.9 + m * 0.7;
      ctx.save();
      ctx.translate(player.x, player.y);
      ctx.rotate(Math.atan2(wind.y, wind.x));
      ctx.globalAlpha = 0.8;
      ctx.lineCap = ctx.lineJoin = 'round';
      ctx.strokeStyle = YELLOW;
      ctx.lineWidth = Math.max(3 / cam.zoom, 4);
      ctx.beginPath();
      ctx.moveTo(hr * 1.4, 0); ctx.lineTo(len, 0);
      ctx.moveTo(len - 20, -15); ctx.lineTo(len, 0); ctx.lineTo(len - 20, 15);
      ctx.stroke();
      ctx.restore();
    }
    // 湧水ゾーンは直径 900px 超で、中に居ると縁も見出しも画面の外に出てしまう。
    // 「入っている」は自機のまわりだけで完結させる。そばガードの輪（破線・黄・半径 2.4r）と
    // 見分けが付くよう、こちらは実線・ミントで外側（3.9r）に置く
    if (gim.springAt(player.x, player.y)) {
      ctx.save();
      ctx.strokeStyle = MINT;
      ctx.lineWidth = Math.max(3.5 / cam.zoom, 4.5);
      ctx.globalAlpha = 0.5 + 0.35 * Math.sin(t * 5);
      ctx.beginPath(); ctx.arc(player.x, player.y, hr * 3.9, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
      worldLabel(gimLabel, player.x, player.y + hr * 3.9 + labelPx(), labelPx(), MINT);
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

    // 水中のドット（エリアの中だけ）。タイルは world 座標に敷かれるので、
    // 旧ループと同じく 60 の倍数に並び、カメラと一緒に流れる
    ctx.fillStyle = dots;
    ctx.fill(outline);

    ctx.strokeStyle = INK;
    ctx.lineWidth = 6 / cam.zoom;
    ctx.stroke(outline);

    // 環境ギミック（#83）。餌より後ろに敷く
    drawEnvBack(t, { x0: vx0, y0: vy0, x1: vx1, y1: vy1 });

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

    // いま自分に効いているギミック。サメの上に重ねないと自分のことだと分からない
    drawEnvFront(t);

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
    const scale = s / 150;
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.clearRect(0, 0, s, s);
    // エリアの外接矩形を枠内に収め、以降はワールド座標のまま描く
    const pad = 6 * scale;
    const k = (s - pad * 2) / Math.max(bb.w, bb.h);
    mctx.setTransform(k, 0, 0, k,
      pad - bb.x0 * k + (s - pad * 2 - bb.w * k) / 2,
      pad - bb.y0 * k + (s - pad * 2 - bb.h * k) / 2);

    mctx.fillStyle = 'rgba(33,48,82,.85)';
    mctx.fill(outline);

    // 環境ギミック。どこで吹くか・どこが湧水かは、行く前に地図で分かるほうがいい
    if (gim?.runway) {
      const r = gim.runway;
      mctx.save();
      mctx.translate(r.x0, r.y0); mctx.rotate(r.ang);
      mctx.fillStyle = `rgba(243,181,83,${(0.12 + gim.level(world.envT) * 0.3).toFixed(3)})`;
      mctx.fillRect(0, -r.w, r.len, r.w * 2);
      mctx.restore();
    }
    if (gim?.bands?.length) {
      let y0 = arena.bb.y0;
      const maxSpeed = Math.max(...gim.bands.map((b) => b.speed));
      mctx.save();
      mctx.clip(outline);
      for (const b of gim.bands) {
        const speed = gim.currentSpeedAt((y0 + b.y) / 2);
        mctx.save();
        mctx.globalAlpha = 0.12 + (speed / maxSpeed) * 0.35;
        mctx.fillStyle = speed ? MINT : PAPER;
        mctx.fillRect(arena.bb.x0, y0, arena.bb.w, b.y - y0);
        mctx.restore();
        y0 = b.y;
      }
      mctx.restore();
    }
    for (const z of gim?.springs ?? []) {
      mctx.beginPath(); mctx.arc(z.x, z.y, z.r, 0, TAU);
      mctx.fillStyle = 'rgba(163,240,240,.3)'; mctx.fill();
    }

    mctx.lineWidth = (1.5 * scale) / k;
    for (const o of sharks) {
      if (!o.alive) continue;
      mctx.beginPath();
      mctx.arc(o.x, o.y, (o === player ? 5 * scale : 3.2 * scale) / k, 0, TAU);
      mctx.fillStyle = o === player ? YELLOW : '#e07a6a';
      mctx.fill();
      mctx.strokeStyle = INK; mctx.stroke();
    }
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

    // 送るのは自分の操作と現在座標。盤面は onNet が受け取る
    if (net) {
      netT += dt;
      if (netT >= 1 / 20) {
        netT = 0;
        net.send({
          t: 'in',
          a: +player.aim.toFixed(2),
          b: player.boost ? 1 : 0,
          x: Math.round(player.x),
          y: Math.round(player.y),
        });
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
        edge: player.alive ? clamp((180 - arena.edgeDist(player.x, player.y)) / 140, 0, 1) : 0,
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
      if (!attract) sfx.dash(false);   // 押したまま抜けてもフィルムは止める
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
