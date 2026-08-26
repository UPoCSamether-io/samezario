import { SHARKS, MAPS, TIPS } from './data.js';
import { startGame } from './game.js';
import { connect } from './net.js';
import { centroidOfPath, insidePath } from './geo.js';
import { paintShark, paintSpriteShark, bodyLength, swimBody, preloadSharks } from './shark-art.js';
import { mountHowtoDemo } from './howto-demo.js';
import { save, persist, isUnlocked, isCleared, clearSpot, markShared, isUnlockedShark, hasNewSalvage, stageOf, markSalvageSeen, addXp, salvageProgress, stageTicks, replace, LEVEL_XP, claimShark, chapters, chapterLocked, defaultChapter, unclaimedFinishedChapter } from './progress.js';
import { runUnlock, explain, isDemo } from './verify.js';
import { rubify, plainText, kanaText, esc } from './ruby.js';
import { shareUnlock, explainShare } from './share.js';
import { salvageView, STAGE_RATIO } from './salvage.js';

// 審査・開発用。?demo=1 は「獲得経験値を3倍」にする。以前はレベルを最大へ飛ばして
// いたが、飛ばすと肝心の場面——泥が落ちて文字が増えるところ——を見せられないまま
// 「もう全部読める史料」が出てくるだけになる。
//
// 3倍だと1プレイの到達質量 1000〜2000 が 3000〜6000 になり、1試合で段階3〜6 まで進む。
// 第1幕の完成（6,000XP＝土偶サメの解放）は 1〜2 試合。10倍だったころは1試合で
// 必ず完成まで飛んでいたが、それだと途中の段階——泥が少しずつ落ちていくところ——が
// 一度も画面に出ないまま「完成しました」になる。見せたいのはそこなので3倍に落とした。
//
// デモで「遊ぶ→泥が落ちる→サメを獲得」まで1試合で通したいときは 10 へ戻す。
const DEMO_XP_MULT = 3;
const demo = new URLSearchParams(location.search).get('demo');
const xpMult = demo === '1' ? DEMO_XP_MULT : 1;
if (demo === '0') replace({ xp: 0, seenLevel: 0, claimedSharks: ['cinema'], salvageTutorialSeen: false });

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
  dogu: 'terrain',           // 土がえり（土に埋まる）
  tamagawa: 'double_arrow',  // 直線ダッシュ
  jindaiji: 'shield',        // そばガード
  kondo: 'autorenew',        // 天然理心流（急な切り返し）
  airport: 'rotate_right',   // 旋回飛行
  yokai: 'blur_on',          // すり抜け
};
// 未知の id でも「undefined」という文字列だけは出さない（Material Symbols は合字フォントなので
// 存在しない合字名はリテラル文字列としてそのまま描画されてしまう）
const icon = (name, cls) => `<span class="material-symbols-rounded ${cls}" aria-hidden="true">${name || 'help'}</span>`;
const portrait = (d) => `/img/sharks/${d.id}_side.webp`;   // 立ち絵（タイトルと図鑑で使う）
// 未解放のサメの伏せ字。図鑑・サメ選択・史料の見出しで同じものを出す。
// 解放前に名前が読めてしまうと、史料を復元して「誰が出てくるのか」が分かる
// ——という一本道のごほうびが、先に answer だけ配られた状態になる
const MASK = '????';
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
      syncSalvageDot();
      if (name === 'shark') renderSharks();
      if (name === 'dex') { renderDex(); if (pendingClaim) { openDex(pendingClaim, true); pendingClaim = null; } }
      if (name === 'salvage') renderSalvage();
      if (name === 'howto') goHowtoPage(0);   // 入り直したら1ページ目から
      if (name === 'title') paintTitleShark();
      if (name === 'game') stopAttract(); else startAttract();
      chrome.classList.remove('shut');
      shutting = false;
      // ゲームは全画面。帯が開ききってから消す（閉じたまま消すとハードカットになる）
      if (name === 'game') setTimeout(() => { chrome.style.display = 'none'; }, SHUT + 30);
    }, SHUT);
  }, CLAP);
}

// 史料に新しい文字が現れたことを赤点で知らせる。点は2か所——タイトルの史料ボタンと、
// リザルトの「タイトルへ」——にあり、リザルトからはタイトルの点が見えないので、
// 「なぜタイトルへ戻るのか」を伝えるのはリザルト側の点だけ。
//
// id ではなく .salvage-dot を全部まとめて掴む。1つずつ配線すると、3つ目を足したときに
// 同期漏れが必ず出る（片方だけ点きっぱなしになる）。
const salvageDots = $$('.salvage-dot');

// 赤点は視覚だけなので、スクリーンリーダーには持ち主のボタンの aria-label で言い換える。
// 素の文言はここで控える。付け外しのたびに読み直すと「（新着あり）」が二重に積む
const dotLabels = salvageDots.map((d) => [d.closest('button'), d.closest('button').getAttribute('aria-label')]);

const syncSalvageDot = () => {
  const news = hasNewSalvage();
  for (const dot of salvageDots) dot.classList.toggle('hidden', !news);
  for (const [btn, base] of dotLabels) btn.setAttribute('aria-label', news ? `${base}（新着あり）` : base);
};

// ---------- 史料 ----------
// 章の状態判定（chapters/chapterLocked/defaultChapter）は save 由来の純粋なロジックなので
// progress.js 側に置いてある。ここはビュー状態（chapterIdx）と DOM 配線だけを持つ。

// 獲得したサメの詳細は図鑑のものを流用する。#dex-detail は #s-dex の子で、
// .screen が display:none を持つため史料画面のままでは映らない。
// show('dex') の完了後に開きたいので、ここで受け渡す
let pendingClaim = null;

// 表示中の章の添字。セーブしない。どの章を最後に見ていたかを永続化しても、
// 次に開くとき「復元中の章」以外を見せる理由がない
let chapterIdx = 0;

const salvageBody = $('#salvage-body');
const salvageGaugeRow = $('#salvage-gauge-row');
const salvageAction = $('#salvage-action');

/** 史料画面を組み立てる。show('salvage') から呼ばれる唯一の入口 */
function renderSalvage() {
  // 既読フラグを更新する前に退避する。そうしないと、完成済みの史料を何度開いても
  // 直近の段階差分（+29 など）が毎回ハイライトされたままになる
  const isNew = hasNewSalvage();
  // 初回だけ自動で遊び方を出す。ロック中の章の早期 return より前に置くことで、
  // 未解放の章を最初に開いた場合でも漏れなくチュートリアルが出る
  if (!save.salvageTutorialSeen) openSalvageHelp();
  const cs = chapters();
  chapterIdx = Math.max(0, Math.min(cs.length - 1, chapterIdx));
  const d = cs[chapterIdx];
  const locked = chapterLocked(chapterIdx);

  // 章がロック中なら英字名も伏せる。見出しに鍵を出しておきながら管理ラベルで
  // 「/ TAMAGAWA」と言っていては、誰が出てくるのかがそこだけで割れてしまう
  const en = locked ? MASK : d.en;
  $('#salvage-era').textContent = `HISTORICAL ARCHIVE #${d.era} / ${en}`;
  // 紙面の左の管理ラベル。aria-hidden の飾りなので読み上げには出さない（同じ内容が
  // 上の #salvage-era にある）。長い名前でも縦帯が伸びないよう overflow で切る
  $('#salvage-rail').textContent = `ARCHIVE No.${d.era} · ${en.toUpperCase()}`;
  // 鍵は絵文字を使わない。端末ごとに絵柄が変わるうえ、他のUIが全部 Material Symbols
  // なので1つだけ質感が浮く。rubify() は HTML を escape するので span は外で組む
  const lockIcon = (cls) =>
    `<span class="material-symbols-rounded ${cls} align-middle" aria-hidden="true">lock</span>`;
  $('#salvage-chapter').innerHTML =
    `${rubify(`｜第《だい》${d.era}｜幕《まく》`)} ${locked ? lockIcon('!text-lg') : rubify(d.salvageTitle)}`;
  salvageBody.style.setProperty('--stain', d.color);

  $('#salvage-prev').disabled = chapterIdx === 0;
  $('#salvage-next').disabled = chapterIdx >= cs.length - 1;

  // ロック中は本文を組み立てない。salvageView() を呼ぶと未解放の章の全文が
  // DOM に載り、全選択コピーで露出する（伏せ字を ■ にしている意味が消える）
  if (locked) {
    const prev = cs[chapterIdx - 1];
    // ink/60 は紙地に対して 3.6:1 で、小さくない文字でも下限 4.5:1 を割る
    salvageBody.innerHTML = `
      <p class="text-center text-ink/75 py-10 leading-loose">${lockIcon('!text-xl mr-1.5')}${rubify(
        `｜第《だい》${prev.era}｜幕《まく》のサメを｜映画《えいが》に｜登場《とうじょう》させると、\nここが｜読《よ》めるようになる。`)}</p>`;
    salvageBody.scrollTop = 0;
    salvageGaugeRow.innerHTML = '';
    salvageAction.innerHTML = '';
    markSalvageSeen();
    syncSalvageDot();
    return;
  }

  const stage = stageOf(d.era);
  const done = stage >= STAGE_RATIO.length - 1;
  const v = salvageView(d.salvageText, save.seed, stage);
  const html = isNew ? v.html : v.html.replace(/<mark class="fresh">(.*?)<\/mark>/gs, '$1');
  const added = isNew ? v.added : 0;
  // ゲージの塗りは復元率ではなく大きさ（XP）。復元率は 67→74→79→85→90→95→100
  // （第1幕）のような7値しか取らない。この％はゲージのすぐ下に置くと
  // ゲージの目盛りに見えるが、両者は別の量なので数字と塗りが一致せず嘘になる。
  // しかも連続量ではないので、％で出す意味がない。数字は出さず、増えた瞬間だけ
  // 「何字読めるようになったか」を言葉で出す（下の added）
  const p = salvageProgress(d.era);
  const bar = Math.round((done ? 1 : p.ratio) * 100);
  // 前に開いたときの位置。ここを初期値にして今の位置へ伸ばすと、伸びた分が
  // 「＋N字 読めるようになった！」と同じ量になり、数と動きが一致する。
  // markSalvageSeen()（この関数の末尾）で seenXp が今の値へ進むので、続けて開けば動かない
  const from = Math.round(salvageProgress(d.era, save.seenXp).ratio * 100);

  salvageBody.innerHTML = `
    <div class="salvage-slug">${rubify(d.salvageTagline)}</div>
    <p class="salvage-text mt-5 leading-loose">${html}</p>`;
  salvageBody.scrollTop = 0;

  salvageGaugeRow.innerHTML = `
    <div class="flex items-baseline justify-between text-[11px] text-paper/70">
      <span class="font-bold">${done
        ? rubify('｜復元《ふくげん》｜完了《かんりょう》')
        : rubify('｜全部《ぜんぶ》｜読《よ》めるまで')}</span>
      <!-- 単位はリザルトの「大きさ」と同じ値。同じ言葉にしないと何を溜めるのか繋がらない -->
      <span class="font-mono">${done ? '' : `${plainText('大きさ')} あと ${p.remain.toLocaleString()}`}</span>
    </div>
    <div class="salvage-gauge mt-1" style="--pct:${from}%"
         role="progressbar" aria-valuenow="${bar}" aria-valuemin="0" aria-valuemax="100"
         aria-label="${done ? '復元完了' : '全部読めるまで'}"
      >${stageTicks(d.era).map((x) => `<span class="tick" style="left:${x}%"></span>`).join('')}<i></i></div>
    ${added ? `<div class="salvage-gain text-[11px] font-bold text-yellow mt-1.5">${rubify(
      `＋${added}｜字《じ》 ｜読《よ》めるようになった！`)}</div>` : ''}`;

  // 初期値（from）を一度描いてから今の値へ差し替える。既存の transition: width .5s が
  // そのまま効く。SHUT ぶん待つのは、帯（シャッター）が開く前に始めると動きの前半が
  // 幕の裏で終わってしまうため。prefers-reduced-motion は CSS 側で transition が切れる
  if (from !== bar) {
    const gauge = $('.salvage-gauge', salvageGaugeRow);
    setTimeout(() => gauge.style.setProperty('--pct', `${bar}%`), SHUT);
  }

  const claimed = save.claimedSharks.includes(d.id);
  if (done && !claimed) {
    salvageAction.innerHTML = `
      <button id="salvage-claim" type="button" class="btn primary !w-fit max-w-full mx-auto claim-pulse">
        <div class="cap clapper-stripes"></div>
        <div class="px-6 py-3 font-display font-extrabold text-base md:text-lg">🎬 ${rubify(
          '｜史料《しりょう》をもとにサメを｜映画《えいが》に｜登場《とうじょう》させる！')}</div>
      </button>`;
    $('#salvage-claim').onclick = () => {
      claimShark(d.id);
      renderSalvage();      // ボタンを消し、次の幕のロックを解く
      pendingClaim = d;    // 図鑑へ着いたら詳細を開く（Step 0）
      show('dex');
    };
  } else if (done) {
    // 最終章では「次の幕へ進める」が嘘になる（#salvage-next は disabled のまま、
    // 第3幕はまだ存在しない）。最終章かどうかで文言を分ける
    salvageAction.innerHTML = `<p class="text-[12px] text-paper/70 text-center">${rubify(
      chapterIdx >= cs.length - 1
        ? 'つぎの｜史料《しりょう》をさがしている。'
        : '｜復元《ふくげん》｜完了《かんりょう》。｜次《つぎ》の｜幕《まく》へ｜進《すす》める。')}</p>`;
  } else {
    salvageAction.innerHTML = `<p class="text-[12px] text-paper/70 text-center">${rubify(
      '｜海《うみ》でサメを｜大《おお》きく｜育《そだ》てると、｜泥《どろ》が｜落《お》ちて｜文字《もじ》が｜読《よ》めるようになる。')}</p>`;
  }

  markSalvageSeen();
  syncSalvageDot();
}

// ---------- 史料の遊び方（チュートリアル兼ヘルプ） ----------
// 初回に自動で出るオーバーレイと、ヘッダーの [?] で出し直す内容は同じ1枚。
// 出す条件だけが異なるので、開閉のロジックを共通化する。
const salvageHelpSheet = $('#salvage-help-sheet');

// 本文は先に組み立てておく。rubify() はルビ記法以外をすべてエスケープするので、
// 強調の <span> を文字列に混ぜると &lt;span&gt; がそのまま画面に出てしまう。
// 強調は rubify() の外側で掛ける
const HELP_STEPS = [
  ['① ｜映画《えいが》の「｜原作《げんさく》」になる｜史料《しりょう》をさがそう',
   rubify('ここは｜映画《えいが》のまち・｜調布《ちょうふ》。｜次《つぎ》のサメ｜映画《えいが》をつくるには、｜原作《げんさく》になる「｜史料《しりょう》（｜昔《むかし》の｜記録《きろく》）」が｜必要《ひつよう》です。でも｜海《うみ》の｜底《そこ》で｜見《み》つけた1｜枚《まい》は、｜泥《どろ》で｜汚《よご》れてまだ｜読《よ》めません。')],
  ['② ｜海《うみ》でサメを｜大《おお》きく｜育《そだ》てて｜汚《よご》れを｜落《お》とそう',
   rubify('ゲームでサメを｜大《おお》きく｜育《そだ》てるほど、｜泥汚《どろよご》れが｜落《お》ちて｜文字《もじ》が｜読《よ》めるようになります。')],
  ['③ ｜記録《きろく》がすべて｜復元《ふくげん》されると、サメが｜登場《とうじょう》！',
   rubify('｜史料《しりょう》が100%｜復元《ふくげん》されると、｜映画監督《えいがかんとく》がその｜歴史《れきし》をもとに')
   + `<span class="text-danger font-bold">${rubify('「｜新《あたら》しいサメ」')}</span>`
   + rubify('を｜映画《えいが》にスカウト（｜解放《かいほう》）します。')],
];

function openSalvageHelp() {
  $('#salvage-help-body').innerHTML = HELP_STEPS
    .map(([h, b]) => `<div>
      <h3 class="font-display font-extrabold text-[15px]">${rubify(h)}</h3>
      <p class="mt-1 text-ink/80">${b}</p>
    </div>`).join('');
  salvageHelpSheet.style.display = 'grid';
}

const closeSalvageHelp = () => {
  salvageHelpSheet.style.display = 'none';
  if (!save.salvageTutorialSeen) { save.salvageTutorialSeen = true; persist(); }
};

$('#salvage-help').onclick = openSalvageHelp;
$('#salvage-help-close').onclick = closeSalvageHelp;
salvageHelpSheet.onclick = (e) => { if (e.target === salvageHelpSheet) closeSalvageHelp(); };
// #dex-detail・unlockPanel と同じ Escape 対応。ただしこちらの close は
// salvageTutorialSeen を書いて persist() するので、他の2枚と違って閉じている間の
// Escape まで拾うと無意味な persist() が起きる。開いている間だけ拾うよう絞る
addEventListener('keydown', (e) => { if (e.key === 'Escape' && salvageHelpSheet.style.display === 'grid') closeSalvageHelp(); });

const goChapter = (delta) => {
  const cs = chapters();
  chapterIdx = Math.max(0, Math.min(cs.length - 1, chapterIdx + delta));
  renderSalvage();
};
$('#salvage-prev').onclick = () => goChapter(-1);
$('#salvage-next').onclick = () => goChapter(+1);

// 進入のたびに「復元中の章」へ戻す。ナビの位置は画面を出た時点で忘れる
$('#salvage-btn').onclick = () => { chapterIdx = defaultChapter(); show('salvage'); };

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

// 3ページ。最後の1枚だけ #howto-go（＝行き先を持つボタン）に入れ替える。
// 送りの途中で data-go のボタンを出すと、読み終わる前にロケ地選択へ抜けられてしまう
const howtoNext = $('#howto-next'), howtoBack = $('#howto-back');
const howtoPages = $$('.howto-page');
const howtoDots = $$('.howto-dot');
let howtoPage = 0;

function paintHowto() {
  howtoPages.forEach((n, i) => { n.hidden = i !== howtoPage; });
  howtoDots.forEach((n, i) => n.classList.toggle('on', i === howtoPage));
  const last = howtoPage >= howtoPages.length - 1;
  howtoNext.hidden = last;
  howtoGo.hidden = !last;
  howtoBack.classList.toggle('invisible', howtoPage === 0);
}

function goHowtoPage(i) {
  howtoPage = Math.max(0, Math.min(howtoPages.length - 1, i));
  paintHowto();
}
howtoNext.onclick = () => goHowtoPage(howtoPage + 1);
howtoBack.onclick = () => goHowtoPage(howtoPage - 1);
howtoDots.forEach((n, i) => { n.onclick = () => goHowtoPage(i); });
paintHowto();

// デモは本編と同じ絵で描く。主役は選んでいるサメ、相手は別の1匹。
// selShark はこの下で宣言されるが、読むのは rAF の中（＝モジュール評価後）なので触れる
mountHowtoDemo($('#howto-demo'), () => ({
  page: howtoPage,
  self: selShark,
  other: SHARKS.find((d) => d !== selShark) || SHARKS[0],
  water: selMap.water,   // これから行くロケ地の海の色で見せる
}));

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
syncSalvageDot();     // 同じ理由で赤点もここで一度合わせる

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
    // 面を3つ並べる。ダイヤルを一周させるために、端まで来たら中央の面へ戻す。
    // ここで作るのは器だけで、中身（名前・施錠状態）は下の paintLocks() が入れる
    for (let copy = 0; copy < DIAL_COPIES; copy++) {
      SHARKS.forEach((d, i) => {
        const b = document.createElement('button');
        b.className = 'shark-tile text-left bg-paper ink-3 rounded-lg hard px-3 py-2.5 flex items-center gap-3 ' +
          'transition-transform hover:-translate-x-1 active:translate-y-0.5';
        b.dataset.i = i;
        b.dataset.copy = copy;
        b.onclick = () => selectShark(d);
        list.appendChild(b);
      });
    }
    mountDial(list);
  }
  paintLocks();
  selectShark(selShark);
  // ダイヤルでは選択中が中央に居ないと辻褄が合わないので、開くたびに寄せ直す
  if (isDial()) centerTile($('#shark-list'), SHARKS.indexOf(selShark), 'auto');
}

/**
 * タイル1枚の中身。ロック中は図鑑のカードと同じで、名前も英字も肩書きも出さない。
 * モチーフのアイコンと色はそれ自体が正体を指す（terrain＝土偶）ので、鍵と地の色へ寄せる。
 * 見えるのは「まだ居ないサメが1枠ある」ことだけ。
 */
const tileInner = (d, locked) => `
  <span class="tile-icon w-10 h-10 shrink-0 rounded-full ink-2 grid place-items-center text-paper"
        style="background:${locked ? 'var(--color-ink)' : d.color}">
    ${icon(locked ? 'lock' : ICON[d.id], '!text-[22px]')}
  </span>
  <span class="min-w-0">
    <span class="tile-name block font-display font-extrabold text-base leading-tight">${
      locked ? MASK : rubify(d.name)}</span>
    <span class="tile-sub block font-mono text-[10px] tracking-widest text-ink/55">${
      locked ? MASK : `${esc(d.en)} · ${rubify(d.tag)}`}</span>
  </span>`;

// タイルの生成はキャッシュされるが解放状態は史料の獲得で変わるので、表示のたびに
// 塗り直す（3面ぶん・data-i で当てる）。伏せているのは見た目ではなく中身なので、
// 施錠状態だけでなく innerHTML ごと入れ替える——そうしないと、獲得した直後に
// サメ選択を開いても伏せ字のままになる
function paintLocks() {
  $$('.shark-tile').forEach((n) => {
    const d = SHARKS[+n.dataset.i];
    const locked = !isUnlockedShark(d);
    n.classList.toggle('shark-locked', locked);
    n.disabled = locked;
    n.toggleAttribute('aria-disabled', locked);
    n.innerHTML = tileInner(d, locked);
    // 名前を伏せたぶん、押せない理由は解放条件で言う（図鑑のカードと同じ文面）
    if (locked) n.setAttribute('aria-label', plainText(unlockCopy(d)));
    else n.removeAttribute('aria-label');
  });
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
// カードは7枚・全ポートレート起動時プリロード済みで、開くのも手動遷移のみ。
// キャッシュすると解放状態（claimedSharks）とのズレが再発するので、毎回作り直す
function renderDex() {
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
        <h3 class="font-display font-extrabold text-lg leading-tight">${locked ? MASK : rubify(d.name)}</h3>
      </div>`;
    // aria-disabled は付けない。押すと解放条件が出る＝実際に押せるボタンなので、
    // 「無効」と言うと嘘になる（支援技術がフォーカスを飛ばすし、Playwright も
    // enabled 待ちで固まる）。条件はラベルに入れて、吹き出しを開かなくても伝わるようにする
    if (locked) card.setAttribute('aria-label', plainText(unlockCopy(d)));
    card.onclick = () => (locked ? showDexHint(card, d) : openDex(d));
    wrap.appendChild(card);
  }
}

// ロック中のカードを押したときの解放条件。カードは overflow:hidden なので中に
// 入れると切れる。1つだけ #dex-list の外に置いて、位置を JS で動かす。
// position:fixed なのは、offset-parent を探さずに getBoundingClientRect() の値を
// そのまま使えるため（#dex-list はスクロールするので相対座標だとズレる）
const dexHint = $('#dex-hint');
const dexList = $('#dex-list');
let hintCard = null;                       // 吹き出しが指しているカード
const hideDexHint = () => { hintCard = null; dexHint.classList.add('hidden'); };

/** 解放条件の文面。吹き出し（ルビ付き）と aria-label（ルビ無し）で同じ文を使う */
function unlockCopy(d) {
  return `｜史料《しりょう》の｜第《だい》${d.era}｜幕《まく》を｜復元《ふくげん》すると｜解放《かいほう》`;
}

function showDexHint(card, d) {
  dexHint.innerHTML = rubify(unlockCopy(d));
  dexHint.classList.remove('hidden');      // 先に出す。隠れたままだと寸法が取れない
  hintCard = card;
  placeDexHint();
}

function placeDexHint() {
  if (!hintCard) return;
  const c = hintCard.getBoundingClientRect();
  const list = dexList.getBoundingClientRect();
  // 送ってカードが一覧から出たら、指す先が無いので消す
  if (c.bottom <= list.top || c.top >= list.bottom) return hideDexHint();

  const b = dexHint.getBoundingClientRect();
  const pad = 8;
  const left = Math.min(Math.max(pad, c.left + c.width / 2 - b.width / 2), innerWidth - b.width - pad);
  // 既定はカードの下。上を既定にすると、1行目のカードでは必ず「サメ図鑑」の
  // 見出しに重なる（実測）。カードは縦に長いので、下は普通に空いている。
  // 下に入らない最終行だけ上へ回して、尻尾の向きも入れ替える
  const below = c.bottom + 10 + b.height <= innerHeight - pad;
  dexHint.classList.toggle('below', below);
  dexHint.style.left = `${Math.round(left)}px`;
  dexHint.style.top = `${Math.round(below ? c.bottom + 10 : c.top - b.height - 10)}px`;
}

// 次にどこかを押したら消す。pointerdown → click の順で来るので、カードを押した
// ときは「前の吹き出しを消す」→「新しいのを出す」になって取り合いにならない
document.addEventListener('pointerdown', hideDexHint);
// 送ったら消すのではなく追わせる。押した瞬間にブラウザがカードへフォーカスを
// 送ってスクロールすることがあり、「消す」だと出した端から自分で消していた
dexList.addEventListener('scroll', placeDexHint, { passive: true });

const dexDetail = $('#dex-detail');
const closeDex = () => { dexDetail.style.display = 'none'; };

/** 図鑑の詳細。claimed=true のときは史料からの「獲得しました」演出として使う */
function openDex(d, claimed = false) {
  $('#dex-body').innerHTML = `
    ${claimed ? `<div class="bg-yellow ink-3 border-b-4 border-ink px-6 py-3 text-center font-display font-extrabold text-lg">
      🎬 ${rubify('｜新《あたら》しいサメが｜映画《えいが》に｜登場《とうじょう》した！')}
    </div>` : ''}
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

          ${claimed ? `<button id="dex-sail" type="button" class="btn primary w-full mt-6">
            <div class="cap clapper-stripes"></div>
            <div class="px-6 py-3 font-display font-extrabold">${rubify('このサメで｜海《うみ》へ｜行《い》く')}</div>
          </button>` : ''}
        </div>
    </div>`;
  dexDetail.style.display = 'grid';
  $('#dex-body').scrollTop = 0;
  if (claimed) {
    $('#dex-sail').onclick = () => { closeDex(); selectShark(d); show('title'); };
  }
}

$('#dex-close').onclick = closeDex;
dexDetail.onclick = (e) => { if (e.target === dexDetail) closeDex(); };  // 外側の暗幕をクリック
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDex(); });

// ---------- ゲーム ----------
const stage = $('#stage');
const mini = $('#mini');
const pausePanel = $('#pause');
const vignette = $('#vignette');
const hudMass = $('#hud-mass'), hudScene = $('#hud-scene'), hudTime = $('#hud-time');
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
    vignette.style.setProperty('--warn', '0');
    hudScene.textContent = plainText(selMap.name);
    $('#hud-skill-icon').textContent = ICON[selShark.id] || 'help';
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
  if (h.time !== undefined) hudTime.textContent = fmtTime(h.time);
  if (h.edge !== undefined) vignette.style.setProperty('--warn', h.edge.toFixed(2));
  const isPlayerLead = h.rank === 1 || (h.board && h.board[0] && h.board[0].me);
  hudBoardCard.classList.toggle('is-lead', !!isPlayerLead);
  const row = (b, rank, extra = '') => {
    const isLead = rank === 1;
    const isSecond = rank === 2;
    const isMe = !!b.me;
    return `
    <li class="board-row ${isLead ? 'board-lead' : ''} ${isSecond ? 'board-second' : ''} ${isMe ? 'board-me' : ''} flex justify-between items-center gap-2 px-1.5 py-0.5 ${extra} ${isMe ? 'bg-yellow text-ink font-bold ink-2 -rotate-1 hard-sm relative z-10' : ''}">
      <span class="font-bold truncate">${rank}. ${b.human && !isMe ? '◆ ' : ''}${esc(b.name)}</span>
      <span class="font-mono text-[11px] shrink-0">${b.mass.toLocaleString()}</span>
    </li>`;
  };
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

const hudBoardCard = $('#hud-board-card');
hudBoardCard.addEventListener('click', (e) => {
  e.stopPropagation();
  hudBoardCard.classList.toggle('expanded');
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#hud-board-card')) {
    hudBoardCard.classList.remove('expanded');
  }
});

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
  vignette.style.setProperty('--warn', '0');
  const best = Math.max(save.best, r.mass);
  const isBest = r.mass > save.best;
  save.best = best; persist();

  // 経験値。到達質量をそのまま入れる。呼ぶのはここだけ（二重加算を場所で潰す）。
  // 倍率が 1 以外になるのは ?demo=1 のときだけ（冒頭の DEMO_XP_MULT）
  addXp(r.mass * xpMult);
  syncSalvageDot();

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
  // ここに出すのは「史料が1本読みきれた」ときだけ。レベル番号そのものは、それを見て
  // プレイヤーが何かできるわけではない裸の数字で、削った他の情報より価値が低い。
  //
  // 「使えるようになった」とは書かない。解放が起きるのは史料画面で自分でボタンを
  // 押したときだけで、ここで所有を告げると、サメ選択へ行ってロックを見ることになる
  const done = unclaimedFinishedChapter();
  $('#res-level').innerHTML = done
    ? `<span class="bg-yellow ink-2 rounded px-2 py-0.5 font-bold">${rubify('｜完成《かんせい》')}</span>
       ${rubify(`｜第《だい》${done.era}｜幕《まく》`)}${rubify('の｜史料《しりょう》がすべて｜読《よ》めるようになった！')}`
    : '';
  $('#res-tip').innerHTML = rubify(TIPS[(Math.random() * TIPS.length) | 0]);
}
