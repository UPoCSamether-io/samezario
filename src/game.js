// サメザリオ — ブラウザ側。描画と入力と「サーバの答えの先読み」だけを持つ。
//
// 盤面そのものは src/sim.js（サーバと共有）。ここは world を回して絵にするだけで、
// 餌の増減や生死は決めない —— オンラインなら world.authority=false で
// サーバの宣告を待ち、繋がらなければ world.goSolo() で自分が正になる。
import { BOT_NAMES } from './data.js';
import { paintShark, paintSpriteShark } from './shark-art.js';
import { makeSteer } from './steer.js';
import { sfx, EAT_GAP } from './audio.js';
import { HAPTIC, buzz, hush } from './haptics.js';
import { createWorld, radiusOf, dashBonusOf, clamp, rand, pick, TAU } from './sim.js';

// 地響き。1発ぶんの揺れ（cam.shake の 0.88 減衰）は 0.5秒で消えてしまい、
// 20秒待った末に何かが起き上がる出来事としては軽すぎた。こちらは秒数を持たせて
// 「鳴り続ける」揺れにする。振動（haptics.js の HAPTIC.bossRevive）と同じ長さ
const QUAKE_DUR = 1.2;
const QUAKE_SHAKE = 34;   // 地響きが保つ揺れ幅(px)。時間とともに 0 まで落ちる

// 開始の寄り。始まった瞬間に「自分はどれか・どこに居るか」が分かるよう、
// 自機に寄った絵から INTRO_SEC かけて通常の倍率へ引いていく。
// 寄り倍率は通常の倍率（fit 込み）に掛ける。スマホ横（高さ INTRO_SHORT_CH 未満）は
// 1.8倍だと見える縦が狭すぎて周りの危険が見えないので 1.4倍に抑える
const INTRO_SEC = 2.5;
const INTRO_ZOOM = 1.8;
const INTRO_ZOOM_SHORT = 1.4;
const INTRO_SHORT_CH = 500;
// 「あなた」の目印は開始の無敵の間だけ出し、切れる前のこの秒数でフェードアウトする。
// 0.5秒だと薄くなった黄色が水色の海と混ざって、灰緑の四角に見える時間が長かった
const YOU_FADE = 0.3;
const YOU_RISE = 12;   // フェードしながら浮かせる高さ（画面 px）。「消えた」ではなく「離れていった」に見せる

// 食べる・倒すの手応え（#4）。
// 粒の同時数の上限。上限が無かったころは、ボス撃破（100粒）と死の連鎖が重なると
// 数百粒が積もっていた。300 あれば一番派手な裏ボスの起き上がり（116粒）を2回重ねても入る
const MAX_FX = 300;
// 自分が倒した瞬間に絵を止める長さ(秒・実時間)。止めるのは描画とカメラと粒だけで、
// 盤面（world）は回し続ける —— 盤面の時計を止めるとサーバとずれ、オフラインでも
// TIME が実時間から遅れる。明けた瞬間に 50ms ぶん進んだ絵へ飛ぶのが「止まった」手応えになる
const HITSTOP = 0.05;
// 揺れの幅(px)。自分が倒した手応えは、自分が死んだとき（26）とその他の死（8）の間
const SHAKE_KILL = 14;
const SHAKE_DIE_ME = 26;
const SHAKE_DIE_NEAR = 8;
// 揺れの減衰。1/60 秒ごとに 0.88 倍（以前は step を呼ぶ回数で掛けていたので、
// fps やサブステップの回数で揺れの長さが変わっていた）
const SHAKE_DECAY = 0.88;
const FX_DRAG = 0.93;   // 粒の減速。同じく 1/60 秒あたり

const INK = '#2d2d2d';
const PAPER = '#f4efea';
const YELLOW = '#f3b553';
const MINT = '#a3f0f0';

// 調布飛行場（RJTF）の滑走路番号。[0] を風上の端（x0,y0 ＝北北西）、[1] を風下の端に描く。
// 番号は「その端から進入したときの磁方位の 1/10」なので、北の端には南向きの 17、
// 南の端には北向きの 35 が来る。差し替えるときはここだけ書き換える
const RUNWAY_NUMBERS = ['17', '35'];
// 気流の何秒前から進入灯を流して予告するか。周期 9秒・吹くのは 2.6秒（data.js）なので、
// 凪の 6.4秒のうち最後の 2.5秒。短いと気づく前に吹き、長いと「ずっと光っている」になる
const GUST_WARN = 2.5;
// 予告の閃光の流れ方。閃光は灯 WARN_GAP 個おきに何本も続けて走らせる（列車のように）。
// 1本だけを端から端へ流すと、画面に入っている数灯の前を通るのは一瞬で、止め絵では
// ほぼ写らず、スマホ横（縦 390px）では見落とす。8個おき（≒1190px）なら PC の寄りの画面に
// いつも1本はかかる。速さ WARN_RATE は灯/秒（14 → 約 2100px/s、影の速さと同じ桁）
const WARN_GAP = 8;
const WARN_RATE = 14;

/** 小数部だけ取り出す。泡の散らばりを添字から作るのに使う（乱数を持つと端末ごとに絵が割れる） */
const frac = (n) => n - Math.floor(n);

/**
 * #rrggbb にアルファを足す。グラデーションの端を透明へ落とすときに使う ——
 * 'transparent' は「透明な黒」なので、混ぜると縁が黒ずむ。
 */
function hexA(hex, a) {
  return hex + Math.round(clamp(a, 0, 1) * 255).toString(16).padStart(2, '0');
}

/**
 * 気流のときに頭上を飛んでいくプロペラ機の影。調布の離島便（新中央航空）と同じ
 * 双発の高翼機（Do 228 くらい：翼幅 17m・全長 16.6m）を真上から見た形。
 * 座標はメートルで、機首が +x。右半分（y ≥ 0）の外形を機首から尾まで書き、
 * 鏡に映して1本の閉じた多角形にする —— 胴・主翼・尾翼を別々の図形で重ねると、
 * 向き（巻き方向）が食い違った所で塗りに穴が開く。1本なら起きない。
 */
const PLANE_HALF = [
  [8.3, 0], [8.0, 0.35], [7.3, 0.65], [6.2, 0.8],            // 機首・操縦席
  [1.6, 0.8],                                                 // 主翼の付け根（前縁）
  [1.55, 2.55], [3.6, 2.6], [3.9, 2.85], [3.9, 3.15], [3.6, 3.4], [1.5, 3.45],   // エンジンの張り出し
  [1.4, 7.6], [1.0, 8.5], [0.3, 8.5], [-0.4, 7.6],            // 翼端
  [-0.8, 3.45], [-1.5, 3.2], [-1.5, 2.8], [-0.85, 2.55],      // ナセルの後ろ
  [-0.9, 0.8], [-5.6, 0.75],                                  // 胴の後ろ半分
  [-6.3, 0.6], [-7.2, 3.2], [-7.9, 3.25], [-8.0, 0.45],       // 水平尾翼
  [-8.4, 0.3], [-8.6, 0],
];
const PLANE_SCALE = 65;              // 1m あたりの px。翼幅 17m → 1105px ＝ 画面1枚分前後
const PLANE_R = 8.7 * PLANE_SCALE;   // 外接円の半径。画面外の判定に使う
let planeArt = null;                 // Path2D はブラウザにしか無いので、初めて使うときに1回だけ作る

function planeShadowArt() {
  if (planeArt) return planeArt;
  const S = PLANE_SCALE;
  const body = new Path2D();
  const pts = [...PLANE_HALF, ...PLANE_HALF.slice(1, -1).reverse().map(([x, y]) => [x, -y])];
  body.moveTo(pts[0][0] * S, pts[0][1] * S);
  for (let i = 1; i < pts.length; i++) body.lineTo(pts[i][0] * S, pts[i][1] * S);
  body.closePath();
  // 回っているプロペラは真上から見ると細い帯。胴より薄く描いて「回っている」に見せる
  const props = new Path2D();
  for (const side of [-1, 1]) props.rect(3.95 * S, (side * 3.0 - 1.35) * S, 0.25 * S, 2.7 * S);
  return (planeArt = { body, props });
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
  const stripes = ctx.createPattern(stripeTile(), 'repeat');
  const dots = ctx.createPattern(dotTile(), 'repeat');
  const gravel = ctx.createPattern(gravelTile(), 'repeat');

  const fx = [];
  // 手応え（#4）。hitstop は絵を止めている残り秒数（実時間）。
  // combo は続けて食べた数、lastEat はその最後の時刻(ms)。数え方は audio.js の音の連鎖と同じ
  // （EAT_GAP 以内に次を食べたら +1）。feed は前回の HUD から後に自分が倒した相手の名前、
  // myKills はその通算 —— オンラインでは player.kills がサーバから届かないので、こちらで数える。
  // myName はサーバが名乗らせた名前（server の clean() を通った後）。死因の文字列はこの名前で来る
  let hitstop = 0, combo = 0, lastEat = -Infinity, myKills = 0;
  let feed = [];
  let myName = name;
  // 位置と倍率は player を作った後の startIntro() で自機に合わせる。
  // 以前は arena.home から始めて追従で盤面を横切って飛んできていた
  const cam = { x: arena.home.x, y: arena.home.y, zoom: 1, shake: 0, quake: 0 };
  const mouse = { sx: 0, sy: 0 };   // 画面中心からのオフセット(px)
  // menu = ポーズ画面が出ているか、paused = 世界が止まっているか。
  // 他人が居る部屋では世界を止められないので、この2つは一致しない
  let running = true, paused = false, menu = false, last = 0, dead = false;

  // attract ではカメラが追う主役もボット。死んだら別の個体に付け替える（respawn イベント）
  let player = world.addPlayer({
    nid: net?.id, sharkId, isBot: attract,
    name: attract ? pick(BOT_NAMES) : name,
  });

  // 開始の寄り（INTRO_*）の残り秒数。step(dt) の dt で減らすので、ポーズ中は止まり、
  // frame() のサブステップの回数にも左右されない。attract（タイトル背面のデモ）では寄らない。
  // youOn は「あなた」の目印を出しているか。開始の無敵が一度切れたら落とし、
  // 途中で被弾の無敵が付いても出し直さない
  let introT = 0, youOn = false;
  // オンラインでは湧き位置が最初の 'full' で初めて決まる。それで自機がワープしたら
  // 寄りを最初からやり直す（'full' は入室時の1回だけ。大きなズレの補正ワープでは戻さない）
  let introOnWarp = false;
  // キャンバスの大きさ（size）が測れた最初の step で、倍率を追従を待たずに寄りへ合わせる。
  // 開始直後は画面の切り替え中でキャンバスの幅がまだ 0 のことがあり（実測で約 0.3秒）、
  // その間に決めた倍率（fit が下限・横画面扱い）から追うと、寄りきる前に引き始めてしまう
  let introSnap = false;
  /** 通常の倍率（寄りを掛ける前）。step() のカメラと開始時のズームで共有する */
  function baseZoom() {
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
    return clamp(64 / (44 + pr), 0.34, 1.05) * fit;
  }
  /** 寄り倍率。introT が INTRO_SEC → 0 と減るにつれ、smoothstep で寄り → 1 へ戻る */
  function introZoom() {
    if (introT <= 0) return 1;
    const u = introT / INTRO_SEC;
    const k = u * u * (3 - 2 * u);
    const z = size.ch < INTRO_SHORT_CH ? INTRO_ZOOM_SHORT : INTRO_ZOOM;
    return 1 + (z - 1) * k;
  }
  /** 寄りを最初から。カメラを自機の上に置き、倍率も追従を待たずに寄った絵から始める */
  function startIntro() {
    if (attract) return;   // デモのカメラは今までどおり（寄らず、目印も出さない）
    cam.x = player.x; cam.y = player.y;
    introT = INTRO_SEC;
    youOn = true;
    introSnap = true;
    cam.zoom = baseZoom() * introZoom();
  }
  startIntro();

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
  } else if (map.boss) {
    // ボスステージ（深大寺）は一騎打ち。雑魚ボットは湧かさず、餌だけ通常どおり撒く
    world.spawnBoss();
    world.seedFood();
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
        if (m.t === 'full') introOnWarp = true;
        gotBoard = true;
        // 名簿に載った自分の名前。サーバは名前を整えて（制御文字を抜く・10文字で切る）から
        // 死因に使うので、手元で付けた名前のままだと「自分が倒した」を取りこぼす
        if (m.r) {
          const me = m.r.find((r) => r[0] === player.nid);
          if (me) myName = me[1];
        }
        world.applySnapshot(m, player.nid);
        break;
      case 'down':      // 回線が切れた。盤面を止めずボット部屋として続ける
        goSolo();
        break;
    }
  }
  if (net) net.attach(onNet);   // hello 〜 ここ の間に届いた分もまとめて流れてくる

  // 引きの絵（zoom は 0.34 まで下がる）では粒は点にしか見えないので、倍率に合わせて数を減らす。
  // 上限 MAX_FX を超えるぶんは古い粒から捨てる —— 新しい粒（いま起きたこと）を捨てると、
  // ボス撃破の粒が残っている間の撃破が何も弾けなくなる。fx は積んだ順なので先頭が一番古い
  function burst(x, y, color, n = 10, spread = 90) {
    n = Math.min(MAX_FX, Math.ceil(n * clamp(cam.zoom, 0.4, 1)));
    const over = fx.length + n - MAX_FX;
    if (over > 0) fx.splice(0, over);
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), sp = rand(30, spread);
      fx.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, dur: rand(0.3, 0.7), r: rand(2, 6), color });
    }
  }

  // boss: 撃破した相手の def。裏ボスまで倒すと相手が別物（名前も立ち絵も違う）なので、
  // 結果画面が data.js の boss を引き直すと1戦目のほうが出てしまう
  function endRun(cause, win = false, boss = null) {
    if (dead) return;   // sim が death を2回積んでも XP を二重加算しない
    dead = true;
    hush();             // 震えを持ち越さない。結果画面まで唸っていると事故に見える
    setTimeout(() => onEnd({
      // オンラインでは player.kills が届かない（サーバのスナップショットに kills は無い）ので、
      // 死因の名前で数えた myKills を使う。以前はオンラインのリザルトの撃破数が常に 0 だった
      mass: Math.round(player.mass), kills: net ? myKills : player.kills, time: world.elapsed, cause, win,
      bossName: boss?.name ?? '', bossId: boss?.id ?? '',
      rank: 1 + sharks.filter((o) => o.alive && o !== player && o.mass > player.mass).length,
    // 撃破は餌が散る絵を見せてから抜ける
    }), win ? 1900 : 900);
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
   * その点が画面に映っているか（縁から margin px の外まで含める）。spatial() の vol は
   * 画面の縁でもまだ 0.9 あって「映っているか」の線引きには使えないので、画面座標で測る。
   * cam を置く位置は draw() と同じ（attract だけ左三分の一）
   */
  function onScreen(x, y, margin = 40) {
    const ax = attract ? 0.22 : 0.5;
    const px = (x - cam.x) * cam.zoom + size.cw * ax;
    const py = (y - cam.y) * cam.zoom + size.ch * 0.5;
    return px > -margin && px < size.cw + margin && py > -margin && py < size.ch + margin;
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
        // 音は自分が食べたぶんだけ。オンラインでは「誰が食べたか」をサーバが送って
        // こない（applySnapshot は shark:null で積む）ので、口の届く距離で肩代わりする
        // 口の半径ちょうどでは半分取りこぼす。粒が消えた点はサーバが決めていて、
        // こちらの座標は予測なので、実測で 2倍の半径 + 30px ぶんズレていた
        // （自分の口元は 18〜27px、他人が食べた粒は 250px 先。間は広いので余裕をとる）
        const mouth = radiusOf(player.mass) * 2 + 30;
        const mine = s === player || d2 < mouth * mouth;
        // 自分が食べたぶんは一回り大きく弾けさせる。他人のぶんは控えめなまま
        // （周りで他人が食べる粒まで派手だと、自分の手応えが埋もれる）
        if (mine) burst(e.x, e.y, e.hue, e.kind ? 10 : 6, 90);
        else burst(e.x, e.y, e.hue, e.kind ? 8 : 3, 60);
        if (attract || !mine) break;
        sfx.eat();
        // コンボは音の連鎖と同じ判定。音は 70ms 以内の連打を間引くが、数は1粒ずつ数える
        // （まとめて食べたぶんも数に乗るほうが手応えになる。音の高さは12段で頭打ち）
        const now = performance.now();
        combo = now - lastEat > EAT_GAP ? 1 : combo + 1;
        lastEat = now;
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
      case 'spring':
        // 湧水でガードを1個もらった瞬間。ここで音と粒を出さないと、
        // 「入ったのに何も起きない」再装填中との区別が付かない
        burst(s.x, s.y, MINT, 22, 150);
        if (s === player && !attract) sfx.skill();
        break;
      case 'die': {
        burst(s.x, s.y, s.def.color, 26, 200);
        const { vol, pan } = spatial(s.x, s.y);
        if (s === player) {
          cam.shake = Math.max(cam.shake, SHAKE_DIE_ME);
          if (attract) break;
          sfx.die(); endRun(e.cause);
          break;
        }
        // 自分が倒したか。die イベントは倒した側を持っていない（sim.js は触らない約束）ので、
        // 死因の文字列（sim.js の die(): 「名前 の胴体」「名前 の泳いだ跡」）で見分ける。
        // オンラインでも死因はサーバの文字列がそのまま来る。名前が他の参加者と同じだと
        // 取り違えるが、オンラインの名前は利用者が付ける10文字なので重なるのはまれ
        const byMe = !attract
          && (e.cause === `${myName} の胴体` || e.cause === `${myName} の泳いだ跡`);
        if (byMe) {
          myKills++;
          feed.push(s.name);
          hitstop = HITSTOP;
          cam.shake = Math.max(cam.shake, SHAKE_KILL);
        } else if (onScreen(s.x, s.y)) {
          // 画面の外の死では揺らさない。以前は盤面のどこで誰が死んでも揺れていた
          cam.shake = Math.max(cam.shake, SHAKE_DIE_NEAR * vol);
        }
        if (attract) break;
        // 他人の最期も聞こえる。遠いほど小さく、画面の左右どちらで起きたかで振る
        if (vol > 0.03) sfx.die(vol * 0.7, pan);
        break;
      }
      case 'bosshit':
        cam.shake = 20;
        burst(s.x, s.y, s.def.accent, 34, 260);
        if (!attract) sfx.skill();
        break;
      case 'bossdown':
        cam.shake = 34;
        burst(s.x, s.y, s.def.accent, 60, 320);
        burst(s.x, s.y, YELLOW, 40, 260);
        if (attract) break;
        sfx.die();
        // 裏ボスが控えているなら、ここで撮り終わりにしない（sim.js の boss.revive）。
        // 報酬の餌を拾って太る静けさが 20秒あって、同じ境内で湧き直す
        if (!e.revive) endRun('', true, s.def);
        break;
      case 'bossrevive':
        // 20秒の静けさを、揺れと手元の震えで断ち切る。ここだけは単発の揺れではなく
        // 秒数を持った地響きにしてある（QUAKE_DUR）
        cam.quake = QUAKE_DUR;
        cam.shake = QUAKE_SHAKE;
        burst(s.x, s.y, s.def.accent, 70, 420);
        burst(s.x, s.y, '#ba1a1a', 46, 300);
        if (attract) break;
        sfx.roar();
        // Web Haptics。震えるのは Android だけで、持っていない端末では何も起きない
        buzz(HAPTIC.bossRevive);
        break;
      case 'respawn':
        // attract: 主役が死んだら別の個体へカメラを切り替える。
        // 補間で盤面を横断させず、映画のカットのように飛ばす
        if (e.nid !== player.nid) break;
        player = e.shark;
        cam.x = player.x; cam.y = player.y;
        break;
      case 'warp':
        if (s !== player) break;
        if (introOnWarp) { introOnWarp = false; startIntro(); }
        else { cam.x = s.x; cam.y = s.y; }
        break;
    }
  }

  let wasBoosting = false;
  // frozen: ヒットストップ中。盤面は回すが、粒とカメラ（揺れ・追従・寄りの時計）は止める
  function step(dt, frozen = false) {
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
    // 'full' に自機が載っていなかった（ワープが来なかった）ときに、後の補正ワープで
    // 寄りがやり直されないよう、受け取ったぶんのイベントを流し終えたら下ろす
    introOnWarp = false;

    // ダッシュは sim がイベントを出さない（boost はフラグ）ので、立ち上がりをここで拾う。
    // hud（0.08秒ごと）で拾うと押した音が遅れて聞こえるため毎フレーム見る
    const boosting = player.alive && player.boost && !player.winded && player.stam > 0;
    if (boosting !== wasBoosting && !attract) sfx.dash(boosting);
    wasBoosting = boosting;
    if (frozen) return;

    // エフェクト。減速は dt から引く（回数で掛けるとサブステップの数で粒の飛ぶ距離が変わる）
    const drag = FX_DRAG ** (dt * 60);
    for (let i = fx.length - 1; i >= 0; i--) {
      const p = fx[i];
      p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= drag; p.vy *= drag;
      if (p.t >= p.dur) fx.splice(i, 1);
    }

    // カメラ
    // 通常の倍率（fit 込み、baseZoom のコメント参照）に開始の寄りを掛ける。
    // 寄りが 1 に戻れば「画面幅によらず見える幅が一定」は元どおり。
    // 寄り → 引きは追従（dt * 2.2）にそのまま乗るので、introT が尽きた後も滑らかに収まる
    // キャンバスがまだ測れていない（幅 0）間は寄りの時計を進めない —— 画面に映る前に使い切らないように
    if (size.cw > 0) introT = Math.max(0, introT - dt);
    const wantZoom = baseZoom() * introZoom();
    cam.zoom += (wantZoom - cam.zoom) * Math.min(1, dt * 2.2);
    if (introSnap && size.cw > 0) { introSnap = false; cam.zoom = wantZoom; }
    if (youOn && (!player.alive || player.iframe <= 0)) youOn = false;
    if (player.alive) {
      cam.x += (player.x - cam.x) * Math.min(1, dt * 9);
      cam.y += (player.y - cam.y) * Math.min(1, dt * 9);
    }
    // 地響きの間は揺れ幅を下から支える。支えを外すと 0.88 の減衰が勝って
    // 一瞬で静まるので、残り時間に比例させた床を毎フレーム当て直す
    if (cam.quake > 0) {
      cam.quake = Math.max(0, cam.quake - dt);
      cam.shake = Math.max(cam.shake, QUAKE_SHAKE * (cam.quake / QUAKE_DUR));
    }
    cam.shake *= SHAKE_DECAY ** (dt * 60);
    if (cam.shake < 0.05) cam.shake = 0;   // 0 にしておくと draw() が乱数を引かずに済む
  }

  // ---------- rendering ----------
  function drawShark(s, t) {
    const b = s.body;
    if (b.length < 3) return;
    const lw = 3.2 / cam.zoom;
    const phasing = s.def.id === 'yokai' && s.skill > 0;

    // ボスの金色のオーラ。体の下に敷く（上に重ねると巨体が霞んで見える）。
    // 引きの絵でも「そこに居る」ことが先に分かるよう、体より一回り大きく取る
    if (s.isBoss) {
      const rr = radiusOf(s.mass);
      const g = ctx.createRadialGradient(s.x, s.y, rr, s.x, s.y, rr * 3.4);
      g.addColorStop(0, hexA(s.def.accent, 0.34 + 0.12 * Math.sin(t * 2.2)));
      g.addColorStop(1, hexA(s.def.accent, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(s.x, s.y, rr * 3.4, 0, TAU); ctx.fill();
    }

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
    // 盾を持っている印。スキルの秒数（guard）でも湧水の在庫（guardStock）でも同じ輪を出す ——
    // 出どころが違うだけで「あと1回は耐えられる」は同じで、見分けても打つ手は変わらない。
    // 明滅するミントの実線1本だけにしてある。ゾーンの内外を別の輪で言い分けていたころは、
    // 湧水を出た瞬間にそちらが消えて、盾を持っているのかどうかが読めなかった
    if (s.guard > 0 || s.guardStock > 0) {
      ctx.save();
      ctx.strokeStyle = MINT;
      ctx.lineWidth = Math.max(3.5 / cam.zoom, 4.5);
      ctx.globalAlpha = 0.5 + 0.35 * Math.sin(t * 5);
      ctx.beginPath(); ctx.arc(s.x, s.y, radiusOf(s.mass) * 3.9, 0, TAU); ctx.stroke();
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
    if (cam.zoom > 0.4 || s === player || s.isBoss) {
      ctx.save();
      ctx.font = `700 ${Math.max(12, hr * 0.75)}px "Space Grotesk", sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 5 / cam.zoom; ctx.strokeStyle = INK; ctx.lineJoin = 'round';
      // 「あなた」の目印が出ている間は自機の名前を隠し、頭上の札を1つにまとめる。
      // 目印が薄くなるのと入れ替わりに戻す
      if (s === player) ctx.globalAlpha *= 1 - youAlpha();
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

  let tint = null;   // 流れの帯の色。静的なので初回に1回だけ作る（drawCurrent 参照）

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
    // 継ぎ目が出る。透明側は同じ色のアルファ0（hexA）にして、黒を混ぜない。
    //
    // 中身は時間に依存しない —— currentSpeedAt(y) は windAt(0, y, 0) と時刻を 0 に
    // 固定して呼ぶので、答えは帯の設定だけで決まる。毎フレーム作り直していたころは、
    // 同じ25色を出すために currentSpeedAt 25回と文字列25本を捨てていた。
    // 初回に作る（＝カメラ変換の下で作る）のは前と同じ。グラデーションは塗る時点の
    // 変換で描かれるので、いつ作っても絵は変わらない
    if (!tint) {
      tint = ctx.createLinearGradient(0, bb.y0, 0, bb.y1);
      for (let i = 0; i <= 24; i++) {
        const sp = gim.currentSpeedAt(bb.y0 + (i / 24) * bb.h);
        tint.addColorStop(i / 24, hexA(sp ? MINT : PAPER, 0.04 + (sp / maxSpeed) * 0.13));
      }
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
        // 河川敷は砂利を敷いて「水ではない」と分かるようにする。下端は溶かして
        // 切り口を出さない。敷くのは見えている範囲だけ —— ここだけ view を見ずに
        // bb 幅（多摩川で 10536px）へ毎フレーム7回パターンを塗っていた。すぐ上の筋が
        // view を見ているのと同じ理由で、こちらも切る。速度0の帯を持つのは多摩川
        // だけなので、この漏れも多摩川でしか出ない。
        // パターンはワールド原点にタイル敷きされるので、矩形を縮めても柄はずれない
        const fade = gim.def.blend * bb.h * 2;
        const gx = box.x0, gw = box.x1 - box.x0;
        ctx.save();
        ctx.fillStyle = gravel;
        const my0 = Math.max(box.y0, y0), my1 = Math.min(box.y1, y1 - fade);
        if (my1 > my0) ctx.fillRect(gx, my0, gw, my1 - my0);
        for (let k = 0; k < 6; k++) {
          const fy = y1 - fade + (fade / 6) * k, fh = fade / 6 + 1;
          if (fy + fh < box.y0 || fy > box.y1) continue;   // 画面の外の段は敷かない
          ctx.globalAlpha = 1 - (k + 0.5) / 6;
          ctx.fillRect(gx, fy, gw, fh);
        }
        ctx.restore();
      }
    }
  }

  // 滑走路の絵のうち、時間で変わらない部分（舗装の帯のグラデーションと白い標識）。
  // 滑走路は試合中に動かないので初回に1回だけ作る（drawCurrent の tint と同じやり方）。
  // どれも滑走路の座標系（x0,y0 が原点、+x が気流の向き）で作ってあるので、
  // 塗るときも同じ translate/rotate の下で塗る
  let runwayArt = null;

  function makeRunwayArt(r) {
    const pw = r.w * 0.55;           // 舗装の半幅。帯（＝気流の効く幅）の内側 55%
    // 帯の濃さ。効き k = 1 - d/w（sim.js の nearRunway）と同じ直線で中心から縁の 0 へ落とす ——
    // 「濃い所ほど強く押される」が絵で読める。舗装の外に見えているのが路肩
    const band = ctx.createLinearGradient(0, -r.w, 0, r.w);
    band.addColorStop(0, hexA(INK, 0));
    band.addColorStop(0.5, hexA(INK, 0.42));
    band.addColorStop(1, hexA(INK, 0));
    // 吹いている間だけ重ねる白っぽい明るみ。形は同じ直線で、濃さは level で決める
    const wash = ctx.createLinearGradient(0, -r.w, 0, r.w);
    wash.addColorStop(0, hexA(PAPER, 0));
    wash.addColorStop(0.5, hexA(PAPER, 0.24));
    wash.addColorStop(1, hexA(PAPER, 0));

    // 白い標識はぜんぶ矩形なので Path2D 1本にまとめて fill 1回で塗る
    // （rect() はどれも同じ向きに巻くので、重なっても穴が開かない）
    const marks = new Path2D();
    const edge = 9;                                          // 両脇の側線の幅
    marks.rect(0, -pw + 14, r.len, edge);
    marks.rect(0, pw - 14 - edge, r.len, edge);
    // ピアノの鍵盤。片側 5本ずつ、真ん中を空けて両端に置く
    const KEY0 = 70, KEYL = 300, KEYS = 5, mid = 22;
    const kw = (pw - 30 - mid) / (KEYS * 2 - 1);             // 縞と隙間を同じ幅に
    // 番号は縦に引き伸ばして描く（本物の路面標示も進入方向に長い）。文字高 ≈ 舗装幅の 0.6
    const numPx = Math.round(pw * 1.18), numStretch = 1.4;
    const numH = numPx * 0.72 * numStretch;
    const numAt = KEY0 + KEYL + 90 + numH / 2;               // 端から番号の中心まで
    for (const end of [0, 1]) {
      const u0 = end ? r.len - KEY0 - KEYL : KEY0;
      for (let i = 0; i < KEYS; i++) {
        const v = mid + i * kw * 2;
        marks.rect(u0, v, KEYL, kw);
        marks.rect(u0, -v - kw, KEYL, kw);
      }
      // 接地帯の目印（太い2本）。番号の先にあると「滑走路」の読みが一段強くなる
      const ua = end ? r.len - numAt - numH / 2 - 380 - 320 : numAt + numH / 2 + 380;
      marks.rect(ua, pw * 0.3, 320, pw * 0.22);
      marks.rect(ua, -pw * 0.3 - pw * 0.22, 320, pw * 0.22);
    }
    // センターラインは実線の短冊の列（setLineDash は使わない）
    const c0 = numAt + numH / 2 + 120, c1 = r.len - c0;
    const cw = 12, dash = 150, gap = 110;
    for (let u = c0; u + dash <= c1; u += dash + gap) marks.rect(u, -cw / 2, dash, cw);

    return {
      pw, band, wash, marks, numStretch, numAt,
      // 毎フレーム同じ文字列を作り直さないよう、色と書体もここで持つ
      pave: hexA(INK, 0.55), ink: hexA(PAPER, 0.62),
      // 舗装の上にだけ重ねるごく薄い水の色。標識ごと沈めて「水の底の滑走路」に見せる
      water: hexA('#3fb8b0', 0.1),
      font: `700 ${numPx}px "Space Grotesk", sans-serif`,
    };
  }

  /**
   * 飛行場。水に沈んだ滑走路（凪の間もはっきり見える）、気流の前に流れる進入灯、
   * 吹いている間に気流の向きへ巻き上がる泡。
   *
   * 演出の時刻はすべて world.envT から出す —— envT はスナップショットで全員にそろうので、
   * 同じ部屋の2台で灯の流れも泡も同じ絵になる（Math.random や t を混ぜると割れる）。
   * 向きは「泡の流れ」「影の進む向き」（drawPlaneShadow）「餌の渦」（sim.js の swirlFood）で伝える。
   * 以前の黄色い破線と矢羽根（最大 700本の Path）はやめた
   */
  function drawGust(t, view) {
    const r = gim.runway;
    // 帯の外接矩形が画面にかからなければ何もしない（灯も泡も帯の中にしか出ない）
    if (Math.max(r.x0, r.x1) + r.w < view.x0 || Math.min(r.x0, r.x1) - r.w > view.x1
      || Math.max(r.y0, r.y1) + r.w < view.y0 || Math.min(r.y0, r.y1) - r.w > view.y1) return;

    const env = world.envT;
    const { period, dur } = gim.def;
    const lv = gim.level(env);
    // level（sim.js）と同じ floor の畳み方。二重剰余だと窓の端が内側へ落ちる
    const ph = env - Math.floor(env / period) * period;
    if (!runwayArt) runwayArt = makeRunwayArt(r);
    const art = runwayArt;

    ctx.save();
    ctx.translate(r.x0, r.y0);
    ctx.rotate(r.ang);

    // 帯（路肩→水）と舗装。水の中なので舗装も少し沈ませる
    ctx.fillStyle = art.band;
    ctx.fillRect(0, -r.w, r.len, r.w * 2);
    ctx.fillStyle = art.pave;
    ctx.fillRect(0, -art.pw, r.len, art.pw * 2);
    if (lv > 0) {
      ctx.globalAlpha = lv;
      ctx.fillStyle = art.wash;
      ctx.fillRect(0, -r.w, r.len, r.w * 2);
      ctx.globalAlpha = 1;
    }

    // 白い標識（側線・鍵盤・接地帯・センターライン）と番号
    ctx.fillStyle = art.ink;
    ctx.fill(art.marks);
    ctx.font = art.font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const end of [0, 1]) {
      // その端から進入する向きに立てる＝文字の上が滑走路の奥を向く
      ctx.save();
      ctx.translate(end ? r.len - art.numAt : art.numAt, 0);
      ctx.rotate(end ? -Math.PI / 2 : Math.PI / 2);
      ctx.scale(1, art.numStretch);
      ctx.fillText(RUNWAY_NUMBERS[end], 0, 0);
      ctx.restore();
    }
    ctx.fillStyle = art.water;
    ctx.fillRect(0, -art.pw, r.len, art.pw * 2);

    // 進入灯。舗装の両脇に 24個ずつ、風上の端から風下へ並べる。仕様の目安（10〜14個）より多いのは、
    // 3570px に 14個だと間隔 255px になり、スマホ横（縦 390px）の画面には片側 1〜2灯しか入らず
    // 「流れている」が読めないため。数が増えても Path にまとめて塗るので fill の回数は変わらない。
    //
    // 灯の芯は餌（半径 8px 前後の黄・橙の丸）より明らかに小さく白くし、にじみは滑走路の向きに
    // 横長の楕円にする —— 丸く黄色い灯は餌と見分けが付かなかった
    const N = 24;
    const lr = Math.max(4.5, 1.8 / cam.zoom);      // 芯の半径。引きの絵でも画面上 1.8px は残す
    const lv0 = art.pw + 40;
    const warnS = (ph - (period - GUST_WARN)) / GUST_WARN;   // 予告の進み 0..1（予告中だけ）
    const warning = warnS >= 0 && warnS < 1;
    // 点き方の段。0・1 = 先頭（白く強く）、2・3 = 通り過ぎたあとの尾（黄色く短く）、4 = それ以外
    const LIT = [
      { core: PAPER, ca: 1, glow: PAPER, ga: 0.55, gw: 6, gh: 2.6 },
      { core: PAPER, ca: 0.85, glow: PAPER, ga: 0.35, gw: 5, gh: 2.2 },
      { core: YELLOW, ca: 0.6, glow: YELLOW, ga: 0.28, gw: 4.5, gh: 1.8 },
      { core: YELLOW, ca: 0.3, glow: YELLOW, ga: 0.14, gw: 4, gh: 1.6 },
    ];
    const cores = [], glows = [];
    for (let k = 0; k <= LIT.length; k++) { cores.push(new Path2D()); glows.push(new Path2D()); }
    // 先頭の位置（灯の添字の単位）。予告の始まりに風上の端（添字 0）から出て風下へ進む
    const head = warning ? warnS * GUST_WARN * WARN_RATE : -99;
    const allOn = lv > 0;                          // 全灯が点くのは吹いている間だけ
    for (let i = 0; i < N; i++) {
      const u = ((i + 0.5) / N) * r.len;
      // 0 = いま先頭、大きいほど通り過ぎてから経った。先頭がまだ来ていない灯（負）は消えたまま、
      // 通り過ぎたあとは WARN_GAP ごとに次の閃光が来る
      const d = head - i < 0 ? -1 : (head - i) % WARN_GAP;
      const k = d >= 0 && d < LIT.length ? Math.floor(d) : LIT.length;
      const st = LIT[k];
      for (const v of [-lv0, lv0]) {
        cores[k].moveTo(u + lr, v);
        cores[k].arc(u, v, lr, 0, TAU);
        if (st) {
          glows[k].moveTo(u + lr * st.gw, v);
          glows[k].ellipse(u, v, lr * st.gw, lr * st.gh, 0, 0, TAU);
        } else if (allOn) {
          glows[k].moveTo(u + lr * 4, v);
          glows[k].ellipse(u, v, lr * 4, lr * 1.6, 0, 0, TAU);
        }
      }
    }
    // 凪と予告中の消えている灯＝うっすら見える灯具。吹いている間＝全灯が弱く点きっぱなし
    if (allOn) {
      ctx.fillStyle = YELLOW;
      ctx.globalAlpha = 0.16 * lv;
      ctx.fill(glows[LIT.length]);
    }
    ctx.fillStyle = PAPER;
    ctx.globalAlpha = allOn ? 0.35 + lv * 0.45 : 0.22;
    ctx.fill(cores[LIT.length]);
    if (warning) {
      for (let k = LIT.length - 1; k >= 0; k--) {  // 先頭を最後に塗って上に来るように
        const st = LIT[k];
        ctx.fillStyle = st.glow;
        ctx.globalAlpha = st.ga;
        ctx.fill(glows[k]);
        ctx.fillStyle = st.core;
        ctx.globalAlpha = st.ca;
        ctx.fill(cores[k]);
      }
    }
    ctx.globalAlpha = 1;

    // 巻き上がる泡。吹いている間だけ、帯の中から気流の向きへ流れながら消える。
    // 位置も大きさも添字と envT だけから作る（drawSprings の泡と同じ作り）。
    // 消えぎわは透明度ではなく大きさで落とす —— そうすれば全部を Path 1本・fill 1回で塗れる
    if (lv > 0) {
      const LIFE = 0.9, TRAVEL = 560;
      const bub = new Path2D();
      const rmin = 2.5 / cam.zoom;
      for (let k = 0; k < 48; k++) {
        const seed = frac(Math.sin(k * 12.9898) * 43758.5453);
        const life = env / LIFE + seed;
        const q = frac(life);                                  // 0=湧いた所、1=消える所
        // 生まれ変わるたびに場所を変える。回数も envT から出るので端末で割れない
        const s = frac(Math.sin((k + Math.floor(life) * 57) * 78.233) * 43758.5453);
        const u = frac(s * 7.13) * (r.len - TRAVEL) + q * TRAVEL;
        // 真ん中ほど多く（＝強く押される所ほど泡立つ）
        const v = (frac(s * 3.71) * 2 - 1) * r.w * 0.8 * (0.35 + 0.65 * frac(s * 5.31))
          + Math.sin(q * TAU + k) * 28;                        // 巻き上がる揺れ
        const grow = Math.sin(q * Math.PI);
        const rad = Math.max((4 + 8 * frac(s * 2.17)) * lv, rmin) * grow;
        if (rad <= 0.5) continue;
        bub.moveTo(u + rad, v);
        bub.arc(u, v, rad, 0, TAU);
      }
      ctx.globalAlpha = 0.6 * Math.min(1, lv * 2);
      ctx.fillStyle = PAPER;
      ctx.fill(bub);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /**
   * プロペラ機の影。吹いている間（0 ≤ ph < dur）だけ、滑走路の手前から先まで
   * 気流と同じ向きに横切る。3570px を 2.6秒で抜けるので、押される速さ（205px/s）より
   * ずっと速い ——「頭上を何かが飛んでいった」に見せるため。
   * 水面に落ちた影なので、サメと餌より上に描く（draw() でサメの後・drawEnvFront の前に呼ぶ）。
   * 外周の外には落とさない。時刻は world.envT だけから出すので全員に同じ時に通る。
   */
  function drawPlaneShadow(view) {
    if (!gim?.runway) return;
    const r = gim.runway;
    const env = world.envT;
    const { period, dur } = gim.def;
    const ph = env - Math.floor(env / period) * period;
    if (ph >= dur) return;

    const k = ph / dur;
    const M = PLANE_R + 300;                 // 端の手前・先の余白。影が滑走路の上で湧いて見えないように
    const u = -M + (r.len + M * 2) * k;
    const cx = r.x0 + r.ux * u, cy = r.y0 + r.uy * u;
    if (cx + PLANE_R < view.x0 || cx - PLANE_R > view.x1
      || cy + PLANE_R < view.y0 || cy - PLANE_R > view.y1) return;

    const { body, props } = planeShadowArt();
    // 出はじめと抜けぎわは薄く。外周の内側で影がいきなり現れ・消えるのを和らげる
    const a = Math.min(1, k * 8, (1 - k) * 8);
    ctx.save();
    ctx.clip(outline);
    ctx.translate(cx, cy);
    ctx.rotate(r.ang);
    ctx.fillStyle = '#101f23';
    // 半影：少し大きく薄く敷いてから本影を重ねる（ぼかしフィルタより安い）
    ctx.globalAlpha = 0.1 * a;
    ctx.save();
    ctx.scale(1.05, 1.07);
    ctx.fill(body);
    ctx.restore();
    ctx.globalAlpha = 0.35 * a;   // 暗い舗装の上でもプロジェクタで消えない濃さ
    ctx.fill(body);
    ctx.globalAlpha = 0.12 * a;
    ctx.fill(props);
    ctx.restore();
  }

  /**
   * 深大寺の湧水。縁の破線が「ここから中」の線で、泡は t だけで決まる（端末で絵が割れない）。
   *
   * 湧水がくれるのはガード1個だけで、ゾーンには「今もらえる／再装填中」の2つの状態がある。
   * 入っても何も起きない時間が最大 30秒あるので、色で言い分けないと故障に見える ——
   * もらえるならミント、再装填中は灰にして泡も止める。
   */
  function drawSprings(t) {
    const ready = player.springT <= 0;
    const tint = ready ? '163,240,240' : '150,150,150';
    for (let i = 0; i < gim.springs.length; i++) {
      const z = gim.springs[i];
      const here = (player.x - z.x) ** 2 + (player.y - z.y) ** 2 < z.r * z.r;
      const pulse = ready ? 0.5 + 0.5 * Math.sin(t * 1.6 + i * 2.1) : 0;

      const g = ctx.createRadialGradient(z.x, z.y, z.r * 0.12, z.x, z.y, z.r);
      g.addColorStop(0, `rgba(${tint},${((here ? 0.26 : 0.14) * (ready ? 1 : 0.5) + pulse * 0.05).toFixed(3)})`);
      g.addColorStop(1, `rgba(${tint},0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.fill();

      ctx.save();
      ctx.strokeStyle = ready ? MINT : 'rgb(150,150,150)';
      ctx.globalAlpha = (here ? 0.95 : 0.45) * (ready ? 1 : 0.55);
      ctx.lineWidth = Math.max(2.5 / cam.zoom, here ? 5 : 3.5);
      ctx.setLineDash([30, 22]);
      ctx.lineDashOffset = -t * (ready ? 36 : 8);
      ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.stroke();
      ctx.restore();

      if (!ready) continue;      // 再装填中は泡を止める。「今は湧いていない」と読ませる

      // もらえる間は、ゾーン全体から泡を上げ続ける。これが「いま入れば1個もらえる」の
      // 唯一の合図で、サメが通り抜けた一瞬しか動きがないと、30秒経ったのかどうかが
      // 入ってみるまで分からない。
      // 数と大きさは直径 920px のゾーンから逆算している —— 9粒・半径3〜10pxだったころは
      // 引きの絵では点にもならず、湧いているのに止まって見えていた。
      // 位相も散らばりも添字から作る（乱数を持たない）ので、絵は t だけで決まる
      ctx.fillStyle = MINT;
      for (let k = 0; k < 34; k++) {
        const seed = frac(Math.sin(k * 12.9898 + i * 78.233) * 43758.5453);
        const ph = frac(t * 0.3 + seed);                 // 0=湧き出した所、1=抜けきる所
        const a = k * 2.399 + i * 1.7;                   // 黄金角で回す。並ぶと噴水に見える
        const rr = z.r * (0.12 + 0.8 * frac(seed * 7.13));
        const x = Math.cos(a) * rr + Math.sin(t * 1.7 + k) * 9;
        const y = Math.sin(a) * rr;
        // 浮き先はその x でのゾーンの上端。まっすぐ上へ流すと縁を越えて散り、
        // 破線で引いた「ここから中」がぼやける
        const top = -Math.sqrt(Math.max(0, z.r * z.r - x * x));
        // 上がるにつれ細り、出はじめと抜けぎわで透ける（両端が切れると点滅に見える）
        ctx.globalAlpha = Math.min(1, ph * 5) * Math.min(1, (1 - ph) * 3.5) * 0.55;
        // 引きの絵（zoom は最小 0.21 まで下がる）で消えないよう、画面上 4.5px を下限にする。
        // 上限 14px は、太らせたぶんが縁からはみ出さないための頭打ち
        const rad = (4 + 8 * frac(seed * 3.71)) * (1 - ph * 0.4);
        ctx.beginPath();
        ctx.arc(z.x + x, z.y + y + (top - y) * ph * 0.8, Math.max(rad, Math.min(14, 4.5 / cam.zoom)), 0, TAU);
        ctx.fill();
      }
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
    // 「いま湧水ゾーンの中に居る」を自機のまわりに出すのはやめた。自機に付く輪は
    // 盾の輪（drawShark、ミント・3.9r・明滅）1本だけにする —— 同じ色の輪が2本あると、
    // どちらが「あと1回耐えられる」なのか読めない。
    // ゾーンの内外と再装填の状態は drawSprings の縁と泡（ミント／灰）が持つ
  }

  // 「あなた」の吹き出し（下向きの ▼ 付き）。形は画面 px で決めてあり、描くときに
  // 1/cam.zoom を掛けて画面上の大きさを一定にする。Path2D はブラウザにしか無いので遅れて作る
  const YOU_W = 64, YOU_H = 26, YOU_TIP = 10, YOU_R = 8;
  let youPath = null;
  /**
   * 自機の頭上（名前のさらに上）に黄色の「あなた」▼ を出す。開始の無敵の間だけで、
   * 切れる前の YOU_FADE 秒で薄くなって消える。
   * 輪にはしない —— 自機に付く輪は盾の輪（ミント）1本だけ、という drawEnvFront の方針と
   * 紛らわしくならないように。色は自機の名前と同じ YELLOW（ミント＝盾・赤＝危険は使わない）
   */
  /** 目印の濃さ（0〜1）。drawShark の自機の名前はこの裏返しで出す */
  function youAlpha() {
    if (attract || !youOn || !player.alive) return 0;
    return clamp(player.iframe / YOU_FADE, 0, 1);
  }
  function drawYouMarker() {
    if (player.body.length < 3) return;
    const a = youAlpha();
    if (a <= 0) return;
    if (!youPath) {
      // 原点が ▼ の先。上に角丸の吹き出しを載せた1本の輪郭
      const w = YOU_W / 2, top = -YOU_TIP - YOU_H, bot = -YOU_TIP, r = YOU_R;
      youPath = new Path2D();
      youPath.moveTo(0, 0);
      youPath.lineTo(-7, bot);
      youPath.lineTo(-w + r, bot);
      youPath.arcTo(-w, bot, -w, bot - r, r);
      youPath.lineTo(-w, top + r);
      youPath.arcTo(-w, top, -w + r, top, r);
      youPath.lineTo(w - r, top);
      youPath.arcTo(w, top, w, top + r, r);
      youPath.lineTo(w, bot - r);
      youPath.arcTo(w, bot, w - r, bot, r);
      youPath.lineTo(7, bot);
      youPath.closePath();
    }
    const k = 1 / cam.zoom;
    const hr = player.body[0].r;
    // 名前は drawShark で s.y - hr - 12/zoom に、字の高さ max(12, hr*0.75)（ワールド単位）で描かれる
    const nameTop = player.y - hr - 12 * k - Math.max(12, hr * 0.75);
    // 上下にゆっくり弾ませる（画面 px）。盤面の時計から作るので、ポーズ中は止まる
    const bob = Math.sin(world.elapsed * 4) * 4;
    ctx.save();
    ctx.translate(player.x, nameTop);
    ctx.scale(k, k);
    ctx.translate(0, -6 + bob - (1 - a) * YOU_RISE);
    ctx.globalAlpha = a;
    // HUD（Retro Pop）と同じ INK のずらし影。塗り → 縁の順にして、縁を狙いの太さで見せる
    ctx.fillStyle = INK;
    ctx.translate(3, 3); ctx.fill(youPath); ctx.translate(-3, -3);
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = INK;
    ctx.fillStyle = YELLOW;
    ctx.fill(youPath);
    ctx.stroke(youPath);
    ctx.fillStyle = INK;
    ctx.font = '800 16px "M PLUS Rounded 1c", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('あなた', 0, -YOU_TIP - YOU_H / 2 + 1);
    ctx.restore();
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
    // rope は1匹あたり節の数だけ drawImage するので、映らない分を描かないのが一番効く
    const alive = sharks.filter((s) => s.alive).sort((a, b) => a.mass - b.mass);
    for (const s of alive) {
      if (s.x + s.reach < vx0 || s.x - s.reach > vx1) continue;
      if (s.y + s.reach < vy0 || s.y - s.reach > vy1) continue;
      drawShark(s, t);
    }

    drawPlaneShadow({ x0: vx0, y0: vy0, x1: vx1, y1: vy1 });   // 飛行場の影。水面に落ちるのでサメより上
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
    // 「あなた」の目印。パーティクルにも埋もれないよう世界の絵のいちばん上に置く
    drawYouMarker();
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
      mctx.arc(o.x, o.y, ((o === player ? 5 : o.isBoss ? 8 : 3.2) * scale) / k, 0, TAU);
      mctx.fillStyle = o === player ? YELLOW : o.isBoss ? o.def.accent : '#e07a6a';
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
    // 盤面の時計（world.elapsed ＝ TIME と生存時間）を実時間に追いつかせる。
    // 1回の step は 0.05秒で切る —— 詰まったぶんを dt に乗せると、1ティックで
    // サメが体半分ぶん進んで壁や相手をすり抜ける（server/index.mjs の makeRoom と同じ理由）。
    // 以前は切った残りを捨てていたので、fps が 20 を割ると盤面が実時間より遅れ、
    // 低 fps の多摩川では実時間 12秒で TIME 0:02、自機の無敵も手元だけ長く残っていた。
    // 切った残りは回数で追う。0.25秒（4fps）を超える穴はタブ復帰などなので捨てる
    // （それ以上追うと、描画の重い端末で step が積み上がって余計に遅くなる）
    const dt = last ? Math.min(0.25, t - last) : 0;
    last = t;

    // 独りだから止めていただけの場合、人が入ってきたら世界を戻す
    // （サーバ側も入室で tick を再開している）
    if (paused && world.humans() > 1) setPaused(false);

    // ヒットストップ（自分が倒した瞬間）。倒した絵を描いたフレームの次から、実時間で
    // HITSTOP 秒だけ描き直さない（キャンバスは最後の絵のまま残る）。盤面は step で回し続け、
    // 粒とカメラだけ止める。秒数は frame の dt で減らすので、サブステップの回数に左右されない
    const frozen = hitstop > 0 && !paused;
    if (frozen) hitstop = Math.max(0, hitstop - dt);
    if (!paused) {
      for (let left = dt; left > 1e-6; left -= 0.05) step(Math.min(left, 0.05), frozen);
    }
    if (!frozen) draw(t);

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
        // スコアで伸びたダッシュのぶん(秒)。ゲージは正規化されていて長さが見えないので、
        // 伸びていること自体はリールの中央に数字で出す
        dashBonus: dashBonusOf(player),
        guard: player.guard > 0 || player.guardStock > 0,
        guardStock: player.guardStock,
        // 湧水の再装填。0 なら次のゾーンで1個もらえる
        springT: player.springT,
        boost: !player.winded && player.stam > 0,
        boosting: player.boost && !player.winded && player.stam > 0,
        humans: net ? world.humans() : 0,
        board: board.map((s) => ({
          name: s.name, mass: Math.round(s.mass), me: s === player, human: s.nid[0] !== 'b',
        })),
        edge: player.alive ? clamp((180 - arena.edgeDist(player.x, player.y)) / 140, 0, 1) : 0,
        // ボスの残り耐久。ボスの居ないエリアでは null で、HUD 側がバーごと畳む
        boss: world.boss
          ? {
            name: world.boss.def.name, hp: world.boss.hp, max: world.boss.def.hp,
            hit: world.boss.iframe > 0,
          }
          : null,
        // 裏ボスが湧くまでの残り秒数。0 なら HUD 側は何も出さない
        bossRevive: world.reviveT,
        // 続けて食べた数。EAT_GAP 空いたら 0（HUD 側がフェードで畳む）
        combo: performance.now() - lastEat > EAT_GAP ? 0 : combo,
        // 前回の HUD から後に自分が倒した相手の名前（HUD 側がキルフィードに積む）
        feed,
      });
      feed = [];
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // デバッグ用の覗き穴（コンソールから盤面を確認する）。裏で回る attract に奪わせない
  if (!attract) window.__sz = { cam, sharks, player, food, W, arena, fx };

  return {
    stop() {
      running = false; dead = true;
      if (!attract) sfx.dash(false);   // 押したまま抜けてもフィルムは止める
      hush();                          // 震えたまま盤面を畳まない
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
