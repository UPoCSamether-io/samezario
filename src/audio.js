// 音。BGM は public/audio の ogg を Web Audio でループ再生し、SE はカチンコ以外を
// Web Audio でその場で合成する（素材を持たないので、音色はここの数値がすべて）。
//
// ループの跡切れは2段構えで潰してある。実測（継ぎ目をまたいで出力PCMを全サンプル拾い、
// ほぼ無音が続く長さを測った値）は次のとおり:
//
//   <audio loop> + mp3 ... 39.8ms   mp3 は 1152 サンプル単位でしか終われないので、
//                                   エンコーダが両端を無音で埋める（実測 7〜70ms）
//   <audio loop> + ogg ... 11.9ms   両端の無音は落とした。残りは <audio> の巻き戻しぶん
//   Web Audio  + ogg ...   1.3ms   ＝ 曲の継ぎ目そのもの。聴感上は無音ではない
//
// なので ①ファイルは無音を落とした Ogg Vorbis（granule position でサンプル数を正確に
// 持てるので、切った状態が残る。ついでに 19.4MB → 10.3MB）、②再生は <audio> ではなく
// AudioBufferSourceNode の loop（こちらはサンプル単位で巻き戻る）。
// 変換は scripts/encode-bgm.py（曲を足したら mp3 を置いてもう一度走らせる。
// 変換元の mp3 はリポジトリに残さない）。
//
// ブラウザは最初のユーザー操作まで音を鳴らさない（下の unlock で解禁する）。

// BGM は ogg だけを置いている。mp3 も残すと同じ曲を2形式ぶん配ることになり、
// リポジトリが 18MB ぶん重くなるわりに、鳴らしても継ぎ目に詰め物の無音が挟まる。
// Ogg Vorbis は Chrome / Firefox / Edge と Safari 18.4 以降で鳴る。それ以前の Safari では
// BGM が取れないが、下の bgm() が失敗を飲むので無音になるだけで遊べる。
// カチンコだけは mp3（効果音ラボの素材をそのまま使っている）
const url = (f, ext = 'ogg') => encodeURI(`/audio/${f}.${ext}`);

export const BGM_MAIN = 'Dark_blue_night';
// ロケ地ごとの BGM。ゲームとリザルトだけこちらを鳴らす（data.js の MAPS の id）
export const BGM_MAP = {
  chofu: 'Swing_Queen',
  jindaiji: '雷鳴の閃き',
  airport: '彗星に乗って_2',
  sengawa: 'Take_Me_To_The_Top',
  tamagawa: 'NAGISA',
};

// 曲ごとの音量。素材のラウドネスが -8.2 〜 -15.1 LUFS とばらついているので
// （ffmpeg の ebur128 で実測）、いちばん小さい「雷鳴の閃き」の -15 LUFS へ全部を
// 下げて揃える。倍率は 10^((-15 - 実測)/20)。曲を足したら同じように測って足すこと:
//   ffmpeg -i public/audio/曲.mp3 -filter_complex ebur128 -f null -
const LUFS_VOL = {
  Dark_blue_night: 0.75,      // -12.5
  Swing_Queen: 0.52,          // -9.4
  Take_Me_To_The_Top: 0.46,   // -8.2
  NAGISA: 0.63,               // -11.0
  '彗星に乗って_2': 0.64,       // -11.3
  '雷鳴の閃き': 1,             // -15.1（基準）
};
// BGM と SE の音量はプレイヤーが別々に決められる（タイトル → メニュー → サウンド）。
// progress.js が 'samezario.save' を専有しているので、あちらのスキーマには混ぜず別キーに
// 置く。音の好みは「進行状況」ではないし、セーブを消しても音量まで戻す必要はない
const VOL_KEY = 'samezario.audio';
const vol = { music: 1, sfx: 1 };
try { Object.assign(vol, JSON.parse(localStorage.getItem(VOL_KEY) || '{}')); } catch { /* 既定のまま */ }

// BGM 側だけに掛かる下駄。LUFS で揃えた曲を、そのままだと SE が埋もれる音量なので下げる。
// SE 側に同じものを掛けないのは、下の音色（gain の数値）が素の destination を前提に
// 作ってあるため。ここで掛けると全部が半分になり、餌の音がまた聞こえなくなる
const MIX = 0.5;

let bgmBus = null;
let sfxBus = null;
let clapPiped = false;

/** 出口の2本。AudioContext と同じく、実際に音を出す段になってから作る */
function buses() {
  if (!bgmBus) {
    const c = ctx();
    bgmBus = c.createGain();
    sfxBus = c.createGain();
    bgmBus.connect(c.destination);
    sfxBus.connect(c.destination);
    applyVol();
  }
  // カチンコだけ <audio> なので、ここを通さないと SE のつまみが効かない。
  // 一度しか繋げないうえ、繋げない環境もあり得るので、失敗したら素のまま鳴らす
  if (!clapPiped) {
    clapPiped = true;
    try { ctx().createMediaElementSource(clapEl).connect(sfxBus); } catch { /* 素のまま */ }
  }
}

function applyVol() {
  if (!bgmBus) return;
  bgmBus.gain.value = MIX * vol.music;
  sfxBus.gain.value = vol.sfx;
}

/**
 * 音量の読み書き。0〜1。値を省くと今の値を返す。
 * 触った瞬間に効かせたいので、鳴っている音を止めたり作り直したりはしない
 */
export function volume(kind, v) {
  if (v === undefined) return vol[kind];
  vol[kind] = Math.max(0, Math.min(1, v));
  applyVol();
  try { localStorage.setItem(VOL_KEY, JSON.stringify(vol)); } catch { /* 保存できなくても鳴る */ }
  return vol[kind];
}

let ac;
const ctx = () => (ac ||= new (window.AudioContext || window.webkitAudioContext)());

// 自動再生の解禁。once にしないのは、最初の1回で resume が通るとは限らないため
// （解禁前のジェスチャで作った AudioContext は suspended のまま残る）。
// 止まっている間もソースは繋いだままで、時計ごと止まっているだけなので鳴らし直しは要らない
const unlock = () => { if (ac && ac.state !== 'running') ac.resume(); };
addEventListener('pointerdown', unlock);
addEventListener('keydown', unlock);

// 裏へ回ったら時計ごと止める。自分で止めたぶんだけ戻すのは、解禁前の suspended まで
// 起こしにいくと自動再生の禁を破りにいくことになるため
let napping = false;
document.addEventListener('visibilitychange', () => {
  if (!ac) return;
  if (document.hidden) {
    if (ac.state === 'running') { napping = true; ac.suspend(); }
  } else if (napping) {
    napping = false;
    ac.resume();
  }
});

const FADE = 0.2;     // 曲の入れ替わり。ぶつ切りだと切り替えのたびにプツッと鳴る
let cur = '';         // いま鳴らすべき曲（デコード待ちの間もこれが正）
let node = null;      // 鳴っている { s, g }
const decoded = new Map();

/** 鳴っている曲を FADE 秒かけて落として捨てる */
function fadeOut(n) {
  if (!n) return;
  const t = ctx().currentTime;
  n.g.gain.cancelScheduledValues(t);
  n.g.gain.setValueAtTime(n.g.gain.value, t);
  n.g.gain.linearRampToValueAtTime(0, t + FADE);
  n.s.stop(t + FADE + 0.02);
}

/** 曲を差し替える。同じ曲なら頭出しせずに鳴らしっぱなしにする */
export async function bgm(name) {
  const src = BGM_MAP[name] ? BGM_MAP[name] : name;
  if (src === cur) return;
  cur = src;
  try {
    let buf = decoded.get(src);
    if (!buf) {
      buf = await ctx().decodeAudioData(await (await fetch(url(src))).arrayBuffer());
      // PCM は元ファイルの10倍以上あるので、抱えるのはメインと今のロケ地の2本まで
      for (const k of decoded.keys()) if (k !== BGM_MAIN) decoded.delete(k);
      decoded.set(src, buf);
    }
    if (cur !== src) return;   // 待っている間に別の画面へ移っていたら捨てる
    buses();
    const c = ctx();
    const t = c.currentTime;
    const s = c.createBufferSource();
    s.buffer = buf;
    s.loop = true;             // 両端は切ってあるので loopStart / loopEnd は既定のままでよい
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    // ここに持たせるのは曲ごとのラウドネス差だけ。プレイヤーが動かす音量はバス側なので、
    // つまみを触っても鳴っている曲を作り直さずに済む
    g.gain.linearRampToValueAtTime(LUFS_VOL[src] ?? 1, t + FADE);
    s.connect(g).connect(bgmBus);
    s.start(t);
    fadeOut(node);
    node = { s, g };
  } catch { /* 取れなくても遊べる。無音で続ける */ }
}

// デバッグ用の覗き穴（game.js の window.__sz と同じ趣旨。鳴っているか外から見る）
window.__bgm = {
  get src() { return cur; },
  get vol() { return node ? +(node.g.gain.value * (bgmBus?.gain.value ?? 0)).toFixed(3) : 0; },
  get mix() { return { music: vol.music, sfx: vol.sfx }; },
  get state() { return ac?.state; },
  // 多摩川の電車の音（N7b / N7c）。鉄橋ごと（lines: [下り, 上り]）に、鳴っているか・何本目か・
  // いまの音量（効果音バスの手前）・ファイルのどこか
  get train() { return trainPeek(); },
};

/**
 * 定位と減衰の出口。遠くで起きた音はここで小さく・左右へ振る。
 * pan は -1（左）〜 1（右）。0 のときはパンナーを挟まない（素通りのほうが素直に鳴る）
 */
function out(v = 1, pan = 0) {
  buses();
  const c = ctx();
  const g = c.createGain();
  g.gain.value = v;
  if (pan) {
    const p = c.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p).connect(sfxBus);
  } else {
    g.connect(sfxBus);
  }
  return g;
}

/** 単音。f0 → f1 へ滑らせながら減衰させる */
function tone(type, f0, f1, dur, gain, delay = 0, dest = null) {
  buses();
  const c = ctx();
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dest || sfxBus);
  o.start(t);
  o.stop(t + dur);
}

/**
 * フィルムが回る音。ダッシュを押しているあいだ鳴り続ける。
 * ノイズを流しっぱなしにすると「ザー」になるので、スプロケットに当たる1発ずつを
 * 4ms で減衰させて粒を立て、コマ間隔ちょうどの長さで焼いた1周をループさせる
 * （端が半端だと継ぎ目でプツッと鳴る）。
 */
const REEL_RATE = 46;   // コマ送り（回/秒）。実速は playbackRate で上げ下げする
let spinning = null;    // 回っているあいだの { src, g }

function reelStart(gain = 0.5) {
  if (spinning) return;
  buses();
  const c = ctx();
  const t = c.currentTime;
  const period = Math.round(c.sampleRate / REEL_RATE);
  const n = period * 8;   // 8コマで1周。短すぎるとループの周期そのものが音程に聞こえる
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  const decay = c.sampleRate * 0.004;
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-(i % period) / decay);
  const src = c.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  // 回り出しの加速。いきなり定速で鳴るとテープの再生に聞こえる
  src.playbackRate.setValueAtTime(0.5, t);
  src.playbackRate.linearRampToValueAtTime(1, t + 0.25);
  // 木と金属の当たる帯だけ残す。低域を通すと水中の絵から浮く
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2100;
  bp.Q.value = 1.1;
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.03);
  src.connect(bp).connect(g).connect(sfxBus);
  src.start(t);
  spinning = { src, g };
}

function reelStop() {
  if (!spinning) return;
  const { src, g } = spinning;
  spinning = null;
  const c = ctx();
  const t = c.currentTime;
  // 惰性で止まる。指を離した瞬間に切ると、連打のたびにプツプツ言う
  g.gain.cancelScheduledValues(t);
  g.gain.setValueAtTime(g.gain.value, t);
  g.gain.linearRampToValueAtTime(0, t + 0.12);
  src.playbackRate.cancelScheduledValues(t);
  src.playbackRate.setValueAtTime(src.playbackRate.value, t);
  src.playbackRate.linearRampToValueAtTime(0.6, t + 0.12);
  src.stop(t + 0.14);
}

/** バンドパスを掃いたホワイトノイズ。水を切る音・砕ける音はこちら */
function noise(f0, f1, dur, gain, q = 4, dest = null) {
  buses();
  const c = ctx();
  const t = c.currentTime;
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const n = c.createBufferSource();
  n.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = q;
  bp.frequency.setValueAtTime(f0, t);
  bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  n.connect(bp).connect(g).connect(dest || sfxBus);
  n.start(t);
  n.stop(t + dur);
}

/**
 * 多摩川の鉄橋を渡る電車の音（N7b）。電車が通り過ぎる録音（public/audio/電車.mp3）を、
 * 電車の影が鉄橋に入った瞬間をファイルの 0 秒に合わせて、渡っている間だけ鳴らす。
 * 録音は 17.6秒（0〜1.5秒で近づき、12秒過ぎから遠ざかる）で、鉄橋を渡り切るのは 13秒ほど
 * なので、渡り終えたところで短く落として止める（末尾の遠ざかりはほとんど使わない）。
 *
 * 元の素材（48kHz ステレオ 320kbps、約700KB）は、左右を下の StereoPanner で付けるので
 * モノラル 64kbps の mp3 に落として置いた（約140KB）。mp3 なのは BGM と違ってループしない
 * （継ぎ目の無音が問題にならない）うえ、Ogg の鳴らない古い Safari でも鳴るから。
 * N7d で「もっと大きく」と言われ、コンプレッサとリミッタで音圧を上げて作り直した
 * （大きい区間 -23.5 → -19.7 LUFS、ピーク -2.2 → -2.9 dBFS）。元の素材が手元に無かったので
 * N7b で置いたモノラル 64kbps 版（旧.mp3）から作っている（再エンコード1回ぶんの劣化は聞き分けられない程度）。
 *   ffmpeg -i 旧.mp3 -af "acompressor=threshold=0.1:ratio=3:attack=5:release=150:makeup=2.5,alimiter=limit=0.84:level=false" -ac 1 -ar 44100 -c:a libmp3lame -b:a 64k -map_metadata -1 public/audio/電車.mp3
 *
 * 鉄橋2本（下り・上り）がそれぞれ別に走り、すれ違う間は2本同時に鳴るので（N7c）、
 * 鳴らす口（BufferSource・GainNode・StereoPanner）は鉄橋ごとに1組ずつ持つ（trainSlots）。
 * 鳴らし方は1本につき BufferSource を1つだけ。音量（距離）と左右は、使い回す GainNode と
 * StereoPanner を毎フレーム setTargetAtTime で動かす（ノードを毎フレーム作らない）。
 * 遠くて音量 0 の間も、渡っている間は 0 のまま回しておく（止めて掛け直すより軽く、
 * 近づいたときに途中から入り直す手間も無い）。
 * 時刻は game.js が envT から出した「渡り始めてからの秒数」をそのまま offset にするので、
 * 途中で聞こえる所へ来ても・途中で多摩川に入っても、同じ部屋なら同じ所が鳴る。
 */
// 音量の上限。v = 1（編成の真横）でもこれ以上にはならない。録音の大きい区間（1.5〜12秒）は
// ebur128 で -19.7 LUFS ほどなので、1.3 で約 -17.4 LUFS。BGM（-15 LUFS に揃えて MIX 0.5 で
// 約 -21 LUFS）より少し大きく、真横を通ると「電車が来た」とはっきり分かる
// （N7c で 0.8 → 1.2、N7d で録音の音圧を上げたうえで 1.3。真横で N7c より約 +4.6 dB）。
// 録音のピークは -2.9 dBFS なので、1.3 倍でも -0.6 dBFS と 0 dBFS を超えない（歪まない）。
// 下りと上りがすれ違う3秒ほどは2本同時に鳴る（下りの録音の 10〜12.6秒と上りの 0〜2.6秒が
// 鉄橋の同じ端で重なる）が、両方真横（v = 1）でも足して -1.0 dBFS で、やはり超えない。
// これより上げるとピークが 0 dBFS に近づくので、上げるなら録音のほうを作り直してから。
// うるさければここを下げる
const TRAIN_GAIN = 1.3;
// 音量と左右の追従の時定数(秒)。毎フレームの距離の変化をこれでならす（ぷつぷつ鳴らさない）
const TRAIN_EASE = 0.08;
// 止めるときに落とす長さ(秒)。ぶつ切りだとプツッと鳴る
const TRAIN_FADE = 0.15;
// 鳴っている位置と、envT から出した位置がこれ以上ずれたら掛け直す(秒)。
// タブ復帰（AudioContext の時計は止まっていた）やスナップショットでの envT の補正で飛んだとき用。
// 小さすぎると補正のたびに頭出しし直して途切れる
const TRAIN_SLIP = 0.3;
let trainBuf = null;        // デコード済みの録音
let trainLoad = 0;          // 0 まだ / 1 読み込み中 / 2 済み / -1 失敗（以後は鳴らさない）
// 鉄橋ごと（0 下り / 1 上り）の鳴らす口。out は使い回す { g, p }（GainNode → StereoPanner → sfxBus）、
// now は鳴っている { s, k, t0 }（t0 はファイルの 0 秒に当たる currentTime）
const trainSlots = [{ out: null, now: null }, { out: null, now: null }];

/** 録音を1回だけ取ってくる。失敗したら黙って諦める */
async function trainFetch() {
  trainLoad = 1;
  try {
    const res = await fetch(url('電車', 'mp3'));
    if (!res.ok) throw new Error(res.status);
    trainBuf = await ctx().decodeAudioData(await res.arrayBuffer());
    trainLoad = 2;
  } catch { trainLoad = -1; }
}

/** 鉄橋 slot で鳴っている電車を TRAIN_FADE 秒で落として止める。止まっていれば何もしない */
function trainStop(slot) {
  if (!slot.now) return;
  const { s } = slot.now;
  slot.now = null;
  const c = ctx();
  const t = c.currentTime;
  const g = slot.out.g.gain;
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.linearRampToValueAtTime(0, t + TRAIN_FADE);
  // 時計の止まった AudioContext では、この stop も再開まで持ち越されるだけ（再開した瞬間に止まる）
  try { s.stop(t + TRAIN_FADE + 0.02); } catch { /* もう止まっている */ }
}

/**
 * 毎フレームの指示。cues は鉄橋ごとの [下り, 上り] で、それぞれ
 * { k: 何本目か, at: 渡り始めてからの秒数, v: 0〜1, pan: -1〜1 } か null（その鉄橋は渡っていない）。
 * cues ごと null なら両方止める（多摩川以外・ポーズ・リザルト）
 */
function trainCue(cues) {
  // 効果音 0・AudioContext が動いていない（解禁前・裏に回った・割り込み）ときも止める。
  // 解禁前に AudioContext を作りにいかないよう、ac が無ければ何もしない
  if (!cues || vol.sfx === 0 || !ac || ac.state !== 'running') {
    if (ac) trainSlots.forEach(trainStop);
    return;
  }
  if (trainLoad === 0) trainFetch();
  if (trainLoad !== 2) return;
  trainSlots.forEach((slot, i) => trainSlotCue(slot, cues[i]));
}

/** 鉄橋1本ぶん。cue が null ならその鉄橋だけ止める */
function trainSlotCue(slot, cue) {
  if (!cue) { trainStop(slot); return; }
  const c = ctx();
  const t = c.currentTime;
  // 別の1本になった・ずれた（時計が飛んだ）・録音の終わりを過ぎたら、今のを止める
  if (slot.now) {
    const pos = t - slot.now.t0;
    if (slot.now.k !== cue.k || Math.abs(pos - cue.at) > TRAIN_SLIP) trainStop(slot);
  }
  if (cue.at >= trainBuf.duration) { trainStop(slot); return; }
  if (!slot.out) {
    buses();
    const g = c.createGain();
    const p = c.createStereoPanner();
    g.gain.value = 0;
    g.connect(p).connect(sfxBus);
    slot.out = { g, p };
  }
  const g = slot.out.g.gain;
  if (!slot.now) {
    const s = c.createBufferSource();
    s.buffer = trainBuf;
    s.connect(slot.out.g);
    // 途中から入るときに、録音の大きい所をいきなり出さない（TRAIN_EASE でふわっと上げる）。
    // 止めたばかりの前の音のフェードは、ここで打ち切られる（前の音は直後に stop される）
    g.cancelScheduledValues(t);
    g.setValueAtTime(0, t);
    s.start(t, Math.max(0, cue.at));
    // 最後まで行ったら勝手に止まる。そのとき掴んだままにしない
    s.onended = () => { if (slot.now?.s === s) slot.now = null; };
    slot.now = { s, k: cue.k, t0: t - Math.max(0, cue.at) };
  }
  g.setTargetAtTime(Math.max(0, cue.v) * TRAIN_GAIN, t, TRAIN_EASE);
  slot.out.p.pan.setTargetAtTime(Math.max(-1, Math.min(1, cue.pan || 0)), t, TRAIN_EASE);
}

/** window.__bgm.train の中身（確かめ用）。lines は鉄橋ごとの [下り, 上り] */
function trainPeek() {
  return {
    load: trainLoad,
    lines: trainSlots.map(({ out, now }) => ({
      playing: !!now,
      k: now ? now.k : null,
      gain: out ? +out.g.gain.value.toFixed(3) : 0,
      pan: out ? +out.p.pan.value.toFixed(2) : 0,
      at: now ? +(ctx().currentTime - now.t0).toFixed(2) : null,
    })),
  };
}

// カチンコだけは合成では出ない打撃音なので外部ファイル。連打されるので頭出しで鳴らす
const clapEl = new Audio(url('時代劇演出3', 'mp3'));
clapEl.volume = 0.5;

// 餌は毎秒何粒でも入る。全部鳴らすと持続音になるので間引く。
// 続けて食べているあいだは半音ずつ上げる（食べ続ける行為そのものを気持ちよくする）。
// 手が止まれば下がるので、上がりきった音は「いま連れて食べている」の合図になる
const EAT_BASE = 523.25;   // C5
// これ以上空いたら仕切り直し(ms)。HUD のコンボ（game.js）も同じ値で数えるので export する
export const EAT_GAP = 500;
const EAT_MAX = 12;        // 1オクターブで頭打ち。青天井だと最後は耳に刺さるだけになる
let lastEat = 0;
let chain = 0;

export const sfx = {
  clap() { buses(); clapEl.currentTime = 0; clapEl.play().catch(() => {}); },
  // 小さく高い「ぱく」。粒が続いても濁らないよう短く切る。
  // BGM の下でも粒が立つよう、三角波の上に矩形の芯を一枚重ねる。
  // 上へ滑らせる先も基音に比例させる（固定値のままだと、連鎖で基音が上がりきった
  // ところで滑る向きが下向きに反転してしまう）
  eat() {
    const now = performance.now();
    if (now - lastEat < 70) return;
    chain = now - lastEat > EAT_GAP ? 0 : Math.min(chain + 1, EAT_MAX);
    lastEat = now;
    const f = EAT_BASE * 2 ** (chain / 12);
    tone('triangle', f, f * 1.9, 0.1, 0.42);
    tone('square', f * 2, f * 3.7, 0.05, 0.1);
  },
  // 落ちていく音＋水の砕ける音。ここだけは長めに引く。
  // 他人のサメの分は vol / pan で遠さと左右を付けて呼ばれる
  die(v = 1, pan = 0) {
    const o = v === 1 && !pan ? null : out(v, pan);
    tone('sawtooth', 420, 55, 0.75, 0.4, 0, o);
    noise(900, 120, 0.5, 0.28, 2, o);
  },
  // 鉄橋を渡る電車の音。毎フレーム呼ぶ。鉄橋ごとの [下り, 上り] を渡し、渡っていない方は null、
  // 鳴らさないときは丸ごと null で両方止まる。
  // 何本目か・渡り始めてからの秒数・距離と左右は game.js が決めて渡す
  train(cue) { trainCue(cue); },
  // フィルムが回る音。押しているあいだ回り続ける
  dash(on) { if (on) reelStart(); else reelStop(); },
  // 立ち上がる3音。発動が一番派手に聞こえていい
  skill() {
    tone('square', 440, 660, 0.1, 0.18);
    tone('square', 660, 880, 0.1, 0.18, 0.07);
    tone('sine', 880, 1320, 0.3, 0.26, 0.14);
  },
  // 裏ボスの復活。他の音が上へ滑るのに対して、これだけは下へ落ちて長く残す ——
  // 画面の揺れ（game.js の QUAKE_DUR = 1.2秒）と手元の震えに、耳のぶんを足す。
  // 低い唸りだけだとスマホのスピーカーからは出ないので、上に軋みを1枚重ねる
  roar() {
    tone('sawtooth', 180, 38, 1.2, 0.42);
    tone('square', 90, 26, 1.2, 0.2, 0.04);
    tone('sine', 520, 120, 0.9, 0.16, 0.1);
    noise(1400, 180, 1.1, 0.22, 1.4);
  },
};
