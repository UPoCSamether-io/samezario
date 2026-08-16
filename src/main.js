import { SHARKS, MAPS, TIPS } from './data.js';
import { startGame } from './game.js';
import { connect } from './net.js';
import { centroidOfPath } from './geo.js';
import { paintShark, paintSpriteShark, bodyLength, swimBody, preloadSharks } from './shark-art.js';

preloadSharks(SHARKS);   // タイトルを出している間に全種そろえる（下の理由は shark-art.js 側）

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtTime = (s) => `${(s / 60) | 0}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// アイコンは合字なので、フォントが載るまで隠しておく（style.css の .material-symbols-rounded）。
// 判定用の文字は合字を組む素の ASCII でないと unicode-range から外れて即 resolve してしまう。
// 失敗しても finally で必ず出す。出ないアイコンより、崩れたアイコンのほうがまだ操作できる
document.fonts.load("1.75rem 'Material Symbols Rounded'", 'movie')
  .finally(() => document.documentElement.classList.add('icons-ready'));

// スキルアイコン。絵文字はOSごとに絵柄と彩度が変わって版画調の絵作りから浮くので、
// タイトル画面と同じ Material Symbols Rounded（FILL=1 / wght=700 の塗りつぶし）で統一する。
const ICON = {
  cinema: 'highlight',       // スポットライト
  yokai: 'blur_on',          // すり抜け
  tamagawa: 'double_arrow',  // 直線ダッシュ
  jindaiji: 'shield',        // そばガード
  airport: 'rotate_right',   // 旋回飛行
};
const icon = (name, cls) => `<span class="material-symbols-rounded ${cls}" aria-hidden="true">${name}</span>`;
const portrait = (d) => `/img/sharks/${d.id}_side.webp`;   // 立ち絵（タイトルと図鑑で使う）
// 立ち絵は DOM の <img> なので preloadSharks（canvas 用の原画）の対象外。
// 先に取っておかないと、タイトルや図鑑へ移った瞬間に取りに行くことになり、
// 届くまでその枠が空のまま出る
SHARKS.forEach((d) => { new Image().src = portrait(d); });

// ---------- セーブデータ ----------
const SAVE = 'samezario.save';
const save = Object.assign(
  { unlocked: ['chofu'], best: 0, shark: SHARKS[0].id, name: '', furigana: false },
  JSON.parse(localStorage.getItem(SAVE) || '{}'),
);
const persist = () => localStorage.setItem(SAVE, JSON.stringify(save));
const isUnlocked = (m) => m.unlocked || save.unlocked.includes(m.id);

// ---------- ルビ（ふりがな）切り替え ----------
function applyFurigana(on) {
  save.furigana = !!on;
  persist();
  document.documentElement.classList.toggle('furigana-on', save.furigana);
  const stateEl = $('#furigana-state');
  if (stateEl) stateEl.textContent = save.furigana ? 'ON' : 'OFF';
  const btn = $('#furigana-toggle');
  if (btn) btn.setAttribute('aria-pressed', save.furigana ? 'true' : 'false');
}
$('#furigana-toggle')?.addEventListener('click', () => applyFurigana(!save.furigana));
applyFurigana(save.furigana);

// ---------- 画面遷移 ----------
const screens = Object.fromEntries($$('.screen').map((s) => [s.id.slice(2), s]));
const chrome = $('#chrome');
let cur = 'title';
let ctl = null;

// 上下のレターボックスを中央まで閉じ、その裏で画面を差し替えて開く。
// 差し替えの瞬間が見えないので、明るさも構図も違う画面同士が繋がる。
const SHUT = 190;   // 帯が閉じきるまで(ms)。style.css の .letterbox の transition と揃える
// カチンコが閉じきってから帯を閉じ始める。同時に走らせると、押したボタンは
// 70ms で下の帯に飲み込まれ、肝心の「閉じる」が毎回帯の裏で起きていた（実測）。
// style.css の clap-arm は 170ms だが、イージングの都合で腕が閉じて見えるのは
// その 6 割ほどなので、待つのはここまでで足りる
const CLAP = 110;
let shutting = false;

function show(name) {
  if (shutting || name === cur) return;
  shutting = true;
  setTimeout(() => {
    if (ctl && name !== 'game') { ctl.stop(); ctl = null; }
    chrome.style.display = '';      // ゲーム中は隠してあるので、閉じる前に出し直す
    chrome.classList.add('shut');
    setTimeout(() => {
      screens[cur]?.classList.remove('on');
      screens[name]?.classList.add('on');
      cur = name;
      if (name === 'shark') renderSharks();
      if (name === 'dex') renderDex();
      if (name === 'title') paintTitleShark();
      if (name === 'game') stopAttract(); else startAttract();
      chrome.classList.remove('shut');
      shutting = false;
      // ゲームは全画面。帯が開ききってから消す（閉じたまま消すとハードカットになる）
      if (name === 'game') setTimeout(() => { chrome.style.display = 'none'; }, SHUT + 30);
    }, SHUT);
  }, CLAP);
}

// ---------- タイトルの立ち絵 ----------
function paintTitleShark() {
  const img = $('#title-shark');
  img.src = portrait(selShark);
  img.alt = selShark.name;
}

// ---------- タイトル背面のデモ再生 ----------
// 本編と同じ startGame を attract で回す。操作は受け付けず、主役が死んだら
// カメラが別のサメへ移るだけで永久に続く。
let attract = null;
function startAttract() {
  if (attract) return;
  attract = startGame({
    canvas: $('#attract'), mini: null, attract: true,
    sharkId: SHARKS[(Math.random() * SHARKS.length) | 0].id, map: MAPS[0],
  });
}
function stopAttract() { attract?.stop(); attract = null; }
startAttract();  // 起動時は show() を通らずタイトルが表示されている

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-go]');
  if (b) show(b.dataset.go);
});

// ---------- サメのプレビュー ----------
const previews = [];
function mountPreview(canvas, def, scale = 1) {
  const p = { canvas, ctx: canvas.getContext('2d'), def, scale };
  previews.push(p);
  return p;
}
function tickPreviews(t) {
  for (const p of previews) {
    const { canvas: c, ctx } = p;
    if (!c.isConnected || !c.offsetParent) continue;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) continue;
    // 高さも見ること。幅だけ比べていると、幅が変わらず高さだけ変わったとき
    // （立ち絵の枠は横幅が親いっぱいで、縦だけレイアウトで動く）バッキングストアが
    // 古い高さのまま残る。CSS 側の箱に合わせて引き伸ばされてサメが潰れ、
    // さらに clearRect が w×h ぶんしか消さないので、はみ出した部分に前の絵が
    // 焼き付いて消えなくなる（実機で「タスクを終了するまで直らない」状態）
    if (c.width !== w * dpr || c.height !== h * dpr) { c.width = w * dpr; c.height = h * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const len = Math.min(w * 0.86, h * 1.9, 420) * p.scale;
    // bodyLength は r に比例。スプライトの縦横比が崩れないよう len から逆算する
    const body = swimBody(w / 2, h / 2, len, len / bodyLength(1, p.def), t / 1000);
    if (!paintSpriteShark(ctx, body, p.def)) {
      paintShark(ctx, body, 0, p.def, { lw: Math.max(2.2, len / 120), wobble: t / 320 });
    }
  }
  requestAnimationFrame(tickPreviews);
}
requestAnimationFrame(tickPreviews);

// ---------- ロケ地選択 ----------
// エリアの塗り自体がボタン。未解放は暗く落とすだけで、押して解放条件は読める。
let selMap = MAPS[0];
const SVGNS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs) => Object.entries(attrs)
  .reduce((n, [k, v]) => (n.setAttribute(k, v), n), document.createElementNS(SVGNS, tag));

/**
 * 未解放エリアの色。CSS の grayscale(.62) brightness(.4) と同じ計算を色で行う。
 * filter でやっていたが、WebKit は SVG 要素にショートハンドの filter 関数を
 * 効かせないので iPhone では未解放エリアが明るいまま出ていた。
 */
function dimmed(hex) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const luma = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return `rgb(${c.map((v) => Math.round((v * 0.38 + luma * 0.62) * 0.4)).join(' ')})`;
}

// 名前と鍵は重心（geo.js の centroidOfPath）を挟んで上下に置く。
// data.js の label は「文字を置くために手で決めた点」で図形の中心ではなく、
// 小さい画面で名前を消して鍵だけ残すと中心から外れて見えるため。
// 名前が消える画面では鍵を重心そのものへ寄せる
const LABEL_DY = -22, LOCK_DY = 26;
// 条件は style.css の .map-label を消すブロックと一字一句そろえること
const compactMap = matchMedia('(max-height: 500px)');

/** 鍵の高さを決める。名前が出ているときはその下、消えているときは重心の上 */
function placeLocks() {
  $$('.map-lock').forEach((lk) => {
    lk.setAttribute('y', +lk.dataset.cy + (compactMap.matches ? 0 : LOCK_DY));
  });
}
compactMap.addEventListener('change', placeLocks);

function renderMaps() {
  const areas = $('#map-areas'), labels = $('#map-labels');
  areas.innerHTML = labels.innerHTML = '';
  for (const m of MAPS) {
    const open = isUnlocked(m);
    const p = svgEl('path', {
      class: 'map-area' + (open ? '' : ' locked'),
      d: m.path, fill: open ? m.color : dimmed(m.color), tabindex: '0', role: 'radio',
      'aria-label': `${m.name}${open ? '' : '（未解放）'}`,
    });
    // フォーカス＝選択。Tab で回すと情報パネルが追いかけるので、
    // キーボードにも「今どこを見ているか」が選択リングだけで伝わる
    p.onclick = p.onfocus = () => selectMap(m);
    areas.appendChild(p);

    const cen = centroidOfPath(m.path);

    const t = svgEl('text', {
      class: 'map-label' + (open ? '' : ' locked'),
      x: cen.x, y: cen.y + LABEL_DY,
    });
    // SVG text 内のルビ（tspan）対応
    t.innerHTML = `<tspan class="map-ruby" x="${cen.x}" dy="-13" font-size="14">${esc(m.kana || '')}</tspan><tspan class="map-base" x="${cen.x}" dy="14">${esc(m.name)}</tspan>`;
    labels.appendChild(t);

    // 未解放マークの南京錠。ラベルは text-anchor:middle で幅が読めないので、横ではなく真下に置く
    if (!open) {
      const lock = svgEl('text', { class: 'map-lock', x: cen.x });
      lock.dataset.cy = cen.y;      // y は placeLocks が画面に合わせて決める
      lock.textContent = 'lock';
      labels.appendChild(lock);
    }
  }
  placeLocks();
  selectMap(MAPS.find(isUnlocked) || MAPS[0]);
}

function selectMap(m) {
  selMap = m;
  const open = isUnlocked(m);
  $$('.map-area').forEach((n, i) => n.setAttribute('aria-checked', MAPS[i] === m));
  // 選択リングは別レイヤ。隣のエリアの下に潜らせないため、塗りより上に重ねて描く
  $('#map-ring').setAttribute('d', m.path);
  $('#map-next').disabled = !open;
  // 押せない理由をボタン自身に出す。ラベルが「サメ選択 →」のままだと袋小路に見える。
  $('#map-next-label').innerHTML = open ? 'サメ<ruby>選択<rp>(</rp><rt>せんたく</rt><rp>)</rp></ruby> →' : 'まだ<ruby>遊<rp>(</rp><rt>あそ</rt><rp>)</rp></ruby>べません';
  // 並びは重要な順。パネルは横持ちで本文 197px しか映らず（実測 844x390）、下に置いたものは
  // 読まれない。
  $('#map-info-body').innerHTML = `
    <div id="map-en" class="font-mono text-[10px] tracking-[0.3em] text-mint mb-1">${esc(m.en)}</div>
    <h3 id="map-title" class="font-display font-extrabold text-2xl mb-1 leading-tight">${m.ruby || esc(m.name)}</h3>
    <div id="map-badge" class="inline-block text-[11px] font-bold px-2 py-0.5 rounded ink-2 mb-4 ${open ? 'bg-yellow text-ink' : 'bg-paper/20 text-paper'}">
      ${open ? '<ruby>解放済<rp>(</rp><rt>かいほうず</rt><rp>)</rp></ruby>み' : '<ruby>未解放<rp>(</rp><rt>みかいほう</rt><rp>)</rp></ruby>'}
    </div>
    <div>
      <div class="font-mono text-[10px] tracking-[0.25em] text-yellow mb-1">HISTORY</div>
      <p class="text-[13px] leading-relaxed text-paper/80">${m.rubyLore || esc(m.lore)}</p>
    </div>
    ${open ? '' : `
    <div class="mt-4 bg-paper/10 ink-2 border-paper/30 rounded p-3">
      <div class="font-display font-bold text-sm mb-1 flex items-center gap-1.5">
        ${icon('photo_camera', '!text-lg text-yellow')}<ruby>現地写真<rp>(</rp><rt>げんちしゃしん</rt><rp>)</rp></ruby>で<ruby>解放<rp>(</rp><rt>かいほう</rt><rp>)</rp></ruby>
      </div>
      <p class="text-[12px] leading-relaxed text-paper/70"><ruby>現地<rp>(</rp><rt>げんち</rt><rp>)</rp></ruby>で<ruby>撮影<rp>(</rp><rt>さつえい</rt><rp>)</rp></ruby>した<ruby>写真<rp>(</rp><rt>しゃしん</rt><rp>)</rp></ruby>をアップロードすると<ruby>解放<rp>(</rp><rt>かいほう</rt><rp>)</rp></ruby>されます。<span class="font-mono text-[10px] tracking-widest text-yellow">COMING SOON</span></p>
    </div>`}
    <p id="map-blurb" class="text-sm leading-relaxed text-paper/90 mt-4 pt-3 border-t-2 border-paper/25">${m.rubyBlurb || esc(m.blurb)}</p>
    <div class="mt-4 font-mono text-[11px] text-paper/50">AREA ${(m.size * m.size / 1e6).toFixed(1)} km² · <ruby>実際<rp>(</rp><rt>じっさい</rt><rp>)</rp></ruby>の<ruby>地形<rp>(</rp><rt>ちけい</rt><rp>)</rp></ruby></div>`;
}

$('#map-next').onclick = () => { if (isUnlocked(selMap)) show('shark'); };
renderMaps();

// ---------- サメ選択 ----------
// 直前に遊んだサメ。タイトルの立ち絵とサメ選択の初期値を兼ねる（初回は映画サメ）
let selShark = SHARKS.find((s) => s.id === save.shark) || SHARKS[0];
paintTitleShark();   // 起動直後のタイトルは show() を通らないのでここで描く

const STAT_KEYS = [
  ['スピード', 'スピード', (d) => d.speed],
  ['旋回', '<ruby>旋回<rp>(</rp><rt>せんかい</rt><rp>)</rp></ruby>', (d) => d.turn],
  ['成長', '<ruby>成長<rp>(</rp><rt>せいちょう</rt><rp>)</rp></ruby>', (d) => d.growth],
  ['ダッシュ効率', 'ダッシュ<ruby>効率<rp>(</rp><rt>こうりつ</rt><rp>)</rp></ruby>', (d) => 2 - d.boostCost],
];

let mainPreview = null;
function renderSharks() {
  if (!mainPreview) {
    mainPreview = mountPreview($('#preview'), selShark);
    const list = $('#shark-list');
    list.innerHTML = '';
    // 面を3つ並べる。ダイヤルを一周させるために、端まで来たら中央の面へ
    // 黙って戻す（下の recenter）。1面だけだと端で必ず止まってしまう。
    for (let copy = 0; copy < DIAL_COPIES; copy++) {
      SHARKS.forEach((d, i) => {
        const b = document.createElement('button');
        b.className = 'shark-tile text-left bg-paper ink-3 rounded-lg hard px-3 py-2.5 flex items-center gap-3 ' +
          'transition-transform hover:-translate-x-1 active:translate-y-0.5';
        b.dataset.i = i;
        b.dataset.copy = copy;
        b.innerHTML = `
          <span class="tile-icon w-10 h-10 shrink-0 rounded-full ink-2 grid place-items-center text-paper" style="background:${d.color}">
            ${icon(ICON[d.id], '!text-[22px]')}
          </span>
          <span class="min-w-0">
            <span class="tile-name block font-display font-extrabold text-base leading-tight">${d.ruby || esc(d.name)}</span>
            <span class="tile-sub block font-mono text-[10px] tracking-widest text-ink/55">${esc(d.en)} · ${d.rubyTag || esc(d.tag)}</span>
          </span>`;
        b.onclick = () => selectShark(d);
        list.appendChild(b);
      });
    }
    mountDial(list);
  }
  selectShark(selShark);
  // ダイヤルでは選択中が中央に居ないと辻褄が合わないので、開くたびに寄せ直す
  if (isDial()) centerTile($('#shark-list'), SHARKS.indexOf(selShark), 'auto');
}

// スマホ横画面のサメ選択はダイヤル。中央で止まったサメがそのまま選ばれる。
const isDial = () => matchMedia('(max-height: 500px)').matches;
const DIAL_COPIES = 3;   // 一周させるための面の数。中央の面を基準にする

// スキル札のタップで効果説明を開閉する。
document.addEventListener('click', (e) => {
  const tag = $('#preview-tag');
  tag.classList.toggle('show-desc', !!e.target.closest('.tag-skill') && !tag.classList.contains('show-desc'));
});

// カチンコを鳴らす。
function clap(b) {
  if (!b || b.disabled) return;
  b.classList.remove('clapping');
  void b.offsetWidth;
  b.classList.add('clapping');
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('.btn, #hud-skill');
  clap(b);
});

/** 中央の面の i 番目を、ダイヤルの中央へ持ってくる */
function centerTile(list, i, behavior = 'smooth') {
  const el = list.children[SHARKS.length + i];
  if (el) el.scrollIntoView({ block: 'center', behavior });
}

/** いま中央に一番近いタイル */
function centeredTile(list) {
  const mid = list.getBoundingClientRect().top + list.clientHeight / 2;
  let best = null, bestGap = Infinity;
  for (const el of list.children) {
    const r = el.getBoundingClientRect();
    if (!r.height) continue;                       // 隠してある面は数えない
    const gap = Math.abs(r.top + r.height / 2 - mid);
    if (gap < bestGap) { bestGap = gap; best = el; }
  }
  return best;
}

/** 端まで来たら中央の面へ黙って引き戻す。 */
function recenter(list) {
  const copy = list.scrollHeight / DIAL_COPIES;
  const t = list.scrollTop;
  const to = t < copy * 0.5 ? t + copy : t >= copy * 1.5 ? t - copy : null;
  if (to === null) return;
  const prev = list.style.scrollBehavior;
  list.style.scrollBehavior = 'auto';
  list.scrollTop = to;
  list.style.scrollBehavior = prev;
}

function mountDial(list) {
  let idle;
  list.addEventListener('scroll', () => {
    if (!isDial()) return;
    clearTimeout(idle);
    idle = setTimeout(() => {
      const el = centeredTile(list);
      if (!el) return;
      const d = SHARKS[+el.dataset.i];
      if (d && d !== selShark) selectShark(d);
      recenter(list);
    }, 140);
  }, { passive: true });
}

function selectShark(d) {
  selShark = d;
  if (mainPreview) mainPreview.def = d;
  // 面を3つ持っているので、位置ではなく data-i で当てる
  $$('.shark-tile').forEach((n) => {
    const on = SHARKS[+n.dataset.i] === d;
    n.style.background = on ? '#f3b553' : '';
    n.style.boxShadow = on ? '6px 6px 0 0 #2d2d2d' : '';
    n.style.transform = on ? 'translateX(-6px)' : '';
    n.classList.toggle('is-sel', on);
  });

  $('#preview-tag').innerHTML = `
    <div class="shrink-0 bg-paper ink-3 hard rounded-lg px-4 py-2 -rotate-1">
      <div class="tag-en font-mono text-[10px] tracking-[0.3em] text-ink/55">${esc(d.en)}</div>
      <div class="tag-name font-display font-extrabold text-2xl leading-tight">${d.ruby || esc(d.name)}</div>
      <div class="tag-motif text-[11px] text-ink/60"><ruby>モチーフ<rp>(</rp><rt>もちーふ</rt><rp>)</rp></ruby>：${d.rubyMotif || esc(d.motif)}</div>
    </div>
    <div class="tag-skill flex-1 min-w-0 bg-navy text-paper ink-3 hard rounded-lg px-4 py-3 rotate-1">
      <div class="flex items-center gap-2 mb-1">
        ${icon(ICON[d.id], '!text-xl text-yellow')}
        <span class="font-display font-extrabold">${d.skill.rubyName || esc(d.skill.name)}</span>
        <span class="kbd-badge ml-auto font-mono text-[10px] bg-yellow text-ink px-1.5 py-0.5 rounded">${d.skill.key}</span>
      </div>
      <div class="tag-more">
        <p class="tag-desc text-[12px] leading-relaxed text-paper/85">${d.skill.rubyDesc || esc(d.skill.desc)}</p>
        <div class="tag-cd font-mono text-[10px] text-mint mt-1.5">CD ${d.skill.cd}s</div>
      </div>
    </div>`;

  $('#stats').innerHTML = statBars(d);
}

/** 能力バー4本。サメ選択と図鑑の詳細で同じものを出す */
function statBars(d) {
  return STAT_KEYS.map(([plain, rubyLabel, f]) => {
    const pct = clamp((f(d) - 0.55) / 0.95, 0.1, 1) * 100;
    return `<div class="bg-paper ink-3 hard rounded-lg px-3 py-2">
      <div class="font-mono text-[9px] tracking-[0.18em] text-ink/60 mb-1.5">${rubyLabel}</div>
      <div class="h-3 bg-ink/12 ink-2 relative overflow-hidden">
        <div class="h-full bg-teal" style="width:${pct}%"></div>
      </div>
    </div>`;
  }).join('');
}

// ---------- 名前 ----------
const nameInput = $('#player-name');
nameInput.value = save.name;
const playerName = () => nameInput.value.replace(/\s+/g, ' ').trim().slice(0, 10) || 'PLAYER';

$('#start-btn').onclick = () => play();

// ---------- 図鑑 ----------
let dexBuilt = false;
function renderDex() {
  if (dexBuilt) return;
  dexBuilt = true;
  const wrap = $('#dex-list');
  wrap.innerHTML = '';
  for (const d of SHARKS) {
    const card = document.createElement('button');
    card.className = 'bg-paper ink-4 hard-lg rounded-lg overflow-hidden flex flex-col text-left ' +
      'transition-transform hover:-translate-y-1 active:translate-y-0.5';
    card.innerHTML = `
      <div class="dex-cap clapper-stripes h-5 border-b-4 border-ink w-full"></div>
      <div class="dex-thumb w-full aspect-square p-3" style="background:${d.color}22">
        <img src="${portrait(d)}" alt="${esc(d.name)}" loading="lazy" decoding="async"
             class="w-full h-full object-contain drop-shadow-[5px_6px_0_rgba(45,45,45,.22)]">
      </div>
      <div class="dex-name w-full border-t-4 border-ink px-3 py-2.5">
        <h3 class="font-display font-extrabold text-lg leading-tight">${d.ruby || esc(d.name)}</h3>
      </div>`;
    card.onclick = () => openDex(d);
    wrap.appendChild(card);
  }
}

const dexDetail = $('#dex-detail');
const closeDex = () => { dexDetail.style.display = 'none'; };

function openDex(d) {
  $('#dex-body').innerHTML = `
    <div class="grid gap-6 p-6 md:p-8 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <div>
          <div class="rounded-xl ink-3 p-4" style="background:${d.color}22">
            <img src="${portrait(d)}" alt="${esc(d.name)}" decoding="async"
                 class="w-full object-contain drop-shadow-[7px_8px_0_rgba(45,45,45,.22)]">
          </div>
          <div class="grid grid-cols-2 gap-2 mt-4">${statBars(d)}</div>
        </div>

        <div class="min-w-0">
          <div class="font-mono text-[10px] tracking-[0.3em] text-ink/55">${esc(d.en)}</div>
          <div class="flex items-baseline gap-2 flex-wrap">
            <h3 class="font-display font-extrabold text-3xl md:text-4xl leading-tight">${d.ruby || esc(d.name)}</h3>
            <span class="text-[11px] font-bold bg-yellow ink-2 rounded px-2 py-0.5">${d.rubyTag || esc(d.tag)}</span>
          </div>
          <div class="text-[12px] text-ink/55 mt-1"><ruby>モチーフ<rp>(</rp><rt>もちーふ</rt><rp>)</rp></ruby>：${d.rubyMotif || esc(d.motif)}</div>

          <p class="mt-5 text-[15px] leading-[1.9] font-bold">${d.rubyIntro || esc(d.intro)}</p>

          <div class="bg-navy text-paper ink-3 rounded-lg p-4 mt-5">
            <div class="flex items-center gap-2 mb-1">
              ${icon(ICON[d.id], '!text-xl text-yellow')}
              <span class="font-display font-extrabold">${d.skill.rubyName || esc(d.skill.name)}</span>
              <span class="kbd-badge ml-auto font-mono text-[10px] bg-yellow text-ink px-1.5 py-0.5 rounded">${d.skill.key}</span>
            </div>
            <p class="text-[12.5px] leading-relaxed text-paper/85">${d.skill.rubyDesc || esc(d.skill.desc)}</p>
            <div class="font-mono text-[10px] text-mint mt-1.5">CD ${d.skill.cd}s</div>
          </div>

          <div class="relative border-4 border-ink rounded-lg p-4 pt-5 mt-7">
            <span class="absolute -top-3 left-4 bg-yellow ink-2 rounded px-2 py-0.5 font-mono font-bold text-[10px] tracking-widest">CHOFU TIPS</span>
            <p class="text-[12.5px] leading-relaxed text-ink/80">${d.rubyLore || esc(d.lore)}</p>
          </div>
        </div>
    </div>`;
  dexDetail.style.display = 'grid';
  $('#dex-body').scrollTop = 0;
}

$('#dex-close').onclick = closeDex;
dexDetail.onclick = (e) => { if (e.target === dexDetail) closeDex(); };  // 外側の暗幕をクリック
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDex(); });

// ---------- ゲーム ----------
const stage = $('#stage');
const mini = $('#mini');
const pausePanel = $('#pause');
const hudMass = $('#hud-mass'), hudRank = $('#hud-rank'), hudBar = $('#hud-bar');
const hudBoard = $('#hud-board'), hudCd = $('#hud-cd'), hudReel = $('#hud-reel');
const hudStam = $('#hud-stam');

let net = null;
let myName = 'YOU';   // リーダーボードに自分の行を足すときに使う
const dropNet = () => { net?.close(); net = null; };

let starting = false;
async function play() {
  if (starting) return;
  starting = true;
  try {
    save.shark = selShark.id; save.name = playerName(); persist();
    dropNet();
    $('#start-btn').disabled = true;
    // 繋がらなければ黙ってボット部屋。
    try { net = await connect({ map: selMap.id, shark: selShark.id, name: save.name }); }
    catch { net = null; }
    $('#start-btn').disabled = false;
    show('game');
    pausePanel.style.display = 'none';
    $('#hud-online').classList.toggle('hidden', !net);
    $('#hud-skill-icon').textContent = ICON[selShark.id];
    $('#hud-skill-name').textContent = selShark.skill.name;
    myName = net ? save.name : 'YOU';
    ctl = startGame({
      canvas: stage, mini, sharkId: selShark.id, map: selMap,
      net, name: myName,
      onHud: paintHud,
      onEnd: showResult,
    });
  } finally {
    starting = false;
  }
}

function paintHud(h) {
  if (h.paused !== undefined) {
    pausePanel.style.display = h.paused ? 'grid' : 'none';
    if (Object.keys(h).length === 1) return;
  }
  hudMass.textContent = h.mass.toLocaleString();
  hudRank.textContent = `#${h.rank} / ${h.alive}`;
  const top = Math.max(h.board[0]?.mass || 1, 2);
  hudBar.style.width = clamp(Math.log(Math.max(h.mass, 1)) / Math.log(top), 0.04, 1) * 100 + '%';
  if (h.humans) $('#hud-online').textContent = `ONLINE · ${h.humans} PLAYER${h.humans > 1 ? 'S' : ''}`;
  const row = (b, rank, extra = '') => `
    <li class="flex justify-between items-center gap-2 px-1.5 py-0.5 ${extra} ${b.me ? 'bg-yellow ink-2 -rotate-1 hard-sm relative z-10' : ''}">
      <span class="font-bold truncate">${rank}. ${b.human && !b.me ? '◆ ' : ''}${esc(b.name)}</span>
      <span class="font-mono text-[11px] shrink-0">${b.mass.toLocaleString()}</span>
    </li>`;
  hudBoard.innerHTML = h.board.map((b, i) => row(b, i + 1)).join('')
    + (h.board.some((b) => b.me) ? ''
      : row({ name: myName, mass: h.mass, me: true, human: true }, h.rank, 'mt-1.5 border-t-2 border-ink/25 pt-1'));
  hudCd.style.opacity = h.cd > 0 ? '1' : '0';
  hudCd.textContent = Math.ceil(h.cd);
  hudReel.style.animation = h.boosting ? 'spin .35s linear infinite' : 'spin 4s linear infinite';
  hudReel.style.filter = h.boost ? '' : 'grayscale(1) brightness(.75)';
  const spent = h.winded ? 'rgba(186,26,26,.66)' : 'rgba(11,32,34,.74)';
  hudStam.style.background = `conic-gradient(transparent ${h.stam}turn, ${spent} 0)`;
}

$('#resume').onclick = () => ctl?.resume();
$('#quit').onclick = () => { dropNet(); show('title'); };
$('#retry').onclick = () => play();

const hudKey = (el, key, sound) => el.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (sound) clap(el);
  window.dispatchEvent(new KeyboardEvent('keydown', { key }));
});
hudKey($('#hud-skill'), 'e', true);
hudKey($('#hud-pause'), 'Escape', false);

const hudDash = $('#hud-dash');
const dashKey = (type) => window.dispatchEvent(new KeyboardEvent(type, { key: ' ' }));
hudDash.addEventListener('pointerdown', (e) => { e.preventDefault(); dashKey('keydown'); });
hudDash.addEventListener('pointerup', () => dashKey('keyup'));
hudDash.addEventListener('pointercancel', () => dashKey('keyup'));

function showResult(r) {
  dropNet();
  const best = Math.max(save.best, r.mass);
  const isBest = r.mass > save.best;
  save.best = best; persist();

  show('result');
  $('#res-sub').innerHTML = `${selMap.ruby || esc(selMap.name)} ／ ${selShark.ruby || esc(selShark.name)}`
    + (r.cause ? `<br><span class="text-danger">${esc(r.cause)}に<ruby>接触<rp>(</rp><rt>せっしょく</rt><rp>)</rp></ruby></span>` : '');
  $('#res-stats').innerHTML = [
    ['<ruby>到達<rp>(</rp><rt>とうたつ</rt><rp>)</rp></ruby>サイズ', r.mass.toLocaleString(), isBest ? 'NEW BEST!' : `BEST ${best.toLocaleString()}`],
    ['<ruby>撃破数<rp>(</rp><rt>げきはすう</rt><rp>)</rp></ruby>', r.kills, 'KILLS'],
    ['<ruby>生存時間<rp>(</rp><rt>せいぞんじかん</rt><rp>)</rp></ruby>', fmtTime(r.time), 'SURVIVED'],
  ].map(([label, val, sub], i) => `
    <div class="res-stat ${i === 0 ? 'bg-yellow' : 'bg-paper'} ink-3 hard rounded-lg p-2 sm:p-3 text-center ${['', '-rotate-1', 'rotate-1'][i]}">
      <div class="font-mono text-[9px] tracking-[0.2em] text-ink/60">${label}</div>
      <div class="res-stat-v font-mono font-bold text-xl sm:text-3xl leading-tight my-0.5">${val}</div>
      <div class="font-mono text-[9px] text-ink/50">${sub}</div>
    </div>`).join('');
  $('#res-tip').innerHTML = TIPS[(Math.random() * TIPS.length) | 0];
}
