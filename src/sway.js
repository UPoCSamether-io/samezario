// 深大寺の水面に落ちる草木の影（N8。見た目だけ。sim は知らない）。
// 多摩川の電車の影（N5）のように「動いているのが分かる影」を、深大寺では風に揺れる草木で出す。
// 境内の木立から張り出した枝先の葉の房、湧水の縁と外周の岸から水面へかぶさる草の束が、
// 房ごとに少しずつずれた周期でゆっくり揺れ、ときどき強い風の「波」が盤面を横切って
// 通り道の房を順に大きくなびかせる。
//
// 描くのは game.js の drawSway。ここは DOM を触らないので Node から試せる（sway.test.mjs）。
// 形も置き場所も添字から決め打ちで作り（乱数を持たない）、揺れは world.envT だけから出すので、
// 同じ部屋なら同じに見える（深大寺はソロ専用だが、作りは電車の影と揃えておく）。

const TAU = Math.PI * 2;

// ---- 見た目 ----
// 影の色。鉄橋の上を走る電車の影（rgba(16,31,35,.2)）と同じ。水面の影なので主張させない
export const SWAY_SHADOW = 'rgba(16,31,35,.2)';
// 1房の揺れの周期(秒)の幅。房ごとに添字のハッシュでこの間に散らす（そろうと全部が同時に揺れて、
// 板が傾いているように見える）。仕様の「2〜5秒くらい」の内側
export const SWAY_PERIOD = [2.4, 4.8];
// 揺れの振れ幅(rad)の幅。先端で 5〜10°ほど（小さな揺れを重ねるので最大 13°ほど）。
// 根元はほとんど動かない（しなりの重みで先ほど振る）
export const SWAY_AMP = [0.09, 0.17];
// 強い風の波。every 秒ごとに、盤面の端から端まで dir の向き（右下がり 24°）へ speed px/s で抜ける。
// 盤面を抜けるのに 8秒ほどかかるので、残りの 9秒ほどは凪。
// width は波の厚み（その前後 width px ほどの房がなびく）、lean はそのときの曲がり(rad、最大約 20°)。
// 速さは電車（700px/s）と同じくらい —— 画面（PC で横 1300px）を2秒ほどで横切り、
// 「何かが通った」が読める
export const SWAY_GUST = { every: 17, speed: 760, width: 380, lean: 0.34, dir: 0.42 };
// 引きの絵では描かない。zoom が fade[1] 以下で薄くなり始め、fade[0] で消える。
// 房1つは長さ 50〜180px なので、zoom 0.3 で画面 15〜55px —— それ以下は形が読めず、数だけ増える
export const SWAY_FADE = [0.3, 0.42];
//
// ---- 数（重さ） ----
// GPU の無い端末では、塗る面積がそのまま重さになる（#08 → N3）。SwiftShader・sp 844×390・dpr2・
// CPU 4倍スロットルで、同じページの「影あり／なし」を交互に測った実測（中央値）:
//   最初の版（岸 330px おき・湧水 7・木立ごとに枝2つ・房は今の 1.3倍）  画面に 20房前後、−10%
//   房を小さく・岸 600px・湧水 4・木立3つに1つ                         10〜14房、−3.5〜−5%
//   今の値                                                            2〜7房、−2.4〜+1.8%
// （測り方の揺らぎは「あり／あり」で ±3% ほど）。房1つおよそ 0.3〜0.5% なので、増やすときは注意
// 外周の岸に置く房の間隔(px)。周長 1万8千px ほどで 30房ほど。画面に入るのは 1〜3房
export const SWAY_EDGE_GAP = 600;
// 湧水1つの縁に置く草の束の数（直径 920px の円に 6つ＝500px おき）
export const SWAY_SPRING_N = 6;
// 木立の枝先は、木立いくつごとに1つ置くか（水底のタイル 512px に木立は6つ → タイルに1つ）。
// 木立ごとに置いた版は、PC の寄りの絵で画面に 25房ほど入り、水面じゅうが枝の影になった
export const SWAY_GROVE_EVERY = 6;
// 木立の枝先を描く zoom の下限。枝先はタイルの数だけ増えるので、引きの絵では岸と湧水の草だけにする
export const SWAY_GROVE_ZOOM = 0.6;
// 房の伸びる向き。画面で見て縦（根元が下、先が上）。横や斜めに生えた草は画面の上で
// 不自然に見えたので（人間の判断、N8 往復1回目）、どこに置いた房もこの向きにそろえ、揺れはここから左右へ
export const SWAY_UP = -Math.PI / 2;
// 外周の岸の房の根元を、壁の線から内側へ寄せる距離(px)
export const SWAY_EDGE_INSET = 24;

// 草木の影の形。原点が根元（枝なら付け根）で、+x へ伸びる。
// 命令は 0 = moveTo(x, y)、1 = lineTo(x, y)、2 = quadraticCurveTo(cx, cy, x, y)、3 = closePath。
// 1本の Path にまとめて fill 1回で塗るので、どの葉・草も同じ向きに回る（行きを -側、帰りを +側）
// 輪郭にする —— 向きが混ざると、重なった所が nonzero で打ち消し合って穴になる。
// w は点ごとの「しなり」の重み（根元 0 → 先 1）。揺れの角度にこれを掛けて点を回すので、
// 根元は止まったまま先ほど大きく振れ、草は弓なりにしなる
function makeShape(build, bendPow, base = 0) {
  const ops = [], xs = [], ys = [];
  build({
    m: (x, y) => { ops.push(0); xs.push(x); ys.push(y); },
    l: (x, y) => { ops.push(1); xs.push(x); ys.push(y); },
    q: (cx, cy, x, y) => { ops.push(2); xs.push(cx, x); ys.push(cy, y); },
    z: () => { ops.push(3); },
  });
  let len = 0;
  for (let i = 0; i < xs.length; i++) len = Math.max(len, Math.hypot(xs[i], ys[i]));
  const ws = xs.map((x, i) => base + (1 - base) * Math.min(1, Math.hypot(x, ys[i]) / len) ** bendPow);
  return { ops, xs, ys, ws, len };
}

/** 決め打ちの 0..1。添字と塩から作る（drawSprings の泡と同じ作り） */
export function hash01(i, salt = 0) {
  const s = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** 草の束。n 本の細い葉を扇に開く。spread は扇の開き(rad)、L は長さ、w は根元の幅の半分 */
function grass(n, spread, L, w, salt) {
  return makeShape((p) => {
    for (let b = 0; b < n; b++) {
      const f = n > 1 ? b / (n - 1) - 0.5 : 0;
      const a = f * spread + (hash01(b, salt) - 0.5) * 0.18;
      const len = L * (0.62 + 0.38 * hash01(b, salt + 1));
      const c = (hash01(b, salt + 2) - 0.5) * 0.28 + f * 0.12;   // 葉の反り。外側の葉ほど外へ
      const ux = Math.cos(a), uy = Math.sin(a), vx = -uy, vy = ux;
      const at = (s, t) => [ux * s + vx * t, uy * s + vy * t];
      const tip = at(len, c * len * 1.4);
      p.m(...at(0, -w));
      p.q(...at(len * 0.55, c * len * 0.7 - w * 0.55), ...tip);
      p.q(...at(len * 0.55, c * len * 0.7 + w * 0.55), ...at(0, w));
      p.z();
    }
  }, 1.5);
}

/** 枝先の葉の房。細い枝に、互い違いの葉を k 枚と先端の1枚 */
function spray(k, L, leaf, salt) {
  return makeShape((p) => {
    p.m(0, -3); p.l(L, -1); p.l(L, 1); p.l(0, 3); p.z();
    const put = (x, y, a, ll) => {
      const dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx;
      const lw = ll * 0.26;
      p.m(x, y);
      p.q(x + dx * ll * 0.5 - nx * lw, y + dy * ll * 0.5 - ny * lw, x + dx * ll, y + dy * ll);
      p.q(x + dx * ll * 0.5 + nx * lw, y + dy * ll * 0.5 + ny * lw, x, y);
      p.z();
    };
    for (let i = 0; i < k; i++) {
      const t = 0.22 + 0.72 * (i / Math.max(1, k - 1));
      const side = i % 2 ? 1 : -1;
      const ll = leaf * (0.75 + 0.35 * hash01(i, salt)) * (1 - 0.3 * t);
      put(L * t, 0, side * (0.75 + 0.3 * hash01(i, salt + 1)), ll);
    }
    put(L, 0, (hash01(k, salt) - 0.5) * 0.3, leaf * 0.9);
  }, 1, 0.25);   // 枝は付け根から振る（草よりしならず、全体が揺れる）
}

// 形の見本。草3種と枝先2種。初回に1回だけ作って使い回す
let shapes = null;
export function swayShapes() {
  if (shapes) return shapes;
  return (shapes = {
    grass: [grass(4, 0.8, 74, 6, 1), grass(5, 1.1, 86, 5.5, 2), grass(3, 0.55, 64, 6.5, 3)],
    spray: [spray(5, 106, 34, 4), spray(4, 84, 32, 5)],
  });
}

/**
 * 房の置き場所。
 *   groves  floorJindaiji の木立（[x, y, r, rx, ry, rot]、512px タイルの中の座標）。
 *           水底はタイルの繰り返しなので、房もタイルごとに同じ所に置く（tile に入れて返す）
 *   poly    外周の多角形（arena.poly）。岸から水面へ草と枝をかぶせる
 *   springs 湧水（{ x, y, r }）。縁から内へ草をかぶせる
 * 房 = { x, y, rot（伸びる向き）, s（大きさの倍率）, shape, per（周期）, ph（位相）, amp（振れ幅）,
 *        min（この zoom より引いたら描かない）, r（外接円の半径。画面外の判定に使う） }
 */
export function swayTufts({ groves = [], poly = null, springs = [] }) {
  const S = swayShapes();
  let n = 0;   // 通し番号。周期・位相・形をここから決める
  const tuft = (x, y, rot, kind, s, min) => {
    const i = n++;
    const list = S[kind];
    const shape = list[Math.floor(hash01(i, 11) * list.length)];
    return {
      x, y, rot, s, shape, min,
      per: SWAY_PERIOD[0] + (SWAY_PERIOD[1] - SWAY_PERIOD[0]) * hash01(i, 12),
      ph: hash01(i, 13) * TAU,
      amp: SWAY_AMP[0] + (SWAY_AMP[1] - SWAY_AMP[0]) * hash01(i, 14),
      r: shape.len * s + 12,
    };
  };

  // 木立：樹冠の縁に枝先を1つ。SWAY_GROVE_EVERY 個に1つの木立にだけ置く
  const tile = [];
  groves.forEach(([gx, gy, , rx, ry, rot], g) => {
    if (g % SWAY_GROVE_EVERY) return;
    const a = hash01(g, 21) * TAU;
    const ex = Math.cos(a) * rx * 0.88, ey = Math.sin(a) * ry * 0.88;
    const x = gx + ex * Math.cos(rot) - ey * Math.sin(rot);
    const y = gy + ex * Math.sin(rot) + ey * Math.cos(rot);
    tile.push(tuft(x, y, SWAY_UP, 'spray', 0.95 + 0.35 * hash01(g, 25), SWAY_GROVE_ZOOM));
  });

  const fixed = [];
  // 外周の岸：周に沿って SWAY_EDGE_GAP おきに。草と枝を交互に。
  // 房は上へ伸びるので、根元を内側へ SWAY_EDGE_INSET 寄せ、さらに上の岸（水が下にある辺）では
  // 房の長さぶん下げる —— そのままだと房が岸の外（陸）へ伸びて、clip で消えてしまう
  if (poly) {
    const { xs, ys, n: m } = poly;
    let area = 0;
    for (let i = 0; i < m; i++) { const j = (i + 1) % m; area += xs[i] * ys[j] - xs[j] * ys[i]; }
    const sg = Math.sign(area) || 1;
    let next = SWAY_EDGE_GAP / 2, k = 0;   // 次の房を置く、いまの辺の始点からの距離
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m;
      const dx = xs[j] - xs[i], dy = ys[j] - ys[i], len = Math.hypot(dx, dy);
      const nx = (-sg * dy) / len, ny = (sg * dx) / len;   // 内向きの法線 sg * (-dy, dx)
      let d = next;
      for (; d < len; d += SWAY_EDGE_GAP, k++) {
        const kind = k % 3 === 2 ? 'spray' : 'grass';
        const t = tuft(0, 0, SWAY_UP, kind, 1 + 0.4 * hash01(k, 32), k % 2 ? 0.55 : 0.3);
        t.x = xs[i] + (dx * d) / len + nx * SWAY_EDGE_INSET;
        t.y = ys[i] + (dy * d) / len + ny * SWAY_EDGE_INSET + Math.max(0, ny) * t.shape.len * t.s;
        fixed.push(t);
      }
      next = d - len;
    }
  }
  // 湧水の縁：石組みのすぐ外に草。下側の草は石組みにかぶさって湧水へ、上側の草は奥の岸に立つ
  springs.forEach((z, si) => {
    for (let k = 0; k < SWAY_SPRING_N; k++) {
      const a = ((k + hash01(si * 17 + k, 41) * 0.5) / SWAY_SPRING_N) * TAU + si;
      const rr = z.r + 40;
      const x = z.x + Math.cos(a) * rr, y = z.y + Math.sin(a) * rr;
      fixed.push(tuft(x, y, SWAY_UP, 'grass', 0.9 + 0.3 * hash01(si * 17 + k, 43), k % 2 ? 0.55 : 0.3));
    }
  });
  return { tile, fixed };
}

/**
 * 風の波の、いまの位置。盤面を dir の向きに見た座標（x cosθ + y sinθ）の lo..hi を、
 * SWAY_GUST.every 秒ごとに lo - width から hi + width まで抜ける。抜けたら次の周期まで凪。
 * 返すのは波の先頭の座標（凪の間は null）。envT が同じなら同じ所にある
 */
export function gustFront(env, lo, hi) {
  const { every, speed, width } = SWAY_GUST;
  const ph = env - Math.floor(env / every) * every;
  const at = lo - width + speed * ph;
  return at > hi + width ? null : at;
}

/** 房の揺れの角度(rad)。front は gustFront の戻り値、(x, y) は房の根元のワールド座標 */
export function swayAngle(t, x, y, env, front) {
  const { width, lean, dir } = SWAY_GUST;
  const w = TAU / t.per;
  // ゆるい揺れに、少し速い小さな揺れを重ねて、正弦波1本の機械っぽさを消す
  let a = t.amp * (Math.sin(env * w + t.ph) + 0.3 * Math.sin(env * w * 2.7 + t.ph * 1.9));
  if (front !== null) {
    const d = (x * Math.cos(dir) + y * Math.sin(dir) - front) / width;
    const g = Math.exp(-d * d);
    // 風の向きへなびく。房はみな縦（上向き）なので、sin(dir - rot) = cos(dir) ——
    // 波の進む向きの横成分の側（いまの dir なら右）へ倒れる。通っている間は揺れも少し大きく
    a = a * (1 + g) + lean * g * Math.sin(dir - t.rot);
  }
  return a;
}

/**
 * 房1つの輪郭を ctx（moveTo / lineTo / quadraticCurveTo / closePath を持つもの）へ足す。
 * 新しい Path2D を作らず、今の path に足していくので、画面内の房をまとめて fill 1回で塗れる。
 * 点ごとに「伸びる向き + 揺れ × しなりの重み」だけ回す
 */
export function traceTuft(ctx, t, x, y, bend) {
  const { ops, xs, ys, ws } = t.shape;
  const s = t.s;
  let k = 0;
  // 配列を作らずに回す（毎フレーム数千点を通るので、ゴミを出さない）
  let px = 0, py = 0;
  const at = (i) => {
    const a = t.rot + bend * ws[i];
    const c = Math.cos(a) * s, sn = Math.sin(a) * s;
    px = x + xs[i] * c - ys[i] * sn;
    py = y + xs[i] * sn + ys[i] * c;
  };
  for (let o = 0; o < ops.length; o++) {
    const op = ops[o];
    if (op === 3) { ctx.closePath(); continue; }
    if (op === 2) {
      at(k);
      const cx = px, cy = py;
      at(k + 1);
      ctx.quadraticCurveTo(cx, cy, px, py);
      k += 2;
      continue;
    }
    at(k++);
    if (op === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
}
