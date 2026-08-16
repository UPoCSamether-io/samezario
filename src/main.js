import { SHARKS, MAPS, TIPS } from './data.js';
import { startGame } from './game.js';
import { connect } from './net.js';
import { centroidOfPath, insidePath } from './geo.js';
import { paintShark, paintSpriteShark, bodyLength, swimBody, preloadSharks } from './shark-art.js';
import { save, persist, isUnlocked, isCleared, clearSpot, markShared } from './progress.js';
import { runUnlock, explain, isDemo } from './verify.js';
import { rubify, plainText, esc } from './ruby.js';

preloadSharks(SHARKS);   // タイトルを出している間に全種そろえる（下の理由は shark-art.js 側）

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
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
// 実体は progress.js。エリアの解放とポイントを書けるのはあちらの clearSpot / markShared
// だけで、ここから直に触っていいのは「前回の選択」（shark / name / best）に限る。

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
  img.alt = plainText(selShark.name);
}

// ---------- こどもモード（ふりがな） ----------
const kidsToggle = $('#kids-toggle');
function applyKidsMode(on) {
  document.documentElement.classList.toggle('kids-mode', on);
  if (kidsToggle) kidsToggle.checked = on;
}
applyKidsMode(!!save.kids);
if (kidsToggle) {
  kidsToggle.addEventListener('change', (e) => {
    save.kids = e.target.checked;
    persist();
    applyKidsMode(save.kids);
  });
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

// ---------- 初回だけ挟む遊び方 ----------
// 「ダッシュの航跡に触れたらカット」「サイズは無関係」という中核ルールは遊び方にしか
// 書いていないのに、そこへはタイトルからしか行けなかった。はじめてのゲームスタートだけ
// ロケ地選択の手前に挟んで、ルールを知らないまま開戦しないようにする。
// 一度でも閉じたら印を付け、以後は今までどおりタイトル → ロケ地へ直行する。
const howtoGo = $('#howto-go'), howtoGoLabel = $('#howto-go-label');

/** 遊び方を閉じたあとの行き先。初回の寄り道なら読み終わりがそのまま次の一歩になる */
function aimHowto(next) {
  howtoGo.dataset.go = next;
  howtoGoLabel.textContent = next === 'title' ? 'とじる' : 'ロケ地を選ぶ →';
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-go]');
  if (!b) return;
  let to = b.dataset.go;
  // 横取りするのはタイトルの「ゲームスタート」だけ。リザルトの「ロケ地を変える」は
  // すでに一度は通ったあとなので素通りさせる
  if (to === 'map' && cur === 'title' && !save.seenHowto) { aimHowto('map'); to = 'howto'; }
  else if (to === 'howto') aimHowto('title');   // メニューから開いた分は読み終えてもタイトルへ
  if (b === howtoGo && !save.seenHowto) { save.seenHowto = true; persist(); }
  show(to);
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
// ただし多摩川のような細長いエリアでは、重心の 22px 上がもう隣のエリアの中になる。
// ずらした先が輪郭の外なら重心そのものへ戻す（名前や鍵が他所の海に浮かないように）
const offsetIn = (m, cen, dy) => (insidePath(m.path, cen.x, cen.y + dy) ? dy : 0);
// 条件は style.css の .map-label を消すブロックと一字一句そろえること
const compactMap = matchMedia('(max-height: 500px)');

/** 鍵の高さを決める。名前が出ているときはその下、消えているときは重心の上 */
function placeLocks() {
  $$('.map-lock').forEach((lk) => {
    lk.setAttribute('y', +lk.dataset.cy + (compactMap.matches ? 0 : +lk.dataset.dy));
  });
}
compactMap.addEventListener('change', placeLocks);

/** 地図を描き直す。keep を渡すとそのエリアを選んだままにする（解放直後に使う） */
function renderMaps(keep = null) {
  const areas = $('#map-areas'), labels = $('#map-labels');
  areas.innerHTML = labels.innerHTML = '';
  for (const m of MAPS) {
    const open = isUnlocked(m);
    const p = svgEl('path', {
      class: 'map-area' + (open ? '' : ' locked'),
      d: m.path, fill: open ? m.color : dimmed(m.color), tabindex: '0', role: 'radio',
      'aria-label': `${plainText(m.name)}${open ? '' : '（未解放）'}`,
    });
    // フォーカス＝選択。Tab で回すと情報パネルが追いかけるので、
    // キーボードにも「今どこを見ているか」が選択リングだけで伝わる
    p.onclick = p.onfocus = () => selectMap(m);
    areas.appendChild(p);

    const cen = centroidOfPath(m.path);

    const t = svgEl('text', {
      class: 'map-label' + (open ? '' : ' locked'),
      x: cen.x, y: cen.y + offsetIn(m, cen, LABEL_DY),
    });
    t.textContent = plainText(m.name);
    labels.appendChild(t);

    // 未解放マークの南京錠。ラベルは text-anchor:middle で幅が読めないので、横ではなく真下に置く
    if (!open) {
      const lock = svgEl('text', { class: 'map-lock', x: cen.x });
      lock.dataset.cy = cen.y;      // y は placeLocks が画面に合わせて決める
      lock.dataset.dy = offsetIn(m, cen, LOCK_DY);
      lock.textContent = 'lock';
      labels.appendChild(lock);
    }
  }
  placeLocks();
  selectMap(keep || MAPS.find(isUnlocked) || MAPS[0]);
}

function selectMap(m) {
  selMap = m;
  const open = isUnlocked(m);
  $$('.map-area').forEach((n, i) => n.setAttribute('aria-checked', MAPS[i] === m));
  // 選択リングは別レイヤ。隣のエリアの下に潜らせないため、塗りより上に重ねて描く
  $('#map-ring').setAttribute('d', m.path);
  $('#map-next').disabled = !open;
  // 押せない理由をボタン自身に出す。ラベルが「サメ選択 →」のままだと袋小路に見える。
  // 長い文言は折り返してボタンが伸び、ツールバーごと下の地図を押し下げていた
  // （実測 667x375 で3行・56→76px・地図が 20px 縮んでずれる）。
  // 短くしたうえで style.css 側で nowrap にし、行数を常に1に固定する
  $('#map-next-label').textContent = open ? 'サメ選択 →' : 'まだ遊べません';
  // 並びは重要な順。パネルは横持ちで本文 197px しか映らず（実測 844x390）、下に置いたものは
  // 読まれない。従来の順（blurb → HISTORY）だと史実が丸ごと折り返しの下に沈んでいた。
  // 史実とロック解除の導線がこの画面の主役、blurb は雰囲気づけなので最後に回す
  $('#map-info-body').innerHTML = `
    <div class="flex items-center gap-2 mb-1">
      <div id="map-en" class="font-mono text-[10px] tracking-[0.3em] text-mint">${esc(m.en)}</div>
      <!-- 寄せは justify-between ではなく ml-auto。横持ちでは #map-en が畳まれるので、
           between だと残った数字が左端へ流れる -->
      <div class="flex items-center gap-1.5 shrink-0 ml-auto">
        <span class="font-mono text-[10px] text-paper/55">解放 ${MAPS.filter(isUnlocked).length}/${MAPS.length}</span>
        <span class="font-mono font-bold text-[11px] bg-yellow text-ink ink-2 rounded px-1.5 py-0.5">${save.points} pt</span>
      </div>
    </div>
    <h3 id="map-title" class="font-display font-extrabold text-2xl mb-1 leading-tight">${rubify(m.name)}</h3>
    <div id="map-badge" class="inline-block text-[11px] font-bold px-2 py-0.5 rounded ink-2 mb-4 ${open ? 'bg-yellow text-ink' : 'bg-paper/20 text-paper'}">
      ${open ? '解放済み' : '未解放'}
    </div>
    <div>
      <div class="font-mono text-[10px] tracking-[0.25em] text-yellow mb-1">HISTORY</div>
      <p class="text-[13px] leading-relaxed text-paper/80">${rubify(m.lore)}</p>
    </div>
    ${spotCard(m)}
    <p id="map-blurb" class="text-sm leading-relaxed text-paper/90 mt-4 pt-3 border-t-2 border-paper/25">${rubify(m.blurb)}</p>
    <div class="mt-4 font-mono text-[11px] text-paper/50">AREA ${(m.size * m.size / 1e6).toFixed(1)} km² · 実際の地形</div>`;
}

/**
 * 情報パネルの下段。未解放エリアでは解放条件、解放済みエリアでは現地スポットの案内になる。
 * 撮影ずみのスポットは記録（一致度・シェア）を出して、もう一度撮れる状態のまま置いておく。
 */
function spotCard(m) {
  const s = m.spot;
  if (!s) return '';
  const open = isUnlocked(m);
  const done = isCleared(s);
  const rec = save.spots[s.id];
  const head = open
    ? (done ? '撮影ずみのスポット' : '現地スポット（ボーナス）')
    : '現地写真で解放';
  const label = done ? 'もう一度撮る' : open ? `写真を撮る +${s.points}pt` : '写真を撮って解放';
  return `
    <div class="mt-4 bg-paper/10 ink-2 border-paper/30 rounded p-3">
      <div class="font-display font-bold text-sm mb-1.5 flex items-center gap-1.5">
        ${icon(done ? 'task_alt' : 'photo_camera', '!text-lg text-yellow')}${head}
      </div>
      <div class="font-display font-extrabold text-[15px] leading-tight">${rubify(s.name)}</div>
      <p class="mt-1 text-[12px] leading-relaxed text-paper/70">${rubify(s.desc)}</p>
      <div class="mt-2 flex items-start gap-1.5 text-[11.5px] leading-snug text-mint">
        ${icon('center_focus_strong', '!text-[15px] shrink-0')}<span>${rubify(s.angle)}</span>
      </div>
      ${done ? `
      <div class="mt-2 font-mono text-[10px] text-paper/55">
        一致度 ${rec.score}% ・ ${rec.shared ? 'シェア済み' : 'シェア未'}
      </div>` : ''}
      <button data-unlock="${m.id}"
              class="mt-3 w-full bg-yellow text-ink ink-2 rounded hard-sm px-3 py-2 font-display font-extrabold text-sm
                     flex items-center justify-center gap-1.5 transition-transform hover:-translate-y-0.5 active:translate-y-0.5">
        ${icon('photo_camera', '!text-lg')}${label}
      </button>
      <p class="mt-1.5 font-mono text-[10px] text-paper/45">現地（半径${s.radius}m）で撮影してください</p>
    </div>`;
}

$('#map-next').onclick = () => { if (isUnlocked(selMap)) show('shark'); };
renderMaps();

// ---------- エリア解放（現地写真の照合） ----------
// 撮影 → 現在地 → 照合 の一本道は verify.js の runUnlock が持つ。ここが受け持つのは
// その途中経過を絵にすることと、通った後の「開いた」という手応えだけ。
// 判定を後でサーバへ移しても、この画面は一行も変わらない。
const unlockPanel = $('#unlock');
const unlockBody = $('#unlock-body');
let unlockMap = null;   // いま解放しようとしているエリア
let shotUrl = null;     // 撮った写真のプレビュー。閉じるときに必ず revoke する
let running = false;    // 二重起動よけ。撮影中にもう一度押すと入力欄が2つ開く
let opened = false;     // この撮影でエリアが開いたか（解放済みエリアのボーナスと文言を分ける）

const STEPS = {
  capture: ['photo_camera', 'カメラを開いています', ''],
  locate: ['my_location', '現在地を確認しています', '屋外のほうが早く決まります'],
  verify: ['image_search', 'お手本と照合しています', ''],
};

const gmaps = (s) => `https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lon}`;

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-unlock]');
  if (b) openUnlock(MAPS.find((m) => m.id === b.dataset.unlock));
});
$('#unlock-close').onclick = closeUnlock;
unlockPanel.onclick = (e) => { if (e.target === unlockPanel) closeUnlock(); };   // 外側の暗幕
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeUnlock(); });

function openUnlock(m) {
  if (!m?.spot) return;
  unlockMap = m;
  unlockPanel.style.display = 'grid';
  // このパネルの間だけ縦持ちを許す（style.css の縦持ちガード参照）。
  // 現地でスポットの前に立っている人に、撮る前後だけ横持ちを強いる理由は無い
  document.documentElement.classList.add('unlocking');
  paintIdle();
}

function closeUnlock() {
  if (running || !unlockMap) return;   // 撮影の途中で消すと、戻る先が無くなる
  unlockPanel.style.display = 'none';
  document.documentElement.classList.remove('unlocking');
  dropShot();
  unlockMap = null;
}

function dropShot() {
  if (shotUrl) URL.revokeObjectURL(shotUrl);
  shotUrl = null;
}

/** 撮る前。解放条件（スポット・お手本アングル・ジオフェンス）を読ませる画面 */
function paintIdle(err = '') {
  const m = unlockMap, s = m.spot, open = isUnlocked(m);
  const done = isCleared(s);
  unlockBody.innerHTML = `
    <div class="p-6 max-sm:p-4">
      <div class="font-mono text-[10px] tracking-[0.3em] text-ink/55">${open ? 'BONUS SPOT' : 'UNLOCK AREA'}</div>
      <h3 class="font-display font-extrabold text-2xl leading-tight">${rubify(s.name)}</h3>
      <div class="text-[12px] text-ink/60 mt-0.5">${rubify(m.name)}エリア${done ? ' ・ 撮影ずみ' : ''}</div>

      <p class="mt-3 text-[13px] leading-relaxed text-ink/80">${rubify(s.desc)}</p>

      <div class="mt-4 bg-navy text-paper ink-3 rounded-lg p-4">
        <div class="flex items-center gap-1.5 mb-1">
          ${icon('center_focus_strong', '!text-lg text-yellow')}
          <span class="font-display font-extrabold text-sm">お手本アングル</span>
        </div>
        <p class="text-[13px] leading-relaxed text-paper/85">${rubify(s.angle)}</p>
        <div class="mt-2 pt-2 border-t-2 border-paper/20 font-mono text-[10px] text-mint">
          現地から半径 ${s.radius}m 以内 ・ 成功で +${s.points}pt
        </div>
      </div>

      ${err ? `
      <div class="mt-4 bg-danger/12 ink-2 border-danger/50 rounded p-3 text-[13px] leading-relaxed text-ink shake">
        ${esc(err)}
      </div>` : ''}

      ${isDemo() ? `
      <div class="mt-4 ink-2 border-ink/30 rounded p-2 font-mono text-[10.5px] text-ink/60 text-center">
        DEMO MODE — 現在地と照合を飛ばして解放します
      </div>` : ''}

      <div class="mt-5 flex flex-col gap-3">
        <button class="btn primary" id="unlock-go"><div class="cap clapper-stripes"></div>
          <div class="py-2.5 font-display font-extrabold text-lg flex items-center justify-center gap-2">
            ${icon('photo_camera', '!text-2xl')}${done ? 'もう一度撮る' : '写真を撮る'}
          </div></button>
        <a class="btn block text-center" href="${gmaps(s)}" target="_blank" rel="noopener">
          <div class="cap clapper-stripes"></div>
          <div class="py-2 font-display font-bold text-sm">地図でスポットを開く</div></a>
      </div>
      <p class="mt-3 font-mono text-[10px] leading-relaxed text-ink/45">
        写真は端末の中だけで照合し、どこにも送りません。位置情報はこの判定にだけ使います。
      </p>
    </div>`;
  $('#unlock-go').onclick = go;
}

/** 撮影中・測位中・照合中。フィルムリールを回して待たせる */
function paintStep(step) {
  const [ico, text, note] = STEPS[step];
  unlockBody.innerHTML = `
    <div class="p-8 max-sm:p-5 text-center">
      <div class="relative w-16 h-16 mx-auto">
        <div class="absolute inset-0 rounded-full ink-3" style="animation:spin 1.8s linear infinite;
             background:conic-gradient(from 0deg,var(--color-teal) 0 25%,var(--color-teal-deep) 0 50%,var(--color-teal) 0 75%,var(--color-teal-deep) 0)"></div>
        <div class="absolute inset-0 grid place-items-center text-paper">${icon(ico, '!text-2xl')}</div>
      </div>
      <p class="mt-4 font-display font-extrabold text-lg">${text}…</p>
      <p class="mt-1 text-[12px] text-ink/55 h-4">${note}</p>
    </div>`;
}

/** 通った後。解放の演出 → そのエリアの歴史 → シェア */
function paintSuccess(r, gained) {
  const m = unlockMap, s = m.spot;
  const rec = save.spots[s.id];
  unlockBody.innerHTML = `
    <div class="p-6 max-sm:p-4">
      <div class="text-center">
        <div class="stamp inline-block bg-ink text-yellow ink-3 rounded-lg px-6 py-2 hard neon">
          <span class="font-display font-black text-3xl max-sm:text-2xl">${opened ? 'AREA UNLOCKED' : 'SPOT CLEARED'}</span>
        </div>
        <p class="mt-3 font-display font-extrabold text-xl">${rubify(m.name)}エリア</p>
        <p class="font-mono text-[11px] text-ink/55">${rubify(s.name)} ・ ${
          r.demo ? 'DEMO' : r.blind ? '現在地で確認' : `一致度 ${r.score}%`}</p>
      </div>

      ${shotUrl ? `
      <div class="mt-4 ink-3 rounded-lg overflow-hidden bg-ink/5">
        <img src="${shotUrl}" alt="撮影した写真" class="w-full max-h-[34vh] object-contain">
      </div>` : ''}

      <div class="mt-4 grid grid-cols-2 gap-3">
        <div class="bg-yellow ink-3 hard rounded-lg p-3 text-center -rotate-1">
          <div class="font-mono text-[9px] tracking-[0.2em] text-ink/60">GAIN</div>
          <div class="font-mono font-bold text-2xl leading-tight">+${gained}</div>
          <div class="font-mono text-[9px] text-ink/50">${gained ? 'POINT' : '獲得ずみ'}</div>
        </div>
        <div class="bg-paper ink-3 hard rounded-lg p-3 text-center rotate-1">
          <div class="font-mono text-[9px] tracking-[0.2em] text-ink/60">TOTAL</div>
          <div class="font-mono font-bold text-2xl leading-tight">${save.points}</div>
          <div class="font-mono text-[9px] text-ink/50">POINT</div>
        </div>
      </div>

      <div class="relative border-4 border-ink rounded-lg p-4 pt-5 mt-6">
        <span class="absolute -top-3 left-4 bg-yellow ink-2 rounded px-2 py-0.5 font-mono font-bold text-[10px] tracking-widest">HISTORY</span>
        <p class="text-[13px] leading-relaxed text-ink/80">${rubify(s.desc)}</p>
        <p class="mt-2 text-[13px] leading-relaxed text-ink/80">${rubify(m.lore)}</p>
      </div>

      <div class="mt-5 flex flex-col gap-3">
        ${rec?.shared ? `
        <div class="ink-2 border-ink/25 rounded py-2 text-center font-display font-bold text-sm text-ink/55">
          シェア済み（+${s.share}pt 獲得ずみ）
        </div>` : `
        <button class="btn" id="unlock-share"><div class="cap clapper-stripes"></div>
          <div class="py-2.5 font-display font-extrabold flex items-center justify-center gap-2">
            ${icon('share', '!text-xl')}シェアして +${s.share}pt
          </div></button>`}
        <button class="btn primary" id="unlock-done"><div class="cap clapper-stripes"></div>
          <div class="py-2.5 font-display font-extrabold text-lg">マップへ戻る</div></button>
      </div>
    </div>`;
  const sh = $('#unlock-share');
  if (sh) sh.onclick = () => share(r);
  $('#unlock-done').onclick = closeUnlock;
}

/** 撮る。ここから戻るまでが1回のタップの流れ（iOS は位置の許可をこの中で出す） */
async function go() {
  if (running) return;
  running = true;
  const m = unlockMap;
  try {
    const r = await runUnlock(m.spot, paintStep);
    if (r.code === 'CANCELLED') { paintIdle(); return; }
    if (!r.ok) { paintIdle(explain(r)); return; }

    dropShot();
    if (r.photo) shotUrl = URL.createObjectURL(r.photo);
    const before = save.points;
    opened = !isUnlocked(m);   // 開ける前に見ておく（clearSpot の後では区別が付かない）
    clearSpot(m, r.score);
    renderMaps(m);          // 鍵が外れた地図に描き直す（パネルの裏で済ませておく）
    paintSuccess(r, save.points - before);
  } catch {
    paintIdle('判定できませんでした。もう一度お試しください。');
  } finally {
    running = false;
  }
}

/**
 * シェア。実投稿の検証は X API が有料でできないので、シェアシートが完了した時点で加点する
 * （スポットごと1回）。シートを閉じただけなら reject が来るので加点しない。
 * 共有APIの無い環境では投稿画面を開いた時点で加点扱いにする —— PoC としての割り切り。
 */
async function share(r) {
  const m = unlockMap, s = m.spot;
  // 「エリア」は data.js の name から外れている（地図のラベル用に短くしてある）ので、
  // 文章として読ませるここでは足す。共有テキストはプレーンテキストにする
  const text = `『${plainText(m.name)}エリア』を解放！ ${plainText(s.name)} で写真照合クリア — サメザリオ`;
  const url = location.origin + location.pathname;
  try {
    if (navigator.share) await navigator.share({ title: 'サメザリオ', text, url });
    else window.open(
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
      '_blank', 'noopener');
  } catch {
    return;   // シートを閉じただけ
  }
  markShared(s);
  selectMap(m);              // 情報パネルのポイント表示を追従させる
  paintSuccess(r, s.share);  // 直前に入った分＝シェアぶんを GAIN に出す
}

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
    // 面を3つ並べる。ダイヤルを一周させるために、端まで来たら中央の面へ
    // 黙って戻す（下の recenter）。1面だけだと端で必ず止まってしまう。
    // ダイヤル以外では 0面と2面を CSS が隠すので、見た目は今までどおり5体
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
            <span class="tile-name block font-display font-extrabold text-base leading-tight">${rubify(d.name)}</span>
            <span class="tile-sub block font-mono text-[10px] tracking-widest text-ink/55">${esc(d.en)} · ${esc(d.tag)}</span>
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
// 条件は CSS のダイヤルブロックと一字一句そろえること（ずれると片方だけ効く）
const isDial = () => matchMedia('(max-height: 500px)').matches;
const DIAL_COPIES = 3;   // 一周させるための面の数。中央の面を基準にする

// スキル札のタップで効果説明を開閉する。説明は札の上に浮かせる（札自体は
// 大きくならない）ので、他所を触ったら閉じないと画面に居座ってしまう。
// 中身は選択のたびに作り直されるため、個々の札ではなく document に一度だけ張る
document.addEventListener('click', (e) => {
  const tag = $('#preview-tag');
  tag.classList.toggle('show-desc', !!e.target.closest('.tag-skill') && !tag.classList.contains('show-desc'));
});

// カチンコを鳴らす。押すたびに腕が一瞬持ち上がって閉じる。
// クラスを付け直す前に一度レイアウトを読むのは、連打しても毎回頭から再生させるため
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

/**
 * 端まで来たら中央の面へ黙って引き戻す。面の高さちょうどだけ動かすので
 * スナップ位置も選択も変わらず、利用者からは無限に回っているように見える。
 * scroll-behavior を一時的に切るのは、この移動をアニメーションさせないため
 */
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
  // scrollend はまだ全ブラウザに無いので、止まったことは時間で見る。
  // スナップのアニメーション中に拾うと1つ手前で確定してしまうため少し待つ
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
    // ダイヤル表示の「選択中」はクラスで持つ。inline の transform とは別物で、
    // 未選択側を引っ込める見せ方は style.css が受け持つ
    n.classList.toggle('is-sel', on);
  });

  $('#preview-tag').innerHTML = `
    <div class="shrink-0 bg-paper ink-3 hard rounded-lg px-4 py-2 -rotate-1">
      <div class="tag-en font-mono text-[10px] tracking-[0.3em] text-ink/55">${esc(d.en)}</div>
      <div class="tag-name font-display font-extrabold text-2xl leading-tight">${rubify(d.name)}</div>
      <div class="tag-motif text-[11px] text-ink/60">${rubify(d.motif)}</div>
    </div>
    <div class="tag-skill flex-1 min-w-0 bg-navy text-paper ink-3 hard rounded-lg px-4 py-3 rotate-1">
      <div class="flex items-center gap-2 mb-1">
        ${icon(ICON[d.id], '!text-xl text-yellow')}
        <span class="font-display font-extrabold">${rubify(d.skill.name)}</span>
        <span class="kbd-badge ml-auto font-mono text-[10px] bg-yellow text-ink px-1.5 py-0.5 rounded">${d.skill.key}</span>
      </div>
      <div class="tag-more">
        <p class="tag-desc text-[12px] leading-relaxed text-paper/85">${rubify(d.skill.desc)}</p>
        <div class="tag-cd font-mono text-[10px] text-mint mt-1.5">CD ${d.skill.cd}s</div>
      </div>
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

// ---------- 名前 ----------
// モードの切り替えは無い。常にロケ地の部屋へ入り、空席はボットが埋める。
// サーバが居なければそのままボットだけの部屋になる（＝これまでのソロ）。
const nameInput = $('#player-name');
nameInput.value = save.name;
const playerName = () => nameInput.value.replace(/\s+/g, ' ').trim().slice(0, 10) || 'PLAYER';

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
      <div class="dex-cap clapper-stripes h-5 border-b-4 border-ink w-full"></div>
      <div class="dex-thumb w-full aspect-square p-3" style="background:${d.color}22">
        <img src="${portrait(d)}" alt="${plainText(d.name)}" loading="lazy" decoding="async"
             class="w-full h-full object-contain drop-shadow-[5px_6px_0_rgba(45,45,45,.22)]">
      </div>
      <div class="dex-name w-full border-t-4 border-ink px-3 py-2.5">
        <h3 class="font-display font-extrabold text-lg leading-tight">${rubify(d.name)}</h3>
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
            <img src="${portrait(d)}" alt="${plainText(d.name)}" decoding="async"
                 class="w-full object-contain drop-shadow-[7px_8px_0_rgba(45,45,45,.22)]">
          </div>
          <div class="grid grid-cols-2 gap-2 mt-4">${statBars(d)}</div>
        </div>

        <div class="min-w-0">
          <div class="font-mono text-[10px] tracking-[0.3em] text-ink/55">${esc(d.en)}</div>
          <div class="flex items-baseline gap-2 flex-wrap">
            <h3 class="font-display font-extrabold text-3xl md:text-4xl leading-tight">${rubify(d.name)}</h3>
            <span class="text-[11px] font-bold bg-yellow ink-2 rounded px-2 py-0.5">${esc(d.tag)}</span>
          </div>
          <div class="text-[12px] text-ink/55 mt-1">モチーフ：${rubify(d.motif)}</div>

          <p class="mt-5 text-[15px] leading-[1.9] font-bold">${rubify(d.intro)}</p>

          <div class="bg-navy text-paper ink-3 rounded-lg p-4 mt-5">
            <div class="flex items-center gap-2 mb-1">
              ${icon(ICON[d.id], '!text-xl text-yellow')}
              <span class="font-display font-extrabold">${rubify(d.skill.name)}</span>
              <span class="kbd-badge ml-auto font-mono text-[10px] bg-yellow text-ink px-1.5 py-0.5 rounded">${d.skill.key}</span>
            </div>
            <p class="text-[12.5px] leading-relaxed text-paper/85">${rubify(d.skill.desc)}</p>
            <div class="font-mono text-[10px] text-mint mt-1.5">CD ${d.skill.cd}s</div>
          </div>

          <div class="relative border-4 border-ink rounded-lg p-4 pt-5 mt-7">
            <span class="absolute -top-3 left-4 bg-yellow ink-2 rounded px-2 py-0.5 font-mono font-bold text-[10px] tracking-widest">CHOFU TIPS</span>
            <p class="text-[12.5px] leading-relaxed text-ink/80">${rubify(d.lore)}</p>
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

// 二重起動よけ。play() は connect() を最大 2.5 秒待つので、その間に
// もう一度押されると startGame が二重に走り、前の回のリスナと rAF ループが
// 取り残されたまま回り続ける。#start-btn の disabled だけでは #retry を塞げない
let starting = false;
async function play() {
  if (starting) return;
  starting = true;
  try {
    save.shark = selShark.id; save.name = playerName(); persist();
    dropNet();
    $('#start-btn').disabled = true;
    // 繋がらなければ黙ってボット部屋。ここで手を止める理由が無い
    try { net = await connect({ map: selMap.id, shark: selShark.id, name: save.name }); }
    catch { net = null; }
    $('#start-btn').disabled = false;
    show('game');
    pausePanel.style.display = 'none';
    $('#hud-online').classList.toggle('hidden', !net);
    $('#hud-skill-icon').textContent = ICON[selShark.id];
    $('#hud-skill-name').textContent = plainText(selShark.skill.name);
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
  // トップとの比を線形で取ると、ボットが15秒で500超に届く一方こちらは30スタートなので
  // バーが下限に張り付いて動かない。対数にして序盤の伸びを見せる
  const top = Math.max(h.board[0]?.mass || 1, 2);
  hudBar.style.width = clamp(Math.log(Math.max(h.mass, 1)) / Math.log(top), 0.04, 1) * 100 + '%';
  if (h.humans) $('#hud-online').textContent = `ONLINE · ${h.humans} PLAYER${h.humans > 1 ? 'S' : ''}`;
  const row = (b, rank, extra = '') => `
    <li class="flex justify-between items-center gap-2 px-1.5 py-0.5 ${extra} ${b.me ? 'bg-yellow ink-2 -rotate-1 hard-sm relative z-10' : ''}">
      <span class="font-bold truncate">${rank}. ${b.human && !b.me ? '◆ ' : ''}${esc(b.name)}</span>
      <span class="font-mono text-[11px] shrink-0">${b.mass.toLocaleString()}</span>
    </li>`;
  // トップ5固定なので、上位に入るまで自分の行が一度も出ない。圏外なら最下段に足す
  hudBoard.innerHTML = h.board.map((b, i) => row(b, i + 1)).join('')
    + (h.board.some((b) => b.me) ? ''
      : row({ name: myName, mass: h.mass, me: true, human: true }, h.rank, 'mt-1.5 border-t-2 border-ink/25 pt-1'));
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
$('#retry').onclick = () => play();

// ゲーム中の HUD は click ではなく pointerdown で拾う。
// 操舵の指が画面に付いている間は指が2本になり、iOS はマルチタッチ中の
// タップに click を合成しないので、click 頼みだと「動かしながらスキル」が
// まったく効かなかった。ついでに押した瞬間に出るぶん反応も早くなる。
// preventDefault は長押しの選択・コピーのポップアップ止め（CSS 側とセット）で、
// click が消えるぶんカチンコはここから直接鳴らす
const hudKey = (el, key, sound) => el.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (sound) clap(el);
  window.dispatchEvent(new KeyboardEvent('keydown', { key }));
});
hudKey($('#hud-skill'), 'e', true);
hudKey($('#hud-pause'), 'Escape', false);

// DASH。game.js にボタンの存在を教えず、Space の経路をそのまま再利用する
// （スキルが上でやっているのと同じ手）。game.js 側に状態が増えない。
// pointercancel も拾うのは、通知などで pointer を奪われたときに
// pointerup が来ず、ブーストが押しっぱなしで張り付くため
const hudDash = $('#hud-dash');
const dashKey = (type) => window.dispatchEvent(new KeyboardEvent(type, { key: ' ' }));
hudDash.addEventListener('pointerdown', (e) => { e.preventDefault(); dashKey('keydown'); });
hudDash.addEventListener('pointerup', () => dashKey('keyup'));
hudDash.addEventListener('pointercancel', () => dashKey('keyup'));

function showResult(r) {
  dropNet();                       // 死んだら部屋を出る（ホストなら次の人へ委譲される）
  const best = Math.max(save.best, r.mass);
  const isBest = r.mass > save.best;
  save.best = best; persist();

  show('result');
  $('#res-sub').innerHTML = `${rubify(selMap.name)} ／ ${rubify(selShark.name)}`
    + (r.cause ? `<br><span class="text-danger">${esc(r.cause)}に接触</span>` : '');
  $('#res-stats').innerHTML = [
    ['到達サイズ', r.mass.toLocaleString(), isBest ? 'NEW BEST!' : `BEST ${best.toLocaleString()}`],
    ['撃破数', r.kills, 'KILLS'],
    ['生存時間', fmtTime(r.time), 'SURVIVED'],
  ].map(([label, val, sub], i) => `
    <div class="res-stat ${i === 0 ? 'bg-yellow' : 'bg-paper'} ink-3 hard rounded-lg p-2 sm:p-3 text-center ${['', '-rotate-1', 'rotate-1'][i]}">
      <div class="font-mono text-[9px] tracking-[0.2em] text-ink/60">${label}</div>
      <div class="res-stat-v font-mono font-bold text-xl sm:text-3xl leading-tight my-0.5">${val}</div>
      <div class="font-mono text-[9px] text-ink/50">${sub}</div>
    </div>`).join('');
  $('#res-tip').innerHTML = rubify(TIPS[(Math.random() * TIPS.length) | 0]);
}
