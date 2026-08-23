// 遊び方デモの台本。描画は見ないと分からないが、台本は時間の純関数なので
// 「①が跡を残さない」「③が必ずカットまで行って、ループの頭で戻る」だけは機械で守れる。
import test from 'node:test';
import assert from 'node:assert/strict';

import { bodyLength } from './shark-art.js';
import { demoState, LOOP, VW, VH } from './howto-demo.js';

const at = (page, t, defs) => demoState(page, t, defs);

/** 体（点列）の実測の長さ */
const spanOf = (a) => {
  let d = 0;
  for (let i = 1; i < a.body.length; i++) {
    d += Math.hypot(a.body[i].x - a.body[i - 1].x, a.body[i].y - a.body[i - 1].y);
  }
  return d;
};

test('①はカーソルとサメだけ。跡もカットも出さない', () => {
  const s = at(0, 1.3);
  assert.ok(s.cursor, 'カーソルが無い');
  assert.equal(s.trail, null);
  assert.equal(s.cut, null);
  assert.equal(s.actors.length, 1);
});

test('②の跡はダッシュを踏んでから伸びる。2.5秒より長くは残らない', () => {
  // 本編（sim.js）も航跡を置くのはダッシュ中だけ。ゆっくり泳いでいる間は跡が出ない
  assert.equal(at(1, 0.6).trail, null, 'ダッシュ前から跡が出ている');
  const early = at(1, 1.8).trail.pts.length;
  const late = at(1, 2.4).trail.pts.length;
  assert.ok(late > early, `跡が伸びていない（${early} -> ${late}）`);
  // 0.05秒刻み＋終端の1点。2.5秒ぶんが上限
  assert.ok(at(1, LOOP[1] - 0.01).trail.pts.length <= 2.5 / 0.05 + 2, '跡が寿命より長く残っている');
});

test('③は1ループの中で必ずカットまで行き、相手が倒れる', () => {
  assert.equal(at(2, 1.0).cut, null, '早すぎるカット');
  assert.equal(at(2, 1.0).actors[1].dead, false);

  const hit = at(2, LOOP[2] - 0.2);
  assert.ok(hit.cut, 'ループが終わるまでにカットが起きていない');
  assert.equal(hit.actors[1].dead, true, '相手が倒れていない');

  // カットの位置は、その瞬間に跡の帯の上でなければ嘘になる
  const now = at(2, LOOP[2] - 1.2);
  const near = now.trail.pts.some((p) => Math.hypot(p.x - now.cut.x, p.y - now.cut.y) < 8);
  assert.ok(near, 'カット位置が跡の上に無い');
});

test('どのページもループの頭へ戻る（入り直しても途中から正しく描ける）', () => {
  for (let page = 0; page < LOOP.length; page++) {
    const a = at(page, 0.7), b = at(page, 0.7 + LOOP[page]);
    assert.deepEqual(b.actors[0].body[0], a.actors[0].body[0], `ページ${page + 1}が周回していない`);
  }
});

test('サメは盤面から極端に外れない（頭が仮想盤面の周辺に居る）', () => {
  // 右へ広いのは、②が枠から出たあとも跡が消えるまでループが続くから
  for (let page = 0; page < LOOP.length; page++) {
    for (let t = 0; t < LOOP[page]; t += 0.1) {
      for (const a of at(page, t).actors) {
        const h = a.body[0];
        assert.ok(h.x > -110 && h.x < VW + 200 && h.y > -40 && h.y < VH + 40,
          `ページ${page + 1} t=${t.toFixed(1)} で頭が遠すぎる（${h.x.toFixed(0)}, ${h.y.toFixed(0)}）`);
      }
    }
  }
});

test('体は速度が変わっても伸び縮みしない（弧長で歩いている）', () => {
  // ②はダッシュ前後で速度が5倍以上変わる。そこで体長が変わっていないこと
  const slow = spanOf(at(1, 0.9).actors[0]), fast = spanOf(at(1, 2.2).actors[0]);
  assert.ok(Math.abs(slow - fast) < 2, `体長が速度で変わっている（${slow.toFixed(1)} vs ${fast.toFixed(1)}）`);
});

test('体長は本編と同じ bodyLength(太さ, 種)。原画が伸び縮みしない', () => {
  // paintSpriteShark は原画を体の弧長いっぱいに貼るので、体長を自前の定数にすると
  // その分だけ絵が引き伸ばされる（＝説明の中のサメだけ縦横比が狂う）
  for (const def of [{ aspect: 1.6 }, { aspect: 1.9 }]) {
    for (const [page, t] of [[0, 1.3], [1, 2.0], [2, 1.0]]) {
      const a = at(page, t, { self: def, other: def }).actors[0];
      const want = bodyLength(a.body[0].r / 0.6, def);   // taper(0) = 0.6
      assert.ok(Math.abs(spanOf(a) - want) < 1.5,
        `ページ${page + 1} aspect=${def.aspect} で体長がずれている（${spanOf(a).toFixed(1)} / ${want.toFixed(1)}）`);
    }
  }
});

test('②はダッシュで実際に加速する', () => {
  const head = (t) => at(1, t).actors[0].body[0];
  const speed = (t) => Math.hypot(head(t + 0.05).x - head(t).x, head(t + 0.05).y - head(t).y) / 0.05;
  const before = speed(0.6), after = speed(2.0);
  assert.ok(after > before * 3, `加速していない（${before.toFixed(0)} -> ${after.toFixed(0)} px/s）`);
  assert.equal(at(1, 0.6).dash, 0, 'ダッシュ前なのに流線が出ている');
  assert.equal(at(1, 2.0).dash, 1, 'ダッシュ中に流線が出ていない');
});
