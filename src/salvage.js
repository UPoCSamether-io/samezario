import { esc } from './ruby.js';

// 史料の虫食い。DOM を触らない純関数だけを置く（ruby.js と同じ方針で Node から直接テストできる）。
//
// マスク位置はプレイヤーごとの seed から決定的に作る。毎回振り直すと、
// リロードを数回するだけで全文が読めてしまい仕組みが破られる。
//
// 候補を seed 固定でシャッフルしてから先頭を取る、という作りにしてあるので、
// 同じ seed なら ratio が小さいほど結果は必ず真部分集合になる（入れ子性）。
// 「前の段階との差＝新しく現れた文字」が保存なしで取り出せるのはこの性質のおかげ。

const RUBY_RE = /[|｜]([^|｜\n《》]+)《([^|｜\n《》]+)》/g;

// 伏せない文字。文の骨格が消えると推測が働かなくなるので記号と空白は残す
const KEEP = /[\s、。「」（）〜ー・—]/;

/** 段階ごとのマスク率。0.55 も試したが冒頭が壊れて何の話か立たなくなった（実測） */
export const STAGE_RATIO = [0.40, 0.25, 0.12, 0];

const rng = (seed) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

/** text -> 1文字1要素。ルビ塊の文字には読み(ruby)と塊ID(block)が付く */
export function tokenize(text) {
  const out = [];
  let last = 0, m, block = 0;
  RUBY_RE.lastIndex = 0;
  while ((m = RUBY_RE.exec(text)) !== null) {
    for (const ch of text.slice(last, m.index)) out.push({ ch, ruby: null, block: null });
    const id = block++;
    for (const ch of m[1]) out.push({ ch, ruby: m[2], block: id });
    last = m.index + m[0].length;
  }
  for (const ch of text.slice(last)) out.push({ ch, ruby: null, block: null });
  return out;
}

/**
 * 冒頭行と末尾行の添字。ここは伏せない。
 * 短く冗長性のない行ほどランダムマスクに壊されやすく、引きを担う一行が
 * 真っ先に読めなくなる。両端が残っていれば「何の話で、何が謎か」が最初から立つ。
 */
export function protectedEnds(toks) {
  const nl = toks.map((t, i) => (t.ch === '\n' ? i : -1)).filter((i) => i >= 0);
  const keep = new Set();
  const head = nl.length ? nl[0] : toks.length;
  for (let i = 0; i < head; i++) keep.add(i);
  const tail = nl.length ? nl[nl.length - 1] : 0;
  for (let i = tail; i < toks.length; i++) keep.add(i);
  return keep;
}

/** 伏せる文字の添字集合。seed 固定なのでプレイヤーごとに安定する */
export function maskSet(toks, ratio, seed, protect = new Set()) {
  const rand = rng(seed >>> 0);
  const cand = toks
    .map((t, i) => (KEEP.test(t.ch) || protect.has(i) ? -1 : i))
    .filter((i) => i >= 0);
  for (let i = cand.length - 1; i > 0; i--) {   // Fisher-Yates
    const j = (rand() * (i + 1)) | 0;
    [cand[i], cand[j]] = [cand[j], cand[i]];
  }
  return new Set(cand.slice(0, Math.round(cand.length * ratio)));
}

/**
 * 虫食いを HTML にする。
 *
 * ルビ塊は1文字でも欠けたら読みを落とす。残すと ｜調布《ちょうふ》 の「布」を
 * 伏せても「ちょうふ」が答えを漏らしてしまう。
 * added（前の段階から新しく現れた文字）は <mark> で包む。262文字のうち40字が
 * 増えても、前の状態を覚えていない子には差分が見えないため。
 */
export function renderHTML(toks, masked, added = new Set()) {
  const broken = new Set(
    toks.map((t, i) => (t.block !== null && masked.has(i) ? t.block : null)).filter((b) => b !== null),
  );
  let out = '';
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (masked.has(i)) { out += '<span class="mask" aria-hidden="true">■</span>'; continue; }

    // 塊の頭に来たら、塊まるごと <ruby> として出す
    if (t.block !== null && !broken.has(t.block) && (i === 0 || toks[i - 1].block !== t.block)) {
      let base = '', fresh = false;
      let j = i;
      for (; j < toks.length && toks[j].block === t.block; j++) {
        base += esc(toks[j].ch);
        if (added.has(j)) fresh = true;
      }
      const ruby = `<ruby>${base}<rp>(</rp><rt>${esc(t.ruby)}</rt><rp>)</rp></ruby>`;
      out += fresh ? `<mark class="fresh">${ruby}</mark>` : ruby;
      i = j - 1;
      continue;
    }

    const ch = t.ch === '\n' ? '<br>' : esc(t.ch);
    out += added.has(i) ? `<mark class="fresh">${ch}</mark>` : ch;
  }
  return out;
}

/**
 * main.js が呼ぶ唯一の入口。段階 stage の史料を HTML にして返す。
 *
 * 新出文字は「前の段階のマスク集合 − 今の段階のマスク集合」。
 * maskSet が入れ子性を持つので、前段階をその場で計算し直すだけで求まる。
 * 保存は要らない。
 */
export function salvageView(text, seed, stage) {
  const toks = tokenize(text);
  const keep = protectedEnds(toks);
  const s = Math.max(0, Math.min(STAGE_RATIO.length - 1, stage | 0));

  const masked = maskSet(toks, STAGE_RATIO[s], seed, keep);
  const prev = s > 0 ? maskSet(toks, STAGE_RATIO[s - 1], seed, keep) : masked;
  const added = new Set([...prev].filter((i) => !masked.has(i)));

  const total = toks.filter((t) => t.ch !== '\n').length;
  return {
    html: renderHTML(toks, masked, added),
    added: added.size,
    total,
    readable: total - masked.size,
  };
}
