// 独自アセットの取得口。Robloxにないアクセサリ/エモートを、自前のファイル・URLから読み込むための振り分け。THREE非依存。
// fetchAssetBytes(id)(api.js)は、まずここに問い合わせ、誰も引き受けなければ従来どおりRobloxプロキシへ行く。
//
//   registerAssetMap({ 'hat:cat-ears': '/assets/cat-ears.glb', 'emote:backflip': '/assets/backflip.rbxmx' });
//   registerAssetSource((id) => id.startsWith('mine:') ? fetchMyBytes(id) : null);   // null/undefined = 自分の担当ではない
//
// 返せるもの: ArrayBuffer / TypedArray / Blob / URL文字列(fetchされる) / それらのPromise。
// 数字のIDも上書きできる(Roblox形式のrbxmを自前で差し替えたいとき)。

const sources = [];

/** resolver(id) を登録。返り値の関数で解除。後から登録したものが先に問い合わせられる */
export function registerAssetSource(resolver) {
  if (typeof resolver !== 'function') throw new TypeError('registerAssetSource: 関数を渡してください');
  sources.unshift(resolver);
  return () => { const i = sources.indexOf(resolver); if (i >= 0) sources.splice(i, 1); };
}

/** { id: URL | bytes | Blob } の対応表を登録。返り値の関数で解除 */
export function registerAssetMap(map) {
  const m = new Map(Object.entries(map).map(([k, v]) => [String(k), v]));
  return registerAssetSource((id) => (m.has(String(id)) ? m.get(String(id)) : null));
}

export const hasAssetSources = () => sources.length > 0;

export class SourceError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const URL_LIKE = /^(https?:|blob:|data:|\.{0,2}\/)/i;
/** URLらしい文字列か(それ以外の文字列は登録IDとして扱う) */
export const looksLikeUrl = (s) => typeof s === 'string' && URL_LIKE.test(s);

/** bytes / TypedArray / Blob / URL文字列 → ArrayBuffer */
export async function toArrayBuffer(x) {
  if (x instanceof ArrayBuffer) return x;
  if (ArrayBuffer.isView(x)) return x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength);
  if (typeof Blob !== 'undefined' && x instanceof Blob) return x.arrayBuffer();
  if (looksLikeUrl(x)) {
    let res;
    try { res = await fetch(x); } catch (e) { throw new SourceError('CUSTOM_FETCH', `独自アセットの取得に失敗しました: ${x}`); }
    if (!res.ok) throw new SourceError('CUSTOM_FETCH', `独自アセットの取得に失敗しました(HTTP ${res.status}): ${x}`);
    return res.arrayBuffer();
  }
  throw new SourceError('CUSTOM_BAD_SOURCE', `独自アセットの形式が不明です(ArrayBuffer / Blob / URL を渡してください): ${typeof x}`);
}

/** 登録された取得口にidを問い合わせる。誰も引き受けなければ null */
export async function customAssetBytes(id) {
  for (const s of [...sources]) {
    const r = await s(id);
    if (r !== null && r !== undefined) return toArrayBuffer(r);
  }
  return null;
}
