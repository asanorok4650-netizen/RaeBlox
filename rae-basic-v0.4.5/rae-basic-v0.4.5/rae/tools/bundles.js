// Robloxのボディパーツ(R15バンドル)をR6へ取り込む開発用ツール。エンジン本体(src/)は使わない。
// カタログ検索(catalog.roblox.com)は、プロキシ(Worker)の許可ホストに catalog が入っている必要がある。loadR15BodyParts のアトラス化はブラウザ専用(canvas)。
//   import { loadR15BodyParts, loadBodyBundle } from './tools/index.js';
import { ApiError, NET, getJson, fetchAssetBytes, textureOrNull, loadHeadAsset } from '../src/avatar/api.js';
import { parseModel } from '../src/rbx/model.js';
import { parseMeshAsync } from '../src/rbx/mesh.js';
import { parseAssetUri } from '../src/rbx/accessory.js';
import { extractR15Parts, slotsIn, planChain, bakePiece, mergeGeometry, fitToR6, remapUVsToCell } from './r15.js';

/** catalog.roblox.com 宛の取得。プロキシが許可していない場合(HTTP 400/403/404)は、原因の見当を添えて投げ直す */
async function getCatalogJson(url) {
  try { return await getJson(url); }
  catch (e) {
    if (/^HTTP_(400|403|404)$/.test(e.code || '')) throw new ApiError('CATALOG_BLOCKED', `${e.message} — プロキシ(Worker)の許可ホストに catalog.roblox.com が入っていない可能性があります(users / avatar のみ通す設定のため)。バンドルIDやアセットIDの直接入力なら、catalogを使わない経路でも試せます`);
    throw e;
  }
}

const CATALOG_SORT = { popular: 2, favorited: 1, relevance: 0, updated: 3 };
/**
 * カタログのボディパーツ系バンドルを検索する(既定は人気順 = 売上順)。
 * @returns { items:[{ id, name, itemType, creator, favorites, price }], next } 
 * Robloxのカタログ検索は仕様変更されることがあり、列挙値の指定が通らない場合は数値指定に切り替えて再試行する。
 */
export async function searchBodyBundles({ keyword = '', sort = 'popular', limit = 30, cursor = '' } = {}) {
  const base = 'https://catalog.roblox.com/v1/search/items/details';
  const tail = `&SortType=${CATALOG_SORT[sort] ?? 2}&Limit=${[10, 28, 30, 60, 120].find((l) => l >= limit) || 30}${keyword ? `&Keyword=${encodeURIComponent(keyword)}` : ''}${cursor ? `&Cursor=${encodeURIComponent(cursor)}` : ''}`;
  let j, lastErr;
  for (const head of ['?Category=BodyParts&Subcategory=BodyPartsAll', '?Category=4']) { // 名前指定 → 数値指定
    try { j = await getCatalogJson(base + head + tail); if (j && Array.isArray(j.data)) break; } catch (e) { lastErr = e; if (e.code === 'NETWORK' || e.code === 'ORIGIN_NOT_ALLOWED') throw e; }
  }
  if (!j || !Array.isArray(j.data)) throw lastErr || new ApiError('BAD_CATALOG', 'カタログの応答が不正です');
  const items = j.data.map((d) => ({ id: d.id, name: d.name, itemType: d.itemType, bundleType: d.bundleType, creator: d.creatorName || '', favorites: d.favoriteCount ?? null, price: d.price ?? null }))
    .filter((d) => d.itemType === 'Bundle' || d.itemType === 'Asset');
  return { items, next: j.nextPageCursor || '' };
}

/** バンドルID(またはURL)→ ボディパーツの候補アセットID一覧。UserOutfit(アウトフィット)を持つバンドルはそちらの assets から、Assetの項目はそのまま拾う */
export async function bundleAssetIds(input) {
  const m = String(input).match(/bundles\/(\d+)/) || String(input).match(/^\s*(\d+)\s*$/);
  if (!m) throw new ApiError('BAD_ID', 'バンドルのIDまたはURLを入力してください');
  const b = await getCatalogJson(`https://catalog.roblox.com/v1/bundles/${m[1]}/details`);
  const ids = new Set(), name = b.name || `bundle ${m[1]}`;
  for (const it of b.items || []) if (it.type === 'Asset') ids.add(it.id);
  for (const it of (b.items || []).filter((x) => x.type === 'UserOutfit')) {
    try { const o = await getJson(`https://avatar.roblox.com/v1/outfits/${it.id}/details`); for (const a of o.assets || []) ids.add(a.id); }
    catch (e) { if (e.code === 'NETWORK' || e.code === 'ORIGIN_NOT_ALLOWED') throw e; NET.log('warn', `アウトフィット ${it.id} の取得に失敗: ${e.message}`); }
  }
  if (!ids.size) throw new ApiError('NO_ASSETS', `バンドル「${name}」からアセットを取得できませんでした`);
  return { name, assetIds: [...ids] };
}

/** 複数のテクスチャ(画像)を1枚のアトラスにまとめる(格子状・各セルは同じ大きさ)。同じ画像オブジェクトは1セルを共有。ブラウザ専用 */
function atlasOf(images) {
  const uniq = [...new Set(images.filter(Boolean))];
  if (uniq.length <= 1) return { canvas: null, cells: new Map(uniq.map((im) => [im, [0, 0, 1, 1]])), image: uniq[0] || null };
  const cols = Math.ceil(Math.sqrt(uniq.length)), rows = Math.ceil(uniq.length / cols);
  const cell = Math.min(1024, Math.max(...uniq.map((im) => Math.max(im.width, im.height))));
  const c = document.createElement('canvas'); c.width = cols * cell; c.height = rows * cell;
  const g = c.getContext('2d'), cells = new Map();
  uniq.forEach((im, i) => { const col = i % cols, row = Math.floor(i / cols); g.drawImage(im, col * cell, row * cell, cell, cell); cells.set(im, [col, row, cols, rows]); });
  return { canvas: c, cells, image: c };
}

/**
 * ボディパーツのアセット(R15の胴・腕・脚)を読み込み、R6の各パーツへ組み立てる。
 * 1アセットに含まれるR15パーツ(上腕・前腕・手など)をRigAttachmentでつないで1つのジオメトリにし、R6の大きさへ合わせる。
 * 頭のアセットは loadHeadAsset で読む。複数のテクスチャは1枚のアトラスにまとめる(1パーツ=テクスチャ1枚のため)。
 * @param assetIds  アセットID(数)の配列
 * @param opts      { fit: 'stretch' | 'uniform' | 'none' }
 * @returns { parts: { [slot]: { slot, geometry, texture, color, transparency, face, overColor, warnings, source } }, skipped: [{ id, reason }] }
 */
export async function loadR15BodyParts(assetIds, opts = {}, onStatus = () => {}) {
  const fit = opts.fit || 'stretch';
  const parts = {}, skipped = [];
  for (const id of assetIds) {
    onStatus(`アセット ${id} を取得中…`);
    let buf, tree;
    try { buf = await fetchAssetBytes(id); tree = parseModel(buf); }
    catch (e) { if (e.code === 'NO_API_KEY' || e.code === 'KEY_REJECTED' || e.code === 'NETWORK') throw e; skipped.push({ id, reason: e.message }); continue; }
    const found = extractR15Parts(tree), slots = slotsIn(found);
    if (!slots.length) {
      try { const head = await loadHeadAsset(id, 'R15'); if (!parts.Head) parts.Head = { ...head, source: id }; else skipped.push({ id, reason: '頭は既に取り込み済み' }); }
      catch (e) { skipped.push({ id, reason: '胴・腕・脚・頭のメッシュを含まないアセット' }); }
      continue;
    }
    for (const slot of slots) {
      try {
        const plan = planChain(slot, found), pieces = [], warnings = [];
        for (const pc of plan) {
          onStatus(`${slot}: ${pc.name} のメッシュを取得中…`);
          const mesh = await parseMeshAsync(await fetchAssetBytes(parseAssetUri(pc.info.meshUri)));
          pieces.push({ info: pc.info, geo: bakePiece(pc.info, mesh, pc.T), tex: await textureOrNull(pc.info.textureUri) });
        }
        const atlas = atlasOf(pieces.map((p) => p.tex));
        if (pieces.some((p) => !p.tex) && atlas.image) warnings.push('一部のパーツにテクスチャがありません(その部分は絵が当たりません)');
        const merged = mergeGeometry(pieces.map((p) => {
          const cell = p.tex && atlas.cells.get(p.tex);
          return cell && atlas.canvas ? { ...p.geo, uvs: remapUVsToCell(p.geo.uvs, ...cell) } : p.geo;
        }));
        const first = pieces[0].info;
        parts[slot] = { slot, geometry: fitToR6(merged, slot, fit), texture: atlas.image, color: !atlas.image ? first.color : null, transparency: first.transparency || 0,
          face: false, overColor: false, warnings, source: id };
      } catch (e) { skipped.push({ id, reason: `${slot}: ${e.message}` }); }
    }
  }
  return { parts, skipped };
}

/**
 * バンドル(ID / URL)またはアセットIDの配列から、R15のボディパーツをR6へ変換して avatar に差し替える(取得・変換・反映を一度に)。
 * avatar: Avatar(engine.player など)。opts: { fit('stretch' | 'uniform' | 'none'), onStatus }
 * 反映は avatar.set({ bodyParts }) なので、再構築は1回だけ。変換できたパーツが無ければ何も変えない。
 * @returns { name, parts, skipped }
 */
export async function loadBodyBundle(avatar, input, { fit, onStatus } = {}) {
  let assetIds = input, name = '';
  if (!Array.isArray(input)) ({ name, assetIds } = await bundleAssetIds(input));
  const { parts, skipped } = await loadR15BodyParts(assetIds, { fit }, onStatus);
  if (Object.keys(parts).length) await avatar.set({ bodyParts: parts });
  return { name, parts, skipped };
}
