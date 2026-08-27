// 遊び方の3ページに1つずつ載る、ルール専用の小さなデモ。
//
// 本編と同じ絵で描く。paintSpriteShark() は {x, y, r} の列（頭が先頭）を渡すだけで
// 塗ってくれるので、説明の絵と実際の画面が食い違わない。体長も本編と同じ
// bodyLength(r, def) で出す。ここを自前の定数にすると原画が引き伸ばされて、
// 説明の中のサメだけ縦横比の狂った別種になる。
//
// 台本は時間の純関数にしてある。demoState(page, t) が「その瞬間の盤面」を返し、
// 描画はそれを塗るだけ。状態を持たないので、ページを行き来してもループの途中から
// 正しく描けるし、Node からそのまま検証できる（howto-demo.test.mjs）。

import { bodyLength, paintShark, paintSpriteShark, taper } from './shark-art.js';

const TAU = Math.PI * 2;

// 仮想の盤面。canvas の実寸に合わせて拡縮するので、台本は px を意識しない
export const VW = 320, VH = 140;

// ページごとのループ長(秒)。②が抜けたあとも少し回すのは、サメが枠から出たあとに
// 跡だけが残っている絵を見せるため（＝「跡が2.5秒のこる」の実演）
export const LOOP = [6, 3.0, 4.0];
const WAKE_LIFE = 2.5;               // 跡が残る時間。本編の説明文と同じ値にしてある
const CUT_AT = 2.6;                  // ③でカットが起きる時刻
const CUT_HOLD = 0.9;                // CUT! の見せ時間

// ---------- 台本（時刻 u の位置。u は秒、範囲外も連続していること） ----------
// ① カーソル（ゆび）を8の字で動かし、サメが遅れて追う
const p0 = (u) => ({
  x: VW / 2 + 108 * Math.sin(TAU * u / LOOP[0]),
  y: VH / 2 + 30 * Math.sin(2 * TAU * u / LOOP[0]),
});
const LAG = 0.5;   // サメが遅れる時間。これが「追いかけている」に見える正体
const WAKE_R = 0.42;   // 跡の太さ ÷ 胴の半径。sim.js と同じ値にしてある

// ② ゆっくり泳いでいる途中でダッシュする。
//    等速で横切らせると「加速」がどこにも出ないので、速度に段差を作り、
//    位置はその積分で出す（＝助走 → 一定加速 → 巡航、の一筆書き）。
//    跡が出るのはダッシュを踏んでから（本編も sim.js の canBoost 中だけ置く）。
//    最初から引いていると、跡がダッシュの結果だという因果がどこにも出ない
const SLOW = 40, FAST = 235;      // px/秒
const D0 = 1.2, D1 = 1.65;        // 加速している区間
const dashK = (u) => Math.max(0, Math.min(1, (u - D0) / (D1 - D0)));
/** ∫v du。加速区間は台形なので (u-D0)·k/2 に畳める */
const travel = (u) => {
  const ramp = u <= D0 ? 0
    : u >= D1 ? (D1 - D0) / 2 + (u - D1)
      : ((u - D0) * dashK(u)) / 2;
  return SLOW * u + (FAST - SLOW) * ramp;
};
// 体まるごとが枠に入る位置から始める。外で助走させるとループの3分の1が空の海になり、
// 左端から出そうとすると、いちばん見せたい「ゆっくり」の間ずっと胴が壁に埋まる
const p1 = (u) => ({ x: 62 + travel(u), y: VH / 2 + 9 * Math.sin(u * 2.2) });

// ③ 小さいサメ(a)が引いた跡へ、大きいサメ(b)が頭から突っ込む。
//    b が a より大きいのは「大きさは関係ない」を絵で言うため
const pa = (u) => ({ x: -30 + 95 * u, y: 42 });
const pb = (u) => ({ x: 250 - 62 * u, y: 135 - 36 * u });

/**
 * path を後ろ向きに弧長で歩いて体を作る。
 * ここは本編（sim.js）と違って軌跡を貯めず、path が t を受け取る解析関数なので、
 * いくらでも細かく刻み直せる。添字ではなく実測の弧長で歩くのは、時間で等分すると
 * 速いところほど刻みが粗くなり、速度に応じて体が伸び縮みするため。
 */
function bodyAlong(path, t, len, r, n = 16) {
  const head = path(t);
  const out = [{ x: head.x, y: head.y, r: r * taper(0) }];
  const step = len / n;
  let u = t, cur = head;
  for (let k = 1; k <= n; k++) {
    let d = step;
    // 止まっている台本を渡されると進めないので、遡る量にも上限を置く
    while (d > 0 && t - u < 8) {
      u -= 0.012;
      const q = path(u);
      const seg = Math.hypot(q.x - cur.x, q.y - cur.y);
      if (seg >= d) {
        cur = { x: cur.x + ((q.x - cur.x) / seg) * d, y: cur.y + ((q.y - cur.y) / seg) * d };
        d = 0;
      } else {
        cur = q; d -= seg;
      }
    }
    out.push({ x: cur.x, y: cur.y, r: r * taper(k / n) });
  }
  return out;
}

// 体長は本編と同じ「太さ × 原画の縦横比」。def が無い（Node のテスト）ときは既定値
const actor = (path, u, r, def, who, dead = false) => {
  const body = bodyAlong(path, u, bodyLength(r, def || {}), r);
  return { body, who, dead, angle: Math.atan2(body[0].y - body[1].y, body[0].x - body[1].x) };
};

/** 跡。from から t までの通り道を点で返す */
function trailOf(path, t, from) {
  const pts = [];
  for (let u = from; u < t; u += 0.05) pts.push(path(u));
  pts.push(path(t));
  return pts;
}

/**
 * その瞬間の盤面。page は 0..2、time は秒（ループ長で折り返す）。
 * defs は { self, other } のサメ種（体長に使う。省略可）。
 * who: 'self' = プレイヤーのサメ、'other' = 相手。描画側が実際の種を当てる
 */
export function demoState(page, time, defs = {}) {
  const loop = LOOP[page];
  const t = ((time % loop) + loop) % loop;

  if (page === 0) {
    return {
      cursor: p0(t), actors: [actor(p0, t - LAG, 15, defs.self, 'self')],
      trail: null, dash: 0, cut: null,
    };
  }
  if (page === 1) {
    // 跡はダッシュを踏んだ地点から生える。踏む前は跡そのものが無い
    const from = Math.max(D0, t - WAKE_LIFE);
    return {
      actors: [actor(p1, t, 15, defs.self, 'self')],
      trail: t > D0 ? { pts: trailOf(p1, t, from), who: 'self', r: 15 * WAKE_R } : null,
      dash: dashK(t),
      cut: null,
    };
  }
  const hit = t >= CUT_AT;
  return {
    actors: [
      actor(pa, t, 11, defs.self, 'self'),
      actor(pb, Math.min(t, CUT_AT), 17, defs.other, 'other', hit),
    ],
    trail: { pts: trailOf(pa, t, Math.max(0, t - WAKE_LIFE)), who: 'self', r: 11 * WAKE_R },
    dash: 0,
    cut: hit ? { ...pb(CUT_AT), k: Math.min(1, (t - CUT_AT) / CUT_HOLD) } : null,
  };
}

// ---------- 描画 ----------
const PAPER = '#f4efea';
const INK = '#2d2d2d';
const YELLOW = '#f3b553';

// 本編の海と同じ点々（game.js の dotTile と同じ間隔・同じ濃さ）。
// 単色で塗ると、タイトル背景の dot-bg と区別が付かず箱が背景の穴に見える
function dotTile() {
  const c = document.createElement('canvas');
  c.width = c.height = 60;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(244,239,234,.10)';
  g.fillRect(0, 0, 4, 4);
  return c;
}

function paintTrail(ctx, trail, def, t) {
  const { pts } = trail;
  if (pts.length < 2) return;
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  // 本編と同じ2度塗り。帯の色＋流れる白い破線で「触れると危ない帯」に見せる
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = def.accent;
  ctx.lineWidth = trail.r * 2;
  ctx.stroke();
  ctx.globalAlpha = 0.8;
  ctx.strokeStyle = PAPER;
  ctx.lineWidth = Math.max(1.5, trail.r * 0.45);
  ctx.setLineDash([7, 10]);
  ctx.lineDashOffset = -t * 70;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

function paintCursor(ctx, c, t) {
  const pulse = 5.5 + Math.sin(t * 6) * 1.2;
  ctx.strokeStyle = PAPER; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(c.x, c.y, pulse + 4, 0, TAU); ctx.stroke();
  ctx.fillStyle = YELLOW;
  ctx.beginPath(); ctx.arc(c.x, c.y, 3, 0, TAU); ctx.fill();
}

/**
 * 加速中の流線。速さの差だけでも位置は変わるが、140px の箱の中では
 * 「速くなった」より「もう向こうに居る」に見えてしまう。後ろへ流れる線を足すと
 * 一目で加速として読める。胴の外側に置くので絵は隠さない
 */
function paintSpeedLines(ctx, head, k, t) {
  if (k <= 0.02) return;
  ctx.save();
  ctx.strokeStyle = PAPER;
  ctx.lineCap = 'round';
  ctx.lineWidth = 2.4;
  for (let i = 0; i < 5; i++) {
    const ph = (t * 2.4 + i * 0.41) % 1;          // 0→1 で後ろへ流れる
    const x = head.x + 14 - ph * 96;
    const y = head.y + (i - 2) * 12;
    ctx.globalAlpha = k * 0.6 * Math.sin(Math.PI * ph);   // 出てきて、消える
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 24, y); ctx.stroke();
  }
  ctx.restore();
}

function paintCut(ctx, cut) {
  const k = cut.k;
  ctx.save();
  // 赤い衝撃。広がって薄くなる
  ctx.globalAlpha = (1 - k) * 0.7;
  ctx.fillStyle = '#ba1a1a';
  ctx.beginPath(); ctx.arc(cut.x, cut.y, 10 + k * 26, 0, TAU); ctx.fill();
  // CUT! の判。リザルトの見出しと同じ「墨地に黄文字・傾け」で揃える。
  // ぶつかった場所には重ねない（肝心の「跡に頭から触れた」瞬間が判で隠れる）。
  // 上下どちらへ逃がすかは衝突点で決める。固定にすると盤面の端で枠から出る
  ctx.translate(cut.x, cut.y + (cut.y < VH / 2 ? 34 : -34));
  ctx.globalAlpha = Math.min(1, k * 4);
  ctx.rotate(-0.14);
  ctx.scale(Math.min(1, 0.6 + k * 2), Math.min(1, 0.6 + k * 2));
  ctx.font = '900 18px "Arial Black", system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const w = ctx.measureText('CUT!').width + 16;
  ctx.fillStyle = INK;
  ctx.fillRect(-w / 2, -14, w, 28);
  ctx.fillStyle = YELLOW;
  ctx.fillText('CUT!', 0, 1);
  ctx.restore();
}

/**
 * canvas にデモを載せる。scene() は { page, self, other, water } を返す関数。
 * ページの状態は呼び側（main.js）が持ち、ここは毎フレーム聞きに行くだけにしてある。
 */
export function mountHowtoDemo(canvas, scene) {
  const ctx = canvas.getContext('2d');
  const t0 = performance.now();
  const dots = ctx.createPattern(dotTile(), 'repeat');

  function frame(now) {
    requestAnimationFrame(frame);
    // 遊び方を出していない間は描かない（tickPreviews と同じ判定）
    if (!canvas.isConnected || !canvas.offsetParent) return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr; canvas.height = h * dpr;
    }

    const { page, self, other, water } = scene();
    const t = (now - t0) / 1000;
    const s = demoState(page, t, { self, other });
    const defOf = (who) => (who === 'self' ? self : other);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = water;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = dots;      // 点々は画面座標のまま。拡縮に乗せると間隔が本編とずれる
    ctx.fillRect(0, 0, w, h);

    // 仮想盤面を短辺基準で収める。切れるより余白が出るほうがマシなので min
    const k = Math.min(w / VW, h / VH);
    ctx.translate((w - VW * k) / 2, (h - VH * k) / 2);
    ctx.scale(k, k);

    if (s.trail) paintTrail(ctx, s.trail, defOf(s.trail.who), t);
    if (s.dash) paintSpeedLines(ctx, s.actors[0].body[0], s.dash, t);
    for (const a of s.actors) {
      const def = defOf(a.who);
      ctx.save();
      if (a.dead) ctx.globalAlpha = 0.45;
      if (!paintSpriteShark(ctx, a.body, def)) {
        paintShark(ctx, a.body, a.angle, def, { lw: 2.4, wobble: t * 3 });
      }
      ctx.restore();
    }
    if (s.cursor) paintCursor(ctx, s.cursor, t);
    if (s.cut) paintCut(ctx, s.cut);

    // ループの継ぎ目は暗転でまたぐ。跡も CUT! も途中で切れるので、素で繋ぐと
    // 帯が瞬間移動したように見える。映画のカットと同じ扱いにして隠す
    const cyc = (t % LOOP[page]) / LOOP[page];
    const open = Math.min(1, Math.min(cyc, 1 - cyc) / 0.07);
    if (open < 1) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = `rgba(18, 29, 51, ${1 - open})`;
      ctx.fillRect(0, 0, w, h);
    }
  }
  requestAnimationFrame(frame);
}
