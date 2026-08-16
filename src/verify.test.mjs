import assert from 'node:assert/strict';
import {
  haversineM, hamming, dhashFromGray, matchAny, matchScore, toHex, fromHex,
} from './verify.js';
import { MAPS } from './data.js';

// ---------- 距離（ジオフェンスの土台） ----------

// 同じ点は 0
assert.equal(Math.round(haversineM(35.6553, 139.5439, 35.6553, 139.5439)), 0);

// 緯度1度 ≒ 111.19km。子午線に沿った距離なので経度によらない
assert.ok(Math.abs(haversineM(35, 139, 36, 139) - 111_195) < 300, 'lat 1deg');

// 向きを変えても同じ
{
  const a = haversineM(35.6553, 139.5439, 35.6656, 139.5497);
  const b = haversineM(35.6656, 139.5497, 35.6553, 139.5439);
  assert.ok(Math.abs(a - b) < 1e-6, 'symmetric');
  // 布多天神社 → 深大寺山門 は実測でおよそ 1.2km（半径150mのジオフェンスは重ならない）
  assert.ok(a > 1000 && a < 1400, `fuda→jindaiji: ${a}`);
}

// ジオフェンスの境目。150m 圏内/圏外がその通りに出るか
// （北へ 0.001 度 ≒ 111m、0.002 度 ≒ 222m）
{
  const spot = MAPS.find((m) => m.id === 'jindaiji').spot;
  assert.ok(haversineM(spot.lat + 0.001, spot.lon, spot.lat, spot.lon) <= spot.radius, 'in');
  assert.ok(haversineM(spot.lat + 0.002, spot.lon, spot.lat, spot.lon) > spot.radius, 'out');
}

// ---------- ハミング距離 ----------

assert.equal(hamming(0n, 0n), 0);
assert.equal(hamming(0xffffffffffffffffn, 0n), 64);
assert.equal(hamming(0b1011n, 0b1001n), 1);
assert.equal(hamming(0b1011n, 0b0100n), 4);

// ---------- dHash ----------

const gray = (fill) => {
  const g = new Float64Array(9 * 8);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 9; x++) g[y * 9 + x] = fill(x, y);
  return g;
};

// 左から右へ明るくなる画は全ビット1、暗くなる画は全ビット0
assert.equal(dhashFromGray(gray((x) => x * 10)), 0xffffffffffffffffn);
assert.equal(dhashFromGray(gray((x) => 90 - x * 10)), 0n);

// ビットの並び順。先頭の行が上位8ビットに載る（並びが逆だと基準ハッシュと一致しない）
assert.equal(dhashFromGray(gray((x, y) => (y === 0 ? x : -x))), 0xff00000000000000n);

// 平坦な画は「隣は明るくない」＝全ビット0（比較が < なので同値は 0 側）
assert.equal(dhashFromGray(gray(() => 128)), 0n);

// 16進の往復
{
  const h = 0x0f1e2d3c4b5a6978n;
  assert.equal(toHex(h), '0x0f1e2d3c4b5a6978');
  assert.equal(fromHex(toHex(h)), h);
  assert.equal(toHex(0n).length, 18, '短いハッシュも64bit幅に揃える');
}

// ---------- 照合 ----------

{
  const target = 0xff00ff00ff00ff00n;

  // 基準写真がまだ無いスポットは位置だけで通す（blind）
  const none = matchAny(target, [], 14);
  assert.ok(none.ok && none.blind, 'refs 空なら通す');

  // しきい値の内と外
  assert.ok(matchAny(target, [target], 14).ok, '完全一致');
  assert.ok(matchAny(target, [target ^ 0b111111n], 14).ok, '6bit差はしきい値内');
  assert.ok(!matchAny(target, [target ^ 0xffffn], 14).ok, '16bit差はしきい値外');

  // 複数の基準写真のうち一番近いものが採用される（時間帯別に持たせるための性質）
  const many = matchAny(target, [target ^ 0xffffn, target ^ 0b11n], 14);
  assert.ok(many.ok && many.dist === 2, `best: ${many.dist}`);
  assert.ok(!many.blind);
}

assert.equal(matchScore(0), 100);
assert.equal(matchScore(64), 0);
assert.equal(matchScore(8), 88);

// ---------- 実データ ----------

// 全エリアがスポットを持ち、座標が調布市の外接矩形に収まっていること。
// 緯度経度の取り違え（35↔139）や桁落ちはここで落ちる
for (const m of MAPS) {
  const s = m.spot;
  assert.ok(s, `${m.id} に spot が無い`);
  assert.ok(s.id && s.name && s.angle && s.desc, `${m.id}: 文言が欠けている`);
  assert.ok(s.lat > 35.62 && s.lat < 35.69, `${m.id}: lat ${s.lat} が調布の外`);
  assert.ok(s.lon > 139.50 && s.lon < 139.60, `${m.id}: lon ${s.lon} が調布の外`);
  assert.ok(s.radius >= 100 && s.radius <= 300, `${m.id}: radius ${s.radius}`);
  assert.ok(Array.isArray(s.hashes), `${m.id}: hashes が配列でない`);
  assert.ok(s.threshold > 0 && s.threshold < 32, `${m.id}: threshold ${s.threshold}`);
  for (const h of s.hashes) {
    const v = fromHex(h);
    assert.ok(v >= 0n && v < 1n << 64n, `${m.id}: ${h} が64bitに収まらない`);
  }
}

// スポットのジオフェンス同士が重ならないこと（重なると別のエリアの写真で解放できてしまう）
for (const a of MAPS) {
  for (const b of MAPS) {
    if (a === b) continue;
    const d = haversineM(a.spot.lat, a.spot.lon, b.spot.lat, b.spot.lon);
    assert.ok(d > a.spot.radius + b.spot.radius,
      `${a.id} と ${b.id} のジオフェンスが重なっている（${Math.round(d)}m）`);
  }
}

console.log('verify ok');
