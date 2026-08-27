import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { SHARKS, MAPS } from './data.js';
import { salvageView, STAGE_RATIO } from './salvage.js';

test('全サメが era を持ち、1..6 が重複なく揃っている', () => {
  for (const d of SHARKS) assert.equal(typeof d.era, 'number', `${d.id} に era がない`);
  const eras = SHARKS.map((d) => d.era).filter((e) => e > 0).sort();
  assert.deepEqual(eras, [1, 2, 3, 4, 5, 6]);
  assert.equal(SHARKS.filter((d) => d.era === 0).length, 1, '見本は1種だけ');
});

test('SHARKS は era 順に並んでいる（見本が先頭）', () => {
  assert.equal(SHARKS[0].era, 0);
  const rest = SHARKS.slice(1).map((d) => d.era);
  assert.deepEqual(rest, [...rest].sort((a, b) => a - b));
});

test('土偶サメと近藤イサメが存在する', () => {
  const dogu = SHARKS.find((d) => d.id === 'dogu');
  const kondo = SHARKS.find((d) => d.id === 'kondo');
  assert.ok(dogu, '土偶サメがない');
  assert.ok(kondo, '近藤イサメがない');
  assert.equal(dogu.era, 1);
  assert.equal(kondo.era, 4);
});

test('era 1..6 の全サメが salvageText を持つ（見本の映画サメだけ持たない）', () => {
  for (const d of SHARKS) {
    assert.equal(!!d.salvageText, d.era > 0, `${d.id} の salvageText の有無が era と合っていない`);
  }
});

test('salvageText は改行を含み、ルビ記法が閉じている', () => {
  const { salvageText } = SHARKS.find((d) => d.id === 'dogu');
  assert.ok(salvageText.includes('\n'));
  assert.equal((salvageText.match(/《/g) || []).length, (salvageText.match(/》/g) || []).length);
  assert.equal((salvageText.match(/｜/g) || []).length, (salvageText.match(/《/g) || []).length);
});

test('全サメが描画に必要なパラメータを持つ', () => {
  for (const d of SHARKS) {
    for (const k of ['id', 'name', 'en', 'color', 'accent', 'speed', 'turn', 'growth', 'aspect', 'skill', 'lore']) {
      assert.ok(d[k] !== undefined, `${d.id} に ${k} がない`);
    }
  }
});

// 段階を刻み直したら（STAGE_RATIO を触ったら）必ずここが番人になる。刻みが細かすぎると
// 「1段階進んだのに1文字も増えない」空振りが出て、ごほうびそのものが消える。
// 本文の長さは幕ごとに違うので、6幕ぶん全部を見ないと1本だけ空振る事故が抜ける。
test('本物の史料は段階が進むほど読める文字が確実に増える（全6幕・全段階）', () => {
  for (const d of SHARKS.filter((s) => s.salvageText)) {
    const views = STAGE_RATIO.map((_, s) => salvageView(d.salvageText, 20260819, s));

    for (let s = 1; s < views.length; s++) {
      assert.ok(
        views[s].readable > views[s - 1].readable,
        `${d.id} 段階${s} で読める文字が増えていない（${views[s - 1].readable} -> ${views[s].readable}）`,
      );
      assert.ok(views[s].added > 0, `${d.id} 段階${s} で新出文字が1文字も無い`);
    }
    assert.equal(views[views.length - 1].readable, views[0].total, `${d.id}: 最終段階で全文が読めていない`);
    assert.equal(views[0].added, 0, `${d.id}: 段階0に新出があるのはおかしい`);
  }
});

test('史料は era 1..6 の6本で、章の見出しが揃っている', () => {
  const chapters = SHARKS.filter((d) => d.salvageText).sort((a, b) => a.era - b.era);
  assert.deepEqual(chapters.map((d) => d.era), [1, 2, 3, 4, 5, 6]);
  for (const d of chapters) {
    assert.equal(typeof d.salvageTitle, 'string', `${d.id} に salvageTitle がない`);
    assert.equal(typeof d.salvageTagline, 'string', `${d.id} に salvageTagline がない`);
    assert.ok(d.salvageTitle.length > 0 && d.salvageTagline.length > 0);
  }
});

test('史料の本文が全段階で描画でき、ルビ記法が壊れていない', () => {
  for (const d of SHARKS.filter((s) => s.salvageText)) {
    for (let stage = 0; stage < STAGE_RATIO.length; stage++) {
      const v = salvageView(d.salvageText, 12345, stage);
      assert.ok(v.total > 0, `${d.id} stage${stage}: 本文が空`);
      // ルビ記法が生のまま残っていたら tokenize が拾えていない
      assert.ok(!/[|｜《》]/.test(v.html), `${d.id} stage${stage}: 未解釈のルビ記法が残っている`);
    }
    // 完成段階では伏せ字が1つも残らない
    assert.ok(!salvageView(d.salvageText, 12345, STAGE_RATIO.length - 1).html.includes('■'));
  }
});

test('第1幕の本文は凍結されている（変更するとマスク位置が総ずれする）', () => {
  const dogu = SHARKS.find((d) => d.id === 'dogu');
  // 内容そのもののハッシュで固定する。誤字修正であっても、公開済みの本文を変えると
  // 復元途中のプレイヤーの読めていた文章が壊れる（salvage.js の maskSet は KEEP 文字
  // （空白・句読点など）を除いた cand を作ってから Fisher-Yates で伏せ字位置を決めるので、
  // salvageText.length や salvageView().total が変わらない編集――たとえば「、」1字を漢字に
  // 差し替える――でも cand.length が変わり、全プレイヤーの伏せ字位置が丸ごとズレる。
  // 文字数だけを見る旧アサーションはこの種の編集を素通りさせていたため、
  // 本文全体のハッシュに切り替えて穴を塞ぐ
  const sha = createHash('sha256').update(dogu.salvageText, 'utf8').digest('hex');
  assert.equal(sha, '8f82e7945b66ff8c88bd27e3682cdc0ea32d2dfad2344221c992c5e03a612723', '第1幕の本文が変更されている');
});

// 盤面に出るサメは全員、絵を2枚持っている必要がある。
//   <id>.webp      = 盤面のスプライト（shark-art.js の spriteOf が id で引く）
//   <id>_side.webp = 立ち絵（main.js の portrait が id で引く）
// 無いと盤面のほうは黙ってベクター版に落ち、立ち絵は onerror で消えるだけなので、
// 遊んでいて気付けない。def を足したときに転ぶよう、ここで実在を見る
test('全サメとボスに、スプライトと立ち絵の両方がある', () => {
  const bosses = MAPS.flatMap((m) => [m.boss, m.boss?.revive].filter(Boolean));
  for (const d of [...SHARKS, ...bosses]) {
    for (const suffix of ['', '_side']) {
      const rel = `public/img/sharks/${d.id}${suffix}.webp`;
      // 実行時の cwd に依らせない（node --test をどこから流しても同じ答えになる）
      const path = new URL(`../${rel}`, import.meta.url);
      assert.ok(existsSync(path),
        `${rel} が無い（原画を art/sharks へ置いて python3 scripts/build-sprites.py を流す）`);
    }
  }
});

// aspect は当たり判定の寸法（体長）なので、原画を差し替えたら
// scripts/sprite-aspect.py で測り直して data.js へ写す（README の調整ポイント）。
// ここでは「持っていること」と「桁が正気なこと」だけを見る —— 実測値そのものは
// 画像側にあり、テストで焼き直すと原画の差し替えのたびに二重管理になる
test('ボスの aspect は実測値の範囲に収まっている', () => {
  const bosses = MAPS.flatMap((m) => [m.boss, m.boss?.revive].filter(Boolean));
  for (const d of bosses) {
    assert.equal(typeof d.aspect, 'number', `${d.id} に aspect がない`);
    assert.ok(d.aspect > 1 && d.aspect < 3, `${d.id} の aspect が範囲外: ${d.aspect}`);
  }
});
