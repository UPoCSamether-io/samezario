// ルビ（ふりがな）変換モジュール。
//
// 記法: ｜親文字《よみ》 （全角 ｜ または半角 |）
// - rubify(text): HTML 本文用。エスケープしたうえで <ruby>親文字<rt>よみ</rt></ruby> に展開
// - plainText(text): 属性・SVG・プレーンテキスト用。記法を取り除いて「親文字」だけを返す
//
// 壊れた記法（閉じ括弧が無い、単独の記号など）は安全に平文としてエスケープ出力する。
// DOM を触らない素の関数なので Node から単体テスト（ruby.test.mjs）が可能。

const RUBY_RE = /[|｜]([^|｜\n《》]+)《([^|｜\n《》]+)》/g;

/** HTML 特殊文字をエスケープ */
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * ｜親文字《よみ》 を <ruby>親文字<rp>(</rp><rt>よみ</rt><rp>)</rp></ruby> に展開する。
 * ルビ以外のテキストおよびルビの中身も安全に HTML エスケープする。
 *
 * <rp> はルビ非対応の環境でだけ括弧として現れる保険。対応環境では
 * style.css が rp { display: none } で隠す。これが無いと非対応環境で
 * 「親文字よみ」と地続きに並んでしまい、どこまでが本文か読めなくなる。
 * index.html 側の直書きルビも同じ形にそろえてある。
 */
export function rubify(text) {
  if (text == null) return '';
  const str = String(text);
  let out = '';
  let last = 0;
  RUBY_RE.lastIndex = 0;

  let m;
  while ((m = RUBY_RE.exec(str)) !== null) {
    out += esc(str.slice(last, m.index));
    const base = esc(m[1]);
    const reading = esc(m[2]);
    out += `<ruby>${base}<rp>(</rp><rt>${reading}</rt><rp>)</rp></ruby>`;
    last = m.index + m[0].length;
  }
  out += esc(str.slice(last));
  return out;
}

/**
 * ｜親文字《よみ》 を親文字だけのプレーンテキストに戻す。
 * SVG <text>、alt、aria-label、共有文など HTML タグを使えない場所で呼ぶ。
 */
export function plainText(text) {
  if (text == null) return '';
  return String(text).replace(RUBY_RE, '$1');
}

/**
 * plainText の逆。｜親文字《よみ》 を「よみ」に、ルビの無い部分はそのままにして返す。
 * 「｜調布駅《ちょうふえき》・｜布田《ふだ》」→「ちょうふえき・ふだ」。
 *
 * SVG <text> は <ruby> を持てないので、地図のエリア名は親文字と読みを別々の
 * <text> として二段に置くしかない。その上段用。読みを data.js に二重で持つと
 * 記法とずれていくので、記法そのものから取り出す。
 */
export function kanaText(text) {
  if (text == null) return '';
  return String(text).replace(RUBY_RE, '$2');
}
