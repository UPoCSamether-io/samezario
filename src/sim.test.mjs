// 盤面の最小チェック: node src/sim.test.mjs
// サーバとブラウザが同じこのファイルを回すので、ここが壊れると両方が同時に壊れる。
import assert from 'node:assert/strict';
import { MAPS } from './data.js';
import { createWorld, makeArena, makeGimmick } from './sim.js';

const chofu = MAPS.find((m) => m.id === 'chofu');

// ---------------------------------------------------------------------------
// 1. 輪郭が単純多角形であること。
//
// 内外判定は Path2D + isPointInPath（nonzero）から ray casting（even-odd）へ
// 移した。この2つは自己交差の無い多角形でだけ答えが一致するので、前提そのものを
// 検査する —— 交差する輪郭を data.js に入れた瞬間、サーバとブラウザで
// 「壁の内側」の意味が食い違い、片方だけで死ぬサメが出る。
const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
const straddles = (p1, p2, p3, p4) => {
  const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
};

for (const map of MAPS) {
  const { xs, ys, n } = makeArena(map).poly;
  const pt = (i) => [xs[i % n], ys[i % n]];
  let hits = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;   // 隣り合う辺は端点を共有する
      if (straddles(pt(i), pt(i + 1), pt(j), pt(j + 1))) hits++;
    }
  }
  assert.equal(hits, 0, `${map.id} の輪郭が自己交差している（辺の交差 ${hits} 箇所）`);
}

// 2. 内外判定：外接矩形の外は必ず外、home は必ず内、spot() は必ず内
{
  const { inside, bb, home, spot } = makeArena(chofu);
  assert.ok(inside(home.x, home.y), 'home は内側');
  assert.ok(!inside(bb.x0 - 10, bb.y0 - 10), '外接矩形の外は外側');
  assert.ok(!inside(bb.x1 + 10, bb.y1 + 10), '外接矩形の外は外側');
  for (let i = 0; i < 200; i++) {
    const p = spot();
    assert.ok(inside(p.x, p.y), `spot() が外を返した: ${p.x},${p.y}`);
  }
}

// ---------------------------------------------------------------------------
// 3. 10秒ぶん回して、盤面が壊れないこと（NaN を出さない・壁の外へ出ない・餌が枯れない）
{
  const w = createWorld({ map: chofu });
  w.fillBots();
  w.seedFood();
  const start = w.food.length;
  assert.ok(start > 1000, `餌が湧いている: ${start}`);
  assert.equal(w.sharks.length, 14, 'ボットで 14 匹');

  for (let i = 0; i < 300; i++) {
    w.step(1 / 30);
    w.drainEvents();
  }
  for (const s of w.sharks) {
    assert.ok(Number.isFinite(s.x) && Number.isFinite(s.y), `${s.name} の座標が NaN`);
    assert.ok(Number.isFinite(s.mass) && s.mass > 0, `${s.name} の質量が壊れている: ${s.mass}`);
    // ボットは壁で押し戻されるので、生きている限り必ず内側に居る
    if (s.alive) assert.ok(w.arena.inside(s.x, s.y), `${s.name} が壁の外に居る`);
  }
  // 補充が効いていること（食われっぱなしで枯れない）
  assert.ok(w.food.length > start * 0.8, `餌が枯れた: ${start} -> ${w.food.length}`);
  w.destroy();
}

// 3b. 上と同じことを全マップで。エリアを描き直したときに効く。
// 多摩川は外接矩形の 1/3 しか中身がない細長い一本道で、湧き座標の棄却サンプリングも
// 壁の押し戻しも、いちばん条件が厳しいのはここになる
for (const map of MAPS) {
  const w = createWorld({ map });
  w.fillBots();
  w.seedFood();
  assert.ok(w.food.length > 1000, `${map.id}: 餌が湧いていない (${w.food.length})`);
  for (let i = 0; i < 150; i++) {
    w.step(1 / 30);
    w.drainEvents();
  }
  for (const s of w.sharks) {
    assert.ok(Number.isFinite(s.x) && Number.isFinite(s.y), `${map.id}: 座標が NaN`);
    if (s.alive) assert.ok(w.arena.inside(s.x, s.y), `${map.id}: ${s.name} が壁の外に居る`);
  }
  w.destroy();
}

// 4. 捕食：口元に置いた餌は食われ、質量が増える
{
  const w = createWorld({ map: chofu });
  const s = w.addPlayer({ nid: 'p1', sharkId: 'cinema', name: 'P' });
  w.step(1 / 30);
  const before = s.mass;
  // 数で見ると resolve() の補充（1ティック最大24個）に紛れるので、名指しした1粒を追う
  w.food.push({ x: s.x, y: s.y, v: 50, r: 5, kind: 0, hue: '#fff', ph: 0, id: 9999 });
  w.step(1 / 30);
  assert.ok(!w.food.some((f) => f.id === 9999), '口元の餌は消える');
  assert.ok(s.mass > before, `質量が増える: ${before} -> ${s.mass}`);
  w.destroy();
}

// 5. 衝突：他人の胴体へ頭から突っ込んだ側が死ぬ（サイズは関係ない）
{
  const w = createWorld({ map: chofu });
  const a = w.addPlayer({ nid: 'a', sharkId: 'cinema', name: 'A' });
  const b = w.addPlayer({ nid: 'b', sharkId: 'cinema', name: 'B' });
  for (let i = 0; i < 30; i++) w.step(1 / 30);   // 胴体ができるまで泳がせる

  // 壁から離れた所へ a ごと移してから試す。壁際のままやると外周死が先に起きて
  // 「当たらなかった」のか「当たったが壁が先だった」のか区別できない
  // （実測: そのままだと 200回中 72回が a の壁死、さらに稀に b の壁死で kills が付かない）。
  // 湧いた直後の無敵（3秒）はここまで残っているので、移す途中で死ぬ心配はない
  const clear = (() => {
    for (let i = 0; i < 500; i++) {
      const p = w.arena.spot();
      const open = [...Array(8)].every((_, k) => {
        const t = (k * Math.PI) / 4;
        return w.arena.inside(p.x + Math.cos(t) * 250, p.y + Math.sin(t) * 250);
      });
      if (open) return p;
    }
    throw new Error('壁から 250px 離れた場所が見つからない');
  })();
  const dx = clear.x - a.x, dy = clear.y - a.y;
  a.x += dx; a.y += dy;
  for (const p of a.path) { p.x += dx; p.y += dy; }
  w.step(1 / 30);                                 // 移した先で胴体を引き直す
  w.drainEvents();

  b.iframe = 0;                                   // 突っ込む側の無敵だけ解く
  b.mass = a.mass * 4;                            // 大きい側が突っ込んでも死ぬ
  const hit = a.body[8];                          // 頭から4節より後ろ＝当たる範囲
  b.x = hit.x; b.y = hit.y;
  w.step(1 / 30);

  assert.equal(b.alive, false, '突っ込んだ側が死ぬ');
  assert.equal(a.alive, true, '突っ込まれた側は生きている');
  assert.equal(a.kills, 1, '倒した数が付く');
  const died = w.drainEvents().find((e) => e.k === 'die');
  assert.equal(died.shark, b);
  assert.match(died.cause, /^A の/, `死因が入る: ${died.cause}`);
  w.destroy();
}

// 6. 壁：人のサメは外へ出ると死ぬ（ボットとすり抜け中は押し戻し）
{
  const w = createWorld({ map: chofu });
  const s = w.addPlayer({ nid: 'p1', sharkId: 'cinema', name: 'P' });
  w.step(1 / 30);
  s.iframe = 0;
  s.x = w.arena.bb.x1 + 500;                      // 外接矩形の外＝確実に外側
  s.y = w.arena.bb.y1 + 500;
  w.step(1 / 30);
  assert.equal(s.alive, false, '壁の外で死ぬ');
  assert.equal(w.drainEvents().find((e) => e.k === 'die').cause, '外壁');
  w.destroy();
}

// ---------------------------------------------------------------------------
// 7. 配信の往復：サーバの盤面がブラウザ側で同じ形に組み上がる
{
  const server = createWorld({ map: chofu, authority: true, diffs: true });
  server.fillBots();
  server.seedFood();
  server.addPlayer({ nid: 'me', sharkId: 'yokai', name: 'ME' });
  for (let i = 0; i < 60; i++) { server.step(1 / 30); server.drainEvents(); }

  const client = createWorld({ map: chofu, authority: false });
  client.addPlayer({ nid: 'me', sharkId: 'yokai', name: 'ME' });
  // サーバと同じ順（差分を確定させてから全部を撮る）。逆にすると full の中身が
  // 直後の差分でもう一度届いて餌が倍になる —— server/index.mjs の makeRoom と同じ話
  server.snapshot();
  client.applySnapshot(server.snapshot(true), 'me');

  assert.equal(client.sharks.length, server.sharks.length, 'サメの数が一致');
  assert.equal(client.food.length, server.food.length, '餌の数が一致');
  for (const s of server.sharks) {
    const c = client.sharks.find((o) => o.nid === s.nid);
    assert.ok(c, `${s.nid} が居ない`);
    assert.equal(c.name, s.name);
    assert.equal(c.def.id, s.def.id, `${s.nid} のサメ種が一致`);
    assert.ok(Math.abs(c.x - s.x) < 1 && Math.abs(c.y - s.y) < 1, `${s.nid} の座標がズレた`);
  }

  // 差分：サーバで消えた餌が、次のスナップショットでクライアントからも消える
  const gone = server.food[0].id;
  for (let i = 0; i < 30; i++) { server.step(1 / 30); server.drainEvents(); }
  client.applySnapshot(server.snapshot(), 'me');
  assert.equal(client.food.length, server.food.length, '差分適用後も餌の数が一致');
  if (!server.food.some((f) => f.id === gone)) {
    assert.ok(!client.food.some((f) => f.id === gone), '食われた餌は差分で消える');
  }

  // 予測側は生死を自分で決めない（authority=false なので壁でも死なない）
  const me = client.sharks.find((o) => o.nid === 'me');
  me.iframe = 0;
  me.x = client.arena.bb.x1 + 500;
  client.step(1 / 30);
  assert.equal(me.alive, true, '予測側は壁で勝手に殺さない（サーバの宣告を待つ）');

  server.destroy(); client.destroy();
}

// ---------------------------------------------------------------------------
// 8. クライアント主導座標の反映とサニティチェック（サーバー側）
{
  const w = createWorld({ map: chofu, authority: true });
  const s = w.addPlayer({ nid: 'p1', sharkId: 'cinema', name: 'P' });
  const origX = s.x, origY = s.y;

  // 正常な微小移動（10px 移動）は反映される
  w.input('p1', { aim: 0, boost: false, x: origX + 10, y: origY });
  assert.equal(s.x, origX + 10, '正常範囲の座標入力は反映される');

  // 異常なテレポート（1000px 先）は棄却される
  const currentX = s.x;
  w.input('p1', { aim: 0, boost: false, x: currentX + 1000, y: origY });
  assert.equal(s.x, currentX, '異常な距離のテレポートは棄却される');

  // エリア外の座標も棄却される
  w.input('p1', { aim: 0, boost: false, x: w.arena.bb.x1 + 900, y: w.arena.bb.y1 + 900 });
  assert.equal(s.x, currentX, 'エリア外の座標は棄却される');
  w.destroy();
}

// 9. 自機 (me) の3段階スナップショット補正
{
  const c = createWorld({ map: chofu, authority: false });
  const me = c.addPlayer({ nid: 'me', sharkId: 'cinema', name: 'ME' });
  me.x = 500; me.y = 500; me.ex = 0; me.ey = 0;

  // ① デッドゾーン (< 25px): 微小な遅れによる差は補正せずジッターゼロ (ex=0, ey=0)
  c.applySnapshot({
    t: 'snap',
    s: [[me.nid, 515, 510, me.angle, me.mass, 1]],
  }, 'me');
  assert.equal(me.ex, 0, 'デッドゾーン内では ex=0');
  assert.equal(me.ey, 0, 'デッドゾーン内では ey=0');
  assert.equal(me.x, 500, 'クライアント座標は維持される');

  // ② 累積微小誤差 (25px <= d < 120px): 緩やかに溶かすため微小な ex/ey が設定される
  c.applySnapshot({
    t: 'snap',
    s: [[me.nid, 550, 500, me.angle, me.mass, 1]],
  }, 'me');
  assert.ok(me.ex > 0 && me.ex <= 50 * 0.3, `累積誤差では緩やかな ex が設定される: ${me.ex}`);
  assert.equal(me.x, 500, '即時ワープはしない');

  // ③ 致命的ずれ (d >= 120px): 即座にスナップ補正
  c.applySnapshot({
    t: 'snap',
    s: [[me.nid, 800, 500, me.angle, me.mass, 1]],
  }, 'me');
  assert.equal(me.x, 800, '致命的なずれでは即時スナップされる');
  assert.equal(me.ex, 0, 'スナップ後は ex=0');
  c.destroy();
}

// ---------------------------------------------------------------------------
// 10. 攻撃的なボット。
//
// 衝突はサイズ無関係（突っ込んだ側が死ぬ）なので、ボットは自分より大きい人にも
// 仕掛けてよい。以前は「自分より小さい相手」しか狙わず、成長した人は永久に
// 標的にならなかった。ここが戻ると審査の3分で誰も襲ってこない海になる
{
  const w = createWorld({ map: chofu });
  const me = w.addPlayer({ nid: 'p1', sharkId: 'chofu', name: '人' });
  const bot = w.addPlayer({ nid: 'b9', sharkId: 'chofu', name: '鮫', isBot: true });

  // 湧き場所は毎回ランダムなので、壁が絡まない直線を探してそこへ並べる。
  // 壁回避は狩りより優先なので、壁際で始めると「詰めない」が正しい答えになってしまう
  let x0 = null, y0 = null;
  for (let i = 0; i < 4000 && x0 === null; i++) {
    const p = w.arena.spot();
    let clear = true;
    for (let d = -650; d <= 500 && clear; d += 50) clear = w.arena.inside(p.x + d, p.y);
    if (clear) { x0 = p.x; y0 = p.y; }
  }
  assert.ok(x0 !== null, '壁の絡まない直線が見つからない');

  // 人は右へ等速で逃げ、ボットは 500px 後ろ。人は大型プレイヤー（mass=900）。
  // 素の速度は同じなので、ダッシュして追わない限り差は縮まらない
  me.x = x0; me.y = y0;
  bot.x = x0 - 500; bot.y = y0;
  [me, bot].forEach((s) => { s.iframe = 0; s.path = [{ x: s.x, y: s.y }]; });
  me.angle = me.aim = 0; me.mass = 900;
  bot.angle = bot.aim = 0;
  bot.mood = 1; bot.moodT = 99;             // 狩る個体に固定（mood は毎回引き直される）

  const d0 = Math.hypot(me.x - bot.x, me.y - bot.y);
  // 餌は毎回空にする。残しておくと「たまたま人の近くの餌へ寄った」でも通ってしまい、
  // 狩っているのか餌を拾っているのか区別できない
  for (let i = 0; i < 30; i++) { w.food.length = 0; me.aim = 0; me.boost = false; w.step(1 / 30); }
  const d1 = Math.hypot(me.x - bot.x, me.y - bot.y);
  assert.ok(d1 < d0 - 80, `ボットが人へ間合いを詰めていない: ${d0.toFixed(0)} → ${d1.toFixed(0)}`);
  assert.ok(bot.boost, '間合い内でダッシュしていない（航跡＝キル帯を敷けない）');
  // 餌ではなく人そのものへ向いていること
  const off = Math.abs(((Math.atan2(me.y - bot.y, me.x - bot.x) - bot.aim + Math.PI) % (Math.PI * 2)
    + Math.PI * 2) % (Math.PI * 2) - Math.PI);
  assert.ok(off < 0.6, `ボットの狙いが人からずれている: ${(off * 57.3).toFixed(0)}°`);
  w.destroy();
}

// 11. 狩る個体でも壁回避が最優先であること。
//     獲物が壁の外側にいるとき、追ってエリアの外へ出てはいけない
{
  const w = createWorld({ map: chofu });
  const bait = w.addPlayer({ nid: 'b8', sharkId: 'chofu', name: '囮', isBot: true });
  const bot = w.addPlayer({ nid: 'b9', sharkId: 'chofu', name: '鮫', isBot: true });
  bot.mood = 1; bot.moodT = 99; bot.iframe = 0;
  bait.iframe = 0;
  // 囮はエリア外へ置く。ボットは壁で死なず押し戻されるだけなので、そこに留まり続ける
  bait.x = w.arena.bb.x1 + 600; bait.y = w.arena.bb.y1 + 600;
  for (let i = 0; i < 300; i++) {
    bait.x = w.arena.bb.x1 + 600; bait.y = w.arena.bb.y1 + 600;
    w.step(1 / 30);
  }
  assert.ok(w.arena.inside(bot.x, bot.y), 'ボットが獲物を追って壁の外へ出た');
  w.destroy();
}

// 12. 初対面のサメ（他人の入室・退室で入れ替わったボット）はワープで置くこと。
//     名簿で作った瞬間の座標は arena の適当な点なので、補間の枝に落とすと
//     そこから本当の居場所まで盤面を横断する（実測 2.4kpx / 278px per frame）。
//     これが「人が入退室するとラグい」の正体だった
{
  const w = createWorld({ map: chofu, authority: false });
  const me = w.addPlayer({ nid: 's1', sharkId: 'chofu', name: 'ME' });
  const X = w.arena.home.x + 2000, Y = w.arena.home.y + 1500;
  w.applySnapshot({
    t: 'snap',
    r: [['s1', 'ME', 0], ['s2', 'NEW', 0]],
    s: [['s1', me.x, me.y, 0, 40, 1], ['s2', X, Y, 0, 40, 1]],
  }, 's1');
  const s2 = w.sharks.find((o) => o.nid === 's2');
  const err = Math.hypot(s2.x - X, s2.y - Y);
  assert.ok(err < 1, `入室した他人が湧いた点に取り残されている: ${err.toFixed(0)}px`);
  w.destroy();
}

// 13. 4段階凶暴度（Tiered Aggressiveness）: 小型プレイヤー（mass < 200）の索敵除外と大型プレイヤー（mass >= 800）の最優先ロックオン
{
  const w = createWorld({ map: chofu });
  const smallHuman = w.addPlayer({ nid: 'p_small', sharkId: 'chofu', name: '小人', isBot: false });
  const nearBot = w.addPlayer({ nid: 'b_near', sharkId: 'chofu', name: '近鮫', isBot: true });
  const hunter = w.addPlayer({ nid: 'b_hunter', sharkId: 'chofu', name: '狩鮫', isBot: true });

  // 壁回避が絡まない十分な広さのある点を探す
  let cx = null, cy = null;
  for (let i = 0; i < 4000 && cx === null; i++) {
    const p = w.arena.spot();
    let clear = true;
    for (let d = -500; d <= 500 && clear; d += 50) {
      if (!w.arena.inside(p.x + d, p.y) || !w.arena.inside(p.x, p.y + d)) clear = false;
    }
    if (clear) { cx = p.x; cy = p.y; }
  }
  cx = cx ?? w.arena.home.x; cy = cy ?? w.arena.home.y;
  hunter.x = cx; hunter.y = cy; hunter.angle = 0; hunter.aim = 0; hunter.mood = 1; hunter.moodT = 99; hunter.iframe = 0;
  // 近いボット（距離300、X軸方向）
  nearBot.x = cx + 300; nearBot.y = cy; nearBot.angle = 0; nearBot.aim = 0; nearBot.mass = 50; nearBot.iframe = 0;
  // やや遠い小型人間（距離400、Y軸方向、mass=150 < 200）
  smallHuman.x = cx; smallHuman.y = cy + 400; smallHuman.angle = 0; smallHuman.aim = 0; smallHuman.mass = 150; smallHuman.iframe = 0;

  w.food.length = 0;
  w.step(1 / 30);

  // mass < 200 の人間は索敵除外され、hunter の狙いが nearBot 方向（正のX軸、300px先、aim=0付近）へ向くこと
  assert.ok(hunter.aim !== undefined, 'hunter が行動していること');
  assert.ok(Math.abs(hunter.aim) < 0.2, `hunter は小型人間を除外してボットを狙う（aim=${hunter.aim}）`);

  // 大型人間（mass=900 >= 800）なら最優先ターゲット補正（d2 *= 0.25）が働き、より遠くても優先して狙うこと
  smallHuman.mass = 900;
  w.step(1 / 30);
  assert.ok(hunter.aim > 0.5, `hunter は大型人間を最優先で狙う（aim=${hunter.aim}）`);
  w.destroy();
}

// 14. 4段階凶暴度（Tiered Aggressiveness）: 小型獲物への急襲抑制と段階的ダッシュ間合い
{
  const w = createWorld({ map: chofu });
  const target = w.addPlayer({ nid: 'p_target', sharkId: 'chofu', name: '標的', isBot: false });
  const hunter = w.addPlayer({ nid: 'b_hunter2', sharkId: 'chofu', name: '狩鮫2', isBot: true });

  let cx = null, cy = null;
  for (let i = 0; i < 4000 && cx === null; i++) {
    const p = w.arena.spot();
    let clear = true;
    for (let d = -500; d <= 500 && clear; d += 50) {
      if (!w.arena.inside(p.x + d, p.y) || !w.arena.inside(p.x, p.y + d)) clear = false;
    }
    if (clear) { cx = p.x; cy = p.y; }
  }
  cx = cx ?? w.arena.home.x; cy = cy ?? w.arena.home.y;
  hunter.x = cx; hunter.y = cy; hunter.mood = 0.8; hunter.moodT = 99; hunter.iframe = 0;

  // mass < 200（mass=150）の獲物に対してはダッシュ急襲を行わない（dashDist = 0）
  target.x = cx + 250; target.y = cy; target.mass = 150; target.iframe = 0;
  w.food.length = 0;
  w.step(1 / 30);
  assert.strictEqual(hunter.boost, false, 'mass < 200 の獲物に対してはダッシュ急襲を行わない');

  // mass=300（200 <= mass < 450）では dashDist = 280
  // 距離 400px（> 280px）ではダッシュしない
  target.x = cx + 400; target.y = cy; target.mass = 300;
  w.step(1 / 30);
  assert.strictEqual(hunter.boost, false, 'mass=300 で 280px より遠い時はダッシュしない');

  // 距離 250px（< 280px）に入った時はダッシュ急襲する
  target.x = cx + 250; target.y = cy; target.mass = 300;
  w.step(1 / 30);
  assert.strictEqual(hunter.boost, true, 'mass=300 で 280px 以内の時はダッシュ急襲する');

  w.destroy();
}

// ---------------------------------------------------------------------------
// 15〜20. 環境ギミック（#83）。
//
// 数値は data.js が持っていて、sim.js にあるのは式だけ。ここで見るのは
// 「式が docs の言うとおりに効くこと」と「ギミックの無いエリアが従来どおりであること」、
// そして「サーバとブラウザで同じ位相が回ること」の3つ。
const GIMMICKED = ['jindaiji', 'tamagawa', 'airport'];

// 15. 定義の健全性：持っているのは3エリアだけ。帯もゾーンも輪郭の内側に収まっている
{
  for (const map of MAPS) {
    const arena = makeArena(map);
    const g = makeGimmick(map, arena);
    if (!GIMMICKED.includes(map.id)) {
      assert.equal(g, null, `${map.id} にギミックが付いている（従来どおりのはず）`);
      continue;
    }
    assert.ok(g, `${map.id} のギミックが組み立てられない`);

    if (g.runway) {
      // 帯（滑走路の両側 w px）が丸ごとエリアの中にあること。
      // はみ出していると、吸い寄せた餌が壁の外へ消える見た目になる
      const r = g.runway;
      for (let t = 0; t <= 1.0001; t += 0.02) {
        for (let u = -1; u <= 1.0001; u += 0.1) {
          const x = r.x0 + (r.x1 - r.x0) * t - r.uy * r.w * u;
          const y = r.y0 + (r.y1 - r.y0) * t + r.ux * r.w * u;
          assert.ok(arena.inside(x, y),
            `${map.id}: 滑走路の帯が壁の外へ出ている (t=${t.toFixed(2)}, u=${u.toFixed(1)})`);
        }
      }
    }
    for (const z of g.springs) {
      for (let k = 0; k < 32; k++) {
        const a = (k / 32) * Math.PI * 2;
        assert.ok(arena.inside(z.x + Math.cos(a) * z.r, z.y + Math.sin(a) * z.r),
          `${map.id}: 湧水ゾーンが壁の外へはみ出している`);
      }
      assert.ok(g.springAt(z.x, z.y), `${map.id}: ゾーンの中心がゾーン判定に入らない`);
      assert.ok(!g.springAt(z.x + z.r + 1, z.y), `${map.id}: ゾーンの外がゾーン判定に入る`);
    }
  }
}

// 16. 多摩川の急流カレント：下流へ向かうほうが、上流へ向かうより遠くへ進む
{
  const map = MAPS.find((m) => m.id === 'tamagawa');
  const w = createWorld({ map });
  const dir = map.gimmick.dir;

  // 流れの向きに前後 1000px 開けた場所を探す。壁際で測ると押し戻しが混ざって、
  // 「流れが効いていない」のか「壁に当たった」のか区別できない
  let p = null;
  for (let i = 0; i < 20000 && !p; i++) {
    const q = w.arena.spot();
    let open = true;
    for (let d = -1000; d <= 1000 && open; d += 60) {
      open = w.arena.inside(q.x + Math.cos(dir) * d, q.y + Math.sin(dir) * d);
    }
    if (open) p = q;
  }
  assert.ok(p, '多摩川に流れ方向へ開けた直線が見つからない');

  // 進んだ距離を「向いている向き」へ射影して測る。餌は毎ティック空にする ——
  // 拾って質量が増えると速度（1 - r/420 の項）が動いて、比較にならない
  const run = (a) => {
    const s = w.addPlayer({ nid: 'run', sharkId: 'cinema', name: 'R' });
    s.x = p.x; s.y = p.y; s.angle = s.aim = a; s.path = [{ x: s.x, y: s.y }];
    const x0 = s.x, y0 = s.y;
    for (let i = 0; i < 60; i++) { s.aim = a; w.food.length = 0; w.step(1 / 30); w.drainEvents(); }
    const d = (s.x - x0) * Math.cos(a) + (s.y - y0) * Math.sin(a);
    w.removeShark('run');
    return d;
  };
  const down = run(dir), up = run(dir + Math.PI);
  assert.ok(down > up + 100, `下流が速くない: 下流 ${down.toFixed(0)}px / 上流 ${up.toFixed(0)}px`);
  // 素の2秒ぶん（172px/s × 2 ≒ 344px）を挟むこと＝加速と減速の両方が起きている
  assert.ok(down > 380 && up < 300, `加速と減速の片方しか効いていない: ${down.toFixed(0)} / ${up.toFixed(0)}`);
  w.destroy();
}

// 17. 飛行場のプロペラ気流：周期的に発生し、帯の中の餌が滑走路へ吸い寄せられる
{
  const map = MAPS.find((m) => m.id === 'airport');
  const w = createWorld({ map });
  const g = w.gimmick;
  const { period, dur, width } = map.gimmick;

  // 周期のどこかで必ず吹き、どこかで必ず止む。窓の端は 0（速度に段差を作らない）
  const lv = [...Array(180)].map((_, i) => g.level((i * period) / 180));
  assert.ok(Math.max(...lv) > 0.99, `気流が最大まで吹かない: ${Math.max(...lv)}`);
  assert.ok(lv.filter((v) => v === 0).length > 10, '気流が止む時間が無い');
  assert.equal(g.level(0), 0, '窓の入口は 0');
  assert.equal(g.level(dur), 0, '窓の出口は 0');
  assert.equal(g.level(period * 3 + dur / 2), g.level(dur / 2), '周期が繰り返していない');

  // 帯の中のサメは滑走路の向きへ押され、帯の外と凪の間は押されない
  const r = g.runway;
  const mid = { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 };
  const peak = dur / 2;
  const wind = g.windAt(mid.x, mid.y, peak);
  assert.ok(Math.hypot(wind.x, wind.y) > map.gimmick.push * 0.9, '滑走路の真上で気流が弱い');
  assert.ok(Math.abs(Math.atan2(wind.y, wind.x) - r.ang) < 1e-9, '気流が滑走路の向きを向いていない');
  assert.equal(g.windAt(mid.x - r.uy * width * 1.2, mid.y + r.ux * width * 1.2, peak).x, 0,
    '帯の外にまで気流が届いている');
  assert.deepEqual(g.windAt(mid.x, mid.y, dur + 0.5), { x: 0, y: 0 }, '凪の間も押している');

  // 帯の中に置いた餌は吹いている間に滑走路へ寄る。帯の外に置いた餌は動かない
  const bait = (u, id) => ({
    x: mid.x - r.uy * width * u, y: mid.y + r.ux * width * u,
    v: 4, r: 5, kind: 0, hue: '#fff', ph: 0, gone: false, id,
  });
  const near = bait(0.8, 90001), far = bait(2.4, 90002);
  assert.ok(w.arena.inside(far.x, far.y), '比較用の餌が壁の外に置かれている');
  const d0 = g.nearRunway(near.x, near.y).d;
  const farWas = { x: far.x, y: far.y };
  w.food.push(near, far);
  for (let i = 0; i < 45; i++) w.step(1 / 30);     // 1.5秒 ＝ 吹いている最中
  const d1 = g.nearRunway(near.x, near.y).d;
  assert.ok(d1 < d0 - 40, `餌が吸い寄せられていない: ${d0.toFixed(0)} -> ${d1.toFixed(0)}px`);
  assert.ok(Math.hypot(far.x - farWas.x, far.y - farWas.y) < 1e-9, '帯の外の餌まで動いている');
  w.destroy();
}

// 18. 深大寺の湧水ゾーン：スタミナの戻りが速く、そばガードが張られる
{
  const map = MAPS.find((m) => m.id === 'jindaiji');
  const w = createWorld({ map });
  const z = w.gimmick.springs[0];

  // ゾーンからじゅうぶん離れた比較点。近いと泳いで入ってしまう
  let out = null;
  for (let i = 0; i < 20000 && !out; i++) {
    const q = w.arena.spot();
    if (w.gimmick.springs.every((s) => Math.hypot(q.x - s.x, q.y - s.y) > s.r + 900)) out = q;
  }
  assert.ok(out, '湧水ゾーンから離れた場所が見つからない');

  const a = w.addPlayer({ nid: 'in', sharkId: 'cinema', name: 'IN' });
  const b = w.addPlayer({ nid: 'out', sharkId: 'cinema', name: 'OUT' });
  a.stam = b.stam = 0.2;
  // 泳いでゾーンを出入りしないよう、毎ティック置き直してから回す
  for (let i = 0; i < 45; i++) {
    a.x = z.x; a.y = z.y; b.x = out.x; b.y = out.y;
    w.step(1 / 30);
  }
  const gained = (a.stam - 0.2) / (b.stam - 0.2);
  assert.ok(gained > 1.8 && gained < 2.2, `スタミナの戻りが2倍になっていない: ${gained.toFixed(2)}倍`);
  assert.ok(a.guard > 0, '湧水ゾーンでそばガードが張られない');
  assert.equal(b.guard, 0, 'ゾーンの外でガードが張られている');

  // 出れば切れる（「一時付与」）
  for (let i = 0; i < 45; i++) { a.x = out.x; a.y = out.y; b.x = z.x; b.y = z.y; w.step(1 / 30); }
  assert.equal(a.guard, 0, 'ゾーンを出てもガードが残り続けている');
  w.destroy();
}

// 19. サーバとブラウザで同じ位相が回ること。
//     気流は周期ものなので、時計がずれていると「サーバでは吹いているのにこちらでは凪」に
//     なり、帯の中のサメだけ位置が割れる（オンライン対戦でいちばん見える形のズレ）
{
  const map = MAPS.find((m) => m.id === 'airport');
  const server = createWorld({ map, authority: true, diffs: true });
  const client = createWorld({ map, authority: false });
  server.addPlayer({ nid: 'me', sharkId: 'cinema', name: 'ME' });
  client.addPlayer({ nid: 'me', sharkId: 'cinema', name: 'ME' });

  for (let i = 0; i < 111; i++) client.step(1 / 30);        // 3.7秒ぶん先に回して位相をずらす
  assert.ok(Math.abs(client.envT - server.envT) > 3, '前提: 時計がずれていない');

  server.snapshot();
  client.applySnapshot(server.snapshot(true), 'me');
  assert.ok(Math.abs(client.envT - server.envT) < 0.02, `環境の時計が揃わない: ${client.envT} / ${server.envT}`);
  assert.ok(Math.abs(client.gimmick.level(client.envT) - server.gimmick.level(server.envT)) < 0.02,
    '時計を揃えても気流の強さが一致しない');

  // 揃えたあとは、同じ dt で回すかぎり同じ答えを出し続ける
  for (let i = 0; i < 90; i++) {
    server.step(1 / 30); server.drainEvents();
    client.step(1 / 30); client.drainEvents();
  }
  assert.ok(Math.abs(client.envT - server.envT) < 0.02, '同じ dt で回して時計がずれた');
  server.destroy(); client.destroy();
}

// 20. ギミックの無いエリア（調布駅・布田／つつじヶ丘・仙川）は従来どおり。
//     スナップショットに環境の時計を積まない＝配信のバイト列も増えない
{
  for (const id of ['chofu', 'sengawa']) {
    const w = createWorld({ map: MAPS.find((m) => m.id === id), authority: true, diffs: true });
    assert.equal(w.gimmick, null, `${id} にギミックがある`);
    assert.equal(w.snapshot().e, undefined, `${id} のスナップショットに環境の時計が載っている`);
    assert.equal(w.snapshot(true).e, undefined, `${id} の full に環境の時計が載っている`);
    w.destroy();
  }
}

console.log('sim ok');




