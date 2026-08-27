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
  const { inside, bb, home, spot, edgeDist, poly } = makeArena(chofu);
  assert.ok(inside(home.x, home.y), 'home は内側');
  assert.ok(!inside(bb.x0 - 10, bb.y0 - 10), '外接矩形の外は外側');
  assert.ok(!inside(bb.x1 + 10, bb.y1 + 10), '外接矩形の外は外側');
  for (let i = 0; i < 200; i++) {
    const p = spot();
    assert.ok(inside(p.x, p.y), `spot() が外を返した: ${p.x},${p.y}`);
  }

  // 2.5 辺への最短距離 (edgeDist)
  // 頂点上は距離 0
  for (let i = 0; i < poly.n; i++) {
    assert.ok(edgeDist(poly.xs[i], poly.ys[i]) < 1e-6, `頂点 ${i} 上の距離は 0`);
    const j = (i + 1) % poly.n;
    const mx = (poly.xs[i] + poly.xs[j]) / 2;
    const my = (poly.ys[i] + poly.ys[j]) / 2;
    assert.ok(edgeDist(mx, my) < 1e-6, `辺 ${i}-${j} の中点上の距離は 0`);
  }
  assert.ok(edgeDist(home.x, home.y) > 0, 'home の距離は正');
  assert.ok(edgeDist(bb.x0 - 50, bb.y0) >= 50, '矩形外の点は少なくとも 50px 離れている');
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

// 16. 多摩川の3帯カレント：上は凪、中は流れ、下はより強い急流
{
  const map = MAPS.find((m) => m.id === 'tamagawa');
  const w = createWorld({ map });
  const g = w.gimmick;
  const dir = map.gimmick.dir;

  // 帯ごとに、流れ方向へ前後1000px開けた場所を探す。壁際で測ると押し戻しが混ざる。
  const pointInBand = (i) => {
    const y0 = i ? g.bands[i - 1].y : w.arena.bb.y0;
    const y1 = g.bands[i].y;
    for (let n = 0; n < 20000; n++) {
      const q = w.arena.spot();
      if (q.y <= y0 + map.gimmick.blend * w.arena.bb.h || q.y >= y1 - map.gimmick.blend * w.arena.bb.h) continue;
      let open = true;
      for (let d = -1000; d <= 1000 && open; d += 60) {
        open = w.arena.inside(q.x + Math.cos(dir) * d, q.y + Math.sin(dir) * d);
      }
      if (open) return q;
    }
    return null;
  };

  // 進んだ距離を「向いている向き」へ射影して測る。餌は毎ティック空にする ——
  // 拾って質量が増えると速度（1 - r/420 の項）が動いて、比較にならない
  const run = (p, a) => {
    const s = w.addPlayer({ nid: 'run', sharkId: 'cinema', name: 'R' });
    s.x = p.x; s.y = p.y; s.angle = s.aim = a; s.path = [{ x: s.x, y: s.y }];
    const x0 = s.x, y0 = s.y;
    for (let i = 0; i < 60; i++) { s.aim = a; w.food.length = 0; w.step(1 / 30); w.drainEvents(); }
    const d = (s.x - x0) * Math.cos(a) + (s.y - y0) * Math.sin(a);
    w.removeShark('run');
    return d;
  };
  const distances = g.bands.map((_, i) => {
    const p = pointInBand(i);
    assert.ok(p, `多摩川の第${i + 1}帯に流れ方向へ開けた直線が見つからない`);
    return { down: run(p, dir), up: run(p, dir + Math.PI) };
  });
  const [upper, middle, lower] = distances;
  assert.ok(Math.abs(upper.down - upper.up) < 8,
    `河川敷で流されている: ${upper.down.toFixed(0)} / ${upper.up.toFixed(0)}`);
  assert.ok(middle.down > middle.up + 100,
    `中帯の下流が速くない: ${middle.down.toFixed(0)} / ${middle.up.toFixed(0)}`);
  assert.ok(lower.down - lower.up > middle.down - middle.up,
    `急流が中帯より強くない: 中 ${middle.down - middle.up} / 下 ${lower.down - lower.up}`);

  // 盤面が使うベクトルを直接見る。向きは全帯共通で、強さだけが変わる。
  const vectors = g.bands.map((_, i) => {
    const y0 = i ? g.bands[i - 1].y : w.arena.bb.y0;
    return g.windAt(w.arena.bb.x0, (y0 + g.bands[i].y) / 2, 0);
  });
  assert.deepEqual(vectors[0], { x: 0, y: 0 }, '河川敷に流れがある');
  const mags = vectors.map((v) => Math.hypot(v.x, v.y));
  assert.ok(mags[2] > mags[1] && mags[1] > 0, `帯の強さが正しくない: ${mags.join(', ')}`);
  for (const v of vectors.slice(1)) {
    assert.ok(Math.abs(Math.atan2(v.y, v.x) - dir) < 1e-9, '帯で流れの向きがずれている');
  }

  // vを細かく走査しても、クロスフェードの隣接値が段差にならない。
  let prev = 0;
  for (let i = 0; i <= 1000; i++) {
    const y = w.arena.bb.y0 + (i / 1000) * w.arena.bb.h;
    const v = g.windAt(w.arena.bb.x0, y, 0);
    const m = Math.hypot(v.x, v.y);
    if (i) assert.ok(Math.abs(m - prev) < 4, `流速が段差になっている: ${prev} -> ${m}`);
    prev = m;
  }
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

// 18. 深大寺の湧水ゾーン：入った瞬間にガードを1個もらう。**それだけ**。
//     ガードは「在庫」で、次にもらえるのは rearm 秒後（居座っても増えない）。
//     スタミナには触らない —— 効果を2つ持たせると「何をもらいに行く場所か」がぼやける
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
  // スタミナには触らない。ゾーンの内と外で戻り方が同じであること
  assert.ok(Math.abs(a.stam - b.stam) < 1e-9,
    `湧水がスタミナに触っている: 中 ${a.stam.toFixed(4)} / 外 ${b.stam.toFixed(4)}`);

  // 入った瞬間に1個。1.5秒（45ティック）居座っても増えない ——
  // ここが「張り直し」だったころは、居座るだけで無敵になっていた
  assert.equal(a.guardStock, 1, `湧水でガードが1個もらえていない: ${a.guardStock}`);
  assert.equal(b.guardStock, 0, 'ゾーンの外でガードをもらっている');
  assert.ok(a.springT > 0, '再装填が始まっていない');

  // 出て入り直しても、再装填が終わるまでは増えない
  for (let i = 0; i < 45; i++) { a.x = out.x; a.y = out.y; w.step(1 / 30); }
  for (let i = 0; i < 45; i++) { a.x = z.x; a.y = z.y; w.step(1 / 30); }
  assert.equal(a.guardStock, 1, `再装填中に入り直してガードが増えた: ${a.guardStock}`);

  // 再装填が明けても、上限（stockMax=1）を超えて貯まらない
  assert.equal(map.gimmick.stockMax, 1, '前提: 在庫の上限が1になっていない');
  a.springT = 0;
  for (let i = 0; i < 30; i++) { a.x = out.x; a.y = out.y; w.step(1 / 30); }
  for (let i = 0; i < 30; i++) { a.x = z.x; a.y = z.y; w.step(1 / 30); }
  assert.equal(a.guardStock, 1, `在庫が上限を超えた: ${a.guardStock}`);

  // 使い切ったあとは、再装填が明ければまた1個もらえる
  a.guardStock = 0; a.springT = 0;
  for (let i = 0; i < 30; i++) { a.x = out.x; a.y = out.y; w.step(1 / 30); }
  for (let i = 0; i < 30; i++) { a.x = z.x; a.y = z.y; w.step(1 / 30); }
  assert.equal(a.guardStock, 1, '使い切った後にもらい直せない');

  // 在庫はゾーンを出ても消えない（秒数ではなく個数だから）
  for (let i = 0; i < 120; i++) { a.x = out.x; a.y = out.y; w.step(1 / 30); }
  assert.equal(a.guardStock, 1, 'ゾーンを出たら在庫が消えた');
  w.destroy();
}

// 18b. 深大寺サメのスキルは「秒数」のまま。在庫と混ざっていないこと ——
//      在庫にすると期限が消えて「押しておけば得」になり、使いどころを読む判断が消える
{
  const w = createWorld({ map: MAPS.find((m) => m.id === 'chofu') });   // 湧水の無いエリアで見る
  const s = w.addPlayer({ nid: 'p1', sharkId: 'jindaiji', name: 'P' });
  w.useSkill(s);
  assert.equal(s.guard, s.def.skill.dur, 'そばガードが秒数で張られていない');
  assert.equal(s.guardStock, 0, 'スキルが在庫を増やしている');
  // 壁から十分離れた1点に毎ティック置き直す。放っておくと湧いた向きへ直進して外壁で死に、
  // 死んだサメは step の先頭で飛ばされるので guard が減らないまま残る（実測 12回中8回）。
  // home は「内側のどこか」でしかなく縁に寄ることがあるので、clearance を見て選ぶ
  // （home 決め打ちでも 40回に1回すり抜けた）
  let safe = null;
  for (let i = 0; i < 20000 && !safe; i++) {
    const q = w.arena.spot();
    if (w.arena.edgeDist(q.x, q.y) > 700) safe = q;
  }
  assert.ok(safe, '壁から離れた点が見つからない');
  for (let i = 0; i < 30 * (s.def.skill.dur + 1); i++) {
    s.x = safe.x; s.y = safe.y;
    w.step(1 / 30);
  }
  assert.ok(s.alive, '前提: サメが生きたまま測れていない');
  assert.equal(s.guard, 0, 'そばガードが時間で切れていない');
  w.destroy();
}

// 18c. ボスは湧水の対象外。湧水はプレイヤーの逃げ場なので、ヌシまで潤すと逃げ場でなくなる
{
  const map = MAPS.find((m) => m.id === 'jindaiji');
  const w = createWorld({ map });
  const boss = w.spawnBoss();
  const z = w.gimmick.springs[0];
  for (let i = 0; i < 60; i++) { boss.x = z.x; boss.y = z.y; boss.boost = false; w.step(1 / 30); }
  assert.equal(boss.guardStock, 0, 'ボスが湧水でガードをもらっている');
  assert.equal(boss.springT, 0, 'ボスで湧水の再装填が動いている');
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

// 21. 深大寺のボス戦。
//     普通のサメは「頭が相手の胴体に触れたら突っ込んだ側が死ぬ」だが、ボスだけは
//     その当たりを HP1 の被弾として受ける。この折り返しが消えると、ボスが自分から
//     突っ込んで勝手に死ぬ（＝戦いが成立しない）ので、規則そのものを検査する
{
  const map = MAPS.find((m) => m.id === 'jindaiji');
  assert.ok(map.boss, '深大寺にボスが居ない');
  assert.ok(map.solo, 'ボスステージがシングルプレイになっていない');
  for (const m of MAPS) {
    if (m.id !== 'jindaiji') assert.equal(m.boss, undefined, `${m.id} にボスが居る`);
  }

  // ロケ地選択に出す説明文は、被弾回数を {hp} で持って表示側が差し込む。
  // 数字を文にも直書きしていたころは、hp を 5 → 10 にしたときに文だけ 5 のまま残った
  assert.ok(map.boss.hint.includes('{hp}'), 'ボスの説明文が hp を直書きしている');
  assert.ok(!/\d+｜回《かい》｜当《あ》てれば/.test(map.boss.hint),
    'ボスの説明文に被弾回数が直書きされている');

  const w = createWorld({ map });
  const p = w.addPlayer({ nid: 'p1', sharkId: 'cinema', name: 'P' });
  const boss = w.spawnBoss();
  assert.ok(boss, 'ボスが湧かない');
  assert.equal(boss.hp, map.boss.hp);
  assert.equal(w.spawnBoss(), null, 'ボスが2体湧いた');
  assert.equal(w.sharks.filter((s) => s.isBoss).length, 1);

  // 体を作らせてから、ボスの頭をプレイヤーの胴体の真ん中へ置く
  w.step(1 / 30); w.drainEvents();
  const hitOnce = () => {
    boss.iframe = 0;
    const mid = p.body[Math.floor(p.body.length / 2)];
    boss.x = mid.x; boss.y = mid.y;
    w.step(1 / 30);
    return w.drainEvents();
  };

  const hp0 = boss.hp;
  const ev = hitOnce();
  assert.ok(boss.alive, 'ボスが1回の接触で死んだ');
  assert.equal(boss.hp, hp0 - 1, 'ボスの HP が減っていない');
  assert.ok(ev.some((e) => e.k === 'bosshit'), 'bosshit イベントが出ない');
  assert.ok(p.alive, 'ボスに当てたプレイヤーが死んだ');

  // 無敵時間の間は削れない（30Hz で重なったままだと一瞬で削り切れてしまう）
  const hp1 = boss.hp;
  const mid = p.body[Math.floor(p.body.length / 2)];
  boss.x = mid.x; boss.y = mid.y;
  w.step(1 / 30); w.drainEvents();
  assert.equal(boss.hp, hp1, '無敵時間中にも HP が減っている');

  // 残りを削り切ると撃破。高得点の餌がまとまって散る
  const foodBefore = w.food.length;
  let down = null;
  for (let i = 0; i < map.boss.hp + 2 && !down; i++) {
    down = hitOnce().find((e) => e.k === 'bossdown') ?? null;
  }
  assert.ok(down, 'HP を削り切っても bossdown が出ない');
  assert.equal(boss.alive, false);
  assert.equal(w.boss, null, '撃破後も world.boss が残っている');
  assert.ok(w.food.length > foodBefore + 50, `報酬の餌が散っていない: ${foodBefore} -> ${w.food.length}`);
  w.destroy();
}

// 21b. ボスの HP を削れるのは**胴体**だけ。ダッシュの航跡はすり抜ける。
//      航跡も数えていたころは、ヌシが自分から突進して跡を踏み抜き、プレイヤーが
//      何もしていないのに HP が減っていった（実測: 被弾50回のうち32回が航跡）。
//      「ボスが勝手にダメージを受けている」の正体がこれ
{
  const map = MAPS.find((m) => m.id === 'jindaiji');
  const w = createWorld({ map });
  const p = w.addPlayer({ nid: 'p1', sharkId: 'cinema', name: 'P' });
  const boss = w.spawnBoss();

  // プレイヤーをダッシュさせて航跡を伸ばす。ボスは遠くへ避けておく
  const far = w.arena.bb;
  boss.x = far.x0 + 10; boss.y = far.y0 + 10;
  p.boost = true;
  for (let i = 0; i < 60; i++) {
    p.aim = p.angle;
    boss.x = far.x0 + 10; boss.y = far.y0 + 10;
    w.step(1 / 30);
    w.drainEvents();
  }
  assert.ok(p.wake.length > 3, `前提: 航跡が伸びていない (${p.wake.length})`);

  // 航跡のいちばん古い点＝プレイヤーの胴体から最も離れた場所へ、ボスの頭を置く
  const tail = p.wake[0];
  const bodyGap = Math.min(...p.body.map((q) => Math.hypot(q.x - tail.x, q.y - tail.y)));
  assert.ok(bodyGap > 120, `前提: 航跡の端が胴体に近すぎる (${bodyGap.toFixed(0)}px)`);

  const hp0 = boss.hp;
  for (let i = 0; i < 30; i++) {
    boss.iframe = 0;
    boss.x = tail.x; boss.y = tail.y;
    w.step(1 / 30);
    for (const e of w.drainEvents()) {
      assert.notEqual(e.k, 'bosshit', `航跡でボスの HP が減った（how=${e.how}）`);
    }
  }
  assert.equal(boss.hp, hp0, `航跡でボスの HP が減った: ${hp0} -> ${boss.hp}`);
  w.destroy();
}

// 22. ボスは壁で死なず、餌でも太らない。
//     獲物を置かないのが要点 —— 相手が居ると、ボスは追いかけた末に自分から頭を
//     擦って HP を失い、30秒のうちに撃破されてしまう（それは 21 が見ている正しい挙動で、
//     ここで混ぜると「壁で死んだ」のか「削られた」のか区別が付かない）。
//     獲物が居なければ bossThink は直進するだけになり、壁だけが相手として残る
{
  const map = MAPS.find((m) => m.id === 'jindaiji');
  const w = createWorld({ map });
  w.seedFood();
  const boss = w.spawnBoss();
  const mass0 = boss.mass;
  const hp0 = boss.hp;
  for (let i = 0; i < 900; i++) { w.step(1 / 30); w.drainEvents(); }
  assert.ok(boss.alive, 'ボスが壁で死んだ');
  assert.equal(boss.hp, hp0, '相手が居ないのにボスの HP が減っている');
  assert.ok(w.arena.inside(boss.x, boss.y), 'ボスが壁の外へ出た');
  assert.equal(boss.mass, mass0, 'ボスが餌で成長している');
  w.destroy();
}

// 22b. 壁へ突っ込ませ続けても死なず、詰まらないこと。
//      bossThink の先読み（260 + r*6 ≒ 724px）が働くので、普通に回しているだけでは
//      壁の押し戻しに一度も入らない（実測 120秒で 0 回）。取りこぼしを防ぐため、
//      毎ティック外向きに舵を上書きして、その分岐だけを名指しで踏ませる
{
  const map = MAPS.find((m) => m.id === 'jindaiji');
  const w = createWorld({ map });
  const boss = w.spawnBoss();
  const bb = w.arena.bb;

  for (const [cx, cy] of [[bb.x0, bb.y0], [bb.x1, bb.y0], [bb.x0, bb.y1], [bb.x1, bb.y1]]) {
    for (let i = 0; i < 240; i++) {
      // 外接矩形の角＝必ず輪郭の外側へ向かう向きへ、毎ティック向け直す
      boss.aim = Math.atan2(cy - boss.y, cx - boss.x);
      w.step(1 / 30);
      w.drainEvents();
      assert.ok(boss.alive, 'ボスが壁で死んだ');
      assert.ok(Number.isFinite(boss.x) && Number.isFinite(boss.y), 'ボスの座標が壊れた');
    }
    assert.ok(w.arena.inside(boss.x, boss.y), `角(${Math.round(cx)},${Math.round(cy)})でボスが外に残った`);
  }
  assert.equal(boss.hp, map.boss.hp, '壁でボスの HP が減っている');
  w.destroy();
}

// 23. ヌシが突進を始めるのは HP を rageHp まで削ってから（#94）。
//     それまでは他のロケ地のボットと同じ泳ぎ方 —— つまりダッシュを撃たない。
//     開幕から突進していたころは、間合いの取り方を覚える前に轢かれて終わっていた
{
  const map = MAPS.find((m) => m.id === 'jindaiji');
  assert.ok(map.boss.rageHp > 0 && map.boss.rageHp < map.boss.hp,
    'rageHp が 0..hp の間に無い（怒る段階が来ないか、最初から怒っている）');

  const w = createWorld({ map });
  const p = w.addPlayer({ nid: 'p1', sharkId: 'cinema', name: 'P' });
  const boss = w.spawnBoss();
  const home = w.arena.home;

  // 突進の判定（bossThink の pd < 950）に必ず入る間合いへ毎ティック置き直す。
  // 500px 離すのは、胴体が触れて HP が勝手に減るのを避けるため
  const face = (hp) => {
    boss.hp = hp;
    boss.x = home.x; boss.y = home.y;
    p.x = home.x + 500; p.y = home.y;
    boss.mood = 1; boss.moodT = 9;   // mood の抽選で「今は溜める」に落ちないよう固定
    boss.winded = false; boss.stam = 1;
    p.mass = 900;                    // ボットが最優先で狙う質量帯（botThink の 800 以上）
  };

  for (let i = 0; i < 300; i++) {
    face(map.boss.hp);
    w.step(1 / 30); w.drainEvents();
    assert.equal(boss.boost, false, '削り切る前のヌシが突進した');
  }

  // rageHp まで削れたら突進する
  let dashed = false;
  for (let i = 0; i < 300 && !dashed; i++) {
    face(map.boss.rageHp);
    w.step(1 / 30); w.drainEvents();
    dashed = boss.boost;
  }
  assert.ok(dashed, `HP ${map.boss.rageHp} まで削ってもヌシが突進しない`);
  w.destroy();
}

console.log('sim ok');




