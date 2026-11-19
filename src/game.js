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
import {
  TRAIN_W, TRAIN_CAR, TRAIN_GAP, TRAIN_CARS, TRAIN_LEN,
  trainRuns, trainNearest, clackVol,
} from './train.js';

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
// 1位の王冠（#5）。大きさは画面 px で、引きの絵でも同じ大きさに見せる。
// 色は自機の名前と「あなた」の目印の YELLOW と分けて、明るい金にする
const CROWN_W = 30, CROWN_H = 20;
const CROWN_GAP = 4;   // 名前の上端と王冠の下端のすき間（画面 px）
const CROWN_GOLD = '#ffd84a';
// 王冠を移すのは、今の持ち主よりこの割合以上重くなってから。抜きつ抜かれつの間に
// 王冠がフレームごとに行き来してちらつかないようにする（順位表の1位も王冠に合わせる）
const CROWN_SWAP = 1.03;

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

// 多摩川の水の色。帯の順（河川敷＝浅瀬 → 流れ → 急流）に1色ずつ。帯の数と揃える。
// 間は流速で補間する（drawCurrent）ので、帯の境目でも色の段は出ない
const RIVER_COLORS = ['#5fb7ad', '#2f8a8f', '#18575f'];
// 水色の不透明度（流速 0 → 最大）。深い帯ほど濃く塗って、下に敷いた川底の石を沈ませる
const RIVER_ALPHA = [0.62, 0.8];
// 流れていく落ち葉の色。くすんだ枯れ葉の1色。明るい黄緑にすると黄色い餌と同系色に見えて
// 張り合うので、暗く彩度を落とす。2色に分けると塗りが1回増え、スマホ横の fps に響いた
// （描画命令は種類ごとに1回なので、色の数がそのまま回数になる）
const LEAF_COLOR = '#8c8a4e';
// 落ち葉の画面上の長さ(px)。この幅で葉ごとにばらつかせる。餌（画面上 20px 前後）より
// ひと回り小さくして、拾える物と見間違えないようにする
const LEAF_PX = [10, 14];
// 泡の塊の粒の並び（中心からのずれ・半径の倍率）。粒ごとに配列を作らないよう外に置く
const FOAM_DX = [0, 1.7], FOAM_DY = [0, -0.8], FOAM_R = [1, 0.7];
// 漂流物の行の間隔(px)。急流ほど詰める（drawCurrent の drifts）。旧 streaks の 240 より
// 詰めたのは、線より物のほうが小さく、同じ間隔だと餌に紛れて川面がまばらに見えるため
const DRIFT_GAP = 150;
// 京王相模原線の鉄橋（京王多摩川〜京王よみうりランド）。外接矩形の u（左＝上流が 0）で、
// 実際の位置ではなく、一本道の中ほど（要調整）。影の幅と橋脚の間隔は px。
// 鉄橋は同じ幅のものを2本、流れの向きに並べる（上り線・下り線）。KEIO_BRIDGE_U は2本の真ん中
const KEIO_BRIDGE_U = 0.5;
const KEIO_BRIDGE_W = 130;
const KEIO_PIER_GAP = 420;
// 2本の鉄橋のすき間(px)。幅（130px）の 0.6倍。幅の半分より詰めると引きの絵で1本の太い帯に
// つぶれて見え、幅と同じだけ空けると別々の橋に見える。「並んだ2本」に見える間を取った
const KEIO_BRIDGE_SPACE = 80;
// 鉄橋を渡る電車の影の寸法・速さ・間隔（TRAIN_*）は src/train.js。音（N7b、電車の通過音）と共有する
// 川底の石を撒く升の大きさ(px)。升ごとに 1〜2個。水面のドット（60px 間隔の小さな四角）と
// 見分けが付くよう、間隔も石の大きさも水のドットよりずっと大きく取る
const STONE_CELL = 240;
// 石の Path2D を取っておく塊の大きさ(px)。STONE_CELL の倍数
const STONE_CHUNK = STONE_CELL * 6;
// これより引いた絵では川底の石を敷かない（石が画面上 4px 前後の点になる）
const STONE_MIN_ZOOM = 0.45;

/** 小数部だけ取り出す。泡の散らばりを添字から作るのに使う（乱数を持つと端末ごとに絵が割れる） */
const frac = (n) => n - Math.floor(n);

/**
 * #rrggbb にアルファを足す。グラデーションの端を透明へ落とすときに使う ——
 * 'transparent' は「透明な黒」なので、混ぜると縁が黒ずむ。
 */
function hexA(hex, a) {
  return hex + Math.round(clamp(a, 0, 1) * 255).toString(16).padStart(2, '0');
}

/** #rrggbb どうしを k(0..1) で混ぜて #rrggbb で返す。多摩川の帯の水色の補間に使う */
function mixHex(a, b, k) {
  let out = '#';
  for (let i = 1; i < 7; i += 2) {
    const x = parseInt(a.slice(i, i + 2), 16), y = parseInt(b.slice(i, i + 2), 16);
    out += Math.round(x + (y - x) * k).toString(16).padStart(2, '0');
  }
  return out;
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

// 水底（#9）。「水没した調布」が、ギミックの無いマップでも伝わるように、
// 水の底に沈んだ街区・路地・森・草地をうっすら敷く。
// dotTile と同じく、起動時にそのマップの分だけタイル1枚を作って、draw() では
// fill(outline) 1回で敷き詰める（描く図形がどれだけ細かくても毎フレームの描画回数は変わらない）。
// 大きさは 1辺 FLOOR_TILE px（512×512×4 = 1MB）。
// 引きの絵（zoom 0.34）では 512px が画面 174px まで縮むので、線は太め（ワールド 8px 以上）、
// 建物や樹冠は 20px 以上にして、にじんで灰色の面にならないようにする。
// 濃さは線・面とも 0.06〜0.14。上に乗る餌・サメ・ギミックより必ず弱くする。
const FLOOR_TILE = 512;
// 水底の2色。暗い方（建物）は場外の色に寄せ、明るい方（道）は PAPER
const FLOOR_DARK = '#0c2629';
const FLOOR_LIGHT = '#f4efea';
// 水面のきらめき。以前の dotTile（4px 角・60px 間隔・.10）を、タイルの中に描き込んで残す。
// 間隔だけは 512 を割り切れる 64 にする（60 だとタイルの継ぎ目で間隔が乱れる）
const SPARKLE = { gap: 64, size: 4, color: 'rgba(244,239,234,.10)' };

/** 水底の乱数。シード固定で、開くたびに同じ街が沈んでいる（mulberry32） */
function floorRand(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * タイルに1層を重ねる。draw は不透明な色で描き、層ごと alpha で薄めて載せる ——
 * 半透明のまま図形を重ねると、道の交差点や樹冠の重なりだけ濃くなって斑になるため。
 * draw は上下左右と斜めの9か所にずらして呼ぶので、タイルの端からはみ出した図形は
 * 反対側の端に続きが描かれ、敷き詰めたときに継ぎ目が出ない。
 * cut があれば、同じ層から destination-out で抜く（家の上を路地が通らないように、など）
 */
function floorLayer(g, scratch, color, alpha, draw, cut) {
  const s = FLOOR_TILE;
  const h = scratch.getContext('2d');
  h.setTransform(1, 0, 0, 1, 0, 0);
  h.globalCompositeOperation = 'source-over';
  h.clearRect(0, 0, s, s);
  const wrap = (fn) => {
    for (const dx of [-s, 0, s]) {
      for (const dy of [-s, 0, s]) {
        h.setTransform(1, 0, 0, 1, dx, dy);
        fn(h);
      }
    }
    h.setTransform(1, 0, 0, 1, 0, 0);
  };
  h.fillStyle = h.strokeStyle = color;
  h.lineCap = h.lineJoin = 'round';
  wrap(draw);
  if (cut) {
    h.globalCompositeOperation = 'destination-out';
    h.fillStyle = h.strokeStyle = '#000';
    wrap(cut);
    h.globalCompositeOperation = 'source-over';
  }
  g.globalAlpha = alpha;
  g.drawImage(scratch, 0, 0);
  g.globalAlpha = 1;
}

/** 折れ線（点の配列）を path に足す */
function polyPath(h, pts) {
  h.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) h.lineTo(pts[i][0], pts[i][1]);
}

// 調布駅・布田: 街区。横に抜ける通りと、帯ごとに位置のずれた縦の路地、区画の中の建物。
// 映画のまちなので、区画の1つにフィルムの帯（縁の穴）を沈めておく。
// 以前は太い通りが縦横1本ずつタイルを貫く格子で、引きの絵（質量 40000）では 512px ごとに
// 同じ大きな四角が並び、タイルの繰り返しが見えていた。そこで
//   - 太い通りは横の1本（甲州街道）だけにし、縦の太い通り（駅前通り）は途中の路地で突き当たらせる
//   - 縦の路地は、横の通りで区切った帯ごとに位置を変える（T字路にして、格子の線を通さない）
//   - 横の通りの間隔も揃えない
// で、区画の大きさにばらつきを出し、四角の並びが目で追えないようにした
function floorChofu(g, scratch) {
  const s = FLOOR_TILE;
  const rnd = floorRand(0xc40f);
  // 横の通り [中心 y, 幅]。タイルを端から端まで抜ける。最初が甲州街道（太い通り）
  const hy = [[104, 28], [262, 10], [378, 12]];
  // 帯（横の通りと次の横の通りの間）の上端・下端。最後の帯はタイルの端をまたいで次のタイルの甲州街道まで
  const bands = hy.map(([y, w], i) => {
    const [y2, w2] = hy[(i + 1) % hy.length];
    return [y + w / 2, (i + 1 < hy.length ? y2 : y2 + s) - w2 / 2];
  });
  // 帯ごとの縦の路地 [中心 x, 幅]。帯をまたいで線がつながらないよう、位置を帯ごとにずらす。
  // 幅 22 の 1本が駅前通り（甲州街道から2本目の横の通りまでで、3つ目の帯では突き当たる）
  const vx = [
    [[34, 10], [148, 10], [232, 22], [352, 10], [458, 12]],
    [[78, 12], [232, 22], [318, 10], [436, 10]],
    [[20, 10], [124, 12], [288, 10], [392, 10]],
  ];
  // 帯の中で途中まで入る横の路地（行き止まり）[帯, x0, x1, 中心 y の帯の上端からの位置, 幅]
  const stubs = [[0, 148, 352, 70, 8], [2, 288, 512 + 20, 104, 8]];
  const roads = (h) => {
    for (const [y, w] of hy) h.fillRect(0, y - w / 2, s, w);
    vx.forEach((list, b) => {
      const [y0, y1] = bands[b];
      for (const [x, w] of list) h.fillRect(x - w / 2, y0, w, y1 - y0);
    });
    for (const [b, x0, x1, dy, w] of stubs) h.fillRect(x0, bands[b][0] + dy - w / 2, x1 - x0, w);
  };
  // 区画（帯の中の、縦の路地と縦の路地の間）。最後の区画はタイルの端をまたぐ
  const blocks = [];
  vx.forEach((list, b) => {
    const [y0, y1] = bands[b];
    list.forEach(([x, w], i) => {
      const [x2, w2] = list[(i + 1) % list.length];
      const bx0 = x + w / 2, bx1 = (i + 1 < list.length ? x2 : x2 + s) - w2 / 2;
      // 行き止まりの路地が通る区画は、路地の上下2つに分ける
      const st = stubs.find(([sb, sx0, sx1]) => sb === b && sx0 <= bx0 && sx1 >= bx1);
      if (st) {
        const cy = y0 + st[3];
        blocks.push([bx0, y0, bx1, cy - st[4] / 2], [bx0, cy + st[4] / 2, bx1, y1]);
      } else {
        blocks.push([bx0, y0, bx1, y1]);
      }
    });
  });
  const film = 7;   // フィルムの帯を沈める区画（2つ目の帯の、駅前通りの西）
  const park = 12;  // 建物を建てない区画（公園・空き地）。引きの絵での抜けにする
  // 建物は2層に分けて濃さを少し変える（.11 と .14）。同じ濃さの四角が並ぶより、繰り返しが目立たない
  const bld = [[], []];
  blocks.forEach(([x0, y0, x1, y1], i) => {
    if (i === film || i === park) return;
    const m = 7, gap = 7;
    const bw = x1 - x0 - m * 2, bh = y1 - y0 - m * 2;
    // 大きな区画ほど細かく割る。たまに区画まるごと1棟（駅ビル・映画館）
    const big = rnd() < 0.2;
    const cols = big ? 1 : Math.max(1, Math.round(bw / (36 + rnd() * 40)));
    const rows = big ? 1 : Math.max(1, Math.round(bh / (40 + rnd() * 50)));
    // 列の幅・行の高さも揃えない（割り目を乱数でずらす）
    const cuts = (n, len) => {
      const w = Array.from({ length: n }, () => 0.6 + rnd() * 0.8);
      const sum = w.reduce((a, b) => a + b, 0);
      const free = len - gap * (n - 1);
      let at = 0;
      return w.map((k) => { const seg = [at, free * k / sum]; at += seg[1] + gap; return seg; });
    };
    for (const [cx, cw] of cuts(cols, bw)) {
      for (const [ry, rh] of cuts(rows, bh)) {
        if (!big && rnd() < 0.15) continue;     // 空き地
        bld[rnd() < 0.5 ? 0 : 1].push([x0 + m + cx, y0 + m + ry, cw, rh]);
      }
    }
  });
  floorLayer(g, scratch, FLOOR_DARK, 0.14, (h) => {
    for (const [x, y, w, hh] of bld[1]) h.fillRect(x, y, w, hh);
  });
  // フィルムの帯は薄い方の層に入れる。タイルに1つしかない目印なので、濃いと引きの絵で
  // 512px ごとに同じ模様が並ぶのがいちばん目につく
  const [fx0, fy0, fx1, fy1] = blocks[film];
  const fm = 10, fw = fx1 - fx0 - fm * 2, fh = fy1 - fy0 - fm * 2;
  floorLayer(g, scratch, FLOOR_DARK, 0.11, (h) => {
    for (const [x, y, w, hh] of bld[0]) h.fillRect(x, y, w, hh);
    h.fillRect(fx0 + fm, fy0 + fm, fw, fh);
  }, (h) => {
    // フィルムの縁の穴（上下2列）と、コマの窓
    const hw = 9, hh = 7, step = 18;
    for (let x = fx0 + fm + 6; x + hw < fx1 - fm - 4; x += step) {
      h.fillRect(x, fy0 + fm + 6, hw, hh);
      h.fillRect(x, fy1 - fm - 6 - hh, hw, hh);
    }
    const iy0 = fy0 + fm + 6 + hh + 8, iy1 = fy1 - fm - 6 - hh - 8;
    const n = 2, iw = (fw - 12 - 8 * (n - 1)) / n;
    for (let k = 0; k < n; k++) h.fillRect(fx0 + fm + 6 + k * (iw + 8), iy0, iw, iy1 - iy0);
  });
  floorLayer(g, scratch, FLOOR_LIGHT, 0.07, roads);
}

// つつじヶ丘・仙川: 細い路地が斜めに入り組んだ住宅地。
// 路地は端と端の高さ（横なら y、縦なら x）を揃えたジグザグにして、タイルの継ぎ目でつながるようにする
function floorSengawa(g, scratch) {
  const s = FLOOR_TILE;
  const rnd = floorRand(0x5e9a);
  // 横向きの路地: x = 0, 128, 256, 384, 512 での y。最初と最後を同じにする
  const hz = [[60, 112, 150, 90, 60], [250, 210, 290, 330, 250], [400, 460, 430, 380, 400]];
  // 縦向きの路地: y = 0, 128, 256, 384, 512 での x
  const vt = [[120, 170, 130, 80, 120], [330, 300, 370, 420, 330]];
  const lines = [
    ...hz.map((ys) => ys.map((y, i) => [i * 128, y])),
    ...vt.map((xs) => xs.map((x, i) => [x, i * 128])),
  ];
  const wide = 1;   // 1本だけ少し広い通り（駅前の商店街）
  const alleys = (pad) => (h) => {
    lines.forEach((pts, i) => {
      h.lineWidth = (i === wide ? 18 : 9) + pad;
      h.beginPath(); polyPath(h, pts); h.stroke();
    });
  };
  // 家。少し揺らした格子に、少し回した小さな矩形を置く
  const houses = [];
  for (let y = 0; y < s; y += 46) {
    for (let x = 0; x < s; x += 46) {
      if (rnd() < 0.25) continue;
      houses.push([x + rnd() * 14, y + rnd() * 14, 20 + rnd() * 14, 18 + rnd() * 12, (rnd() - 0.5) * 0.9]);
    }
  }
  // 水の色（#285868）が暗いので、家は調布駅より少し濃くしないと引きの絵で消える
  floorLayer(g, scratch, FLOOR_DARK, 0.14, (h) => {
    for (const [x, y, w, hh, a] of houses) {
      h.save(); h.translate(x, y); h.rotate(a); h.fillRect(-w / 2, -hh / 2, w, hh); h.restore();
    }
  }, alleys(12));
  floorLayer(g, scratch, FLOOR_LIGHT, 0.07, alleys(0));
}

// 深大寺: 森。樹冠（丸の重なり）と、その間を抜ける参道。
// 湧水の石組み（#8）と色がぶつからないよう、緑は暗く沈める
function floorJindaiji(g, scratch) {
  const s = FLOOR_TILE;
  const rnd = floorRand(0x1da1);
  // 参道。少しだけ曲がりながら縦に抜ける（y = 0 と 512 で x を揃える）
  const path = [[256, 0], [244, 128], [262, 256], [282, 384], [256, 512]];
  const pathX = (y) => {
    const i = Math.min(3, Math.floor(y / 128)), k = (y - i * 128) / 128;
    return path[i][0] + (path[i + 1][0] - path[i][0]) * k;
  };
  // 木のかたまり（木立）。以前は小さめの樹冠（半径 24〜46）を 46 個まんべんなく撒いていて、
  // 引きの絵では丸と隙間が同じくらいの大きさで混ざり、迷彩柄（苔）に見えた。
  // そこで、大きな木立（長径 84〜118 の楕円）を少なく置き、木立と木立の間に下草の抜けを残す。
  // 木立は芯の楕円に、大小の樹冠の丸を不揃いに重ねて縁を波打たせる
  // （縁に丸を等間隔に並べると、引きの絵で花の判子に見えた）
  const groves = [];
  const PATH_CLEAR = 104;   // 参道の両脇で木を抜く幅（灯籠の外側まで）
  const GAP = 12;   // 木立どうしの最小の隙間（抜け）
  for (let n = 0; groves.length < 6 && n < 800; n++) {
    const x = rnd() * s, y = rnd() * s;
    const rx = 84 + rnd() * 34, ry = 58 + rnd() * 24, rot = rnd() * Math.PI;
    const r = (rx + ry) / 2;
    // ほかの木立と重ねない（タイルの継ぎ目をまたいだ距離で見る）
    const near = groves.some(([gx, gy, gr]) => {
      let dx = Math.abs(x - gx), dy = Math.abs(y - gy);
      dx = Math.min(dx, s - dx); dy = Math.min(dy, s - dy);
      return Math.hypot(dx, dy) < r + gr + GAP;
    });
    if (near) continue;
    // 樹冠の丸。楕円の外寄りに不揃いに散らし（中は芯が埋める）、半径は 18〜38 とばらつかせる
    const crowns = [];
    const k = 12 + Math.floor(rnd() * 5);
    for (let i = 0; i < k; i++) {
      const a = rnd() * TAU, t = 0.5 + rnd() * 0.5;
      const lr = 18 + rnd() * 20;
      const ex = Math.cos(a) * (rx - lr) * t, ey = Math.sin(a) * (ry - lr) * t;
      crowns.push([x + ex * Math.cos(rot) - ey * Math.sin(rot), y + ex * Math.sin(rot) + ey * Math.cos(rot), lr]);
    }
    groves.push([x, y, r, rx, ry, rot, crowns]);
  }
  floorLayer(g, scratch, '#0e3a2c', 0.11, (h) => {
    h.beginPath();
    for (const [x, y, , rx, ry, rot, crowns] of groves) {
      // 芯（木立の中は隙間なく埋める）
      h.moveTo(x + Math.cos(rot) * rx * 0.62, y + Math.sin(rot) * rx * 0.62);
      h.ellipse(x, y, rx * 0.62, ry * 0.62, rot, 0, TAU);
      for (const [cx, cy, lr] of crowns) { h.moveTo(cx + lr, cy); h.arc(cx, cy, lr, 0, TAU); }
    }
    h.fill('nonzero');
  }, (h) => {
    // 参道と石灯籠の上は木を抜く。木立を参道から離して置くと、大きな木立はタイルに
    // 2つしか入らなかったので、木立は自由に置き、参道の幅で切り開く
    h.lineWidth = PATH_CLEAR;
    h.beginPath(); polyPath(h, path); h.stroke();
  });
  // 参道と、両脇の石灯籠。敷石の目地も描いてみたが、引きの絵で梯子（線路）に見えたのでやめた
  floorLayer(g, scratch, FLOOR_LIGHT, 0.07, (h) => {
    h.lineWidth = 30;
    h.beginPath(); polyPath(h, path); h.stroke();
    for (let y = 40; y < s; y += 128) {
      for (const side of [-1, 1]) h.fillRect(pathX(y) + side * 32 - 6, y - 6, 12, 12);
    }
  });
}

// 調布飛行場: 草地と誘導路。滑走路本体は #6 が水底に描くので、ここには入れない
function floorAirport(g, scratch) {
  const s = FLOOR_TILE;
  // 誘導路: タイルの縦（y 方向）に平行な2本と、その間をつなぐ短い連絡路1本。
  // タイルは startGame で滑走路の向き（17/35）に回して敷くので、縦の2本は滑走路と平行になる。
  // 横・縦・45°の斜めで組んでいたころは、引きの絵で網（方眼紙）に見えた
  const ways = (h) => {
    h.beginPath();
    h.moveTo(120, 0); h.lineTo(120, s);
    h.moveTo(380, 0); h.lineTo(380, s);
    h.moveTo(120, 300); h.lineTo(380, 300);
    h.stroke();
  };
  floorLayer(g, scratch, '#3f8a52', 0.09, (h) => h.fillRect(0, 0, s, s));
  // 草むら。草地の中に、少し濃い不揃いの斑を置く
  // （刈り込みの縞も描いてみたが、誘導路と合わさって格子柄の布のように見えたのでやめた）
  const rnd = floorRand(0xa1e0);
  floorLayer(g, scratch, FLOOR_DARK, 0.06, (h) => {
    h.beginPath();
    for (let k = 0; k < 9; k++) {
      const x = rnd() * s, y = rnd() * s, rx = 40 + rnd() * 30;
      h.moveTo(x + rx, y);
      h.ellipse(x, y, rx, 24 + rnd() * 18, 0, 0, TAU);
    }
    h.fill();
  });
  // 誘導路は草地寄りの暗い色にして沈める。明るい線や黄の中心線は、#6 の滑走路と主役を取り合った
  floorLayer(g, scratch, '#123d33', 0.12, (h) => { h.lineWidth = 24; ways(h); });
}

// マップ別の水底。ここに無いマップは水底を敷かず、きらめき（dotTile）だけ。
// 多摩川は #7 が川底（石）を描くので、ここには入れない
const FLOOR_ART = {
  chofu: floorChofu,
  sengawa: floorSengawa,
  jindaiji: floorJindaiji,
  airport: floorAirport,
};

/** そのマップの水底タイル（水面のきらめき込み）。起動時に1回だけ作る */
function floorTile(id) {
  const art = FLOOR_ART[id];
  if (!art) return dotTile();
  const c = document.createElement('canvas');
  c.width = c.height = FLOOR_TILE;
  const scratch = document.createElement('canvas');
  scratch.width = scratch.height = FLOOR_TILE;
  const g = c.getContext('2d');
  art(g, scratch);
  scratch.width = 0;   // 作業用の canvas は作り終えたら手放す
  g.fillStyle = SPARKLE.color;
  for (let y = 0; y < FLOOR_TILE; y += SPARKLE.gap) {
    for (let x = 0; x < FLOOR_TILE; x += SPARKLE.gap) g.fillRect(x, y, SPARKLE.size, SPARKLE.size);
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
  // 水底（#9）。そのマップの分だけ、起動時に1枚作る
  const floor = ctx.createPattern(floorTile(map.id), 'repeat');
  // 飛行場は誘導路が滑走路と平行になるよう、タイルを滑走路の向きに回して敷く
  // （タイルの縦 = +y = 90° を runway.ang に合わせる）。回しても fill 1回のまま
  if (map.id === 'airport' && gim?.runway && floor.setTransform) {
    floor.setTransform(new DOMMatrix().rotate((gim.runway.ang - Math.PI / 2) * 180 / Math.PI));
  }

  const fx = [];
  // 手応え（#4）。hitstop は絵を止めている残り秒数（実時間）。
  // combo は続けて食べた数、lastEat はその最後の時刻(ms)。数え方は audio.js の音の連鎖と同じ
  // （EAT_GAP 以内に次を食べたら +1）。feed は前回の HUD から後に自分が倒した相手（{ name, ruby }）、
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
   * 死因の文字列から「自分が倒したか」を決める。名前が一致するだけでは足りない ——
   * 名前を空欄にすると全員が 'PLAYER' になり（server の clean()）、オフラインでも
   * BOT_NAMES と同じ名前を付けられる。同じ名前のサメが他に居るときだけ、死んだ点が
   * 自分の胴（または航跡）の近くかでも絞る。距離は互いの半径 + 80px（オンラインの座標は
   * 予測でずれるので余裕をとる）。同名が居なければ名前だけで決める
   */
  const KILL_NEAR = 80;
  function killedByMe(s, cause) {
    const how = cause === `${myName} の胴体` ? 'body' : cause === `${myName} の泳いだ跡` ? 'wake' : null;
    if (!how) return false;
    if (!sharks.some((o) => o !== player && o.name === myName)) return true;
    const pts = how === 'body' ? player.body : player.wake;
    const reach = radiusOf(s.mass) + radiusOf(player.mass) + KILL_NEAR;
    return pts.some((p) => (p.x - s.x) ** 2 + (p.y - s.y) ** 2 < reach * reach);
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
        // オンラインでも死因はサーバの文字列がそのまま来る
        const byMe = !attract && killedByMe(s, e.cause);
        if (byMe) {
          myKills++;
          feed.push({ name: s.name });
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
        // 自分が倒したなら撃破と同じ手応え（止める・フィード）。深大寺はシングルなので
        // by は手元の sim が持っている（死因の文字列で見分ける必要は無い）
        if (e.by === player) {
          // ボスの名前は data.js のルビ記法なので、HUD 側で rubify させる（利用者の名前は esc だけ）
          feed.push({ name: s.def.name, ruby: true });
          hitstop = HITSTOP;
        }
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

    // 1位の王冠。名前を出さない引きの絵でも出す（狙う目標なので）
    const named = cam.zoom > 0.4 || s === player || s.isBoss;
    if (s === crowned) drawCrown(s, named);

    // 名前
    if (named) {
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
   * 格子の添字から 0..1 の値を作る。漂流物の種類・ずれ・回り方を決める種で、
   * 乱数を持たない（frac と同じ考え方）—— 同じ添字なら、どの端末で何度描いても同じ物になる
   */
  const hash = (i, row, k) => frac(Math.sin(i * 127.1 + row * 311.7 + k * 74.7) * 43758.5453);

  /**
   * 1つの帯の漂流物（落ち葉・泡）と、急流なら白波を、流れの座標系の Path2D へ積む。
   * 描くのは呼び側が全部の帯を積み終えてから、種類ごとに1回だけ。
   *
   * 格子と流し方は旧 streaks と同じ —— flowBox で流れの座標系へ移し、行ごとの位相に
   * t * speed を足すだけ。粒の位置は u = off + i * span で、添字 i は流れても変わらないので、
   * 1つの物が途中で別の物に化けたり、1個ずつ巻き戻ったりしない。
   * 速さは帯の流速そのもの（world px/s）なので、急流の葉は 110px/s で流れていく。
   *
   * 格子は流れの座標系の外接矩形に張るので、斜めにはみ出た角（帯の外）の升も回ってしまう。
   * そこは世界座標へ戻して帯の矩形と比べ、Path に積まずに飛ばす（数えもしない）。
   * cap は保険。いちばん引いた絵（zoom 0.34、1280 幅）で急流 1帯 350 個ほど、4K 幅でも
   * 900 個ほどなので 1200 なら切り捨ては見えない。1本の Path なので個数は fill の回数に響かない。
   */
  function drifts(t, speed, strength, box, art, cap = 1200) {
    const ang = gim.def.dir;
    const { u0, u1, v0, v1 } = flowBox(ang, box);
    const co = Math.cos(ang), si = Math.sin(ang);
    const z = cam.zoom;
    const gap = DRIFT_GAP - strength * 40;   // 流れに直交する行の間隔
    const span = gap * 1.5;                  // 流れに沿った物の間隔
    const pad = span;                        // ずらしたぶん、画面の縁で物が生え際を見せない
    // 流れの座標 (u, v) の点が帯の矩形に入るか。左右（画面の縁）は pad だけ広げて生え際を隠し、
    // 上下（帯の境目）は広げない —— 広げると隣の河川敷へ物がはみ出して「止まった浅瀬」が崩れる
    // （box.b0/b1 が帯そのものの上下端、box.y0/y1 はそれを画面で切ったもの）
    const top = Math.max(box.y0 - pad, box.b0), bottom = Math.min(box.y1 + pad, box.b1);
    const near = (u, v) => {
      const x = u * co - v * si, y = u * si + v * co;
      return x > box.x0 - pad && x < box.x1 + pad && y > top && y < bottom;
    };
    // 引きの絵（スマホ横は zoom 0.22 まで下がる）で点にならないよう、画面上の大きさに下限を持つ
    // （drawSprings の泡が 4.5 / cam.zoom を下限にしているのと同じ）
    const foamMin = 1.6 / z;
    let n = 0;
    for (let row = Math.ceil((v0 - gap) / gap); row * gap <= v1 + gap && n < cap; row++) {
      // 行ごとに位相をずらす。揃えると格子に見えて水に見えない
      const off = t * speed + row * span * 0.37;
      for (let i = Math.ceil((u0 - pad - off) / span); off + i * span <= u1 + pad && n < cap; i++) {
        if (!near(off + i * span, row * gap)) continue;
        const kind = hash(i, row, 0);
        if (kind > 0.8) continue;            // 2割は空けておく。全部埋めると格子が透ける
        const h1 = hash(i, row, 1), h2 = hash(i, row, 2), h3 = hash(i, row, 3);
        const u = off + i * span + (h1 - 0.5) * span * 0.6;
        const v = row * gap + (h2 - 0.5) * gap * 0.6 + Math.sin(t * 0.9 + h1 * TAU) * gap * 0.04;
        n++;
        if (kind < 0.42) {
          // 引きの絵（川底の石を省く倍率より引いた絵）では葉を描かない。点になって餌と紛れる
          if (z < STONE_MIN_ZOOM) continue;
          // 落ち葉。大きさは画面上の px で決め（LEAF_PX）、向きは流れの向き ±30° に揃えて
          // ゆっくり揺らす（向きも揺れ方も添字で決まる）。流れに乗っている物だと読めるように
          const rx = (LEAF_PX[0] + (LEAF_PX[1] - LEAF_PX[0]) * h3) / 2 / z, ry = rx * 0.42;
          const rot = (h1 - 0.5) * 0.7 + Math.sin(t * 0.8 + h2 * TAU) * 0.15;
          const p = art.leaf;
          // ellipse は直前の点から線を引いてしまうので、楕円の始点へ先に飛んでおく
          p.moveTo(u + Math.cos(rot) * rx, v + Math.sin(rot) * rx);
          p.ellipse(u, v, rx, ry, rot, 0, TAU);
        } else {
          // 泡。小さな丸の2個の塊
          const r = Math.max(3.2 + 2.4 * h3, foamMin);
          // 引きの絵では塊の粒が潰れて見分けられないので1粒だけ積む（ellipse/arc の数を減らす）
          const blobs = z < 0.5 ? 1 : 2;
          for (let k = 0; k < blobs; k++) {
            const bx = u + FOAM_DX[k] * r, by = v + FOAM_DY[k] * r;
            const br = r * FOAM_R[k];
            art.foam.moveTo(bx + br, by);
            art.foam.arc(bx, by, br, 0, TAU);
          }
        }
      }
    }

    // 白波は急流（旧 streaks の白波と同じ strength > 0.7）だけ。流れに直交する短い弧を、
    // 漂流物と格子をずらして置く。水と一緒に流しながら、それぞれの拍子で立っては消える
    if (strength <= 0.7) return;
    const cg = gap * 1.3, cs = span * 0.8;
    const capMin = 6 / z, capW = Math.max(3, 1.6 / z);
    n = 0;
    for (let row = Math.ceil((v0 - cg) / cg); row * cg <= v1 + cg && n < cap; row++) {
      const off = t * speed + row * cs * 0.61 + cs * 0.5;
      const v = row * cg + cg * 0.5;
      for (let i = Math.ceil((u0 - pad - off) / cs); off + i * cs <= u1 + pad && n < cap; i++) {
        if (!near(off + i * cs, v)) continue;
        const h1 = hash(i, row, 5), h2 = hash(i, row, 6);
        const s = Math.sin(t * 2.2 + h1 * TAU);
        if (s < 0.15) continue;              // 寝ている間は描かない（立つ・崩れるの繰り返し）
        const R = Math.max((16 + 12 * h2) * (0.4 + 0.6 * s), capMin);
        const cu = off + i * cs + (h2 - 0.5) * cs * 0.5, cv = v + (h1 - 0.5) * cg * 0.4;
        // 下流側へふくらむ弧。中心を上流側へ R ずらし、±0.9rad だけ描く
        // 線で引くと塗りとは別に stroke が1回要るので、太さ w の三日月形にして泡と同じ Path で塗る
        art.foam.moveTo(cu - R + Math.cos(-0.9) * R, cv + Math.sin(-0.9) * R);
        art.foam.arc(cu - R, cv, R, -0.9, 0.9);
        art.foam.arc(cu - R, cv, R - capW, 0.9, -0.9, true);
        art.foam.closePath();
        n++;
      }
    }
  }

  /**
   * 川底の石。升（STONE_CELL）ごとに 1〜2個、位置・大きさ・向きは升の添字だけで決まり、
   * 時間では動かない（川底なので流れない）。
   *
   * 以前はタイル1枚のパターンを画面いっぱいに塗っていたが、パターンの全面塗りは重く、
   * スマホ横の fps が目に見えて落ちた。石のある所だけを塗る Path にし、さらに石は動かないので、
   * STONE_CHUNK 四方の塊ごとに Path2D を初めて映ったときに1回だけ作って取っておく。
   * 毎フレームは映っている塊を addPath で1本に束ねて1回塗るだけ（石を1個ずつ積み直すと、
   * 引きの絵では1フレーム数百回の ellipse になり、描画の JS だけで数 ms 掛かっていた）
   */
  const stoneChunks = new Map();
  let bed = null, bedKey = '';   // 映っている塊を束ねた Path と、その範囲（drawCurrent）
  function stoneChunk(kx, ky) {
    const key = kx + ',' + ky;
    let p = stoneChunks.get(key);
    if (p) return p;
    p = new Path2D();
    const C = STONE_CELL, N = STONE_CHUNK / STONE_CELL;
    for (let cy = ky * N; cy < (ky + 1) * N; cy++) {
      for (let cx = kx * N; cx < (kx + 1) * N; cx++) {
        const h0 = hash(cx, cy, 11);
        const n = h0 < 0.55 ? 1 : 2;
        for (let k = 0; k < n; k++) {
          const h1 = hash(cx, cy, 12 + k * 3), h2 = hash(cx, cy, 13 + k * 3), h3 = hash(cx, cy, 14 + k * 3);
          const rx = 8 + 18 * h3 * h3;               // 小石が多く、大きな石は少ない
          const ry = rx * (0.55 + 0.3 * h1), rot = h2 * TAU;
          const x = (cx + h1) * C, y = (cy + h2) * C;
          p.moveTo(x + Math.cos(rot) * rx, y + Math.sin(rot) * rx);
          p.ellipse(x, y, rx, ry, rot, 0, TAU);
        }
      }
    }
    stoneChunks.set(key, p);
    return p;
  }

  let tint = null;     // 流れの帯の色。静的なので初回に1回だけ作る（drawCurrent 参照）
  let bridge = null;   // 京王線の鉄橋の影。これも静的なので初回に1回だけ作る

  /**
   * 京王相模原線の鉄橋の影。川を流れに直交して横切る暗い帯2本（上り線・下り線）と、
   * 流れに沿って細長い橋脚。2本は外接矩形の u（KEIO_BRIDGE_U）を通る、流れに直交する直線を
   * 真ん中に挟んで、流れの向きに KEIO_BRIDGE_SPACE だけ空けて並ぶ。橋脚の位置は2本でそろえる。
   * 見えている範囲との当たりを取るため、外接の矩形も一緒に返す。
   * track[0] が上流側、track[1] が下流側の鉄橋の中心線の、中心線からのずれ（流れの向き）
   */
  function bridgeArt() {
    if (bridge) return bridge;
    const bb = arena.bb, ang = gim.def.dir;
    const cx = bb.x0 + KEIO_BRIDGE_U * bb.w, cy = bb.y0 + bb.h / 2;
    // 流れに直交する向き（の単位ベクトル）と、流れの向き
    const nx = -Math.sin(ang), ny = Math.cos(ang), fx = Math.cos(ang), fy = Math.sin(ang);
    // 上下の端まで届く長さ（外は clip が落とす）。流れがほぼ横向きでない限り ny は 1 に近いが、
    // 縦に近い向きを data.js に書かれても無限に伸びないよう下限を入れる
    const half = (bb.h / 2) / Math.max(Math.abs(ny), 0.2) + 200;
    const w = KEIO_BRIDGE_W / 2;
    const d = (KEIO_BRIDGE_W + KEIO_BRIDGE_SPACE) / 2;   // 2本の中心線の、真ん中からのずれ
    const track = [-d, d];
    // along は流れに直交する向き、c0〜c1 は流れの向きの範囲
    const quad = (along0, along1, c0, c1) => {
      const p = new Path2D();
      const pts = [[along0, c0], [along1, c0], [along1, c1], [along0, c1]];
      pts.forEach(([a, c], k) => {
        const x = cx + nx * a + fx * c, y = cy + ny * a + fy * c;
        if (k) p.lineTo(x, y); else p.moveTo(x, y);
      });
      p.closePath();
      return p;
    };
    const shadow = new Path2D();
    for (const c of track) shadow.addPath(quad(-half, half, c - w, c + w));
    // 橋脚は流れに沿って細長い（水を切る形）。桁の影から上下へ少しだけ出して、一定の間隔で並べる。
    // 桁と同じ Path に足して1回で塗る —— 向きの揃った四角どうしなので、重なりは濃くならず
    // 和になる（橋脚は桁の縁から出た小さな出っ張りとして見える）。2本で同じ along に置くので、
    // 橋脚が流れの向きに一列にそろって、並んだ2本の橋に見える
    for (let a = -half + KEIO_PIER_GAP / 2; a < half; a += KEIO_PIER_GAP) {
      for (const c of track) shadow.addPath(quad(a - 16, a + 16, c - w - 12, c + w + 12));
    }
    const ac = d + w + 40;   // 流れの向きの広がり（2本ぶん）
    const ex = Math.abs(nx) * half + Math.abs(fx) * ac, ey = Math.abs(ny) * half + Math.abs(fy) * ac;
    return (bridge = { shadow, cx, cy, nx, ny, fx, fy, half, track, x0: cx - ex, x1: cx + ex, y0: cy - ey, y1: cy + ey });
  }

  /**
   * 電車の影の Path2D（初回に1回だけ作る）。編成の中心が原点、長手が x。
   * 両端の先頭車だけ角を落として運転台の顔にする —— 両端とも同じ形なので、
   * 上り・下りは向きを 180° 回すだけで済む。車両は向きの揃った四角なので、1本の Path に
   * 足して1回で塗る（すき間はそのまま抜けて、継ぎ目に見える）
   */
  let trainPath = null;
  function trainArt() {
    if (trainPath) return trainPath;
    const p = new Path2D();
    const w = TRAIN_W / 2, nose = TRAIN_W * 0.3;
    for (let i = 0; i < TRAIN_CARS; i++) {
      const x0 = -TRAIN_LEN / 2 + i * (TRAIN_CAR + TRAIN_GAP), x1 = x0 + TRAIN_CAR;
      const n0 = i === 0 ? nose : 0, n1 = i === TRAIN_CARS - 1 ? nose : 0;
      p.moveTo(x0 + n0, -w);
      p.lineTo(x1 - n1, -w);
      p.lineTo(x1, -w + n1);
      p.lineTo(x1, w - n1);
      p.lineTo(x1 - n1, w);
      p.lineTo(x0 + n0, w);
      p.lineTo(x0, w - n0);
      p.lineTo(x0, -w + n0);
      p.closePath();
    }
    return (trainPath = p);
  }

  /**
   * 鉄橋を渡る電車の影。2本の鉄橋をそれぞれ単線とみなし、下流側を下り、上流側を上りが通る。
   * 鉄橋ごとに TRAIN_PERIOD 秒に1本、上りは半周期遅れて走るので、全体では 10秒ごとに1本、
   * 鉄橋の端から端まで流れに直交して走り抜ける（すれ違う3秒ほどは2本同時に映る）。
   * 時刻は world.envT だけから出す（読むだけ）—— envT はスナップショットで全員にそろうので、
   * 同じ部屋なら同じ時に通り、乱数も使わない。envT は試合の始めが 0 なので、1本目（下り）は
   * 開始 6〜7秒で鉄橋の真ん中に来る。
   * 鉄橋の影の上に同じ色を薄く重ねるだけ（水面の影なので、他の物より派手にしない）。
   * Path2D は1つを使い回し、塗るのは電車1本につき1回
   */
  function drawTrain(br, view) {
    // 先頭が鉄橋の手前の端（-half）にいる所から、最後尾が向こうの端を抜けるまで（train.js）
    for (const run of trainRuns(world.envT, br.half)) {
      if (!run) continue;
      // 下りは +n 向き（画面の下、よみうりランド側へ）、上りは -n 向き。
      // 日本の鉄道は左側通行なので、進む向きの左の鉄橋を走る（+n の左は +f＝下流側）
      const { dir, head } = run;
      const a = dir * (head - TRAIN_LEN / 2);           // 編成の中心の、鉄橋の中心線に沿った位置
      const off = br.track[dir > 0 ? 1 : 0];
      const x = br.cx + br.nx * a + br.fx * off, y = br.cy + br.ny * a + br.fy * off;
      const R = TRAIN_LEN / 2 + TRAIN_W;                // 外接円の半径（ゆとり込み）
      if (x + R < view.x0 || x - R > view.x1 || y + R < view.y0 || y - R > view.y1) continue;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.atan2(br.ny * dir, br.nx * dir));
      ctx.fillStyle = 'rgba(16,31,35,.2)';   // 鉄橋の影（.28）に重ねて、ひと段だけ濃く
      ctx.fill(trainArt());
      ctx.restore();
    }
  }

  /**
   * 電車の音（N7 / N7b / N7c）。毎フレーム呼び、鉄橋ごとに、渡っている間だけ audio.js に
   * 「何本目か・渡り始めてからの秒数・音量・左右」を渡す（[下り, 上り] の2つ。渡っていない方は null）。
   * 録音（電車.mp3）の 0 秒が影が鉄橋に入った瞬間（trainRun の ph = 0）に当たり、途中から
   * 聞こえる所に来ても ph の所から鳴る。時刻は envT だけから出すので、同じ部屋の人には同じ所が鳴る。
   * 音量は聞き手（自機、居なければカメラの中心）とその編成のいちばん近い点の距離で決め
   * （train.js の clackVol）、左右は他の音と同じ spatial() の pan。すれ違う間は2本が別々に鳴る。
   * ポーズ・リザルト・多摩川以外では null を渡して両方止める。
   * attract（タイトルの裏の盤面）は何も渡さない —— 本編の音を止めにいかないため
   */
  function trainSound() {
    if (attract) return;
    if (paused || dead || gim?.kind !== 'current') { sfx.train(null); return; }
    const br = bridgeArt();
    const ear = player.alive ? player : cam;
    sfx.train(trainRuns(world.envT, br.half).map((run) => {
      if (!run) return null;
      const near = trainNearest(br, run, ear.x, ear.y);
      const v = clackVol(near.d);
      return { k: run.k, at: run.ph, v, pan: v > 0 ? spatial(near.x, near.y).pan : 0 };
    }));
  }

  /**
   * 多摩川の上下3帯。上＝河川敷（浅瀬・流れ無し）、中＝流れ、下＝急流。
   * 帯の色も漂流物の数・速さも sim.js の流速そのものから出すので、
   * 絵と盤面が食い違うことはない。
   *
   * 重ね順は 川底の石 → 帯の水色 → 漂流物・白波 → 鉄橋の影 → 電車の影。石を水色の下に敷くので、
   * 深い帯ほど水色が濃く（不透明に）なって石が沈んで見える。
   * 描画命令はいちばん多くても 石1・水色1・葉1・泡と白波1・鉄橋1・電車2（すれ違う間だけ）の 7回で、
   * 帯の数にも、映っている物の数にもよらない。
   */
  function drawCurrent(t, view) {
    const bb = arena.bb;
    const bands = gim.bands;
    const maxSpeed = Math.max(...bands.map((b) => b.speed));
    // 見えている範囲との重なり。エリアは 10536 × 5453 あるので、全面へ撒くと
    // 引きの絵で毎フレーム数千個になる（漂流物も石も、ここより外へは置かない）
    const vx0 = Math.max(view.x0, bb.x0), vx1 = Math.min(view.x1, bb.x1);
    const vy0 = Math.max(view.y0, bb.y0), vy1 = Math.min(view.y1, bb.y1);
    if (vx0 >= vx1 || vy0 >= vy1) return;

    // 川底の石。水色の下に敷くので、深い帯ほど沈んで見える。引きの絵（STONE_MIN_ZOOM 未満）では
    // 石が数 px の点になって水のドットと見分けが付かないので、敷かない
    if (cam.zoom >= STONE_MIN_ZOOM) {
      const K = STONE_CHUNK, m = 30;               // m: 隣の塊の石が縁から張り出す分（石の半径の上限 26）
      const kx0 = Math.floor((vx0 - m) / K), kx1 = Math.floor((vx1 + m) / K);
      const ky0 = Math.floor((vy0 - m) / K), ky1 = Math.floor((vy1 + m) / K);
      // 映っている塊の範囲が前のフレームと同じなら、束ねた Path をそのまま使う。
      // 塊は 1080px 四方なので、範囲が変わるのは泳いで塊の境をまたいだときだけ
      const key = kx0 + ',' + ky0 + ',' + kx1 + ',' + ky1;
      if (key !== bedKey) {
        bed = new Path2D();
        for (let ky = ky0; ky <= ky1; ky++) {
          for (let kx = kx0; kx <= kx1; kx++) bed.addPath(stoneChunk(kx, ky));
        }
        bedKey = key;
      }
      ctx.fillStyle = 'rgba(16,40,44,.4)';
      ctx.fill(bed);
    }

    // 帯の色。境目で切らず、流速を細かく引いた1本のグラデーションで溶かす ——
    // 帯ごとに矩形を敷くと、どの帯も自分の両端で透明に落ちて、境目に無着色の
    // 継ぎ目が出る。色は流速 0（浅瀬）→ 中 → 最大（急流）の3色を流速で補間し、
    // 不透明度も流速とともに上げる（深いほど底が見えない）。
    //
    // 中身は時間に依存しない —— currentSpeedAt(y) は windAt(0, y, 0) と時刻を 0 に
    // 固定して呼ぶので、答えは帯の設定だけで決まる。毎フレーム作り直していたころは、
    // 同じ25色を出すために currentSpeedAt 25回と文字列25本を捨てていた。
    // 初回に作る（＝カメラ変換の下で作る）のは前と同じ。グラデーションは塗る時点の
    // 変換で描かれるので、いつ作っても絵は変わらない
    if (!tint) {
      // 帯の流速を色の節にする（多摩川なら 0 / 48 / 110 → 浅瀬・中・急流の色）
      // RIVER_COLORS は帯と同じ数だけ並んでいる前提（帯 j と j+1 の間を補間する）
      const knots = bands.map((b) => b.speed / maxSpeed);
      if (RIVER_COLORS.length !== knots.length) console.warn('RIVER_COLORS の数が帯の数と合いません');
      tint = ctx.createLinearGradient(0, bb.y0, 0, bb.y1);
      for (let i = 0; i <= 24; i++) {
        const k = gim.currentSpeedAt(bb.y0 + (i / 24) * bb.h) / maxSpeed;
        let j = 0;
        while (j < knots.length - 2 && k > knots[j + 1]) j++;
        const a = knots[j], b = knots[j + 1];
        const col = mixHex(RIVER_COLORS[j], RIVER_COLORS[j + 1], b > a ? clamp((k - a) / (b - a), 0, 1) : 0);
        tint.addColorStop(i / 24, hexA(col, RIVER_ALPHA[0] + (RIVER_ALPHA[1] - RIVER_ALPHA[0]) * k));
      }
    }
    ctx.fillStyle = tint;
    ctx.fillRect(vx0, vy0, vx1 - vx0, vy1 - vy0);

    // 漂流物と白波。全部の帯ぶんを種類ごとの Path2D に積んでから、種類ごとに1回だけ塗る。
    // 河川敷（流速 0）には何も置かない ＝ 止まった浅瀬
    const art = { leaf: new Path2D(), foam: new Path2D() };
    let any = false;
    for (let i = 0, y0 = bb.y0; i < bands.length; y0 = bands[i++].y) {
      const y1 = bands[i].y;
      const box = { x0: vx0, x1: vx1, y0: Math.max(vy0, y0), y1: Math.min(vy1, y1), b0: y0, b1: y1 };
      if (box.y0 >= box.y1) continue;
      const speed = gim.currentSpeedAt((y0 + y1) / 2);
      if (!speed) continue;
      const strength = speed / maxSpeed;
      drifts(t, speed, strength, box, art);
      any = true;
    }
    if (any) {
      ctx.save();
      ctx.rotate(gim.def.dir);
      ctx.fillStyle = LEAF_COLOR; ctx.fill(art.leaf);
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = PAPER; ctx.fill(art.foam);   // 泡と白波
      ctx.restore();
    }

    // 京王線の鉄橋の影。水面に落ちた影なので漂流物の上に重ねる
    const br = bridgeArt();
    if (br.x1 > vx0 && br.x0 < vx1 && br.y1 > vy0 && br.y0 < vy1) {
      ctx.fillStyle = 'rgba(16,31,35,.28)';
      ctx.fill(br.shadow);
      // その上を渡る電車の影。鉄橋が画面に入っていないなら電車も入らない
      drawTrain(br, { x0: vx0, x1: vx1, y0: vy0, y1: vy1 });
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

  // 湧水の絵のうち、時間で変わらない部分（石組みの縁・苔・水のグラデーション）。
  // ゾーンは試合中に動かないので初回に1回だけ作る（makeRunwayArt と同じやり方）。
  //
  // 仕様（#8）では石と苔を Path2D のまま毎フレーム塗る案だったが、絵（ImageBitmap）に
  // 焼いてから drawImage で描くことにした。理由は fps —— 実測（Chromium、GPU あり、
  // PC 1280×720、ゾーンに寄った絵）で、石を Path2D のまま毎フレーム塗ると fps が改修前の
  // 4分の1 まで落ちた。丸1つではない複雑な Path は GPU の速い道（楕円・矩形）に乗らず、
  // 塗るたびに作り直しになる。泡を Path 1本にまとめたときも同じ理由で遅くなったので、
  // 泡と波紋は丸1つずつ塗る（丸は速い道に乗る）。焼いた絵は stop() で手放す
  //
  // GPU の無い端末向けの軽量化（N3）。塗る面積（フィルレート）がそのまま重さになる端末 ——
  // GPU の無いソフトウェア描画（SwiftShader で計測）や低〜中価格帯のスマホ —— では、#8 の
  // 「水のグラデーションを塗る → その上に石組みの絵を重ねる」が、縁の所を2回塗るぶん重かった
  // （sp 844×390・dpr2 の実測で、#8 を外した版より 9〜20% 遅い）。そこで水と石組みを
  // 1枚の絵に焼いて1回で描く。焼くのは「もらえる」「再装填中」「再装填中で中に居る」の3枚。
  // グラデーションを毎フレーム塗るより絵を貼るほうが安く、この形で #8 を外した版との差は ±2% ほどに収まった。
  // 絵は増える（ゾーンあたり 1040px 角が 3枚）が、作るのは1フレームに1枚ずつ（springTodo）
  let springArt = null;
  let springTodo = [];        // まだ焼いていない絵（[art, 名前]）。drawSprings が1フレームに1枚ずつ焼く
  const RIM_PAD = 60;     // 縁の石がゾーンの円からはみ出す分（径方向に最大 ±45px）＋影のずれ
  const RIM_HI_SCALE = 0.5;   // 「中に居る」の明るみの絵の解像度。ぼけても困らないので半分
  // 絵は円の形で、外側の四隅は透明（「中に居る」の明るみは輪の形で、内側も透明）。その透明な所まで
  // 描くと上と同じ理由で重いので、絵を横長の帯に切り、段ごとに左右の端を円に合わせて詰める。
  // 外側は石が届く半径（RIM_REACH）の円、明るみの内側は「透明だと言える半径」（RIM_HOLE）の円に合わせる。
  // 段の数は 12（描く面積は正方形に対して、水＋石で 86%、明るみで 46%。#8 の石組みは 3段で 65%）
  const RIM_ROWS = 12;
  const RIM_HOLE = 0.86;      // 透明だと言える半径（z.r との比。石の内縁は z.r - 53、影のずれ 9px を引いてさらに内側）
  // 石が届く最も外（z.r からの距離）。石の外縁は z.r + 52、影は右下へ 9px ずれるので z.r + 61、
  // 縁のにじみを足して 64。正方形の端（RIM_PAD）より外は、どのみち絵が無い
  const RIM_REACH = 64;

  /**
   * 焼いた絵を描く帯（ワールド座標の矩形 [x0, y0, x1, y1]）。段の上下の境は隙間なく接する。
   * hole > 0 なら、その半径より内側（透明な穴）を描かないよう、穴をまたぐ段を左右に分ける
   */
  function springPieces(z, hole) {
    const m = z.r + RIM_PAD, o = z.r + RIM_REACH;
    const p = [];
    const at = (x0, y0, x1, y1) => p.push([z.x + x0, z.y + y0, z.x + x1, z.y + y1]);
    for (let k = 0; k < RIM_ROWS; k++) {
      const y0 = -m + (2 * m * k) / RIM_ROWS, y1 = -m + (2 * m * (k + 1)) / RIM_ROWS;
      // 段の中で中心にいちばん近い y（外側の円が最も広い所）と、いちばん遠い y（穴が最も狭い所）
      const near = y0 < 0 && y1 > 0 ? 0 : Math.min(Math.abs(y0), Math.abs(y1));
      const far = Math.max(Math.abs(y0), Math.abs(y1));
      const xo = Math.min(m, Math.sqrt(Math.max(0, o * o - near * near)));
      if (far < hole) {
        const xi = Math.sqrt(hole * hole - far * far);
        at(-xo, y0, -xi, y1);
        at(xi, y0, xo, y1);
      } else {
        at(-xo, y0, xo, y1);
      }
    }
    return p;
  }

  /**
   * ゾーン z のまわり（半径 z.r + RIM_PAD の正方形）を、ワールド座標のまま描ける絵に焼く。
   * まず canvas を返し、ImageBitmap ができしだい差し替える（set に渡す）——
   * canvas のままだと描くたびに GPU へ送り直されることがあり、ImageBitmap は1回で済む
   */
  function bakeSpring(z, px, draw, set) {
    const m = z.r + RIM_PAD;
    const c = document.createElement('canvas');
    c.width = c.height = px;
    const g = c.getContext('2d');
    g.scale(px / (2 * m), px / (2 * m));
    g.translate(m - z.x, m - z.y);
    draw(g);
    set(c);
    if (typeof createImageBitmap === 'function') {
      createImageBitmap(c).then((b) => {
        // 焼き上がる前に試合が畳まれていたら、もう使わないので手放す
        if (!running) { b.close?.(); c.width = c.height = 0; return; }
        set(b);
        // 元の canvas はもう要らないので、すぐに大きさ 0 にして手放す。GC を待つと、焼いた直後は
        // canvas と bitmap が両方残ってメモリが一時的に約2倍になる（Safari は GC 待ちの canvas も上限に数える）
        c.width = c.height = 0;
      }, () => { });
    }
  }

  /** 焼いた絵を手放す（stop() から呼ぶ）。ImageBitmap は GPU の記憶を持っているので明示的に閉じる */
  function dropSpringArt() {
    for (const art of springArt ?? []) {
      for (const b of [art.ready, art.rest, art.restHere, art.hi]) b?.close?.();
    }
    springArt = null;
    springTodo = [];
  }

  function makeSpringArt() {
    return gim.springs.map((z, i) => {
      // 添字から作る種。乱数を持たないので、何度作っても同じ石組みになる
      const rnd = (k, s) => frac(Math.sin(k * 12.9898 + i * 78.233 + s * 37.719) * 43758.5453);
      // 石。寺の庭石くらいの大きめの丸石を、ゾーンの境（z.r）の上に隙間を少し空けて並べる。
      // 引きの絵（zoom 0.21）でも画面上 6〜9px あり、インクの縁取りで「点々」ではなく
      // 「縁」として読める大きさ。形は 7角の頂点を少しずつ揺らして丸めた多角形
      const rocks = new Path2D(), tops = new Path2D(), moss = new Path2D();
      const N = 30 + Math.floor(rnd(0, 1) * 6);           // 30〜35個
      const step = TAU / N;
      for (let k = 0; k < N; k++) {
        const a = (k + 0.5 * (rnd(k, 2) - 0.5)) * step;
        const len = z.r * step * (0.38 + 0.1 * rnd(k, 3));    // 円周方向の半径（隙間ぶん小さめ）
        const dep = 24 + 16 * rnd(k, 4);                     // 径方向の半径
        const rr = z.r + (rnd(k, 5) - 0.5) * 14;
        const cx = z.x + Math.cos(a) * rr, cy = z.y + Math.sin(a) * rr;
        const ca = Math.cos(a), sa = Math.sin(a);
        // 石の座標系（u = 径方向、v = 円周方向）の点をワールドへ
        const P = (u, v) => [cx + ca * u - sa * v, cy + sa * u + ca * v];
        const V = 7, pts = [];
        for (let j = 0; j < V; j++) {
          const th = (j / V) * TAU + rnd(k, 6) * 0.9;
          const w = 0.82 + 0.3 * rnd(k * 7 + j, 7);
          pts.push(P(Math.cos(th) * dep * w, Math.sin(th) * len * w));
        }
        // 辺の中点を通る二次曲線で角を丸める
        const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
        const m0 = mid(pts[V - 1], pts[0]);
        rocks.moveTo(m0[0], m0[1]);
        for (let j = 0; j < V; j++) {
          const p = pts[j], m = mid(p, pts[(j + 1) % V]);
          rocks.quadraticCurveTo(p[0], p[1], m[0], m[1]);
        }
        rocks.closePath();
        // 上面の照り。石の上（-y）寄りに小さな楕円を重ねて、平らな円盤に見えないようにする
        const [hx, hy] = P(0, 0);
        tops.moveTo(hx + len * 0.45, hy - dep * 0.25);
        tops.ellipse(hx, hy - dep * 0.25, len * 0.45, Math.min(len, dep) * 0.32, 0, 0, TAU);
        // 苔。石の内側（水に面した側）の根元に、緑の小さな塊を 1〜3個
        const nm = 1 + Math.floor(rnd(k, 8) * 3);
        for (let j = 0; j < nm; j++) {
          const [mx, my] = P(-dep * (0.2 + 0.4 * rnd(k * 3 + j, 9)), (rnd(k * 5 + j, 10) - 0.5) * len * 1.1);
          const mr = 6 + 7 * rnd(k * 11 + j, 11);
          moss.moveTo(mx + mr, my);
          moss.arc(mx, my, mr, 0, TAU);
        }
      }

      const art = {
        box: [z.x - z.r - RIM_PAD, z.y - z.r - RIM_PAD, 2 * (z.r + RIM_PAD)],
        disk: springPieces(z, 0),                  // 水＋石組みの絵（円）を描く帯
        ring: springPieces(z, z.r * RIM_HOLE),     // 明るみの絵（輪）を描く帯
        // 焼いた絵。ready = もらえる、rest = 再装填中、restHere = 再装填中で中に居る、hi = 明るみだけ
        ready: null, rest: null, restHere: null, hi: null,
        bake: {},
        /** 名前の絵を返す。まだ焼いていなければ、いま焼く */
        get(key) { if (!this[key]) this.bake[key](); return this[key]; },
      };

      // 縁の内側の水。もらえる間はミント寄りに明るく、再装填中は暗い青で平らに。
      // 再装填中を灰にしていたころは、水没した調布の水色の中で濁って見えたので青へ寄せた
      const water = (g, stops) => {
        const gr = g.createRadialGradient(z.x, z.y, z.r * 0.1, z.x, z.y, z.r);
        for (const [o, c] of stops) gr.addColorStop(o, c);
        g.fillStyle = gr;
        g.beginPath(); g.arc(z.x, z.y, z.r, 0, TAU); g.fill();
      };
      // 石組み。水底に沈んだ石に見せる —— 飛行場の滑走路（drawGust）と同じく、
      // インクの縁は付けず、色を水の色へ寄せて暗く沈ませる。インクの縁と明るい灰だと
      // 「水の上に置いた、ぶつかる岩の壁」に見えた。
      // 影（右下へずらした暗い塗り）→ 石 → ごく弱い照り → 苔（石の形で切り抜く）→ 暗いティールの細い縁。
      // 引きの絵での「輪」は、石の数と並びと影で読ませる
      const rim = (g) => {
        g.save();
        g.translate(5, 7);
        g.fillStyle = SPRING_SHADE;
        g.fill(rocks);
        g.restore();
        g.fillStyle = SPRING_ROCK;
        g.fill(rocks);
        g.fillStyle = SPRING_TOP;
        g.fill(tops);
        g.save();
        g.clip(rocks);       // 苔は石の輪郭の内側だけ。はみ出すと水に浮いた藻に見える
        g.fillStyle = SPRING_MOSS;
        g.fill(moss);
        g.restore();
        g.strokeStyle = SPRING_EDGE;
        g.lineWidth = 2.5;
        g.lineJoin = 'round';
        g.stroke(rocks);
      };
      const READY = [[0, 'rgba(163,240,240,0.30)'], [0.75, 'rgba(163,240,240,0.16)'], [1, 'rgba(120,210,215,0.24)']];
      const REST = [[0, 'rgba(30,60,86,0.30)'], [1, 'rgba(16,38,58,0.40)']];
      const rimPx = Math.ceil(2 * (z.r + RIM_PAD));
      const [bx0, by0, bs] = art.box;
      // 自機がゾーンの中に居るとき、石の上に重ねる薄い白（石の形だけ）
      art.bake.hi = () => bakeSpring(z, Math.ceil(rimPx * RIM_HI_SCALE), (g) => {
        g.fillStyle = SPRING_HERE;
        g.fill(rocks);
      }, (b) => { art.hi = b; });
      art.bake.ready = () => bakeSpring(z, rimPx, (g) => { water(g, READY); rim(g); }, (b) => { art.ready = b; });
      art.bake.rest = () => bakeSpring(z, rimPx, (g) => { water(g, REST); rim(g); }, (b) => { art.rest = b; });
      // 明るみは、別に重ねていたころと同じ半分の解像度の絵を引き伸ばして焼き込む（縁のぼけ方を揃える）
      art.bake.restHere = () => bakeSpring(z, rimPx, (g) => {
        water(g, REST); rim(g);
        g.drawImage(art.get('hi'), bx0, by0, bs, bs);
      }, (b) => { art.restHere = b; });
      // 最初の絵に要るのは「もらえる」だけ。残りは1フレームに1枚ずつ前もって焼く
      // （まとめて焼くと開始直後の1フレームが長くなる）
      art.get('ready');
      springTodo.push([art, 'hi'], [art, 'rest'], [art, 'restHere']);
      return art;
    });
  }

  // 石と苔の色。石は灰（#8a8f8c）を水のティールへ半分ほど寄せて暗くした色、苔も彩度を落とす。
  // here（自機がゾーンの中）は石に薄い白を重ねて「いま中に居る」を縁で言う
  const SPRING_ROCK = '#4f6e6c', SPRING_HERE = hexA(PAPER, 0.24);
  const SPRING_TOP = hexA(PAPER, 0.06), SPRING_MOSS = hexA('#58744a', 0.6);
  const SPRING_SHADE = hexA('#101f23', 0.32), SPRING_EDGE = hexA('#173235', 0.4);

  /**
   * 深大寺の湧水。石組みの縁と苔で囲った湧き水で、縁の内側が「ここから中」。
   *
   * 湧水がくれるのはガード1個だけで、ゾーンには「今もらえる／再装填中」の2つの状態がある。
   * 入っても何も起きない時間が最大 30秒あるので、言い分けないと故障に見える ——
   * もらえる間は水が明るく、泡と波紋が湧き続ける。再装填中は水面を暗い青で平らにし、
   * 泡も波紋も止める（縁の石は両状態で同じ）。
   *
   * 演出の時刻は world.envT から出し、石の配置も泡の位相も添字から作る種で決める
   * （乱数を持たない）ので、絵は時刻だけで決まる。
   * 以前の破線の円は、issue C の「破線による範囲表示は原則なくす」でやめた
   */
  function drawSprings(view) {
    const ready = player.springT <= 0;
    const env = world.envT;
    if (!springArt) springArt = makeSpringArt();
    else if (springTodo.length) {
      const [art, key] = springTodo.shift();
      art.get(key);              // 前もって焼く絵を1フレームに1枚（焼き済みなら何もしない）
    }
    for (let i = 0; i < gim.springs.length; i++) {
      const z = gim.springs[i];
      const art = springArt[i];
      // 縁の石（径方向に最大 ±45px ほどはみ出す）まで含めて画面に無ければ描かない
      const m = z.r + RIM_PAD;
      if (z.x + m < view.x0 || z.x - m > view.x1 || z.y + m < view.y0 || z.y - m > view.y1) continue;
      const here = (player.x - z.x) ** 2 + (player.y - z.y) ** 2 < z.r * z.r;

      // 水と石組み（焼いた絵）。石は水底に沈んでいるので、波紋と泡より下に描く。
      // 中に居るゾーンだけ、石に薄い白を重ねて明るくする（再装填中は焼き込み済みの絵）。
      // もらえる間に中に居るのは、入ったフレームで再装填が始まるまでの一瞬だけ
      // （springT は自機の手元の値）なので、そこは明るみの絵を別に重ねる
      const lit = here && ready;
      const water = ready ? art.get('ready') : art.get(here ? 'restHere' : 'rest');
      // 帯ごとに、画面に入っている部分だけを切り出して描く。塗る面積がそのまま重さになる
      // 端末（GPU の無いソフトウェア描画、フィルレートの低いスマホ）のため。
      // 寄りの絵ではゾーンの大半が画面の外にある
      const [bx0, by0, bs] = art.box;
      // view には draw() の揺れ（cam.shake の translate）が入っていないので、そのぶん広げて
      // 切り出す。ぴったりだと揺れている間（ヌシ復活の地響きなど）画面端で石だけ欠ける
      const pad = (cam.shake + 2) / cam.zoom;
      // 帯の境目は画面の画素の境に合わせる。半端な位置で接すると、両側の帯の縁が
      // どちらも半透明に塗られて、石の上に細い筋（継ぎ目）が出る
      const tm = ctx.getTransform();
      const snapX = (x) => (Math.round(tm.a * x + tm.e) - tm.e) / tm.a;
      const snapY = (y) => (Math.round(tm.d * y + tm.f) - tm.f) / tm.d;
      const paste = (img, pieces) => {
        const k = img.width / bs;
        for (const [qx0, qy0, qx1, qy1] of pieces) {
          const px0 = snapX(qx0), py0 = snapY(qy0), px1 = snapX(qx1), py1 = snapY(qy1);
          const x0 = Math.max(px0, view.x0 - pad), y0 = Math.max(py0, view.y0 - pad);
          const x1 = Math.min(px1, view.x1 + pad), y1 = Math.min(py1, view.y1 + pad);
          if (x1 <= x0 || y1 <= y0) continue;
          ctx.drawImage(img, (x0 - bx0) * k, (y0 - by0) * k, (x1 - x0) * k, (y1 - y0) * k, x0, y0, x1 - x0, y1 - y0);
        }
      };
      paste(water, art.disk);
      if (lit) paste(art.get('hi'), art.ring);

      if (ready) {
        // 波紋。中心付近から 3本の輪が広がり、縁の手前で消える。外へ行くほど薄く細く。
        // 湧いたばかりの内側の輪ほど太く濃くして、ゾーンの外からでも「湧いている」が読めるようにする
        ctx.strokeStyle = MINT;
        const lw = Math.max(4, 2.6 / cam.zoom);
        for (let k = 0; k < 3; k++) {
          const q = frac(env * 0.25 + k / 3 + i * 0.29);    // 0=湧いた所、1=縁
          ctx.globalAlpha = 0.75 * (1 - q) * Math.min(1, q * 6);
          ctx.lineWidth = lw * (1.8 - 1.1 * q);
          ctx.beginPath();
          ctx.arc(z.x, z.y, z.r * 0.9 * q, 0, TAU);
          ctx.stroke();
        }

        // もらえる間は、ゾーン全体から泡を上げ続ける。これが「いま入れば1個もらえる」の
        // 主な合図で、サメが通り抜けた一瞬しか動きがないと、30秒経ったのかどうかが
        // 入ってみるまで分からない。
        // 数と大きさは直径 920px のゾーンから逆算している —— 9粒・半径3〜10pxだったころは
        // 引きの絵では点にもならず、湧いているのに止まって見えていた。
        // 泡は丸1つずつ塗る（Path 1本にまとめると GPU の速い道から外れて、かえって遅い）
        ctx.fillStyle = MINT;
        const rmin = Math.min(14, 4.5 / cam.zoom);
        for (let k = 0; k < 34; k++) {
          const seed = frac(Math.sin(k * 12.9898 + i * 78.233) * 43758.5453);
          const ph = frac(env * 0.3 + seed);               // 0=湧き出した所、1=抜けきる所
          const a = k * 2.399 + i * 1.7;                   // 黄金角で回す。並ぶと噴水に見える
          const rr = z.r * (0.12 + 0.8 * frac(seed * 7.13));
          const x = Math.cos(a) * rr + Math.sin(env * 1.7 + k) * 9;
          const y = Math.sin(a) * rr;
          // 浮き先はその x でのゾーンの上端。まっすぐ上へ流すと縁を越えて散り、
          // 石組みで囲った「ここから中」がぼやける
          const top = -Math.sqrt(Math.max(0, z.r * z.r - x * x));
          // 出はじめと抜けぎわで透ける（両端が切れると点滅に見える）
          ctx.globalAlpha = Math.min(1, ph * 5) * Math.min(1, (1 - ph) * 3.5) * 0.55;
          // 引きの絵（zoom は最小 0.21 まで下がる）で消えないよう、画面上 4.5px を下限にする。
          // 上限 14px は、太らせたぶんが縁からはみ出さないための頭打ち
          const rad = Math.max((4 + 8 * frac(seed * 3.71)) * (1 - ph * 0.4), rmin);
          ctx.beginPath();
          ctx.arc(z.x + x, z.y + y + (top - y) * ph * 0.8, rad, 0, TAU);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

    }
  }

  /** 水の中に敷く層。サメより後ろ、餌より後ろ */
  function drawEnvBack(t, view) {
    if (!gim) return;
    ctx.save();
    ctx.clip(outline);          // 流れも渦も湧水も水の中だけ。壁の外へはみ出させない
    if (gim.kind === 'current') drawCurrent(t, view);
    if (gim.kind === 'gust') drawGust(t, view);
    if (gim.kind === 'spring') drawSprings(view);
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

  // 盤面の1位（生きている中で質量最大・ボスは除く）。updateCrown() が決め、drawShark が王冠を載せ、
  // HUD の順位表もこのサメを1位に置く。ボスを除くのは、深大寺のヌシ（質量 8000〜13000）が
  // 常に1位になってしまうから（順位表でもボスは番号の無い「BOSS」札で、サメの順位に数えない）
  let crowned = null;
  /** 質量の重い順。同じ重さなら nid の順に固定して、順位表と王冠の並びを食い違わせない */
  const byMass = (a, b) => b.mass - a.mass || (a.nid < b.nid ? -1 : a.nid > b.nid ? 1 : 0);
  /** 王冠の持ち主を決め直す。今の持ち主より CROWN_SWAP 倍以上重いサメが出たときだけ移す */
  function updateCrown() {
    let best = null;
    for (const o of sharks) {
      if (!o.alive || o.isBoss) continue;
      if (!best || byMass(o, best) < 0) best = o;
    }
    if (!crowned || !crowned.alive || crowned.isBoss || !best
      || (best !== crowned && best.mass >= crowned.mass * CROWN_SWAP)) crowned = best;
  }
  // 王冠の輪郭。原点が王冠の下辺の中央で、画面 px。Path2D はブラウザにしか無いので遅れて作り、使い回す
  let crownPath = null;
  /** s の名前の上端（ワールド座標）。名前は s.y - hr - 12/zoom に、字の高さ max(12, hr*0.75) で描かれる */
  const nameTopOf = (s) => s.y - s.body[0].r - 12 / cam.zoom - Math.max(12, s.body[0].r * 0.75);
  /**
   * 名前の上に王冠を載せる。塗りとインクの縁を1回ずつ。
   * 名前を出していない引きの絵では、名前の位置だと上を向いて泳ぐ大物の胴にかかるので、
   * 体の上端（頭側の節の円の上端のうち一番上）と比べて高いほうに置く
   */
  function drawCrown(s, named) {
    if (!crownPath) {
      const w = CROWN_W / 2, h = CROWN_H;
      crownPath = new Path2D();
      crownPath.moveTo(-w + 2, 0);
      crownPath.lineTo(-w, -h + 4);
      crownPath.lineTo(-w / 2, -h * 0.45);
      crownPath.lineTo(0, -h);
      crownPath.lineTo(w / 2, -h * 0.45);
      crownPath.lineTo(w, -h + 4);
      crownPath.lineTo(w - 2, 0);
      crownPath.closePath();
    }
    const k = 1 / cam.zoom;
    let top = nameTopOf(s);
    if (!named) {
      // 尾の先は絵が細く、節の円で測ると上に浮きすぎるので、頭側の 6割だけで測る
      const b = s.body, m = Math.ceil(b.length * 0.6);
      for (let i = 0; i < m; i++) top = Math.min(top, b[i].y - b[i].r);
    }
    ctx.save();
    ctx.translate(s.x, top);
    ctx.scale(k, k);
    ctx.translate(0, -CROWN_GAP);
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = INK;
    ctx.fillStyle = CROWN_GOLD;
    ctx.fill(crownPath);
    ctx.stroke(crownPath);
    ctx.restore();
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
    const nameTop = nameTopOf(player);
    // 自分が1位なら名前の上に王冠があるので、目印はそのさらに上に積む（重ねない）
    const lift = player === crowned ? CROWN_H + CROWN_GAP : 0;
    // 上下にゆっくり弾ませる（画面 px）。盤面の時計から作るので、ポーズ中は止まる
    const bob = Math.sin(world.elapsed * 4) * 4;
    ctx.save();
    ctx.translate(player.x, nameTop);
    ctx.scale(k, k);
    ctx.translate(0, -6 - lift + bob - (1 - a) * YOU_RISE);
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

    // 水底と水面のきらめき（エリアの中だけ、#9）。タイルは world 座標に敷かれるので、
    // カメラと一緒に流れる。水底の絵がどれだけ細かくても、ここは fill 1回のまま
    ctx.fillStyle = floor;
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

    // パーティクル。サメより先に描いて体の下に潜らせる —— 上に重ねると、食べている間じゅう
    // 自機が粒でまだらに見えて、どれが自分か分かりにくかった
    for (const p of fx) {
      const k = 1 - p.t / p.dur;
      ctx.globalAlpha = k;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * k, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // サメ（小さい順に描いて大物を前面へ）。画面外は捨てる —
    // rope は1匹あたり節の数だけ drawImage するので、映らない分を描かないのが一番効く
    const alive = sharks.filter((s) => s.alive).sort((a, b) => a.mass - b.mass);
    updateCrown();
    for (const s of alive) {
      if (s.x + s.reach < vx0 || s.x - s.reach > vx1) continue;
      if (s.y + s.reach < vy0 || s.y - s.reach > vy1) continue;
      drawShark(s, t);
    }

    drawPlaneShadow({ x0: vx0, y0: vy0, x1: vx1, y1: vy1 });   // 飛行場の影。水面に落ちるのでサメより上
    // いま自分に効いているギミック。サメの上に重ねないと自分のことだと分からない
    drawEnvFront(t);

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
    trainSound();   // 多摩川の電車の音（ポーズ中・デモ・リザルトでは中で抜ける）
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
      // 順位表（#5）。サメはボスを除いて重い順に数え、王冠の持ち主を1位に置く（王冠と表の1位を揃える）。
      // ボスは番号の無い「BOSS」札として先頭に別に付ける。
      // 表示は上位3人＋自分だが、順位表をタップして広げたときだけ上位5人を出すので5人ぶん送る
      updateCrown();
      const ranked = sharks.filter((s) => s.alive && !s.isBoss).sort(byMass);
      if (crowned && ranked[0] !== crowned) {
        ranked.splice(ranked.indexOf(crowned), 1);
        ranked.unshift(crowned);
      }
      const bossShark = sharks.find((s) => s.alive && s.isBoss);
      const meAt = ranked.indexOf(player);
      const rank = meAt >= 0 ? meAt + 1
        : 1 + sharks.filter((o) => o.alive && !o.isBoss && o !== player && o.mass > player.mass).length;
      // ひとつ上の相手。HUD が「あと N で X 位」を出す。ボスは目標にしない（数えていない）。
      // 抜くのに要る質量は、ふつうはその相手の質量、相手が王冠持ちなら CROWN_SWAP 倍
      const above = meAt > 0 ? ranked[meAt - 1] : null;
      const need = above ? (above === crowned ? above.mass * CROWN_SWAP : above.mass) : 0;
      const board = ranked.slice(0, 5);
      onHud?.({
        mass: Math.round(player.mass),
        rank,
        next: above && player.alive ? { rank: meAt, mass: Math.ceil(need) } : null,
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
        board: (bossShark ? [bossShark, ...board] : board).map((s) => ({
          name: s.name, mass: Math.round(s.mass), me: s === player, human: s.nid[0] !== 'b',
          boss: s.isBoss,
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
        // 前回の HUD から後に自分が倒した相手 { name, ruby }（HUD 側がキルフィードに積む）
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
      if (!attract) sfx.train(null);   // 電車の音も盤面と一緒に止める（次の盤面へ持ち越さない）
      hush();                          // 震えたまま盤面を畳まない
      world.destroy();
      dropSpringArt();
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
