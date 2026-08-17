// サメザリオ — 盤面そのもの。DOM も canvas も一切触らない。
//
// サーバ（server/index.mjs）とブラウザ（src/game.js）が同じこのファイルを回す。
// 判定に関わるものを2箇所に書くと必ずズレて、しかもズレは再現しないので、
// 移動・成長・当たり判定・ボットAI・餌はここに閉じ込めてある。
//
// 正はサーバ。ブラウザ側も同じ world を回すが authority=false で、
// resolve()（餌の増減と生死）だけ回さずスナップショットの到着を待つ。
// つまりブラウザが持っているのは「サーバがこう答えるはず」という予測で、
// ズレは applySnapshot() が ex/ey に積んで step() が数フレームかけて溶かす。
//
// 描画や UI に属すること（爆ぜる粒・画面揺れ・リザルト画面）はここではやらず、
// events へ積んで呼び側に拾わせる。sim は「何が起きたか」までしか知らない。
import { SHARKS, BOT_NAMES } from './data.js';
import { bodyLength, taper } from './shark-art.js';

export const TAU = Math.PI * 2;

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
const SEGS = 18;          // rope の骨の数。体長は伸びないので固定
const FOOD_PER_AREA = 14000;   // 餌1個あたりの面積(px²)

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = (a) => a[(Math.random() * a.length) | 0];
export const radiusOf = (m) => 9 + Math.sqrt(m) * 0.72;

/** a から b への最短の角度差（-π..π）。畳まずに引くと 2π の段差が差に化ける */
const angDiff = (a, b) => ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI;

/** a を b の方向へ最大 max ラジアンだけ回す */
function steer(a, b, max) {
  return a + clamp(angDiff(a, b), -max, max);
}

/** "M x yl dx dy,...z"（data.js のエリア輪郭）→ 頂点配列 */
export function parsePath(d) {
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
 *
 * 内外判定は ray casting。以前は Path2D + isPointInPath だったが、
 * document を持たないサーバでは引けない。輪郭は seal-arms.mjs が細い腕を落とした
 * 単純多角形（自己交差なし）なので、Path2D の nonzero と even-odd の答えは一致する
 * —— この前提は sim.test.mjs が全マップについて実際に検査している。
 */
export function makeArena(map) {
  const pts = parsePath(map.path);
  let a2 = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a2 += p[0] * q[1] - q[0] * p[1];
  }
  const k = map.size / Math.sqrt(Math.abs(a2) / 2);

  // 走査を素直に速くするため座標だけ平たい配列へ移す（頂点は26〜64個）
  const n = pts.length;
  const xs = new Float64Array(n), ys = new Float64Array(n);
  for (let i = 0; i < n; i++) { xs[i] = pts[i][0] * k; ys[i] = pts[i][1] * k; }

  const inside = (x, y) => {
    let c = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      if ((ys[i] > y) !== (ys[j] > y) &&
          x < ((xs[j] - xs[i]) * (y - ys[i])) / (ys[j] - ys[i]) + xs[i]) c = !c;
    }
    return c;
  };

  const bb = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (let i = 0; i < n; i++) {
    bb.x0 = Math.min(bb.x0, xs[i]); bb.x1 = Math.max(bb.x1, xs[i]);
    bb.y0 = Math.min(bb.y0, ys[i]); bb.y1 = Math.max(bb.y1, ys[i]);
  }
  bb.w = bb.x1 - bb.x0; bb.h = bb.y1 - bb.y0;

  const home = (() => {                       // 必ず内側にある1点（湧き場所の最後の砦）
    for (let i = 0; i < 4000; i++) {
      const x = rand(bb.x0, bb.x1), y = rand(bb.y0, bb.y1);
      if (inside(x, y)) return { x, y };
    }
    return { x: (bb.x0 + bb.x1) / 2, y: (bb.y0 + bb.y1) / 2 };
  })();

  // 外接矩形の 34〜80% しか中身がない（いちばん薄いのは細長い多摩川）ので、
  // 湧かせる座標は棄却サンプリングで取る
  const spot = () => {
    for (let i = 0; i < 60; i++) {
      const x = rand(bb.x0, bb.x1), y = rand(bb.y0, bb.y1);
      if (inside(x, y)) return { x, y };
    }
    return { ...home };
  };

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

  return { inside, bb, home, spot, escape, poly: { xs, ys, n } };
}

/**
 * 盤面をひとつ作る。
 *
 * authority: 餌の増減と生死を自分で決めるか。サーバと「独りの海」は true、
 *            オンラインのブラウザは false（サーバの宣告を待つ）。回線が切れたら
 *            goSolo 相当で true へ倒せるよう、後から書き換えられる。
 * diffs:     餌の増減を配信用に溜めるか。サーバだけ true。
 *            溜めた分は snapshot() が引き取るので、呼ばない側が true にすると際限なく積む。
 */
export function createWorld({ map, authority = true, diffs = false }) {
  const W = map.size;
  const arena = makeArena(map);
  const sharks = [];
  const food = [];
  const events = [];          // 呼び側が drainEvents() で引き取る
  const fAdd = [], fDel = []; // 前回のスナップショット以降の餌の増減
  const timers = new Set();   // ボットの復活待ち。destroy() で全部止める
  let elapsed = 0, nidSeq = 0, fSeq = 0, running = true, rosterDirty = true;
  // 餌の最大半径。湧いた粒は 10px 程度だが、大きいサメが死んでばら撒く粒は 20px を超える。
  // 格子の探索はこれを足した半径で引く（減らさないのは、縮めると取りこぼすため）
  let maxFoodR = 0;
  const deaths = [];          // 次のスナップショットに載せる死亡通知（死因つき）

  const world = {
    map, W, arena, sharks, food, authority, diffs,
    get elapsed() { return elapsed; },
    /** 人が操っているサメの数。nid の頭文字でボットと見分ける */
    humans: () => sharks.filter((s) => s.nid[0] !== 'b').length,
    drainEvents() { const e = events.slice(); events.length = 0; return e; },
  };

  // ---------- 餌 ----------
  function makeFood(x, y, v, kind, hue) {
    return {
      x, y, v,
      r: 3.6 + Math.sqrt(v) * 1.5,
      kind: kind ?? (Math.random() < 0.11 ? 1 : 0), // 1 = クラッパー(高得点)
      // 色は見た目だけの情報。スナップショットには載せないので、
      // 受け取った側は自分で引き直す（どの粒が何色でも遊びは変わらない）
      hue: hue ?? pick(['#f3b553', '#a3f0f0', '#f4efea', '#f08a5d', '#9ad9c0']),
      ph: Math.random() * TAU,
      gone: false,   // 食われた印。後から生やすと形が変わって遅くなるのでここで宣言する
    };
  }

  // 餌は数が多いので毎回まるごとは送らない。増えた分・消えた分だけ拾っておく
  function addFood(f) {
    f.id = ++fSeq;
    food.push(f);
    if (f.r > maxFoodR) maxFoodR = f.r;   // 格子の探索半径。取りこぼさないための上限
    if (world.diffs) fAdd.push(f);
    return f;
  }
  function delFood(i) {
    if (world.diffs) fDel.push(food[i].id);
    food.splice(i, 1);
  }
  function spawnFood(n) {
    for (let i = 0; i < n; i++) {
      const v = Math.random() < 0.12 ? rand(9, 20) : rand(2.5, 6);
      const p = arena.spot();
      addFood(makeFood(p.x, p.y, v));
    }
  }
  const foodTarget = () => Math.round((W * W) / FOOD_PER_AREA);

  // ---------- 餌の格子 ----------
  // 捕食判定は「頭のすぐ近く」しか要らないのに、素直に書くと
  // サメ14匹 × 餌1260個 = 17,640回/tick の総当たりになる（実測で CPU の 65%）。
  // マス目に配って近傍だけ見る。餌はほぼ動かないが、飛行機サメの吸引で動くのと
  // 湧き・消えが毎ティックあるので、毎ティック配り直す（1260回で、上の 17,640回を消せる）。
  const CELL = 240;
  const GW = Math.ceil(arena.bb.w / CELL) + 2;   // 外周1マスぶんの余白。丸め落ちを外へ出さない
  const GH = Math.ceil(arena.bb.h / CELL) + 2;
  const NCELL = GW * GH;
  const col = (x) => clamp(Math.floor((x - arena.bb.x0) / CELL) + 1, 0, GW - 1);
  const row = (y) => clamp(Math.floor((y - arena.bb.y0) / CELL) + 1, 0, GH - 1);

  // 計数ソートで並べ替える。最初はマスごとに配列を持たせたが、
  // 700本の配列を毎ティック空にして 1260 個を push し直すコストが
  // 今度は全体の 46% を占めた（本末転倒）。型付き配列なら確保もGCも起きない。
  //   at[c]..at[c+1] が マス c の中身で、items[k] が food の添字
  const at = new Int32Array(NCELL + 1);
  const cursor = new Int32Array(NCELL);
  let items = new Int32Array(2048);
  let fcell = new Int32Array(2048);

  function regrid() {
    const n = food.length;
    if (items.length < n) { items = new Int32Array(n * 2); fcell = new Int32Array(n * 2); }
    at.fill(0);
    for (let i = 0; i < n; i++) {
      const f = food[i];
      const c = row(f.y) * GW + col(f.x);
      fcell[i] = c;
      at[c + 1]++;
    }
    for (let c = 0; c < NCELL; c++) at[c + 1] += at[c];
    cursor.set(at.subarray(0, NCELL));
    for (let i = 0; i < n; i++) items[cursor[fcell[i]]++] = i;
  }

  /**
   * (x,y) から rad 以内に「居るかもしれない」餌を全部 fn へ。取りこぼしは出ない。
   * 添字を渡すので、呼んでいる間に food から要素を抜いてはいけない
   * （resolve は印を付けて最後にまとめて詰める）。
   */
  function eachNearFood(x, y, rad, fn) {
    const c0 = col(x - rad), c1 = col(x + rad);
    const r0 = row(y - rad), r1 = row(y + rad);
    for (let cy = r0; cy <= r1; cy++) {
      const base = cy * GW;
      for (let cx = c0; cx <= c1; cx++) {
        const c = base + cx;
        for (let k = at[c]; k < at[c + 1]; k++) fn(food[items[k]]);
      }
    }
  }

  // ---------- サメ ----------
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
      ex: 0, ey: 0, ea: 0,       // スナップショットとのズレ（位置と向き）。数フレームかけて溶かす
      x, y, angle, aim: angle,   // 初回入力が来るまでは湧いた向きへ直進
      mass: START_MASS,
      path: [{ x, y }],
      body: [], wake: [],
      wbb: null,                 // 航跡の外接矩形。ここで宣言しておかないと形が途中で変わる
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

  /**
   * 人ひとりぶんの席。nid はサーバが配る接続ID。
   * 満席なら一番小さいボットと入れ替える —— 足すだけだと人が増えるほど海が混み、
   * 8人揃った部屋が 22 匹になって密度が別のゲームになってしまう。
   */
  world.addPlayer = ({ nid, sharkId, name, isBot = false }) => {
    if (!isBot && sharks.length >= BOT_COUNT + 1) {
      let worst = -1;
      for (let i = 0; i < sharks.length; i++) {
        if (sharks[i].isBot && (worst < 0 || sharks[i].mass < sharks[worst].mass)) worst = i;
      }
      if (worst >= 0) { sharks.splice(worst, 1); rosterDirty = true; }
    }
    const def = SHARKS.find((s) => s.id === sharkId) || SHARKS[0];
    const s = makeShark(def, isBot, name, nid);
    sharks.push(s);
    return s;
  };

  world.removeShark = (nid) => {
    const i = sharks.findIndex((o) => o.nid === nid);
    if (i < 0) return;
    sharks.splice(i, 1);
    rosterDirty = true;
  };

  /** 空いた席をボットで埋める。何度呼んでも合計 BOT_COUNT+1 匹を超えない */
  world.fillBots = () => {
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    for (let i = 0; sharks.length < BOT_COUNT + 1; i++) {
      sharks.push(makeShark(pick(SHARKS), true, names[i % names.length]));
    }
  };

  /** 餌を初期量まで湧かせる。盤面を持つ側（authority）だけが呼ぶ */
  world.seedFood = () => { if (!food.length) spawnFood(foodTarget()); };

  world.useSkill = (s) => {
    if (!s.alive || s.cd > 0) return;
    const sk = s.def.skill;
    s.cd = sk.cd;
    events.push({ k: 'skill', shark: s });
    switch (s.def.id) {
      case 'jindaiji': s.guard = sk.dur; break;
      case 'tamagawa': s.rapid = sk.dur; break;
      default: s.skill = sk.dur;
    }
  };

  /** 操作の反映。サーバはゲストから届いた分を、ブラウザは自分の入力をここへ通す */
  world.input = (nid, { aim, boost, x, y } = {}) => {
    const s = sharks.find((o) => o.nid === nid);
    if (!s) return;
    if (typeof aim === 'number' && Number.isFinite(aim)) s.aim = aim;
    if (boost !== undefined) s.boost = !!boost;
    if (world.authority && typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y)) {
      if (s.alive && arena.inside(x, y)) {
        const d = Math.hypot(x - s.x, y - s.y);
        const maxDist = (BASE_SPEED * s.def.speed * BOOST_MULT * s.def.boostPower * 3.1) * 0.15 + 40;
        if (d <= maxDist) {
          s.x = x;
          s.y = y;
        }
      }
    }
  };

  // ---------- 体 ----------
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

  /** how: 'body' | 'wake'（killer が居るとき）。killer が無ければ外壁 */
  function die(s, killer, how) {
    s.alive = false;
    s.wake.length = 0;   // 死んだ本人の航跡が幽霊として残らないように
    const cause = killer ? `${killer.name} の${how === 'wake' ? '航跡' : '胴体'}` : '外壁';
    events.push({ k: 'die', shark: s, cause });
    if (world.diffs) deaths.push([s.nid, cause]);

    // 質量を餌としてばら撒く
    const per = Math.max(4, s.mass / Math.max(6, s.body.length));
    for (const p of s.body) {
      if (Math.random() < 0.75) {
        addFood(makeFood(p.x + rand(-8, 8), p.y + rand(-8, 8), per * rand(0.6, 1.2), 0));
      }
    }
    if (killer) killer.kills++;

    // 人のサメは湧き直さない（本人はリザルトへ抜ける）。湧き直すのはボットだけ
    if (!s.isBot) return;
    const t = setTimeout(() => {
      timers.delete(t);
      if (!running) return;
      const i = sharks.indexOf(s);
      if (i < 0) return;
      sharks[i] = makeShark(pick(SHARKS), true, s.name, s.nid);
      events.push({ k: 'respawn', nid: s.nid, shark: sharks[i] });
    }, 2200);
    timers.add(t);
  }

  // ---------- ボットAI ----------
  const HUNT_R2 = 900 * 900;   // 狩りの間合い。二乗のまま比べる
  const HUNT_DASH = 520;       // ここまで寄ったらダッシュ＝航跡を相手の前に敷く

  function botThink(s, dt) {
    s.moodT -= dt;
    if (s.moodT <= 0) { s.moodT = rand(1.2, 3.5); s.mood = Math.random(); }

    // 獲物さがし。大きさは見ない —— 当たって死ぬのは突っ込んだ側なので（resolve と同じ前提）、
    // 小さいボットが大きい人の鼻先を切るのは成立する。
    // 全員が狩ると逃げ場が無くなるので、狩るのは mood の高い個体だけ（再抽選で顔ぶれが入れ替わる）
    let prey = null, pd2 = HUNT_R2;
    if (s.mood > 0.45) {
      for (const o of sharks) {
        if (o === s || !o.alive || o.iframe > 0) continue;
        let d2 = (o.x - s.x) ** 2 + (o.y - s.y) ** 2;
        if (!o.isBot) d2 *= 0.25;        // 人は距離半分ぶん魅力的に見える
        if (d2 < pd2) { pd2 = d2; prey = o; }
      }
    }

    let tx, ty, hunt = 0;
    if (prey) {
      // 迎撃点：相手が「自分が着くまでに進む距離」だけ前に置く。
      // 180px 固定だと速い相手の後ろを追い、遅い相手には行き過ぎる
      hunt = Math.hypot(prey.x - s.x, prey.y - s.y);
      const lead = clamp(hunt * 0.75, 90, 420);
      tx = prey.x + Math.cos(prey.angle) * lead;
      ty = prey.y + Math.sin(prey.angle) * lead;
      s.goal = null;                     // 餌の目標は捨てる。狩りをやめたら引き直す
    } else {
      // 一番近い餌の塊を狙う
      tx = s.goal?.x; ty = s.goal?.y;
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
    }

    let want = Math.atan2(ty - s.y, tx - s.x);

    // 胴体と航跡を回避。サイズに関係なく当たれば死ぬので相手は選ばない。
    // ただし狩り中は間合いを詰める —— 190px で必ず逃げると、仕掛けた直後に
    // 自分から離れてしまい一度も刺せない。
    // 頭から4節は見ない：そこは当たっても死なない（resolve の衝突判定と同じ i=4）
    const near = hunt ? 120 : 190;
    const nearW = hunt ? 130 : 170;
    for (const o of sharks) {
      if (o === s || !o.alive) continue;
      if (Math.hypot(o.x - s.x, o.y - s.y) <= o.reach + near + 70) {
        for (let i = 4; i < o.body.length; i += 2) {
          const p = o.body[i];
          if (Math.hypot(p.x - s.x, p.y - s.y) < near) { want = Math.atan2(s.y - p.y, s.x - p.x); break; }
        }
      }
      if (o.wbb && s.x >= o.wbb.x0 - nearW && s.x <= o.wbb.x1 + nearW
                && s.y >= o.wbb.y0 - nearW && s.y <= o.wbb.y1 + nearW) {
        for (let i = 0; i < o.wake.length; i += 2) {
          const p = o.wake[i];
          if (Math.hypot(p.x - s.x, p.y - s.y) < nearW) { want = Math.atan2(s.y - p.y, s.x - p.x); break; }
        }
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
    // 獲物に寄ったらダッシュ。速いだけでなく、キル帯そのものである航跡を相手の前へ敷ける
    s.boost = !s.winded && (hunt ? hunt < HUNT_DASH : s.mood > 0.9);
    // 追い詰めている間はスキルも切る（シネマの減速・多摩川の急流がそのまま決め手になる）
    if (s.cd <= 0 && Math.random() < (hunt && hunt < HUNT_DASH ? 0.05 : 0.004)) world.useSkill(s);
  }

  // ---------- 判定 ----------
  /** authority だけが回す。餌の増減とサメの生死＝盤面の「正」がここで決まる */
  function resolve(dt) {
    regrid();

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
        eachNearFood(s.x, s.y, 300, (f) => {
          const dx = s.x - f.x, dy = s.y - f.y;
          const d = Math.hypot(dx, dy);
          if (d < 300 && d > 1) { f.x += (dx / d) * 480 * dt; f.y += (dy / d) * 480 * dt; }
        });
      }
    }

    // 捕食。格子を回している最中に food から抜くと添字が崩れるので、
    // 印を付けておいて最後に1回で詰める
    let ate = false;
    for (const s of sharks) {
      if (!s.alive) continue;
      const r = radiusOf(s.mass) + 6;
      eachNearFood(s.x, s.y, r + maxFoodR, (f) => {
        if (f.gone) return;
        if (Math.abs(f.x - s.x) > r + f.r || Math.abs(f.y - s.y) > r + f.r) return;
        if ((f.x - s.x) ** 2 + (f.y - s.y) ** 2 >= (r + f.r) ** 2) return;
        // ボットは餌を完璧に拾えるので、成長を抑えて難易度を整える
        s.mass += f.v * s.def.growth * (f.kind ? 2.2 : 1) * (s.isBot ? BOT_GROWTH : 1);
        events.push({ k: 'eat', shark: s, x: f.x, y: f.y, hue: f.hue, kind: f.kind });
        f.gone = true;
        ate = true;
        if (world.diffs) fDel.push(f.id);
      });
    }
    if (ate) {
      for (let i = food.length - 1; i >= 0; i--) if (food[i].gone) food.splice(i, 1);
    }
    const target = foodTarget();
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
        // 航跡は本体から離れた場所に残るので、胴体の早期棄却（o.reach）は使えない。
        // 代わりに航跡そのものの外接矩形で弾く（step で作ってある）
        if (!hit && o.wbb && s.x >= o.wbb.x0 - hr && s.x <= o.wbb.x1 + hr
                        && s.y >= o.wbb.y0 - hr && s.y <= o.wbb.y1 + hr) {
          for (let i = 0; i < o.wake.length; i++) {
            const p = o.wake[i];
            if ((p.x - s.x) ** 2 + (p.y - s.y) ** 2 < (p.r + hr) ** 2) { hit = 'wake'; break; }
          }
        }
        if (!hit) continue;
        if (s.guard > 0) {
          s.guard = 0; s.iframe = 1.2;
          events.push({ k: 'guard', shark: s });
        } else {
          die(s, o, hit);
        }
        break;
      }
    }
  }

  // ---------- 1ティック ----------
  world.step = (dt) => {
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
      // 人のサメ（自分・他人とも）は aim/boost が外から入る。ここでは何もしない

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
        } else if (world.authority) {
          events.push({ k: 'wall', shark: s, x: s.x, y: s.y });
          die(s, null);
          continue;
        }
        // 予測側：壁での生死もサーバが決める。はみ出したまま補正を待つ
      }

      // スナップショットとのズレは数フレームかけて溶かす（見えるワープを作らない）。
      // 向きも位置と同じに扱う —— aim へ渡すだけだと上の steer が旋回レート上限で
      // 追いかける形になり、曲がり続けている間ずっと遅れが残る
      if (s.ex || s.ey || s.ea) {
        const k = Math.min(1, dt * 7);
        s.x += s.ex * k; s.y += s.ey * k;
        s.ex -= s.ex * k; s.ey -= s.ey * k;
        s.angle += s.ea * k; s.ea -= s.ea * k;
      }

      // 航跡：ダッシュ中だけ点を置き、寿命が切れた先頭から消える（尻尾から引っ込む）
      if (canBoost) {
        const w = s.wake[s.wake.length - 1];
        if (!w || (s.x - w.x) ** 2 + (s.y - w.y) ** 2 >= WAKE_STEP * WAKE_STEP) {
          s.wake.push({ x: s.x, y: s.y, r: r * WAKE_R, born: elapsed });
        }
      }
      while (s.wake.length && elapsed - s.wake[0].born > WAKE_LIFE) s.wake.shift();

      // 航跡の外接矩形。衝突も回避も「他人の航跡40点を距離に関係なく毎tick全部見る」に
      // なっていて（胴体側にある早期棄却が航跡側だけ無い）、判定を変えずに弾くために置く。
      // 1匹40点を1回なめる代わりに、13匹ぶんの走査が矩形の外なら丸ごと消える
      if (s.wake.length) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, wr = 0;
        for (let i = 0; i < s.wake.length; i++) {
          const p = s.wake[i];
          if (p.x < x0) x0 = p.x;
          if (p.x > x1) x1 = p.x;
          if (p.y < y0) y0 = p.y;
          if (p.y > y1) y1 = p.y;
          if (p.r > wr) wr = p.r;
        }
        s.wbb = { x0: x0 - wr, y0: y0 - wr, x1: x1 + wr, y1: y1 + wr };
      } else s.wbb = null;

      // 軌跡サンプリング
      const h = s.path[0];
      if ((s.x - h.x) ** 2 + (s.y - h.y) ** 2 >= PATH_STEP * PATH_STEP) {
        s.path.unshift({ x: s.x, y: s.y });
      }
      const need = Math.ceil(bodyLength(r, s.def) / PATH_STEP) + 3;
      if (s.path.length > need) s.path.length = need;

      s.body = bodyOf(s);
    }

    // ここから先（餌の増減・生死）は authority だけが回す。答えが2つあると盤面が割れる。
    // 予測側は結果をスナップショットで受け取る（吸引で動いた餌もサーバの座標が正）
    if (world.authority) resolve(dt);
  };

  // ---------- 配信 ----------
  const packShark = (o) => [
    o.nid, Math.round(o.x), Math.round(o.y), +o.angle.toFixed(2), Math.round(o.mass),
    // slow / rapid は見た目ではなく速度と旋回上限そのものを変える。載せ忘れると
    // 予測側だけが等速で走り、スロー中は追い越し・急流中は置いていかれる（実測 64px）
    (o.alive ? 1 : 0) | (o.boost ? 2 : 0) | (o.skill > 0 ? 4 : 0) | (o.guard > 0 ? 8 : 0) | (o.iframe > 0 ? 16 : 0)
    | (o.slow > 0 ? 32 : 0) | (o.rapid > 0 ? 64 : 0),
  ];
  const packFood = (f) => [f.id, Math.round(f.x), Math.round(f.y), +f.v.toFixed(1), f.kind];
  const roster = () => sharks.map((o) => [o.nid, o.name, SHARKS.indexOf(o.def)]);

  /**
   * full=true なら盤面まるごと（入室してきた1人へ）。
   * それ以外は差分：サメは全部、餌は増減だけ、名簿は顔ぶれが変わったときだけ。
   */
  world.snapshot = (full = false) => {
    if (full) return { t: 'full', r: roster(), s: sharks.map(packShark), f: food.map(packFood) };
    const m = { t: 'snap', s: sharks.map(packShark) };
    if (fAdd.length) m.fa = fAdd.map(packFood);
    if (fDel.length) m.fd = fDel.slice();
    if (deaths.length) m.d = deaths.slice();   // 死因。リザルトの「◯◯に食われた」の出どころ
    if (rosterDirty) { m.r = roster(); rosterDirty = false; }
    fAdd.length = fDel.length = deaths.length = 0;
    return m;
  };

  /**
   * 予測側がサーバの答えを受け取る。
   * me = 自分のサメの nid。自分の向き・ダッシュ・スキル演出はローカルの値を残す
   * （押した瞬間から反応させたいので、往復ぶん遅れて上書きされると手応えが消える）。
   */
  world.applySnapshot = (m, me) => {
    const full = m.t === 'full';
    if (m.r) {
      const keep = new Set(m.r.map((e) => e[0]));
      for (const [nid, nm, di] of m.r) {
        if (nid === me) continue;
        const d = SHARKS[di] || SHARKS[0];
        const s = sharks.find((o) => o.nid === nid);
        if (!s) {
          // 湧かせる場所を知らないので makeShark は arena の適当な点へ置く。alive のまま
          // 下の位置ループへ渡すと full でも復活でもない＝補間の枝に落ち、初対面のサメが
          // 湧いた点から本当の居場所まで盤面を横断する（実測 2.4kpx / 278px per frame）。
          // 死んだ状態で入れて、同じスナップショットの !wasAlive でワープさせる
          sharks.push(Object.assign(makeShark(d, false, nm, nid), { alive: false }));
        } else if (s.def !== d) {
          s.def = d; s.path = [{ x: s.x, y: s.y }]; s.wake.length = 0;   // 復活して別のサメになった
        }
      }
      for (let i = sharks.length - 1; i >= 0; i--) {
        if (sharks[i].nid !== me && !keep.has(sharks[i].nid)) sharks.splice(i, 1);
      }
    }

    if (full) food.length = 0;
    for (const a of m.f ?? m.fa ?? []) {
      const f = makeFood(a[1], a[2], a[3], a[4]);
      f.id = a[0];
      food.push(f);
      if (f.id > fSeq) fSeq = f.id;   // goSolo で自分が湧かせ始めたとき id がぶつからないように
    }
    if (m.fd) {
      const gone = new Set(m.fd);
      for (let i = food.length - 1; i >= 0; i--) {
        if (!gone.has(food[i].id)) continue;
        const f = food[i];
        events.push({ k: 'eat', shark: null, x: f.x, y: f.y, hue: f.hue, kind: f.kind });
        food.splice(i, 1);
      }
    }
    const causes = new Map(m.d ?? []);

    for (const [nid, x, y, ang, mass, flags] of m.s) {
      const s = sharks.find((o) => o.nid === nid);
      if (!s) continue;
      const wasAlive = s.alive;
      s.mass = mass;
      if (s.nid !== me) {
        // aim は「次のスナップショットまで曲がり続ける先」、ea は「いま開いている向きのズレ」。
        // 前者だけだと旋回中に体が進行方向を向かず横滑りする。
        // scripts/turn-probe.mjs 実測、急旋回の横滑り p95 で 12.4° → 8.9°
        s.aim = ang;
        s.ea = angDiff(s.angle, ang);
        s.boost = !!(flags & 2);
        s.skill = flags & 4 ? 0.25 : 0;
        s.guard = flags & 8 ? 0.25 : 0;
        s.iframe = flags & 16 ? 0.25 : 0;
      }
      // スロー / 急流は自分にも当てる。他のフラグと違って「自分の操作」ではなく
      // サーバが決めた効果なので、除け者にすると当てられた本人の予測だけが全速のままになる。
      // 残り時間が上の演出フラグ(0.25)より短いのは、速度そのものを変えるから ——
      // 効果が切れた後まで残ると 3.1倍のまま突っ走る。届かない側へ倒して次の便で張り直す
      s.slow = flags & 32 ? 0.15 : 0;
      s.rapid = flags & 64 ? 0.15 : 0;
      s.alive = !!(flags & 1);

      if (s.nid === me) {
        // 自機：クライアント主導の位置計算。3段階（デッドゾーン、累積微小補正、致命的ズレ）で補正
        if (full || !wasAlive) {
          s.x = x; s.y = y; s.angle = ang; s.ex = s.ey = s.ea = 0;
          s.path = [{ x, y }]; s.wake.length = 0;
          events.push({ k: 'warp', shark: s });
        } else {
          const d = Math.hypot(x - s.x, y - s.y);
          if (d < 25) {
            // ① デッドゾーン：通常の遅延による微小差は無視（ジッターゼロ）
            s.ex = 0; s.ey = 0;
          } else if (d < 120) {
            // ② 累積微小誤差：目に見えない緩やかな速度で溶かす
            s.ex = (x - s.x) * 0.2; s.ey = (y - s.y) * 0.2;
          } else {
            // ③ 致命的なずれ：即時スナップ
            s.x = x; s.y = y; s.ex = 0; s.ey = 0;
            s.path = [{ x, y }];
            events.push({ k: 'warp', shark: s });
          }
        }
      } else {
        if (full || !wasAlive) {                    // 入室直後と復活はワープさせる（補間で盤面を横断させない）
          s.x = x; s.y = y; s.angle = ang; s.ex = s.ey = s.ea = 0;
          s.path = [{ x, y }]; s.wake.length = 0;
          events.push({ k: 'warp', shark: s });
        } else {
          s.ex = x - s.x; s.ey = y - s.y;           // ズレは step で少しずつ詰める
        }
      }
      if (wasAlive && !s.alive) {
        s.wake.length = 0;
        events.push({ k: 'die', shark: s, cause: causes.get(nid) ?? '' });
      }

    }
  };

  /**
   * サーバから切り離されて「独りの海」として続ける。
   * 盤面が空のまま来ることがある（サーバが落ちた等）ので、ボットと餌もここで補う。
   * 補わないと「サメも餌も居ない海」になり、ゲームとして成立しない
   */
  world.goSolo = (me) => {
    world.authority = true;
    world.diffs = false;
    for (const o of sharks) if (o.nid !== me) o.isBot = true;
    world.fillBots();
    world.seedFood();
  };

  world.destroy = () => {
    running = false;
    for (const t of timers) clearTimeout(t);
    timers.clear();
  };

  return world;
}
