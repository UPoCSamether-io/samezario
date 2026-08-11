import { SHARKS, MAPS, TIPS } from './data.js';
import { startGame } from './game.js';
import { connect } from './net.js';
import { paintShark, paintSpriteShark, bodyLength, swimBody } from './shark-art.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtTime = (s) => `${(s / 60) | 0}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

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
const portrait = (d) => `/img/sharks/${d.id}_side.png`;   // 立ち絵（タイトルと図鑑で使う）

// ---------- セーブデータ ----------
const SAVE = 'samezario.save';
const save = Object.assign(
  { unlocked: ['chofu'], best: 0, shark: SHARKS[0].id, online: false, name: '' },
  JSON.parse(localStorage.getItem(SAVE) || '{}'),
);
const persist = () => localStorage.setItem(SAVE, JSON.stringify(save));
const isUnlocked = (m) => m.unlocked || save.unlocked.includes(m.id);

// ---------- 画面遷移 ----------
const screens = Object.fromEntries($$('.screen').map((s) => [s.id.slice(2), s]));
const chrome = $('#chrome');
let cur = 'title';
let ctl = null;

// 上下のレターボックスを中央まで閉じ、その裏で画面を差し替えて開く。
// 差し替えの瞬間が見えないので、明るさも構図も違う画面同士が繋がる。
const SHUT = 190;   // 帯が閉じきるまで(ms)。style.css の .letterbox の transition と揃える
let shutting = false;

function show(name) {
  if (shutting || name === cur) return;
  shutting = true;
  if (ctl && name !== 'game') { ctl.stop(); ctl = null; }
  chrome.style.display = '';        // ゲーム中は隠してあるので、閉じる前に出し直す
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
    if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
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

function renderMaps() {
  const areas = $('#map-areas'), labels = $('#map-labels');
  areas.innerHTML = labels.innerHTML = '';
  for (const m of MAPS) {
    const open = isUnlocked(m);
    const p = svgEl('path', {
      class: 'map-area' + (open ? '' : ' locked'),
      d: m.path, fill: m.color, tabindex: '0', role: 'radio',
      'aria-label': `${m.name}${open ? '' : '（未解放）'}`,
    });
    // フォーカス＝選択。Tab で回すと情報パネルが追いかけるので、
    // キーボードにも「今どこを見ているか」が選択リングだけで伝わる
    p.onclick = p.onfocus = () => selectMap(m);
    areas.appendChild(p);

    const t = svgEl('text', {
      class: 'map-label' + (open ? '' : ' locked'),
      x: (m.label.x / 100) * 1103, y: (m.label.y / 100) * 960,
    });
    t.textContent = m.name.replace(/エリア$/, '');
    labels.appendChild(t);

    // 未解放マークの南京錠。ラベルは text-anchor:middle で幅が読めないので、横ではなく真下に置く
    if (!open) {
      const lock = svgEl('text', {
        class: 'map-lock',
        x: (m.label.x / 100) * 1103, y: (m.label.y / 100) * 960 + 34,
      });
      lock.textContent = 'lock';
      labels.appendChild(lock);
    }
  }
  selectMap(MAPS.find(isUnlocked) || MAPS[0]);
}

function selectMap(m) {
  selMap = m;
  const open = isUnlocked(m);
  $$('.map-area').forEach((n, i) => n.setAttribute('aria-checked', MAPS[i] === m));
  // 選択リングは別レイヤ。隣のエリアの下に潜らせないため、塗りより上に重ねて描く
  $('#map-ring').setAttribute('d', m.path);
  $('#map-next').disabled = !open;
  $('#map-info-body').innerHTML = `
    <div class="font-mono text-[10px] tracking-[0.3em] text-mint mb-1">${esc(m.en)}</div>
    <h3 class="font-display font-extrabold text-2xl mb-1 leading-tight">${esc(m.name)}</h3>
    <div class="inline-block text-[11px] font-bold px-2 py-0.5 rounded ink-2 mb-4 ${open ? 'bg-yellow text-ink' : 'bg-paper/20 text-paper'}">
      ${open ? '解放済み' : '未解放'}
    </div>
    <p class="text-sm leading-relaxed text-paper/90 mb-4">${esc(m.blurb)}</p>
    <div class="border-t-2 border-paper/25 pt-3">
      <div class="font-mono text-[10px] tracking-[0.25em] text-yellow mb-1">HISTORY</div>
      <p class="text-[13px] leading-relaxed text-paper/80">${esc(m.lore)}</p>
    </div>
    ${open ? '' : `
    <div class="mt-4 bg-paper/10 ink-2 border-paper/30 rounded p-3">
      <div class="font-display font-bold text-sm mb-1 flex items-center gap-1.5">
        ${icon('photo_camera', '!text-lg text-yellow')}現地写真で解放
      </div>
      <p class="text-[12px] leading-relaxed text-paper/70">現地で撮影した写真をアップロードすると解放されます（実装予定：基準画像とのSSIM照合）。</p>
    </div>`}
    <div class="mt-4 font-mono text-[11px] text-paper/50">AREA ${(m.size * m.size / 1e6).toFixed(1)} M㎡ · 実際の地形</div>`;
}

$('#map-next').onclick = () => { if (isUnlocked(selMap)) show('shark'); };
renderMaps();

// ---------- サメ選択 ----------
// 直前に遊んだサメ。タイトルの立ち絵とサメ選択の初期値を兼ねる（初回は映画サメ）
let selShark = SHARKS.find((s) => s.id === save.shark) || SHARKS[0];
paintTitleShark();   // 起動直後のタイトルは show() を通らないのでここで描く

const STAT_KEYS = [
  ['スピード', (d) => d.speed],
  ['旋回', (d) => d.turn],
  ['成長', (d) => d.growth],
  ['ダッシュ効率', (d) => 2 - d.boostCost],
];

let mainPreview = null;
function renderSharks() {
  if (!mainPreview) {
    mainPreview = mountPreview($('#preview'), selShark);
    const list = $('#shark-list');
    list.innerHTML = '';
    for (const d of SHARKS) {
      const b = document.createElement('button');
      b.className = 'shark-tile text-left bg-paper ink-3 rounded-lg hard px-3 py-2.5 flex items-center gap-3 ' +
        'transition-transform hover:-translate-x-1 active:translate-y-0.5';
      b.innerHTML = `
        <span class="w-10 h-10 shrink-0 rounded-full ink-2 grid place-items-center text-paper" style="background:${d.color}">
          ${icon(ICON[d.id], '!text-[22px]')}
        </span>
        <span class="min-w-0">
          <span class="block font-display font-extrabold text-base leading-tight">${esc(d.name)}</span>
          <span class="block font-mono text-[10px] tracking-widest text-ink/55">${esc(d.en)} · ${esc(d.tag)}</span>
        </span>`;
      b.onclick = () => selectShark(d);
      list.appendChild(b);
    }
  }
  selectShark(selShark);
}

function selectShark(d) {
  selShark = d;
  if (mainPreview) mainPreview.def = d;
  $$('.shark-tile').forEach((n, i) => {
    const on = SHARKS[i] === d;
    n.style.background = on ? '#f3b553' : '';
    n.style.boxShadow = on ? '6px 6px 0 0 #2d2d2d' : '';
    n.style.transform = on ? 'translateX(-6px)' : '';
  });

  $('#preview-tag').innerHTML = `
    <div class="bg-paper ink-3 hard rounded-lg px-4 py-2 -rotate-1">
      <div class="font-mono text-[10px] tracking-[0.3em] text-ink/55">${esc(d.en)}</div>
      <div class="font-display font-extrabold text-2xl leading-tight">${esc(d.name)}</div>
      <div class="text-[11px] text-ink/60">${esc(d.motif)}</div>
    </div>
    <div class="mt-3 max-w-[300px] bg-navy text-paper ink-3 hard rounded-lg px-4 py-3 rotate-1">
      <div class="flex items-center gap-2 mb-1">
        ${icon(ICON[d.id], '!text-xl text-yellow')}
        <span class="font-display font-extrabold">${esc(d.skill.name)}</span>
        <span class="ml-auto font-mono text-[10px] bg-yellow text-ink px-1.5 py-0.5 rounded">${d.skill.key}</span>
      </div>
      <p class="text-[12px] leading-relaxed text-paper/85">${esc(d.skill.desc)}</p>
      <div class="font-mono text-[10px] text-mint mt-1.5">CD ${d.skill.cd}s</div>
    </div>`;

  $('#stats').innerHTML = statBars(d);
}

/** 能力バー4本。サメ選択と図鑑の詳細で同じものを出す */
function statBars(d) {
  return STAT_KEYS.map(([label, f]) => {
    const pct = clamp((f(d) - 0.55) / 0.95, 0.1, 1) * 100;
    return `<div class="bg-paper ink-3 hard rounded-lg px-3 py-2">
      <div class="font-mono text-[9px] tracking-[0.18em] text-ink/60 mb-1.5">${label}</div>
      <div class="h-3 bg-ink/12 ink-2 relative overflow-hidden">
        <div class="h-full bg-teal" style="width:${pct}%"></div>
      </div>
    </div>`;
  }).join('');
}

// ---------- 対戦モード ----------
// オンラインはロケ地ごとの部屋へ自動で入るだけ。ロビーもマッチング画面も作らない。
const nameInput = $('#player-name');
nameInput.value = save.name;
const playerName = () => nameInput.value.replace(/\s+/g, ' ').trim().slice(0, 10) || 'PLAYER';

function setMode(online) {
  save.online = online; persist();
  for (const [el, on] of [[$('#mode-solo'), !online], [$('#mode-online'), online]]) {
    el.style.background = on ? '#f3b553' : 'rgba(244,239,234,.12)';
    el.style.color = on ? '#2d2d2d' : '';
  }
  $('#mode-note').textContent = online
    ? '同じロケ地の部屋へ自動で入ります（最大8人）。空いた席はボットが埋めます。'
    : 'ボットだけの部屋で遊びます。通信は使いません。';
}
$('#mode-solo').onclick = () => setMode(false);
$('#mode-online').onclick = () => setMode(true);
setMode(save.online);

$('#start-btn').onclick = () => play();

// ---------- 図鑑 ----------
// 一覧は立ち絵と名前だけ。中身はカードを開いた先の大画面にまとめてある。
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
      <div class="clapper-stripes h-5 border-b-4 border-ink w-full"></div>
      <div class="w-full aspect-square p-3" style="background:${d.color}22">
        <img src="${portrait(d)}" alt="${esc(d.name)}" loading="lazy"
             class="w-full h-full object-contain drop-shadow-[5px_6px_0_rgba(45,45,45,.22)]">
      </div>
      <div class="w-full border-t-4 border-ink px-3 py-2.5">
        <h3 class="font-display font-extrabold text-lg leading-tight">${esc(d.name)}</h3>
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
            <img src="${portrait(d)}" alt="${esc(d.name)}"
                 class="w-full object-contain drop-shadow-[7px_8px_0_rgba(45,45,45,.22)]">
          </div>
          <div class="grid grid-cols-2 gap-2 mt-4">${statBars(d)}</div>
        </div>

        <div class="min-w-0">
          <div class="font-mono text-[10px] tracking-[0.3em] text-ink/55">${esc(d.en)}</div>
          <div class="flex items-baseline gap-2 flex-wrap">
            <h3 class="font-display font-extrabold text-3xl md:text-4xl leading-tight">${esc(d.name)}</h3>
            <span class="text-[11px] font-bold bg-yellow ink-2 rounded px-2 py-0.5">${esc(d.tag)}</span>
          </div>
          <div class="text-[12px] text-ink/55 mt-1">モチーフ：${esc(d.motif)}</div>

          <p class="mt-5 text-[15px] leading-[1.9] font-bold">${esc(d.intro)}</p>

          <div class="bg-navy text-paper ink-3 rounded-lg p-4 mt-5">
            <div class="flex items-center gap-2 mb-1">
              ${icon(ICON[d.id], '!text-xl text-yellow')}
              <span class="font-display font-extrabold">${esc(d.skill.name)}</span>
              <span class="ml-auto font-mono text-[10px] bg-yellow text-ink px-1.5 py-0.5 rounded">${d.skill.key}</span>
            </div>
            <p class="text-[12.5px] leading-relaxed text-paper/85">${esc(d.skill.desc)}</p>
            <div class="font-mono text-[10px] text-mint mt-1.5">CD ${d.skill.cd}s</div>
          </div>

          <div class="relative border-4 border-ink rounded-lg p-4 pt-5 mt-7">
            <span class="absolute -top-3 left-4 bg-yellow ink-2 rounded px-2 py-0.5 font-mono font-bold text-[10px] tracking-widest">CHOFU TIPS</span>
            <p class="text-[12.5px] leading-relaxed text-ink/80">${esc(d.lore)}</p>
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
const dropNet = () => { net?.close(); net = null; };

async function play() {
  save.shark = selShark.id; save.name = playerName(); persist();
  dropNet();
  if (save.online) {
    $('#start-btn').disabled = true;
    try {
      net = await connect({ map: selMap.id, shark: selShark.id, name: save.name });
    } catch {
      net = null;
      alert('対戦サーバに接続できませんでした。ソロで開始します。');
    }
    $('#start-btn').disabled = false;
  }
  show('game');
  pausePanel.style.display = 'none';
  $('#hud-online').classList.toggle('hidden', !net);
  $('#hud-skill-icon').textContent = ICON[selShark.id];
  $('#hud-skill-name').textContent = selShark.skill.name;
  ctl = startGame({
    canvas: stage, mini, sharkId: selShark.id, map: selMap,
    net, name: net ? save.name : 'YOU',
    onHud: paintHud,
    onEnd: showResult,
  });
}

function paintHud(h) {
  if (h.paused !== undefined) {
    pausePanel.style.display = h.paused ? 'grid' : 'none';
    if (Object.keys(h).length === 1) return;
  }
  hudMass.textContent = h.mass.toLocaleString();
  hudRank.textContent = `#${h.rank} / ${h.alive}`;
  const top = h.board[0]?.mass || 1;
  hudBar.style.width = clamp(h.mass / top, 0.04, 1) * 100 + '%';
  if (h.humans) $('#hud-online').textContent = `ONLINE · ${h.humans} PLAYERS`;
  hudBoard.innerHTML = h.board.map((b, i) => `
    <li class="flex justify-between items-center gap-2 px-1.5 py-0.5 ${b.me ? 'bg-yellow ink-2 -rotate-1 hard-sm relative z-10' : ''}">
      <span class="font-bold truncate">${i + 1}. ${b.human && !b.me ? '◆ ' : ''}${esc(b.name)}</span>
      <span class="font-mono text-[11px] shrink-0">${b.mass.toLocaleString()}</span>
    </li>`).join('');
  hudCd.style.opacity = h.cd > 0 ? '1' : '0';
  hudCd.textContent = Math.ceil(h.cd);
  hudReel.style.animation = h.boosting ? 'spin .35s linear infinite' : 'spin 4s linear infinite';
  hudReel.style.filter = h.boost ? '' : 'grayscale(1) brightness(.75)';
  // 残量ぶんは素通し、使った分を暗く塗る。息切れ中は赤で潰す
  const spent = h.winded ? 'rgba(186,26,26,.66)' : 'rgba(11,32,34,.74)';
  hudStam.style.background = `conic-gradient(transparent ${h.stam}turn, ${spent} 0)`;
}

$('#resume').onclick = () => ctl?.resume();
$('#quit').onclick = () => { dropNet(); show('title'); };
$('#hud-skill').onclick = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e' }));
$('#retry').onclick = () => play();

function showResult(r) {
  dropNet();                       // 死んだら部屋を出る（ホストなら次の人へ委譲される）
  const best = Math.max(save.best, r.mass);
  const isBest = r.mass > save.best;
  save.best = best; persist();

  show('result');
  $('#res-sub').textContent = `${selMap.name} ／ ${selShark.name}`;
  $('#res-stats').innerHTML = [
    ['到達サイズ', r.mass.toLocaleString(), isBest ? 'NEW BEST!' : `BEST ${best.toLocaleString()}`],
    ['撃破数', r.kills, 'KILLS'],
    ['生存時間', fmtTime(r.time), 'SURVIVED'],
  ].map(([label, val, sub], i) => `
    <div class="${i === 0 ? 'bg-yellow' : 'bg-paper'} ink-3 hard rounded-lg p-3 text-center ${['', '-rotate-1', 'rotate-1'][i]}">
      <div class="font-mono text-[9px] tracking-[0.2em] text-ink/60">${label}</div>
      <div class="font-mono font-bold text-3xl leading-tight my-0.5">${val}</div>
      <div class="font-mono text-[9px] text-ink/50">${sub}</div>
    </div>`).join('');
  $('#res-tip').textContent = TIPS[(Math.random() * TIPS.length) | 0];
}
