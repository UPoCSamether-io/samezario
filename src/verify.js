// 現地写真によるエリア解放の判定。
//
// 方針は UPoC_Samether.io/docs/07_画像照合_技術検証書.md の案A（ブラウザ内 dHash）。
// 「位置は厳密に、画像はゆるく」の二段構え —— ジオフェンスが「現地に行った」を担保し、
// dHash は「指定アングルで撮った」体験と、遠隔地からの適当な写真の排除を担当する。
//
// DOM / 端末を触るのは capturePhoto・normalize・photoHash・locate だけ。判定そのもの
// （haversineM / hamming / matchAny / dhashFromGray）は素の関数なので Node から試せる
// （verify.test.mjs）。判定をサーバへ移すときに書き換えるのは verifyPhoto ひとつ。

const HASH_W = 9, HASH_H = 8;   // 9×8 に潰して隣接ピクセルの明暗差 → 64bit
const MAX_EDGE = 1280;          // 照合・送信前の長辺。スマホ写真は 5〜12MB あるので必ず通す
const JPEG_Q = 0.85;

/** ?demo=1（または値なしの ?demo） —— 調布市外のデモ会場向けに、ジオフェンスと照合を両方飛ばす。
 *  ?demo=0 は main.js が xp を戻すためだけの値で、デモ扱いにはしない */
export const isDemo = () => {
  if (typeof location === 'undefined') return false;
  const p = new URLSearchParams(location.search);
  return p.has('demo') && p.get('demo') !== '0';
};

// ---------- 判定（素の関数。ここが「答え」） ----------

/** 2点間の距離(m)。地球を半径 R の球とみなす */
export function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371008.8;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** ハミング距離（0 = 完全一致、64 = 全ビット不一致） */
export function hamming(a, b) {
  let x = a ^ b, d = 0;
  while (x) { d += Number(x & 1n); x >>= 1n; }
  return d;
}

/** 9×8 のグレースケール輝度配列 → 64bit dHash */
export function dhashFromGray(gray, w = HASH_W, h = HASH_H) {
  let hash = 0n;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w - 1; x++) {
      hash = (hash << 1n) | (gray[y * w + x] < gray[y * w + x + 1] ? 1n : 0n);
    }
  }
  return hash;
}

export const toHex = (h) => '0x' + h.toString(16).padStart(16, '0');
export const fromHex = (s) => BigInt(s);

/**
 * 参照ハッシュ群のどれかがしきい値内なら合格。
 *
 * refs が空のスポットは基準写真がまだ無いので、位置だけで通す（blind）。
 * docs/07 4.4 の「どうしても照合が通らないときはしきい値を上げて実質ジオフェンス主判定へ
 * 逃がす」を、写真ゼロ枚の状態まで延ばしたもの。hash-lab.html で撮った基準写真の
 * ハッシュを data.js の hashes に書けば、この分岐は自然に無効になる。
 */
export function matchAny(hash, refs, threshold = 14) {
  if (!refs.length) return { ok: true, dist: 0, blind: true };
  const dist = Math.min(...refs.map((r) => hamming(hash, r)));
  return { ok: dist <= threshold, dist, blind: false };
}

/** ハミング距離 → 見せる用の一致度(%) */
export const matchScore = (dist) => Math.round(100 - (dist / 64) * 100);

// ---------- 端末（撮影・位置・画像） ----------

/**
 * OS のカメラ（またはギャラリー）を開いて写真を1枚もらう。
 * 必ず利用者の操作（クリック / タップのハンドラ）の中から呼ぶこと。
 * キャンセルは異常系ではないので reject せず null を返す。
 *
 * getUserMedia を使わないのは、要るのが1枚きりだから。権限UI・ピント・回転・
 * タブ復帰の地雷を全部 OS に任せられて、実装も20行で済む（docs/07 1.1）。
 */
export function capturePhoto({ camera = true } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (camera) input.setAttribute('capture', 'environment');   // 背面カメラを直に開く
    input.style.display = 'none';
    document.body.appendChild(input);

    let done = false;
    const finish = (file) => {
      if (done) return;
      done = true;
      input.remove();
      resolve(file);
    };

    input.onchange = () => finish(input.files?.[0] ?? null);
    // iOS Safari はキャンセルで change が飛ばない。画面に戻ってきた時点でファイルが
    // 無ければキャンセルとみなす（change が先に来た場合は done が弾く）
    addEventListener('focus', () => setTimeout(() => {
      if (!input.files?.length) finish(null);
    }, 400), { once: true });

    input.click();
  });
}

/** 現在地を1回だけ取る。GPS の常時追跡はしない（iOS Safari の制約） */
export function locate(timeout = 8000) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(fail('GEO_UNSUPPORTED')); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }),
      (e) => reject(fail(e.code === 1 ? 'GEO_DENIED' : 'GEO_TIMEOUT')),
      { enableHighAccuracy: true, timeout, maximumAge: 30_000 },
    );
  });
}

const fail = (code) => Object.assign(new Error(code), { code });

/**
 * 長辺 MAX_EDGE へ縮めて JPEG に統一する。
 * EXIF の回転をここで焼き込むのが肝。iPhone の縦持ち写真は「横向きの画素 + 回転フラグ」で
 * 保存されるので、素の drawImage だと基準画像と90度ずれてハッシュがまったく合わない
 * （docs/07 4.3。この案件で最も多い事故）。
 */
export async function normalize(blob) {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const out = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', JPEG_Q));
  if (!out) throw fail('BAD_IMAGE');
  return out;   // 実測でおおむね 150〜350KB
}

/**
 * 写真 → 64bit dHash。基準画像も必ずこの関数を通すこと（hash-lab.html も同じ道を通る）。
 * 正規化の経路が撮影側と基準側でずれると、同じ被写体でも一致しなくなる。
 */
export async function photoHash(blob) {
  const bmp = await createImageBitmap(await normalize(blob), { imageOrientation: 'from-image' });
  const canvas = document.createElement('canvas');
  canvas.width = HASH_W; canvas.height = HASH_H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, HASH_W, HASH_H);
  bmp.close();

  const { data } = ctx.getImageData(0, 0, HASH_W, HASH_H);
  const gray = new Float64Array(HASH_W * HASH_H);
  for (let i = 0; i < gray.length; i++) {   // ITU-R BT.601
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }
  return dhashFromGray(gray);
}

// ---------- 照合の一本道 ----------

/**
 * 合否を決める唯一の場所。
 *
 * いまはブラウザの中で判定している（＝参照ハッシュとしきい値が配布物に入っており、
 * 読めば答えが分かる）。PoC としては割り切りだが、秘匿したくなったらこの関数の中身を
 *
 *   const fd = new FormData();
 *   fd.append('photo', await normalize(photo));
 *   fd.append('spotId', spot.id); fd.append('lat', pos.lat); fd.append('lon', pos.lon);
 *   return (await fetch('/api/verify', { method: 'POST', body: fd })).json();
 *
 * に差し替えるだけで済む。呼び出し側は戻り値の形しか知らない。
 * サーバ側の判定式は docs/07 2.2（goimagehash の DifferenceHash）と同じなので、
 * ここで詰めたしきい値はそのまま持ち越せる。
 */
export async function verifyPhoto(spot, photo, pos) {
  if (isDemo()) {
    await new Promise((r) => setTimeout(r, 1200));   // 演出のための間。判定はしない
    return { ok: true, score: 92, demo: true };
  }

  // ① 位置は厳密に
  const m = haversineM(pos.lat, pos.lon, spot.lat, spot.lon);
  if (m > spot.radius) return { ok: false, code: 'TOO_FAR', meters: Math.round(m - spot.radius) };

  // ② 画像はゆるく
  const hash = await photoHash(photo);
  const refs = (spot.hashes || []).map(fromHex);
  const { ok, dist, blind } = matchAny(hash, refs, spot.threshold);
  return ok
    ? { ok: true, score: blind ? 100 : matchScore(dist), blind }
    : { ok: false, code: 'NO_MATCH', score: matchScore(dist) };
}

/**
 * 撮影 → 位置 → 照合 の直列。途中で失敗したら code を持って戻る。
 * 位置の権限プロンプトは iOS では撮影と同じ操作の流れの中で呼ばないと出ないことがあるので、
 * この関数ごと1回のタップのハンドラから呼ぶこと（docs/07 4.1）。
 */
export async function runUnlock(spot, onStep = () => {}) {
  onStep('capture');
  const photo = await capturePhoto({ camera: !isDemo() });
  if (!photo) return { ok: false, code: 'CANCELLED' };

  let pos = null;
  if (!isDemo()) {
    onStep('locate');
    try {
      pos = await locate();
    } catch (e) {
      return { ok: false, code: e.code || 'GEO_TIMEOUT', photo };
    }
  }

  onStep('verify');
  try {
    return { ...await verifyPhoto(spot, photo, pos), photo };
  } catch (e) {
    return { ok: false, code: e.code || 'BAD_IMAGE', photo };
  }
}

/** 失敗の理由を、次に何をすればいいか分かる日本語にする */
export function explain(r) {
  switch (r.code) {
    case 'TOO_FAR':
      return `スポットまであと約 ${r.meters}m。もう少し近づいてから撮ってください。`;
    case 'NO_MATCH':
      return 'お手本と同じアングルで、建物や看板の全体が入るように撮ってみてください。';
    case 'GEO_DENIED':
      return '位置情報が拒否されています。設定 → Safari → 位置情報 で許可してから、もう一度お試しください。';
    case 'GEO_TIMEOUT':
      return '現在地を取得できませんでした。屋外で、もう一度お試しください。';
    case 'GEO_UNSUPPORTED':
      return 'この端末では位置情報を取得できません。スマートフォンからお試しください。';
    case 'BAD_IMAGE':
      return '写真を読み込めませんでした。もう一度撮影してください。';
    default:
      return '判定できませんでした。もう一度お試しください。';
  }
}
