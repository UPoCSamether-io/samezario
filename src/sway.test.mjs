// 深大寺の草木の影（N8）の素の計算の最小チェック: node src/sway.test.mjs
// 「置き場所が決め打ちで、岸・湧水から水の側へ伸びるか」「揺れが envT だけで決まり、
// 振れ幅が数度〜十数度に収まるか」「風の波が盤面を抜けて凪に戻るか」だけを見る。
import assert from 'node:assert/strict';
import { createWorld } from './sim.js';
import { MAPS } from './data.js';
import {
  SWAY_AMP, SWAY_GUST, SWAY_PERIOD, SWAY_SPRING_N,
  swayShapes, swayTufts, gustFront, swayAngle, traceTuft,
} from './sway.js';

const map = MAPS.find((m) => m.id === 'jindaiji');
const world = createWorld({ map, authority: true });
const { arena } = world;
const springs = world.gimmick.springs;
// floorJindaiji の木立と同じ形（[x, y, r, rx, ry, rot]）の仮の木立
const groves = [[100, 120, 90, 100, 70, 0.4], [380, 300, 80, 90, 60, 2.1], [250, 450, 85, 95, 66, 1.2]];

// 1. 置き場所は決め打ち（同じ入力なら同じ房が同じ所に）
{
  const a = swayTufts({ groves, poly: arena.poly, springs });
  const b = swayTufts({ groves, poly: arena.poly, springs });
  assert.deepEqual(a.fixed.map((t) => [t.x, t.y, t.rot, t.per, t.ph]), b.fixed.map((t) => [t.x, t.y, t.rot, t.per, t.ph]));
  assert.deepEqual(a.tile.map((t) => [t.x, t.y, t.rot]), b.tile.map((t) => [t.x, t.y, t.rot]));
  assert.ok(a.tile.length >= 1 && a.tile.length <= groves.length, '木立の枝先は木立の数まで');
}

// 2. 外周の岸の房は水の側（内側）へ、湧水の縁の草は湧水の中心へ伸びる
{
  const { fixed } = swayTufts({ poly: arena.poly, springs });
  const edge = fixed.slice(0, fixed.length - springs.length * SWAY_SPRING_N);
  const rim = fixed.slice(edge.length);
  assert.ok(edge.length > 10, '外周に沿って並ぶ');
  for (const t of edge) {
    const x = t.x + Math.cos(t.rot) * 60, y = t.y + Math.sin(t.rot) * 60;
    assert.ok(arena.inside(x, y), `岸の房 (${t.x | 0}, ${t.y | 0}) が水の側を向く`);
  }
  assert.equal(rim.length, springs.length * SWAY_SPRING_N);
  rim.forEach((t, i) => {
    const z = springs[Math.floor(i / SWAY_SPRING_N)];
    const before = Math.hypot(t.x - z.x, t.y - z.y);
    const after = Math.hypot(t.x + Math.cos(t.rot) * 60 - z.x, t.y + Math.sin(t.rot) * 60 - z.y);
    assert.ok(before > z.r, '根元は湧水の外');
    assert.ok(after < before, '湧水の中心へ伸びる');
  });
}

// 3. 揺れは envT だけで決まり、凪の間は周期 per で繰り返す。振れ幅は数度〜十数度
{
  const { fixed } = swayTufts({ poly: arena.poly, springs });
  for (const t of fixed.slice(0, 20)) {
    assert.ok(t.per >= SWAY_PERIOD[0] && t.per <= SWAY_PERIOD[1]);
    assert.ok(t.amp >= SWAY_AMP[0] && t.amp <= SWAY_AMP[1]);
    let max = 0;
    for (let e = 0; e < 10; e += 0.05) max = Math.max(max, Math.abs(swayAngle(t, t.x, t.y, e, null)));
    assert.ok(max > (2 * Math.PI) / 180, '凪でも 2° 以上は揺れる');
    assert.ok(max < (20 * Math.PI) / 180, '凪の揺れは 20° 未満');
    assert.equal(swayAngle(t, t.x, t.y, 3.3, null), swayAngle(t, t.x, t.y, 3.3, null));
  }
  // 位相は房ごとにずれる（全部が同時に同じ角度にならない）
  const a = fixed.slice(0, 12).map((t) => swayAngle(t, t.x, t.y, 1.0, null).toFixed(3));
  assert.ok(new Set(a).size > 6, '房ごとに位相がずれる');
}

// 4. 風の波は盤面の手前から出て、抜けたら次の周期まで凪（null）。every 秒ごとに繰り返す
{
  const lo = 1000, hi = 6000;
  const { every, speed, width } = SWAY_GUST;
  assert.equal(gustFront(0, lo, hi), lo - width, '周期の頭は盤面の手前');
  assert.ok(Math.abs(gustFront(1, lo, hi) - (lo - width + speed)) < 1e-9, 'speed px/s で進む');
  const cross = (hi - lo + 2 * width) / speed;
  assert.ok(cross < every, '次の波より前に抜けきる');
  assert.equal(gustFront(cross + 0.01, lo, hi), null, '抜けたら凪');
  assert.equal(gustFront(every + 1, lo, hi), gustFront(1, lo, hi), 'every 秒ごとに同じ');
  // 波が来ている房は、凪のときより風の向きへ大きく曲がる
  const t = { per: 3, ph: 0, amp: 0.1, rot: SWAY_GUST.dir + Math.PI / 2 };
  const x = 3000, y = 0;
  const at = x * Math.cos(SWAY_GUST.dir) + y * Math.sin(SWAY_GUST.dir);
  const calm = swayAngle(t, x, y, 0, null), hit = swayAngle(t, x, y, 0, at);
  assert.ok(hit - calm < -0.25, '風に直交した房は 15° 近く倒れる');
}

// 5. 輪郭は今の path に足すだけ。命令の数は形の命令の数と同じで、揺れても根元は動かない
{
  const S = swayShapes();
  for (const shape of [...S.grass, ...S.spray]) {
    const calls = [];
    const ctx = {
      moveTo: (x, y) => calls.push(['m', x, y]),
      lineTo: (x, y) => calls.push(['l', x, y]),
      quadraticCurveTo: (cx, cy, x, y) => calls.push(['q', x, y]),
      closePath: () => calls.push(['z']),
    };
    const t = { shape, s: 1, rot: 0.3 };
    traceTuft(ctx, t, 500, 400, 0);
    assert.equal(calls.length, shape.ops.length);
    const first = calls[0];
    calls.length = 0;
    traceTuft(ctx, t, 500, 400, 0.3);
    assert.ok(Math.hypot(calls[0][1] - first[1], calls[0][2] - first[2]) < 3, '根元の点はほとんど動かない');
    assert.ok(shape.ws.every((w) => w >= 0 && w <= 1));
  }
}

console.log('sway.test: ok');
