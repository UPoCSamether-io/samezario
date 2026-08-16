// ロケ地解放のシェア。Web Share API を主、コピーと X 投稿画面を副にした一本道。
//
// 「共有できたか」を決めるのはこのファイルの shareUnlock ひとつ（verify.js の verifyPhoto と
// 同じ考え方）。呼び出し側は戻り値の via / cancelled しか知らない。
//
// navigator / clipboard / window.open は deps で差し替えられるようにしてあり、
// 文面の組み立て（shareText / tweetUrl / classifyError）は素の関数なので Node から試せる
// （share.test.mjs）。DOM は一切触らない。
//
// キャンセルは失敗ではなく「何もしなかった」。加点も通知も起こさないよう、
// 戻り値では ok=false / cancelled=true の別枠にしてある（docs 側の完了条件）。

export const HASHTAGS = ['#サメザリオ', '#調布'];

/** シェアに載せるプロジェクトURL。クエリ（?demo=1 など）は落とす */
export function projectUrl(loc = globalThis.location) {
  if (!loc) return '';
  return loc.origin + loc.pathname;
}

/**
 * 歴史紹介はスポットの解説文の先頭一文だけ。
 * 全文（150字前後）を載せると X では本文がURLごと折り返しの下へ消え、
 * OS の共有シートでもプレビューが1行に潰れて読めない。
 */
export function shortLore(spot, max = 70) {
  const first = String(spot.desc || '').split('。')[0];
  if (!first) return '';
  const s = first.length > max ? first.slice(0, max - 1) + '…' : first + '。';
  return s;
}

/**
 * 共有文。ロケ地名・短い歴史紹介・ハッシュタグを含む（URL は share() が別に受け取るので
 * ここには入れない。文面に混ぜると共有シートでURLが二重に出る端末がある）。
 */
export function shareText(map, spot) {
  // 「エリア」は data.js の name から外れている（地図のラベル用に短くしてある）ので、
  // 文章として読ませるここでは足す
  return [
    `『${map.name}エリア』を解放！`,
    `📍${spot.name} — ${shortLore(spot)}`,
    HASHTAGS.join(' '),
  ].join('\n');
}

/** コピー・X へ渡す1本の文字列。共有シートと違い、URL は自分で末尾に足す */
export const textWithUrl = (text, url) => (url ? `${text}\n${url}` : text);

export const tweetUrl = (text, url) =>
  `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`
  + (url ? `&url=${encodeURIComponent(url)}` : '');

/**
 * 撮った写真を共有候補にするための File。
 * Blob のままでは canShare({files}) が通らない（仕様上 File が要る）。
 */
export function photoFile(blob, spot, File = globalThis.File) {
  if (!blob || !File) return null;
  return new File([blob], `samezario-${spot.id}.jpg`, {
    type: blob.type || 'image/jpeg',
    lastModified: Date.now(),
  });
}

/**
 * share() の例外を「キャンセル」と「失敗」に分ける。
 * 利用者がシートを閉じただけなら AbortError で、これは異常ではないので
 * エラー表示も加点もしない。それ以外（NotAllowedError／DataError など）は失敗。
 */
export function classifyError(err) {
  return err && (err.name === 'AbortError' || err.code === 20) ? 'cancelled' : 'failed';
}

const result = (via, extra = {}) => ({ ok: via !== 'none', via, cancelled: false, ...extra });

/**
 * シェアの一本道。
 *
 *   ① navigator.share（写真を添えられる端末では写真ごと）
 *   ② 非対応ならクリップボードへ共有文をコピー
 *   ③ コピーもできなければ X の投稿画面を開く
 *
 * 写真は canShare が通ったときだけ share() に渡す。渡した先は OS の共有シートで、
 * 送信先を選ぶのは利用者。こちらから送信も保存もしない。
 *
 * 戻り値 via: 'share' | 'share-text' | 'copy' | 'tweet' | 'none'
 *   share-text は「写真つきで投げたら弾かれたので、文だけで通した」場合。
 */
export async function shareUnlock({ map, spot, photo = null }, deps = {}) {
  const {
    nav = globalThis.navigator,
    clipboard = globalThis.navigator?.clipboard,
    open = globalThis.open?.bind(globalThis),
    url = projectUrl(),
    File: FileCtor = globalThis.File,
  } = deps;

  const text = shareText(map, spot);

  if (nav?.share) {
    const file = photo ? photoFile(photo, spot, FileCtor) : null;
    // canShare が無い端末（初期の実装）ではファイルを付けない。付けたまま投げると
    // 丸ごと弾かれて、文すら共有できなくなる
    const withFile = !!(file && nav.canShare?.({ files: [file] }));
    try {
      await nav.share(withFile
        ? { title: 'サメザリオ', text, url, files: [file] }
        : { title: 'サメザリオ', text, url });
      return result(withFile ? 'share' : 'share-text', { withPhoto: withFile });
    } catch (e) {
      if (classifyError(e) === 'cancelled') {
        return { ok: false, via: 'share', cancelled: true, withPhoto: withFile };
      }
      // 写真つきで落ちたぶんには、文だけでもう一度だけ試す。
      // iOS はアプリによってファイル付き共有を受け取れず、ここで初めて分かる
      if (withFile) {
        try {
          await nav.share({ title: 'サメザリオ', text, url });
          return result('share-text', { withPhoto: false });
        } catch (e2) {
          if (classifyError(e2) === 'cancelled') {
            return { ok: false, via: 'share', cancelled: true, withPhoto: false };
          }
        }
      }
      // share が使えない端末だった、とみなして下のフォールバックへ落ちる
    }
  }

  const full = textWithUrl(text, url);

  try {
    if (clipboard?.writeText) {
      await clipboard.writeText(full);
      return result('copy', { text: full, withPhoto: false });
    }
  } catch {
    // 権限が無い / Secure Context でない。X へ回す
  }

  if (open) {
    const w = open(tweetUrl(text, url), '_blank', 'noopener');
    // ポップアップブロックで null が返ることがある。開けていないので成功にしない
    if (w !== null) return result('tweet', { text: full, withPhoto: false });
  }

  return { ok: false, via: 'none', cancelled: false, text: full, withPhoto: false };
}

/** 結果を、次に何をすればいいか分かる日本語にする（verify.js の explain と同じ役どころ） */
export function explainShare(r) {
  switch (r.via) {
    case 'share':
    case 'share-text':
      return 'シェアしました！';
    case 'copy':
      return '共有文をコピーしました。SNS に貼り付けてください。';
    case 'tweet':
      return '投稿画面を開きました。';
    default:
      return 'シェアできませんでした。共有文を選択してコピーしてください。';
  }
}
