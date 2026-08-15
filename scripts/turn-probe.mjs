#!/usr/bin/env node
// 「旋回中だけ動きが不自然」の再現。ネットワーク無しで決定的に回す。
//
//   node scripts/turn-probe.mjs [--lag 20] [--seconds 30]
//
// サーバ側の world（authority=true, 30Hz）とブラウザ側の予測 world（authority=false, 60Hz）を
// 同じプロセスで回し、間に 15Hz のスナップショットと片道遅延を挟む。game.js と同じ経路。
//
// 測るのは他人のサメについて2つ。どちらもそのサメの旋回の速さで分ける。
//
//   ズレ    予測側の向き 対 「同じ時刻の」サーバの向き。
//           届いたスナップショットと比べてはいけない —— それは 66ms 前の値なので、
//           正しく先読みできている予測ほど大きな差が出て、良し悪しが逆に見える。
//   横滑り  体が指す向き 対 実際に進んだ向き。これが目に見える症状そのもの。
import { createWorld, TAU } from '../src/sim.js';
import { MAPS } from '../src/data.js';

const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i > 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : d;
};
const LAG = arg('lag', 20) / 1000;      // 片道遅延(秒)。実測 RTT 中央 41ms → 片道 20ms
const SECONDS = arg('seconds', 30);
const SRV_DT = 1 / 30;
const CLI_DT = 1 / 60;

const wrap = (a) => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
const deg = (r) => (r * 180) / Math.PI;

const map = MAPS[0];
const srv = createWorld({ map, authority: true, diffs: true });
srv.fillBots();
srv.seedFood();
srv.addPlayer({ nid: 's1', sharkId: 'cinema', name: 'ME' });

const cli = createWorld({ map, authority: false });
cli.addPlayer({ nid: 's1', sharkId: 'cinema', name: 'ME' });

let srvT = 0, cliT = 0, ticks = 0, inbox = [], firstSent = false;
const prevSrvAngle = new Map();   // nid -> 1サンプル前のサーバ向き（旋回の速さを出す）
const prevCliPos = new Map();     // nid -> 1フレーム前の予測側の位置（進んだ向きを出す）
const samples = [];               // { rate, err, crab }

for (let frame = 0; cliT < SECONDS; frame++) {
  // --- サーバ: 30Hz（クライアント2フレームに1回） ---
  if (frame % 2 === 0) {
    // スキルは既定だと 0.004/tick でしか出ず標本が足りない。1秒ごとに撃てる個体へ撃たせる
    if (frame % 60 === 0) {
      for (const s of srv.sharks.filter((o) => o.alive && o.cd <= 0).slice(0, 4)) srv.useSkill(s);
    }
    srv.step(SRV_DT);
    srv.drainEvents();
    srvT += SRV_DT;
    if (++ticks % 2 === 0) {
      const m = srv.snapshot(!firstSent);   // 実物と同じで full は入室した1人だけ
      firstSent = true;
      inbox.push({ at: cliT + LAG, m: JSON.parse(JSON.stringify(m)) });
    }
  }

  // --- ブラウザ: 届いた分を適用してから 60Hz で1フレーム進める ---
  while (inbox.length && inbox[0].at <= cliT) cli.applySnapshot(inbox.shift().m, 's1');
  cli.step(CLI_DT);
  cli.drainEvents();
  cliT += CLI_DT;

  // 両方の世界が同じ時刻まで進んだ瞬間だけ測る（奇数フレーム）
  if (Math.abs(srvT - cliT) > 1e-9) continue;

  for (const cs of cli.sharks) {
    if (cs.nid === 's1' || !cs.alive) continue;
    const ss = srv.sharks.find((o) => o.nid === cs.nid);
    if (!ss || !ss.alive) continue;

    const prevPos = prevCliPos.get(cs.nid);
    prevCliPos.set(cs.nid, { x: cs.x, y: cs.y });
    const prevAng = prevSrvAngle.get(cs.nid);
    prevSrvAngle.set(cs.nid, ss.angle);
    if (prevAng === undefined || !prevPos) continue;

    const moved = Math.hypot(cs.x - prevPos.x, cs.y - prevPos.y);
    if (moved < 0.5) continue;   // 止まっている個体の進行方向は雑音

    samples.push({
      def: ss.def.id,
      rate: Math.abs(wrap(ss.angle - prevAng)) / SRV_DT,           // サーバ側の旋回 rad/s
      err: Math.abs(wrap(cs.angle - ss.angle)),                    // 同時刻のサーバ向きとのズレ
      crab: Math.abs(wrap(Math.atan2(cs.y - prevPos.y, cs.x - prevPos.x) - cs.angle)),
      gap: Math.hypot(cs.x - ss.x, cs.y - ss.y),                   // 同時刻の位置のズレ(px)
      slow: ss.slow > 0, rapid: ss.rapid > 0,                      // サーバ側だけが知っている状態
      // ダッシュが実際に効いているか。stam / winded は同期されておらず予測側は自前で回すので、
      // 送られてくる boost が「入力」である以上ここがズレうる（ズレると速度が 1.55倍ぶん違う）
      boostMiss: (ss.boost && !ss.winded && ss.stam > 0) !== (cs.boost && !cs.winded && cs.stam > 0),
    });
  }
}

const bins = [
  ['ほぼ直進  (< 0.5 rad/s)', (r) => r < 0.5],
  ['ゆるい旋回 (0.5-1.5)', (r) => r >= 0.5 && r < 1.5],
  ['旋回      (1.5-3.0)', (r) => r >= 1.5 && r < 3],
  ['急旋回    (>= 3.0)', (r) => r >= 3],
];
const col = (a, p) => (a.length ? deg(a[Math.min(a.length - 1, Math.floor(a.length * p))]) : NaN);
const f = (v) => (Number.isFinite(v) ? v.toFixed(1).padStart(8) + '°' : '        —');

console.log(`\n片道遅延 ${LAG * 1000}ms / ${SECONDS}秒 / 標本 ${samples.length}\n`);
console.log('サーバ側の旋回の速さ        標本   ズレ(中央)  ズレ(p95)  横滑り(中央) 横滑り(p95)');
for (const [label, hit] of bins) {
  const g = samples.filter((s) => hit(s.rate));
  const e = g.map((s) => s.err).sort((a, b) => a - b);
  const c = g.map((s) => s.crab).sort((a, b) => a - b);
  console.log(`${label.padEnd(24)}${String(g.length).padStart(6)} ${f(col(e, 0.5))}${f(col(e, 0.95))}${f(col(c, 0.5))}${f(col(c, 0.95))}`);
}

// スロー/急流を受けている間の内訳。これらはフラグに載っていないので予測側が知らない。
// 知らなければ予測側は等速で回し続け、サーバとの位置が開く（＝毎回引き戻される）
console.log('\nサーバ側の状態          標本   位置のズレ(中央)  (p95)    向きのズレ(中央)');
for (const [label, hit] of [
  ['なし', (s) => !s.slow && !s.rapid],
  ['スロー中 (×0.5)', (s) => s.slow],
  ['急流中 (×3.1)', (s) => s.rapid],
]) {
  const g = samples.filter(hit);
  const p = g.map((s) => s.gap).sort((a, b) => a - b);
  const e = g.map((s) => s.err).sort((a, b) => a - b);
  const px = (a, q) => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * q))].toFixed(1).padStart(9) + 'px' : '        —');
  console.log(`  ${label.padEnd(20)}${String(g.length).padStart(6)}${px(p, 0.5)}${px(p, 0.95)}   ${f(col(e, 0.5))}`);
}

const bm = samples.filter((s) => s.boostMiss);
const bmGap = bm.map((s) => s.gap).sort((a, b) => a - b);
console.log(`\nダッシュの効きが食い違っている割合  ${(bm.length / samples.length * 100).toFixed(1)}%` +
  (bmGap.length ? `（そのとき位置のズレ中央 ${bmGap[bmGap.length >> 1].toFixed(1)}px）` : ''));

// 種別の内訳。turn の倍率が高いサメほど誤差が大きいはず（妖怪 1.35 が最大）
console.log('\n種別（旋回 1.5 rad/s 以上のみ）  turn倍率   標本   ズレ(中央)  横滑り(p95)');
const TURN = { cinema: 1.0, yokai: 1.35, tamagawa: 0.92, jindaiji: 1.0, airport: 0.98 };
for (const id of Object.keys(TURN).sort((a, b) => TURN[b] - TURN[a])) {
  const g = samples.filter((s) => s.def === id && s.rate >= 1.5);
  const e = g.map((s) => s.err).sort((a, b) => a - b);
  const c = g.map((s) => s.crab).sort((a, b) => a - b);
  console.log(`  ${id.padEnd(26)}${TURN[id].toFixed(2)}${String(g.length).padStart(7)} ${f(col(e, 0.5))}${f(col(c, 0.95))}`);
}
console.log();
