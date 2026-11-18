#!/usr/bin/env node
// 主要画面のスクリーンショットを撮る（docs/final/ISSUES.md の #0）。
//
//   node scripts/shots.mjs before                 → docs/final/shots/before/
//   node scripts/shots.mjs after                  → docs/final/shots/after/
//   node scripts/shots.mjs --out docs/final/shots/wip/6
//   オプション:
//     --url http://localhost:5173   起動済みの dev サーバを使う（無ければ自前で vite を立てて、終わったら止める）
//     --only airport,result         ファイル名にこの文字列を含む画面だけ撮る（カンマ区切り）
//     --size pc|sp                  片方の画面サイズだけ撮る
//     --net                         対戦サーバ（dev サーバ相乗りの /ws）に本当につなぐ。
//                                   既定はつながず、net.js が失敗してソロに落ちる既存の動きで撮る
//                                   （サーバ側のボットは乱数を固定できず、撮るたびに絵が変わるため）
//
// 撮り直しても同じ絵になるように:
//   - Math.random を固定シードの乱数に差し替える（ページを開くたびに同じ種から）
//   - playwright の clock でページの時計（setTimeout / rAF / performance.now）を止め、
//     必要な分だけ runFor で進める。ゲームのフレームは常に 16ms 刻みで進むので、
//     「開始から 8 秒後」は毎回同じ盤面になる
//   - CSS アニメーションは撮影時に止める（animations: 'disabled'）
//   - ゲーム中の操作は drive() の決まった運転（壁が近ければ内側へ向ける）をマウスで入れる
//   - リザルトは、調布駅の 8 秒後に自機を外壁の外へ置いて「外壁に接触」で終わらせて撮る
//   SHOTS_DEBUG=1 を付けると drive() が自機の座標を 200ms ごとに出す
// 画像・フォントの読み込みだけは実時間なので、各画面で読み込みを待ってから時計を進める。

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---------- 引数 ----------
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const flag = (name) => args.includes(name);
const VALUED = ['--out', '--url', '--only', '--size'];
const positional = args.filter((a, i) => !a.startsWith('--') && !VALUED.includes(args[i - 1]));
const kind = positional[0];
let outDir = opt('--out');
if (!outDir) {
  if (kind !== 'before' && kind !== 'after') {
    console.error('使い方: node scripts/shots.mjs <before|after> | --out <出力先>  [--url URL] [--only a,b] [--size pc|sp] [--net]');
    process.exit(2);
  }
  outDir = join('docs', 'final', 'shots', kind);
}
outDir = resolve(ROOT, outDir);
const only = opt('--only')?.split(',').filter(Boolean) ?? null;
const sizeOnly = opt('--size');
const useNet = flag('--net');

const SIZES = [
  { tag: 'pc', viewport: { width: 1280, height: 720 }, isMobile: false, hasTouch: false },
  { tag: 'sp', viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true },
].filter((s) => !sizeOnly || s.tag === sizeOnly);

// ---------- セーブデータ（src/progress.js の形） ----------
const MAP_IDS = ['chofu', 'jindaiji', 'tamagawa', 'airport', 'sengawa'];   // data.js の MAPS と同じ順
const baseSave = () => ({
  v: 1,
  unlocked: ['chofu'],
  best: 0,
  shark: 'cinema',
  name: 'PLAYER',
  points: 0,
  spots: {},
  seenHowto: true,          // 初回の遊び方が割り込まないように
  xp: 0,
  seed: 20250801,           // 虫食い位置の種（progress.js が乱数で作る前に固定）
  seenLevel: 0,
  seenXp: 0,
  claimedSharks: ['cinema'],
  salvageTutorialSeen: true,
  played: [],
});
const SAVES = {
  fresh: baseSave(),
  all: {
    ...baseSave(),
    unlocked: [...MAP_IDS],
    claimedSharks: ['cinema', 'dogu', 'tamagawa', 'jindaiji', 'kondo', 'airport', 'yokai'],
  },
};

// ---------- dev サーバ ----------
const freePort = () => new Promise((res, rej) => {
  const s = net.createServer();
  s.unref();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
});

async function waitHttp(url, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(url); if (r.ok) return; } catch { }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`dev サーバが起動しません: ${url}`);
}

async function startDev() {
  const port = await freePort();
  // npx を挟むと Windows で子プロセスの木が残るので、vite を node で直接起動する
  const child = spawn(process.execPath, [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'),
    '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const url = `http://127.0.0.1:${port}`;
  try { await waitHttp(url); } catch (e) { child.kill(); console.error(log); throw e; }
  return { url, stop: () => new Promise((r) => { child.once('exit', r); child.kill(); setTimeout(r, 3000); }) };
}

// ---------- ページ操作 ----------
const T0 = new Date('2026-01-01T10:00:00+09:00').getTime();

// mulberry32。ページを開くたびに同じ種から始まる
const SEED_SCRIPT = `(() => {
  let a = 0x5a3e2a10 >>> 0;
  Math.random = function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})();`;

const errors = [];

async function openPage(browser, size, save, baseUrl) {
  const ctx = await browser.newContext({
    viewport: size.viewport, deviceScaleFactor: 1,
    isMobile: size.isMobile, hasTouch: size.hasTouch,
    locale: 'ja-JP', timezoneId: 'Asia/Tokyo',
  });
  await ctx.addInitScript(SEED_SCRIPT);
  await ctx.addInitScript((s) => {
    // 最初の1回だけ書く。リロードのたびに書き戻すと、ゲームが保存した内容が消える
    if (!sessionStorage.getItem('shots.seeded')) {
      localStorage.setItem('samezario.save', JSON.stringify(s));
      sessionStorage.setItem('shots.seeded', '1');
    }
  }, save);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[${size.tag}] pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${size.tag}] console.error: ${m.text()}`); });
  // 対戦サーバ（/ws）は既定でつながせない → net.js の onclose → ソロに落ちる
  if (!useNet) await page.routeWebSocket(/\/ws$/, (ws) => ws.close());
  await page.clock.install({ time: T0 });
  await page.clock.pauseAt(T0 + 1000);
  await page.goto(baseUrl, { waitUntil: 'load' });
  await settle(page);
  return { ctx, page };
}

/** 実時間で読み込みを待つ（フォント・画像）。ページの時計は止まったまま */
async function settle(page) {
  await page.waitForLoadState('load');
  await page.evaluate(() => document.fonts.ready).catch(() => { });
  await page.waitForFunction(() => [...document.images].every((i) => !i.src || i.complete), null, { timeout: 15000 }).catch(() => { });
  await page.waitForTimeout(300);
}

/** 画面遷移（main.js の show はカチンコの setTimeout を挟む）をページ時計で進める */
async function advance(page, ms) {
  await page.clock.runFor(ms);
}

async function goScreen(page, sel, ms = 800) {
  await advance(page, ms);
  await page.waitForSelector(`${sel}.on`, { timeout: 10000 });
  await settle(page);
}

async function shot(page, size, name) {
  const file = `${name}-${size.tag}.png`;
  if (only && !only.some((o) => file.includes(o))) return;
  await page.screenshot({ path: join(outDir, file), animations: 'disabled' });
  console.log('  ', file);
  taken.push(file);
}
const want = (name) => !only || only.some((o) => name.includes(o));
const taken = [];

async function toMap(page) {
  await page.locator('#s-title [data-go="map"]').click();
  await goScreen(page, '#s-map');
  await advance(page, 600);   // 地図の選択リングなどの初期アニメーション
}

async function toShark(page, mapIndex = 0) {
  await page.locator('#map-areas path').nth(mapIndex).dispatchEvent('click');
  await advance(page, 200);
  await page.locator('#map-next').click();
  await goScreen(page, '#s-shark');
  await advance(page, 600);
}

/** ACTION! を押して、ゲームの rAF が回り始める直前（経過 0 秒）で止める */
async function startGame(page) {
  await page.evaluate(() => { delete window.__sz; });
  await page.locator('#start-btn').click();
  // connect の失敗（実時間）→ startGame。__sz は本編の startGame だけが置く
  for (let i = 0; i < 100; i++) {
    if (await page.evaluate(() => !!window.__sz)) return;
    // サーバ無しの時の 2500ms タイムアウトもページ時計なので、少しずつ進める
    await page.waitForTimeout(100);
    if (i > 10) await advance(page, 100);
  }
  throw new Error('ゲームが始まりません');
}

/**
 * 操作の代わりの決まった運転。何も操作しないと自機は湧いた向きへ直進するだけで、
 * 多摩川・仙川では数秒で外壁に当たってリザルトになってしまう（＝ゲーム中が撮れない）。
 * 200ms ごとに、前方が壁に近ければ arena.home（必ず内側にある点）へ向け直す。
 * 入力は毎回同じなので、絵は撮り直しても変わらない。
 */
async function drive(page, ms) {
  const STEP = 200;
  for (let t = 0; t < ms; t += STEP) {
    // 向けたい角度をページ内で決め、マウスを画面中心からその向きへ置く（本物の入力と同じ経路）
    const r = await page.evaluate(() => {
      const z = window.__sz;
      if (!z || !z.player.alive) return null;
      const { player: p, arena } = z;
      const look = 420;
      const hx = p.x + Math.cos(p.angle) * look, hy = p.y + Math.sin(p.angle) * look;
      const blocked = !arena.inside(hx, hy) || arena.edgeDist(hx, hy) < 260;
      const a = blocked ? Math.atan2(arena.home.y - p.y, arena.home.x - p.x) : p.angle;
      return { a, dbg: [p.x | 0, p.y | 0, p.angle.toFixed(2), blocked, arena.edgeDist(p.x, p.y) | 0].join(' ') };
    });
    if (r) {
      const vp = page.viewportSize();
      const R = Math.min(vp.width, vp.height) * 0.35;
      await page.mouse.move(vp.width / 2 + Math.cos(r.a) * R, vp.height / 2 + Math.sin(r.a) * R);
    }
    if (process.env.SHOTS_DEBUG) console.log('    drive', t, r ? r.dbg : 'dead');
    await advance(page, Math.min(STEP, ms - t));
  }
}

/**
 * 1場面ぶん（ページを開いてから閉じるまで）。途中で失敗したら最初から撮り直す。
 * 外部フォントの読み込み失敗などで Vite がページを読み直すと画面遷移がずれるため
 */
async function withPage(browser, size, save, baseUrl, fn, tries = 3) {
  for (let i = 1; ; i++) {
    const { ctx, page } = await openPage(browser, size, save, baseUrl);
    try {
      await fn(page);
      return;
    } catch (e) {
      if (i >= tries) throw e;
      console.log(`   (やり直し ${i}/${tries - 1}: ${String(e.message).split('\n')[0]})`);
    } finally {
      await ctx.close();
    }
  }
}

// ---------- 撮影の筋書き ----------
const GAME_SHOTS = [
  // [番号, 名前, data.js の MAPS での位置]
  ['06', 'chofu', 0],
  ['08', 'jindaiji', 1],
  ['10', 'tamagawa', 2],
  ['12', 'airport', 3],
  ['15', 'sengawa', 4],
];

async function runSize(browser, size, baseUrl) {
  console.log(`[${size.tag}] ${size.viewport.width}x${size.viewport.height}`);

  // 01 タイトル / 02 ロケ地（未解放） / 04 サメ選択（未獲得あり）
  if (want(`01-title-${size.tag}`) || want(`02-map-locked-${size.tag}`) || want(`04-shark-locked-${size.tag}`)) {
    await withPage(browser, size, SAVES.fresh, baseUrl, async (page) => {
    await advance(page, 1500);   // 背面のデモ再生を少し回す
    await settle(page);
    await shot(page, size, '01-title');
    await toMap(page);
    await shot(page, size, '02-map-locked');
    await toShark(page, 0);
    await shot(page, size, '04-shark-locked');
    });
  }

  // 03 ロケ地（全解放） / 05 サメ選択（全獲得）
  if (want(`03-map-unlocked-${size.tag}`) || want(`05-shark-unlocked-${size.tag}`)) {
    await withPage(browser, size, SAVES.all, baseUrl, async (page) => {
    await advance(page, 1500);
    await toMap(page);
    await shot(page, size, '03-map-unlocked');
    await toShark(page, 0);
    await shot(page, size, '05-shark-unlocked');
    });
  }

  // ゲーム中（5マップ）：開始直後 / 約8秒後 / 飛行場は気流のピーク
  for (const [no, id, idx] of GAME_SHOTS) {
    const nextNo = String(+no + 1).padStart(2, '0');
    const names = [`${no}-${id}-start`, `${nextNo}-${id}-8s`];
    if (id === 'airport') names.push(`14-${id}-gust`);
    if (id === 'chofu') names.push('17-result');
    if (!names.some((n) => want(`${n}-${size.tag}`))) continue;

    await withPage(browser, size, SAVES.all, baseUrl, async (page) => {
    await advance(page, 1500);
    await toMap(page);
    await toShark(page, idx);
    await startGame(page);
    // 開始直後：カチンコの帯が開ききるまで（main.js の CLAP + SHUT + 30）
    await drive(page, 1000);
    await settle(page);
    await shot(page, size, names[0]);
    // 約8秒後
    // （TIME が 0:08 と出るよう、8 秒を少しだけ過ぎたところ）
    await drive(page, 7100);
    await shot(page, size, names[1]);
    if (id === 'airport') {
      // data.js の gust: period 9 / dur 2.6 → 9.0〜11.6 秒が吹いている。真ん中の 10.3 秒で撮る
      await drive(page, 2200);
      await shot(page, size, names[2]);
    }
    if (id === 'chofu') {
      // リザルト：自機を外壁の外へ置いて「外壁に接触」で終わらせる（撮影のための細工。
      // 無敵を切るので、湧き直後でも次のティックで死ぬ）
      await page.evaluate(() => {
        const { player, arena } = window.__sz;
        player.iframe = 0;
        player.x = arena.bb.x0 - 2000;
        player.y = arena.bb.y0 - 2000;
      });
      await advance(page, 900 + 200);   // game.js の endRun が待つ 900ms
      await goScreen(page, '#s-result', 600);
      await advance(page, 1500);        // 数字のカウントアップなど
      await shot(page, size, '17-result');
    }
    });
  }
}

// ---------- main ----------
mkdirSync(outDir, { recursive: true });
let dev = null;
let baseUrl = opt('--url');
if (!baseUrl) {
  console.log('dev サーバを起動します…');
  dev = await startDev();
  baseUrl = dev.url;
}
console.log(`URL: ${baseUrl}  出力: ${outDir}${useNet ? '  (対戦サーバにつなぐ)' : '  (ソロ)'}`);

let browser;
let failed = false;
try {
  browser = await chromium.launch();
  for (const size of SIZES) await runSize(browser, size, baseUrl);
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  await browser?.close();
  if (dev) await dev.stop();
}

console.log(`\n撮影: ${taken.length} 枚 → ${outDir}`);
if (errors.length) {
  console.log(`コンソールエラー: ${errors.length} 件`);
  for (const e of [...new Set(errors)]) console.log('  ', e);
} else {
  console.log('コンソールエラー: なし');
}
process.exit(failed ? 1 : 0);
