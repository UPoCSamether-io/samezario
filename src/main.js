import { SHARKS, MAPS, TIPS } from './data.js';
import { startGame } from './game.js';
import { connect } from './net.js';
import { centroidOfPath, insidePath } from './geo.js';
import { paintShark, paintSpriteShark, bodyLength, swimBody, preloadSharks } from './shark-art.js';
import { save, persist, isUnlocked, isCleared, clearSpot, markShared, isUnlockedShark, hasNewScript } from './progress.js';
import { runUnlock, explain, isDemo } from './verify.js';
import { rubify, plainText, kanaText, esc } from './ruby.js';
import { shareUnlock, explainShare } from './share.js';

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
      syncScriptDot();
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

// 脚本に新しい文字が現れたことを赤点で知らせる。
// #chrome はゲーム中 display:none になるので、表示制御はここでは要らない。
const scriptDot = $('#script-dot');
const syncScriptDot = () => scriptDot.classList.toggle('hidden', !hasNewScript());

// ---------- タイトルの立ち絵 ----------
function paintTitleShark() {
  const img = $('#title-shark');
  img.src = portrait(selShark);
  img.alt = plainText(selShark.name);
}

// ふりがなは常時表示。以前は「こどもモード」トグル（既定OFF）で出し分けていたが、
// 既定が OFF だと読めない子には最初から読めず、設定を見つけて押せる子はそもそも
// 読める、という順序の問題があった。rt は読める人の邪魔にならないサイズに抑える
// （style.css の ruby / rt）ので、常に出しておくほうが目的に合う。

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
  howtoGoLabel.innerHTML = next === 'title' ? 'とじる' : rubify('ロケ｜地《ち》を｜選《えら》ぶ →');
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
    // 高さも見ること。
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
// 26 では 52px の鍵の上端が名前に食い込み、「深大寺」の"大"が隠れていた
const LABEL_DY = -22, LOCK_DY = 35;
// ふりがなは名前のさらに上。どちらも dominant-baseline:middle なので中心どうしの距離で決まる。
// 名前 46px と読み 24px の字面の半分（約 21+11）に縁取り（8/5 の外側 4+2.5）と隙間を足して 42。
// -26 だと 12px ぶん重なって名前の上端に読みが乗っていた。style.css の font-size を変えたらここも変える
const RUBY_DY = -42;
// ただし多摩川のような細長いエリアでは、重心の 22px 上がもう隣のエリアの中になる。
// ずらした先が輪郭の外なら重心そのものへ戻す（名前や鍵が他所の海に浮かないように）
const offsetIn = (m, cen, dy) => (insidePath(m.path, cen.x, cen.y + dy) ? dy : 0);
// 条件は style.css の .map-label を消すブロックと一字一句そろえること
const compactMap = matchMedia('(max-height: 500px)');

function placeLocks() {
  $$('.map-lock').forEach((lk) => {
    lk.setAttribute('y', +lk.dataset.cy + (compactMap.matches ? 0 : +lk.dataset.dy));
  });
}

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
    p.onclick = p.onfocus = () => selectMap(m);
    areas.appendChild(p);

    const cen = centroidOfPath(m.path);

    // ふりがな。SVG <text> は <ruby> を持てないので、読みを別の <text> として
    // エリア名の上に置く。ルビ記法が無い名前は読みが名前と同じになるので出さない
    const kana = kanaText(m.name);
    if (kana !== plainText(m.name)) {
      const r = svgEl('text', {
        class: 'map-ruby' + (open ? '' : ' locked'),
        x: cen.x, y: cen.y + offsetIn(m, cen, LABEL_DY) + RUBY_DY,
      });
      r.textContent = kana;
      labels.appendChild(r);
    }

    // エリア名ラベル
    const t = svgEl('text', {
      class: 'map-label' + (open ? '' : ' locked'),
      x: cen.x, y: cen.y + offsetIn(m, cen, LABEL_DY),
    });
    t.textContent = plainText(m.name);
    labels.appendChild(t);

    // 未解放マークの南京錠。
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
  // 選択リングは別レイヤ。
  $('#map-ring').setAttribute('d', m.path);
  $('#map-next').disabled = !open;
  // 押せない理由をボタン自身に出す。ラベルが「サメ選択 →」のままだと袋小路に見える。
  // 長い文言は折り返してボタンが伸び、ツールバーごと下の地図を押し下げていた
  // （実測 667x375 で3行・56→76px・地図が 20px 縮んでずれる）。
  // 短くしたうえで style.css 側で nowrap にし、行数を常に1に固定する
  $('#map-next-label').innerHTML = open ? rubify('サメ｜選択《せんたく》 →') : rubify('まだ｜遊《あそ》べません');
  // 並びは重要な順。パネルは横持ちで本文 197px しか映らず（実測 844x390）、下に置いたものは
  // 読まれない。従来の順（blurb → HISTORY）だと史実が丸ごと折り返しの下に沈んでいた。
  // 史実とロック解除の導線がこの画面の主役、blurb は雰囲気づけなので最後に回す
  $('#map-info-body').innerHTML = `
    <div class="flex items-center gap-2 mb-1">
      <div id="map-en" class="font-mono text-[10px] tracking-[0.3em] text-mint">${esc(m.en)}</div>
      <!-- 寄せは justify-between ではなく ml-auto。横持ちでは #map-en が畳まれるので、
           between だと残った数字が左端へ流れる -->
      <div class="flex items-center gap-1.5 shrink-0 ml-auto">
        <span class="font-mono text-[10px] text-paper/55">${rubify('｜解放《かいほう》')} ${MAPS.filter(isUnlocked).length}/${MAPS.length}</span>
        <span class="font-mono font-bold text-[11px] bg-yellow text-ink ink-2 rounded px-1.5 py-0.5">${save.points} pt</span>
      </div>
    </div>
    <h3 id="map-title" class="font-display font-extrabold text-2xl mb-1 leading-tight">${rubify(m.name)}</h3>
    <div id="map-badge" class="inline-block text-[11px] font-bold px-2 py-0.5 rounded ink-2 mb-4 ${open ? 'bg-yellow text-ink' : 'bg-paper/20 text-paper'}">
      ${open ? rubify('｜解放済《かいほうず》み') : rubify('｜未解放《みかいほう》')}
    </div>
    <div>
      <div class="font-mono text-[10px] tracking-[0.25em] text-yellow mb-1">HISTORY</div>
      <p class="text-[13px] leading-relaxed text-paper/80">${rubify(m.lore)}</p>
    </div>
    ${spotCard(m)}
    <p id="map-blurb" class="text-sm leading-relaxed text-paper/90 mt-4 pt-3 border-t-2 border-paper/25">${rubify(m.blurb)}</p>
    <div class="mt-4 font-mono text-[11px] text-paper/50">AREA ${(m.size * m.size / 1e6).toFixed(1)} km² · ${rubify('｜実際《じっさい》の｜地形《ちけい》')}</div>`;
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
    ? (done ? rubify('｜撮影《さつえい》ずみのスポット') : rubify('｜現地《げんち》スポット（ボーナス）'))
    : rubify('｜現地写真《げんちしゃしん》で｜解放《かいほう》');
  const label = done ? rubify('もう｜一度《いちど》｜撮《と》る') : open ? rubify(`｜写真《しゃしん》を｜撮《と》る +${s.points}pt`) : rubify('｜写真《しゃしん》を｜撮《と》って｜解放《かいほう》');
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
        ${rubify(`｜一致度《いっちど》 ${rec.score}% ・ ${rec.shared ? 'シェア｜済《ず》み' : 'シェア｜未《み》'}`)}
      </div>` : ''}
      <button data-unlock="${m.id}"
              class="mt-3 w-full bg-yellow text-ink ink-2 rounded hard-sm px-2.5 py-2 font-display font-extrabold text-[13px] sm:text-sm
                     flex items-center justify-center gap-1.5 transition-transform hover:-translate-y-0.5 active:translate-y-0.5 whitespace-nowrap">
        ${icon('photo_camera', '!text-lg shrink-0')}<span class="whitespace-nowrap">${label}</span>
      </button>
      <p class="mt-1.5 font-mono text-[10px] text-paper/45">${rubify(`｜現地《げんち》（｜半径《はんけい》${s.radius}m）で｜撮影《さつえい》してください`)}</p>
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
let shotPhoto = null;   // 同じ写真の実体。共有シートに添える候補（送信するのは利用者）
let running = false;    // 二重起動よけ。撮影中にもう一度押すと入力欄が2つ開く
let sharing = false;    // 同上。共有シートが出ている間にもう一度押させない
let opened = false;     // この撮影でエリアが開いたか（解放済みエリアのボーナスと文言を分ける）
let shareNote = null;   // 直前のシェア結果の知らせ { ok, text }。キャンセルでは付かない

const STEPS = {
  capture: ['photo_camera', 'カメラを｜開《ひら》いています', ''],
  locate: ['my_location', '｜現在地《げんざいち》を｜確認《かくにん》しています', '｜屋外《おくがい》のほうが｜早《はや》く｜決《き》まります'],
  verify: ['image_search', 'お｜手本《てほん》と｜照合《しょうごう》しています', ''],
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
  shown = null;   // 前回の成功画面を持ち越さない（別のスポットをシェアしてしまう）
  shareNote = null;
  paintIdle();
}

function closeUnlock() {
  if (running || sharing || !unlockMap) return;   // 撮影・共有の途中で消すと、戻る先が無くなる
  unlockPanel.style.display = 'none';
  document.documentElement.classList.remove('unlocking');
  dropShot();
  shareNote = null;
  unlockMap = null;
}

function dropShot() {
  if (shotUrl) URL.revokeObjectURL(shotUrl);
  shotUrl = null;
  shotPhoto = null;   // 端末の外へは出さない。パネルを閉じた時点で手放す
}

/** 撮る前。解放条件（スポット・お手本アングル・ジオフェンス）を読ませる画面 */
function paintIdle(err = '') {
  const m = unlockMap, s = m.spot, open = isUnlocked(m);
  const done = isCleared(s);
  unlockBody.innerHTML = `
    <div class="p-6 max-sm:p-4">
      <div class="font-mono text-[10px] tracking-[0.3em] text-ink/55">${open ? 'BONUS SPOT' : 'UNLOCK AREA'}</div>
      <h3 class="font-display font-extrabold text-2xl leading-tight">${rubify(s.name)}</h3>
      <div class="text-[12px] text-ink/60 mt-0.5">${rubify(m.name)}エリア${done ? ' ・ ' + rubify('｜撮影《さつえい》ずみ') : ''}</div>

      <p class="mt-3 text-[13px] leading-relaxed text-ink/80">${rubify(s.desc)}</p>

      <div class="mt-4 bg-navy text-paper ink-3 rounded-lg p-4">
        <div class="flex items-center gap-1.5 mb-1">
          ${icon('center_focus_strong', '!text-lg text-yellow')}
          <span class="font-display font-extrabold text-sm">${rubify('お｜手本《てほん》アングル')}</span>
        </div>
        <p class="text-[13px] leading-relaxed text-paper/85">${rubify(s.angle)}</p>
        <div class="mt-2 pt-2 border-t-2 border-paper/20 font-mono text-[10px] text-mint">
          ${rubify(`｜現地《げんち》から｜半径《はんけい》 ${s.radius}m ｜以内《いない》 ・ ｜成功《せいこう》で +${s.points}pt`)}
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
          <div class="py-2.5 font-display font-extrabold text-base sm:text-lg flex items-center justify-center gap-2 whitespace-nowrap">
            ${icon('photo_camera', '!text-2xl shrink-0')}<span class="whitespace-nowrap">${done ? rubify('もう｜一度《いちど》｜撮《と》る') : rubify('｜写真《しゃしん》を｜撮《と》る')}</span>
          </div></button>
        <a class="btn block text-center" href="${gmaps(s)}" target="_blank" rel="noopener">
          <div class="cap clapper-stripes"></div>
          <div class="py-2 font-display font-bold text-sm whitespace-nowrap">${rubify('｜地図《ちず》でスポットを｜開《ひら》く')}</div></a>
      </div>
      <p class="mt-3 font-mono text-[10px] leading-relaxed text-ink/45">
        ${rubify('｜写真《しゃしん》は｜端末《たんまつ》の｜中《なか》だけで｜照合《しょうごう》し、どこにも｜送《おく》りません。｜位置情報《いちじょうほう》はこの｜判定《はんてい》にだけ｜使《つか》います。')}
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
      <p class="mt-4 font-display font-extrabold text-lg">${rubify(text)}…</p>
      <p class="mt-1 text-[12px] text-ink/55 h-4">${rubify(note)}</p>
    </div>`;
}

// 直前に描いた成功画面。シェアの結果で描き直すとき、照合の結果と GAIN を持ち回らずに済む
let shown = null;

/** 通った後。解放の演出 → そのエリアの歴史 → シェア */
function paintSuccess(r, gained) {
  const m = unlockMap, s = m.spot;
  const rec = save.spots[s.id];
  shown = { r, gained };
  unlockBody.innerHTML = `
    <div class="p-6 max-sm:p-4">
      <div class="text-center">
        <div class="stamp inline-block bg-ink text-yellow ink-3 rounded-lg px-6 py-2 hard neon">
          <span class="font-display font-black text-3xl max-sm:text-2xl">${opened ? 'AREA UNLOCKED' : 'SPOT CLEARED'}</span>
        </div>
        <p class="mt-3 font-display font-extrabold text-xl">${rubify(m.name)}エリア</p>
        <p class="font-mono text-[11px] text-ink/55">${rubify(s.name)} ・ ${
          r.demo ? 'DEMO' : r.blind ? rubify('｜現在地《げんざいち》で｜確認《かくにん》') : rubify(`｜一致度《いっちど》 ${r.score}%`)}</p>
      </div>

      ${shotUrl ? `
      <div class="mt-4 ink-3 rounded-lg overflow-hidden bg-ink/5">
        <img src="${shotUrl}" alt="撮影した写真" class="w-full max-h-[34vh] object-contain">
      </div>` : ''}

      <div class="mt-4 grid grid-cols-2 gap-3">
        <div class="bg-yellow ink-3 hard rounded-lg p-3 text-center -rotate-1">
          <div class="font-mono text-[9px] tracking-[0.2em] text-ink/60">GAIN</div>
          <div class="font-mono font-bold text-2xl leading-tight">+${gained}</div>
          <div class="font-mono text-[9px] text-ink/50">${gained ? 'POINT' : rubify('｜獲得《かくとく》ずみ')}</div>
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
        <!-- シェアは何度でも押せる（加点だけがスポットごと1回）。押せなくすると、
             共有シートを取り違えて閉じた人がもう一度送る手立てを失う -->
        <button class="btn" id="unlock-share"><div class="cap clapper-stripes"></div>
          <div class="py-2.5 font-display font-extrabold flex items-center justify-center gap-2 whitespace-nowrap">
            ${icon('share', '!text-xl shrink-0')}<span class="whitespace-nowrap">${rec?.shared ? rubify('もう｜一度《いちど》シェア') : `シェアして +${s.share}pt`}</span>
          </div></button>
        ${shareNote ? `
        <p class="-mt-1 text-center text-[12px] leading-relaxed font-bold ${shareNote.ok ? 'text-teal-deep' : 'text-danger shake'}">
          ${esc(shareNote.text)}
        </p>
        ${shareNote.copyText ? `
        <!-- コピーも投稿画面も開けなかった端末向け。手で選んで持っていけるよう文面を出す -->
        <textarea id="share-text" readonly rows="4" aria-label="共有文"
                  class="w-full bg-paper ink-2 rounded p-2 text-[12px] leading-relaxed font-body resize-none"
                  >${esc(shareNote.copyText)}</textarea>` : ''}` : `
        <p class="-mt-1 text-center font-mono text-[10px] leading-relaxed text-ink/45">
          ${shotPhoto ? rubify('｜対応端末《たいおうたんまつ》では｜撮《と》った｜写真《しゃしん》も｜共有候補《きょうゆうこうほ》に｜入《はい》ります。') : ''}${rubify('｜送信先《そうしんさき》を｜選《えら》ぶまで、｜写真《しゃしん》はどこへも｜送《おく》られません。')}
        </p>`}
        <button class="btn primary" id="unlock-done"><div class="cap clapper-stripes"></div>
          <div class="py-2.5 font-display font-extrabold text-lg">${rubify('マップへ｜戻《もど》る')}</div></button>
      </div>
    </div>`;
  $('#unlock-share').onclick = share;
  $('#unlock-done').onclick = closeUnlock;
  // 触ったら全選択。共有手段が全部塞がった端末での最後の逃げ道なので、
  // 長押しの範囲指定をさせない
  const box = $('#share-text');
  if (box) box.onfocus = () => box.select();
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
    shareNote = null;
    if (r.photo) { shotPhoto = r.photo; shotUrl = URL.createObjectURL(r.photo); }
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
 * シェア。文面の組み立てと共有先の選択は share.js の shareUnlock が持つ（＝Web Share API →
 * コピー → X 投稿画面 の一本道）。ここが受け持つのは、その結果を画面と加点に写すことだけ。
 *
 * 実投稿の検証は X API が有料でできないので、共有シートが完了した時点で加点する
 * （スポットごと1回。2度目以降は markShared が弾く）—— PoC としての割り切り。
 * シートを閉じただけ（cancelled）は成功でも失敗でもないので、加点も知らせも出さない。
 */
async function share() {
  if (sharing || !shown) return;
  sharing = true;
  const m = unlockMap, s = m.spot;
  const btn = $('#unlock-share');
  if (btn) btn.disabled = true;   // シートが出ている間の連打よけ
  try {
    const out = await shareUnlock({ map: m, spot: s, photo: shotPhoto });
    shareNote = out.cancelled ? null : {
      ok: out.ok,
      text: explainShare(out),
      // 何も開けなかったときだけ、文面そのものを画面に出して手で持っていけるようにする
      copyText: out.via === 'none' ? out.text : '',
    };
    if (out.ok) {
      const before = save.points;
      markShared(s);
      selectMap(m);   // 情報パネルのポイントとシェア済み表示を追従させる
      // 加点があったときだけ GAIN を差し替える。2度目のシェアで +0 に化けさせない
      if (save.points > before) shown.gained = save.points - before;
    }
  } catch {
    shareNote = { ok: false, text: explainShare({ via: 'none' }), copyText: '' };
  } finally {
    sharing = false;
    paintSuccess(shown.r, shown.gained);   // 知らせを出し、ボタンを押せる状態に戻す
  }
}

// ---------- サメ選択 ----------
// 直前に遊んだサメ。タイトルの立ち絵とサメ選択の初期値を兼ねる（初回は映画サメ）
// 未解放のサメが選ばれたままになることがある（LEVEL_XP を変えたときなど）。
// 見本の映画サメへ落とす
let selShark = SHARKS.find((s) => s.id === save.shark && isUnlockedShark(s)) || SHARKS[0];
paintTitleShark();   // 起動直後のタイトルは show() を通らないのでここで描く
syncScriptDot();     // 同じ理由で赤点もここで一度合わせる

const STAT_KEYS = [
  ['スピード', 'スピード', (d) => d.speed],
  ['曲がりやすさ', '<ruby>曲<rp>(</rp><rt>ま</rt><rp>)</rp></ruby>がりやすさ', (d) => d.turn],
  ['成長', '<ruby>成長<rp>(</rp><rt>せいちょう</rt><rp>)</rp></ruby>', (d) => d.growth],
  ['スタミナ', 'スタミナ', (d) => 2 - d.boostCost],
];

let mainPreview = null;
function renderSharks() {
  if (!mainPreview) {
    mainPreview = mountPreview($('#preview'), selShark);
    const list = $('#shark-list');
    list.innerHTML = '';
    // 面を3つ並べる。ダイヤルを一周させるために、端まで来たら中央の面へ戻す
    for (let copy = 0; copy < DIAL_COPIES; copy++) {
      SHARKS.forEach((d, i) => {
        const locked = !isUnlockedShark(d);
        const b = document.createElement('button');
        b.className = 'shark-tile text-left bg-paper ink-3 rounded-lg hard px-3 py-2.5 flex items-center gap-3 ' +
          'transition-transform hover:-translate-x-1 active:translate-y-0.5' + (locked ? ' shark-locked' : '');
        b.dataset.i = i;
        b.dataset.copy = copy;
        b.innerHTML = `
          <span class="tile-icon w-10 h-10 shrink-0 rounded-full ink-2 grid place-items-center text-paper" style="background:${d.color}">
            ${icon(ICON[d.id], '!text-[22px]')}
          </span>
          <span class="min-w-0">
            <span class="tile-name block font-display font-extrabold text-base leading-tight">${rubify(d.name)}</span>
            <span class="tile-sub block font-mono text-[10px] tracking-widest text-ink/55">${esc(d.en)} · ${rubify(d.tag)}</span>
          </span>`;
        if (locked) { b.disabled = true; b.setAttribute('aria-disabled', 'true'); }
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
    if (!r.height) continue;
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
  // 全呼び出し元がここを通る。ダイヤルのスクロール選択は button の disabled を
  // 迂回できるので、押せるかどうかではなく選ばれるかどうかで止める
  if (!isUnlockedShark(d)) return;
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
    const locked = !isUnlockedShark(d);
    const card = document.createElement('button');
    card.className = 'bg-paper ink-4 hard-lg rounded-lg overflow-hidden flex flex-col text-left ' +
      'transition-transform hover:-translate-y-1 active:translate-y-0.5';
    card.innerHTML = `
      <div class="dex-cap clapper-stripes h-5 border-b-4 border-ink w-full"></div>
      <div class="dex-thumb w-full aspect-square p-3" style="background:${d.color}22">
        <img src="${portrait(d)}" alt="${locked ? '' : plainText(d.name)}" loading="lazy" decoding="async"
             class="w-full h-full object-contain drop-shadow-[5px_6px_0_rgba(45,45,45,.22)] ${locked ? 'dex-silhouette' : ''}">
      </div>
      <div class="dex-name w-full border-t-4 border-ink px-3 py-2.5">
        <h3 class="font-display font-extrabold text-lg leading-tight">${locked ? '????' : rubify(d.name)}</h3>
      </div>`;
    if (locked) card.setAttribute('aria-disabled', 'true');
    card.onclick = () => { if (!locked) openDex(d); };
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
            <span class="text-[11px] font-bold bg-yellow ink-2 rounded px-2 py-0.5">${rubify(d.tag)}</span>
          </div>
          <div class="text-[12px] text-ink/55 mt-1">${rubify('モチーフ：')}${rubify(d.motif)}</div>

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

let starting = false;
async function play() {
  if (starting) return;
  starting = true;
  try {
    save.shark = selShark.id; save.name = playerName(); persist();
    dropNet();
    $('#start-btn').disabled = true;
    try { net = await connect({ map: selMap.id, shark: selShark.id, name: save.name }); }
    catch { net = null; }
    $('#start-btn').disabled = false;
    show('game');
    pausePanel.style.display = 'none';
    $('#hud-online').classList.toggle('hidden', !net);
    $('#hud-skill-icon').textContent = ICON[selShark.id];
    $('#hud-skill-name').innerHTML = rubify(selShark.skill.name);
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

// 死因は sim.js が素のテキストで組む（「ノーラン鮫 の胴体」「外壁」など）。
// sim は描画の都合を持たないので、ルビ記法への置き換えは表示側のここでやる。
// 固定語だけが対象で、サメの名前はそのまま rubify のエスケープに任せる。
const CAUSE_RUBY = {
  外壁: '｜外壁《がいへき》',
  胴体: '｜胴体《どうたい》',
  泳いだ跡: '｜泳《およ》いだ｜跡《あと》',
};
const rubifyCause = (c) => rubify(c.replace(/泳いだ跡|外壁|胴体/g, (w) => CAUSE_RUBY[w]));

function showResult(r) {
  dropNet();
  const best = Math.max(save.best, r.mass);
  const isBest = r.mass > save.best;
  save.best = best; persist();

  show('result');
  $('#res-sub').innerHTML = `${rubify(selMap.name)} ／ ${rubify(selShark.name)}`
    + (r.cause ? `<br><span class="text-danger">${rubifyCause(r.cause)}${rubify('に｜接触《せっしょく》')}</span>` : '');
  $('#res-stats').innerHTML = [
    [rubify('｜大《おお》きさ'), r.mass.toLocaleString(), isBest ? 'NEW BEST!' : `BEST ${best.toLocaleString()}`],
    [rubify('｜撃破数《げきはすう》'), r.kills, 'KILLS'],
    [rubify('｜生存時間《せいぞんじかん》'), fmtTime(r.time), 'SURVIVED'],
  ].map(([label, val, sub], i) => `
    <div class="res-stat ${i === 0 ? 'bg-yellow' : 'bg-paper'} ink-3 hard rounded-lg p-2 sm:p-3 text-center ${['', '-rotate-1', 'rotate-1'][i]}">
      <div class="font-mono text-[9px] tracking-[0.2em] text-ink/60">${label}</div>
      <div class="res-stat-v font-mono font-bold text-xl sm:text-3xl leading-tight my-0.5">${val}</div>
      <div class="font-mono text-[9px] text-ink/50">${sub}</div>
    </div>`).join('');
  $('#res-tip').innerHTML = rubify(TIPS[(Math.random() * TIPS.length) | 0]);
}
