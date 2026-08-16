// 盤面の最小チェック: node src/sim.test.mjs
// サーバとブラウザが同じこのファイルを回すので、ここが壊れると両方が同時に壊れる。
import assert from 'node:assert/strict';
import { MAPS } from './data.js';
import { createWorld, makeArena } from './sim.js';

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

console.log('sim ok');

