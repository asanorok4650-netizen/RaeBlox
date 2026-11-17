// Roblox APIからユーザー・アバター情報を取得し、ビルダー用の記述子(descriptor)へ変換する。
// ブラウザから直接はCORSで叩けないため、rbx-db-proxy(Cloudflare Worker + R2キャッシュ)経由で取得する。
// 契約: GET /asset/{id}(X-Cache: HIT|MISS|BYPASS)/ GET|POST /?url=(users・avatarのみ)/ GET /health。
// 失敗時はJSON { error, source?, retryAfter?, status? }(429は Retry-After ヘッダ付き)。
import { CONFIG } from '../config.js';
import { brickHex, BODY_ATTACH } from './rigs.js';
import { parseRbxm, isBinaryRbxm } from '../rbx/rbxm.js';
import { parseModel, modelFormat } from '../rbx/model.js';
import { parseMeshAsync } from '../rbx/mesh.js';
import { extractAccessory, parseAssetUri } from '../rbx/accessory.js';
import { extractHead, describeTree } from '../rbx/bodypart.js';
import { primitiveGeometry, isPrimitiveType } from '../rbx/primitives.js';
import { adjustFor, applyAdjust, describeAdjust } from './adjust.js';
import { customAssetBytes, hasAssetSources, toArrayBuffer, looksLikeUrl } from './sources.js';
import { isGlb, parseGlb, bakeTransform } from '../rbx/glb.js';
import { normalizeUV } from './uv.js';

export class ApiError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function proxyBase() {
  const base = CONFIG.proxyBase.replace(/\/+$/, '');
  if (!base) throw new ApiError('NO_PROXY', 'プロキシURLが未設定です(設定画面で入力してください)');
  return base;
}

// ---- 通信の制御(429対策) ----
// 同時リクエスト数を絞り、429が返ったら Retry-After(無ければ指数バックオフ)だけ待って再試行する。
// 429が出たら全リクエストを一斉に待たせる(連打して制限を延ばさない)。
export const NET = { concurrency: 3, retries: 3, baseDelay: 1500, maxDelay: 20000, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), log: (level, msg) => console.warn('[net]', msg) };
let pausedUntil = 0;
const retryAfterMs = (res) => { const v = res && res.headers && res.headers.get && res.headers.get('Retry-After'); const n = Number(v); return Number.isFinite(n) && n > 0 ? n * 1000 : 0; };
// Workerの429本文 { source, retryAfter } を読む(JSONでなければ空)。source: worker-request|worker-upstream|roblox-edge|roblox
const SOURCE_NOTE = { 'worker-request': 'Workerのリクエスト制限', 'worker-upstream': 'WorkerのRoblox問い合わせ制限', 'roblox-edge': 'Roblox手前のCloudflare制限(Workerの共有IPの混雑)', roblox: 'Roblox側(APIキー)の制限' };
async function limitInfo(res) {
  try { const j = await res.clone().json(); return { code: (j && j.error) || '', source: (j && j.source) || '', retryAfter: Number(j && j.retryAfter) || 0, status: (j && j.status) || 0 }; } catch (e) { return { code: '', source: '', retryAfter: 0 }; }
}
const sourceNote = (src) => (src ? `[${SOURCE_NOTE[src] || src}]` : '');
const retryAfterNote = (res) => { const ms = retryAfterMs(res); return ms ? `(Retry-After ${ms / 1000}秒)` : ''; };
async function backoff(res, attempt, retries, what) {
  const wait = Math.min(NET.maxDelay, Math.max(retryAfterMs(res), NET.baseDelay * 2 ** attempt));
  pausedUntil = Math.max(pausedUntil, Date.now() + wait);
  NET.log('warn', `429(回数制限) ${what} — ${(wait / 1000).toFixed(1)}秒待って再試行 (${attempt + 1}/${retries})`);
  await NET.sleep(wait);
}
const waitPause = async () => { const d = pausedUntil - Date.now(); if (d > 0) await NET.sleep(d); };
let active = 0; const waiters = [];
const acquire = () => (active < NET.concurrency ? (active++, Promise.resolve()) : new Promise((r) => waiters.push(r)));
const release = () => { const n = waiters.shift(); if (n) n(); else active--; };

/**
 * プロキシへの通信の共通処理(users/avatar・/user・/asset すべてここを通る)。
 * 429は Retry-After / 指数バックオフで retries 回まで再試行(全リクエスト共通の待機つき)。成功なら Response を返す。
 * mapError(res, li) が ApiError を返せば、それを投げる(エンドポイント固有のエラーコード変換)。
 * retries: 0 にすると429でも待たずに失敗させる(あってもなくてもよい取得用。全体を止めない)。
 */
async function proxyRequest(target, init, { what, retries = NET.retries, mapError } = {}) {
  for (let attempt = 0; ; attempt++) {
    await waitPause();
    let res;
    try { res = await fetch(target, init); }
    catch (e) { throw new ApiError('NETWORK', '通信に失敗しました(プロキシURLを確認してください)'); }
    if (res.ok) return res;
    const li = await limitInfo(res);
    if (res.status === 429 || li.code === 'RATE_LIMITED') {
      if (attempt < retries) { await backoff(res, attempt, retries, `${what}${sourceNote(li.source)}`); continue; }
      throw new ApiError('RATE_LIMITED', `${what}: 回数制限(HTTP 429${li.code ? ` / ${li.code}` : ''})が続いています${sourceNote(li.source)}${retryAfterNote(res)}`);
    }
    if (li.code === 'ORIGIN_NOT_ALLOWED') throw new ApiError('ORIGIN_NOT_ALLOWED', 'このサイトからの利用はWorkerに許可されていません(ALLOWED_ORIGINを確認)');
    throw (mapError && mapError(res, li)) || new ApiError(`HTTP_${res.status}`, `${what} の取得に失敗しました(HTTP ${res.status}${li.code ? ` / ${li.code}` : ''})`);
  }
}

// 取得済みアセットはブラウザのCache APIに残す(再読み込みでRobloxへ取りに行かない)。使えない環境では何もしない
const CACHE_NAME = 'rbxe-assets-v1';
const cacheKey = (id) => `https://rbxe-cache.invalid/asset/${id}`;
async function cacheGet(id) {
  try { if (typeof caches === 'undefined') return null; const r = await (await caches.open(CACHE_NAME)).match(cacheKey(id)); return r ? await r.arrayBuffer() : null; } catch (e) { return null; }
}
async function cachePut(id, buf) {
  try { if (typeof caches === 'undefined') return; await (await caches.open(CACHE_NAME)).put(cacheKey(id), new Response(buf.slice(0))); } catch (e) { /* 無視 */ }
}
/** 保存したアセットを全部消す(設定画面から) */
export async function clearAssetCache() { try { return typeof caches !== 'undefined' && await caches.delete(CACHE_NAME); } catch (e) { return false; } }

const proxied = (url) => `${proxyBase()}/?url=${encodeURIComponent(url)}`;
export const getJson = async (url, init) => (await proxyRequest(proxied(url), init, { what: url })).json();

// Workerの専用エンドポイント(GET {proxy}/user/{id} = Open Cloud)からユーザー情報を取る。
// 公開API(users.roblox.com)より429になりにくい。表示名のためだけの取得なので、429でも待たずに諦める(retries: 0)。
async function fetchUserInfo(id) {
  const res = await proxyRequest(`${proxyBase()}/user/${id}`, undefined, {
    what: `ユーザー ${id}`, retries: 0,
    mapError: (r, li) => {
      if (li.code === 'NOT_FOUND') return new ApiError('NOT_FOUND', `ユーザーID ${id} が見つかりません`);
      if (li.code === 'NO_API_KEY') return new ApiError('NO_API_KEY', 'WorkerにROBLOX_API_KEYが設定されていません');
      if (li.code === 'KEY_REJECTED') return new ApiError('KEY_REJECTED', 'APIキーが無効、許可IP外、またはUsers読み取り権限(user.advanced:read)がありません');
      // コード無しの400/403/404 = /user に対応していない古いWorker
      if (!li.code && (r.status === 400 || r.status === 403 || r.status === 404)) return new ApiError('OLD_WORKER', 'Workerが /user/{id} に未対応です(rbx-db-proxyを更新してください)');
      return null;
    },
  });
  const j = await res.json();
  if (!j || typeof j.name !== 'string' || !j.name) throw new ApiError('BAD_USER', `ユーザー ${id} の情報が不正です`);
  return { id: Number(id), name: j.name, displayName: j.displayName || j.name };
}

function normalizeUserInput(input) {
  const s = String(input || '').trim().replace(/^@/, '');
  if (!s) throw new ApiError('EMPTY', 'ユーザーID(数字)かユーザー名を入力してください');
  return s;
}

/**
 * ユーザーID(推奨)またはユーザー名 → { id, name, displayName }
 * ID入力: Open Cloud(Worker /user/{id})で表示名を取る。失敗しても表示名はおまけなので、IDだけで続行する(存在しないIDだけエラー)。
 * ユーザー名入力: usernames API 1回(応答に name/displayName 入り)。
 */
export async function resolveUser(input) {
  const s = normalizeUserInput(input);
  if (/^\d+$/.test(s)) {
    const id = Number(s);
    try { return await fetchUserInfo(id); }
    catch (e) {
      if (e.code === 'NOT_FOUND') throw e;
      NET.log('warn', `表示名を取得できませんでした(${e.message})。IDだけで続行します`);
      return { id, name: String(id), displayName: String(id) };
    }
  }
  const r = await getJson('https://users.roblox.com/v1/usernames/users', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usernames: [s], excludeBannedUsers: false }),
  });
  const u = r && r.data && r.data[0];
  if (!u) throw new ApiError('NOT_FOUND', `ユーザー「${s}」が見つかりません`);
  return { id: Number(u.id), name: u.name || s, displayName: u.displayName || u.name || s };
}

// アバター定義の取得。v4(/v4/avatar/users/{id}、{ avatarModel } に包まれている)を優先し、
// v1(非推奨)と同じ形(scales / playerAvatarType / bodyColors / assets)にそろえて返す。
// v4が失敗したら(古いWorkerで未許可、429、廃止など)v1に戻す。通信・Origin設定の問題はそのまま投げる。
export async function getAvatarJson(userId) {
  try {
    const j = await getJson(`https://avatar.roblox.com/v4/avatar/users/${userId}`);
    const m = j && j.avatarModel;
    if (m && Array.isArray(m.assets)) return m;
    NET.log('warn', 'アバターv4の応答に avatarModel が無いため、v1で取り直します');
  } catch (e) {
    if (e.code === 'NETWORK' || e.code === 'ORIGIN_NOT_ALLOWED') throw e;
    NET.log('warn', `アバターv4の取得に失敗(${e.message})。v1で取り直します`);
  }
  return getJson(`https://avatar.roblox.com/v1/users/${userId}/avatar`);
}

// ---- アセット取得 ----
const imageCache = new Map();

/**
 * アセット本体を取得する。Workerの /asset/{id} 経由で、Robloxへの認証(APIキー)はWorker側が行う。
 * 同じIDの同時取得は1回にまとめる(完了後の再取得はブラウザのCache APIが受ける)。
 * 失敗時は原因ごとのApiErrorを投げる(NO_API_KEY / KEY_REJECTED / ASSET_UNAVAILABLE / ASSET_TOO_LARGE / RATE_LIMITED / PROXY_* / OLD_WORKER ほか)。
 */
const inflight = new Map();
export function fetchAssetBytes(id) {
  if (!inflight.has(id)) {
    const p = (async () => {
      if (hasAssetSources()) { const own = await customAssetBytes(id); if (own) return own; } // 独自アセット(sources.js)を先に探す
      if (typeof id === 'string' && !/^\d+$/.test(id)) throw new ApiError('ASSET_UNAVAILABLE', `独自アセット ${id} は登録されていません(registerAssetMap / registerAssetSource)`);
      const hit = await cacheGet(id);
      if (hit) return hit;
      await acquire();
      try {
        const buf = await fetchAssetNetwork(id);
        cachePut(id, buf);
        return buf;
      } finally { release(); }
    })();
    inflight.set(id, p);
    p.then(() => inflight.delete(id), () => inflight.delete(id));
  }
  return inflight.get(id);
}

async function fetchAssetNetwork(id) {
  const res = await proxyRequest(`${proxyBase()}/asset/${id}`, undefined, {
    what: `アセット ${id}`,
    mapError: (r, li) => {
      const code = li.code;
      if (code === 'NO_API_KEY') return new ApiError('NO_API_KEY', 'アセットを取得できません: WorkerにROBLOX_API_KEYが設定されていません');
      if (code === 'KEY_REJECTED') return new ApiError('KEY_REJECTED', 'アセットを取得できません: APIキーが無効か、期限切れ、または許可IP外です');
      if (code === 'NOT_FOUND') return new ApiError('ASSET_UNAVAILABLE', `アセット ${id} が見つかりません`);
      if (code === 'TOO_LARGE') return new ApiError('ASSET_TOO_LARGE', `アセット ${id} がWorkerのサイズ上限(MAX_OBJECT_BYTES)を超えています`);
      if (code === 'UPSTREAM' || code === 'CDN' || code === 'NO_LOCATION' || code === 'BAD_LOCATION') return new ApiError(`PROXY_${code}`, `アセット ${id}: Robloxからの取得に失敗しました(${code}${li.status ? ` / Roblox HTTP ${li.status}` : ''})`);
      if (!code && (r.status === 400 || r.status === 404)) return new ApiError('OLD_WORKER', 'プロキシがrbx-db-proxyではない可能性があります。プロキシURLを確認してください');
      return null;
    },
  });
  const xc = res.headers && res.headers.get && res.headers.get('X-Cache');
  if (xc && xc !== 'HIT') NET.log('info', `アセット ${id}: ${xc === 'MISS' ? 'Robloxから取得してR2に保存' : 'R2キャッシュ未設定(BYPASS)'}`);
  return res.arrayBuffer();
}

function isImageBytes(buf) {
  const b = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
  return (b[0] === 0x89 && b[1] === 0x50) || (b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0x47 && b[1] === 0x49);
}

/** XML形式のアセット(Shirt/Pants/T-Shirt/Decal)から、参照先の画像アセットIDを取り出す。バイナリ形式は null(呼び出し側で rbxm として解析する) */
export function extractContentId(buf) {
  const head = new Uint8Array(buf, 0, Math.min(8, buf.byteLength));
  const magic = String.fromCharCode(...head);
  if (magic.startsWith('<roblox!')) return null;
  const text = new TextDecoder('latin1').decode(buf);
  const m = text.match(/rbxassetid:\/\/(\d+)/) || text.match(/[?&]id=(\d+)/);
  return m ? Number(m[1]) : null;
}

/** 画像アセット → ImageBitmap(同じIDは使い回す)。取得済みのバイト列があれば buf で渡す(再取得しない) */
function imageForAsset(id, buf) {
  if (!imageCache.has(id)) {
    const p = (async () => {
      const b = buf || await fetchAssetBytes(id);
      if (!isImageBytes(b)) throw new ApiError('NOT_IMAGE', `アセット ${id} は画像ではありません`);
      return createImageBitmap(new Blob([b]));
    })();
    imageCache.set(id, p);
    p.catch(() => imageCache.delete(id));
  }
  return imageCache.get(id);
}

/** 服/顔のアセットID → 画像。直接画像ならそのまま、XMLなら参照先の画像を取得。 */
export async function textureForAsset(assetId) {
  const buf = await fetchAssetBytes(assetId);
  if (isImageBytes(buf)) return imageForAsset(assetId, buf);
  const cid = extractContentId(buf);
  if (cid) return imageForAsset(cid);
  if (isBinaryRbxm(buf)) { // バイナリrbxm: 参照先の画像プロパティを探す
    const tree = parseRbxm(buf);
    for (const inst of tree.instances.values()) {
      for (const k of ['ShirtTemplate', 'PantsTemplate', 'Graphic', 'Texture']) {
        const id = parseAssetUri(inst.props[k]);
        if (id) return imageForAsset(id);
      }
    }
  }
  throw new ApiError('NO_TEXTURE', `アセット ${assetId} から画像を特定できません`);
}

/** テクスチャURI → 画像。無い・読めないときは null(テクスチャ無しで表示する) */
export async function textureOrNull(uri) {
  const id = parseAssetUri(uri);
  if (!id) return null;
  try { return await textureForAsset(id); } catch (e) { return null; }
}

/** アクセサリのバイト列(バイナリ・XMLのrbxm)→ 描画用データ { name, handle, attachment, geometry, texture } */
async function accessoryFromBuffer(buf) {
  const fmt = modelFormat(buf);
  if (!fmt) throw new ApiError('UNSUPPORTED_FORMAT', 'アクセサリの形式を判別できません(バイナリrbxmでもXMLでもありません)');
  let tree;
  try { tree = parseModel(buf); }
  catch (e) { throw new ApiError('PARSE_ERROR', `アクセサリ(${fmt === 'xml' ? 'XML' : 'バイナリ'}形式)の解析に失敗しました: ${e.message}`); }
  const acc = extractAccessory(tree);
  if (!acc) throw new ApiError('NO_HANDLE', 'Handleが見つかりません');
  let geometry;
  if (isPrimitiveType(acc.handle.meshType)) { // SpecialMesh の組み込み形状(Brick/Sphere/Cylinder/Wedge/Head など)
    geometry = primitiveGeometry(acc.handle.meshType, acc.handle.size);
  } else {
    const meshId = parseAssetUri(acc.handle.meshUri);
    if (!meshId) throw new ApiError('NO_MESH', 'メッシュIDがありません');
    geometry = await parseMeshAsync(await fetchAssetBytes(meshId));
  }
  return { ...acc, geometry, texture: await textureOrNull(acc.handle.textureUri) };
}

/** アクセサリ(Hat/Hair/Face/Neck/Shoulder/Front/Back/Waist)を読み込む → 描画用データ。バイナリ・XMLの両形式に対応 */
export async function loadAccessory(assetId) {
  return accessoryFromBuffer(await fetchAssetBytes(assetId));
}

// ---- 独自アセット(GLB)共通 ----
/** source: ArrayBuffer / TypedArray / Blob / URL文字列 / 登録したID → ArrayBuffer */
const sourceBytes = (source) => (typeof source === 'string' && !looksLikeUrl(source) ? fetchAssetBytes(source) : toArrayBuffer(source));

/** GLBを解析し、meta(scale / rotation / offset / unit / flipFront)を焼き込んだジオメトリとテクスチャを返す */
async function loadGlb(buf, meta) {
  let glb;
  try { glb = parseGlb(buf); }
  catch (e) { throw new ApiError('PARSE_ERROR', `GLBの解析に失敗しました: ${e.message}`); }
  const geometry = bakeTransform(glb, meta);
  let texture = null;
  if (glb.image && typeof createImageBitmap === 'function') {
    try { texture = await createImageBitmap(new Blob([glb.image.bytes], { type: glb.image.mime })); }
    catch (e) { glb.warnings.push(`テクスチャを読めませんでした: ${e.message}`); }
  }
  return { glb, geometry, texture };
}

/**
 * 独自アクセサリ(Roblox外のGLBモデル)を読み込む → loadAccessory と同じ形の描画用データ。
 * source: ArrayBuffer / TypedArray / Blob / URL文字列 / 登録したID(registerAssetMap など)。Roblox形式(rbxm/rbxmx)のバイト列も可
 * meta: { name, attach = 'HatAttachment', scale = 1 | [x,y,z], rotation = [度x,y,z], offset = [stud x,y,z], unit = 1/0.28, flipFront = true, color }
 *   GLBの原点が取り付け位置(attach)に来る。offset / rotation はその取り付け位置を基準にずらす。
 *   単位はメートルとみなして stud に換算(unit)。glTFの正面+ZはRobloxの正面-Zへ反転(flipFront)。
 */
export async function loadCustomAccessory(source, meta = {}) {
  const buf = await sourceBytes(source);
  const name = meta.name || (typeof source === 'string' ? source : 'CustomAccessory');
  if (!isGlb(buf)) { // GLBでなければ Roblox形式として扱う(Handle + Attachment)
    const acc = await accessoryFromBuffer(buf);
    acc.name = name;
    return acc;
  }
  const attach = meta.attach || 'HatAttachment';
  if (!BODY_ATTACH[attach]) throw new ApiError('BAD_ATTACHMENT', `取り付け位置 ${attach} は未対応です(${Object.keys(BODY_ATTACH).join(' / ')})`);
  const { glb, geometry, texture } = await loadGlb(buf, meta);
  const c = meta.color || (!texture && glb.color) || null;
  const size = geometry.bbox.max.map((v, i) => v - geometry.bbox.min[i]);
  return {
    name, custom: true, warnings: glb.warnings, geometry, texture,
    handle: { kind: 'special', meshType: 5, size, meshUri: null, textureUri: null, scale: [1, 1, 1], offset: [0, 0, 0],
      color: c, transparency: meta.transparency ?? (glb.alpha < 1 ? 1 - glb.alpha : 0) },
    attachment: { name: attach, pos: [0, 0, 0], rot: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
  };
}

/** 頭アセットのメッシュを、頭パーツの座標系(原点=中心)へ焼き込んだジオメトリにする。MeshPartはbboxの中心を原点にSizeへ拡縮、SpecialMeshは頂点×Scale+Offset */
function bakeHeadGeometry(info) {
  const g = info.geometry, pos = new Float32Array(g.positions);
  if (info.kind === 'meshpart') {
    const size = effectiveHeadSize(info), mn = g.bbox.min, mx = g.bbox.max;
    for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) {
      const ext = mx[k] - mn[k] || 1;
      pos[i + k] = (pos[i + k] - (mn[k] + mx[k]) / 2) * ((size[k] || ext) / ext);
    }
  } else {
    for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) pos[i + k] = pos[i + k] * info.scale[k] + info.offset[k];
  }
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], pos[i + k]); max[k] = Math.max(max[k], pos[i + k]); }
  return { positions: pos, normals: g.normals, uvs: g.uvs, indices: g.indices, bbox: { min, max } };
}
/** MeshPartのSizeが仮の値(1,1,1)のアセットがあるため、その場合はメッシュの実寸を使う */
function effectiveHeadSize(info) {
  const g = info.geometry && info.geometry.bbox;
  return g && info.size.every((v) => Math.abs(v - 1) < 1e-3) ? g.max.map((v, k) => v - g.min[k]) : info.size;
}

/**
 * Robloxの頭アセット(DynamicHead / クラシックの頭)を読み込む → desc.customParts.Head の形 { slot, geometry, texture, color, transparency, face, overColor }。
 * R15用(DynamicHeadなど)・R6用(Part+SpecialMesh)のどちらの構造でも、頭のメッシュを取り出してR6の頭に当てる。
 * preferRig: アバター本来のリグ('R15' | 'R6')。そちらの構造を先に探す。
 */
export async function loadHeadAsset(assetId, preferRig = 'R15') {
  const buf = await fetchAssetBytes(assetId);
  if (!isBinaryRbxm(buf)) throw new ApiError('UNSUPPORTED_FORMAT', 'XML形式の頭アセットは未対応です');
  const tree = parseRbxm(buf);
  let info = null;
  for (const rig of preferRig === 'R6' ? ['R6', 'R15'] : ['R15', 'R6']) { info = extractHead(tree, rig); if (info) break; }
  if (!info) {
    const w = tree.warnings.filter((x) => /Mesh|Texture/.test(x)).slice(0, 2).join(' / ');
    throw new ApiError('NO_PART', `頭のメッシュがありません(標準形状か未対応の形式) 構造: ${describeTree(tree)}${w ? ` 警告: ${w}` : ''}`);
  }
  if (isPrimitiveType(info.meshType)) info.geometry = primitiveGeometry(info.meshType, info.size);
  else info.geometry = await parseMeshAsync(await fetchAssetBytes(parseAssetUri(info.meshUri)));
  const texture = await textureOrNull(info.textureUri);
  return { slot: 'Head', geometry: bakeHeadGeometry(info), texture, color: null, transparency: info.transparency || 0,
    face: false, overColor: true, warnings: [] };
}

/** 独自ボディパーツを差し替えられる部位(R6のパーツ名) */
export const BODY_SLOTS = ['Head', 'Torso', 'Left Arm', 'Right Arm', 'Left Leg', 'Right Leg'];

/** テクスチャの差し替え指定 → 描画に使える画像。ImageBitmap / Canvas / <img> はそのまま、Blob・ArrayBuffer・URL・登録IDは読み込む */
async function textureFrom(x) {
  if (!x) return null;
  const drawable = (typeof ImageBitmap !== 'undefined' && x instanceof ImageBitmap) || (typeof HTMLCanvasElement !== 'undefined' && x instanceof HTMLCanvasElement)
    || (typeof OffscreenCanvas !== 'undefined' && x instanceof OffscreenCanvas) || (typeof HTMLImageElement !== 'undefined' && x instanceof HTMLImageElement);
  if (drawable) return x;
  const buf = await sourceBytes(x);
  try { return await createImageBitmap(new Blob([buf])); }
  catch (e) { throw new ApiError('BAD_TEXTURE', `テクスチャ画像を読めませんでした: ${e.message}`); }
}

/**
 * ジオメトリ(stud・Roblox座標・原点=パーツ中心)から、独自ボディパーツのデータを直接作る。GLBを経由しない(ツール・手続き生成向け)。
 * geometry: { positions, normals, uvs, indices } / meta: { slot, texture(画像), uv, wrap, color, transparency, face, overColor }
 */
export async function bodyPartFromGeometry(geometry, meta = {}) {
  const slot = meta.slot;
  if (!BODY_SLOTS.includes(slot)) throw new ApiError('BAD_SLOT', `部位 ${slot} は未対応です(${BODY_SLOTS.join(' / ')})`);
  const p = geometry.positions, min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { if (p[i + k] < min[k]) min[k] = p[i + k]; if (p[i + k] > max[k]) max[k] = p[i + k]; }
  return { slot, geometry: { positions: p, normals: geometry.normals, uvs: geometry.uvs, indices: geometry.indices, plain: geometry.plain || null, bbox: { min, max } },
    texture: await textureFrom(meta.texture), color: meta.color || null,
    plain: geometry.plain || null, plainColor: meta.plainColor || null, transparency: meta.transparency || 0, face: !!meta.face,
    uv: normalizeUV(meta.uv), wrap: meta.wrap || (meta.uv && meta.uv.wrap) || 'repeat', overColor: !!meta.overColor, clothing: meta.clothing, clothFit: meta.clothFit, warnings: [] };
}

/**
 * 独自ボディパーツ(GLB)を読み込む → buildAvatar の desc.customParts[slot] に入れる形 { slot, geometry, texture, color, transparency, face, uv, wrap, overColor, warnings }。
 * source: ArrayBuffer / TypedArray / Blob / URL文字列 / 登録したID(registerAssetMap など)
 * 貼らない面: GLBに「テクスチャ付き」と「テクスチャなし」のプリミティブが混在していれば、なしの三角形は cp.plain(1=貼らない)になり、cp.plainColor の単色で描く。
 * meta: { slot(必須), clothing(false でクラシック服を重ねない), clothFit('bbox'=メッシュ全体に合わせる(既定) | 'standard'=R6標準サイズの箱に合わせる), plainColor, scale = 1 | [x,y,z], rotation = [度x,y,z], offset = [stud x,y,z], unit = 1/0.28, flipFront = true, color, transparency, face = false,
 *         texture(GLBの絵を別の画像に差し替える: 画像 / Blob / URL), uv(テクスチャの位置・拡大・回転。avatar/uv.js), wrap('repeat'|'clamp'|'mirror'), overColor(透明部分を体の色で塗る) }
 *   GLBの原点がそのパーツの中心。パーツは関節(Motor6D)の子なので、アニメーションにそのまま追従する。
 *   stud換算と向きの扱いは loadCustomAccessory と同じ。R6の標準サイズ: Head 1.25立方 / Torso 2×2×1 / 腕・脚 1×2×1。
 */
export async function loadCustomBodyPart(source, meta = {}) {
  const slot = meta.slot;
  if (!BODY_SLOTS.includes(slot)) throw new ApiError('BAD_SLOT', `部位 ${slot} は未対応です(${BODY_SLOTS.join(' / ')})`);
  const buf = await sourceBytes(source);
  if (!isGlb(buf)) throw new ApiError('UNSUPPORTED_FORMAT', '独自ボディパーツはGLB形式のみ対応です');
  const { glb, geometry, texture: glbTexture } = await loadGlb(buf, meta);
  const texture = meta.texture ? await textureFrom(meta.texture) : glbTexture;
  const uv = normalizeUV(meta.uv);
  return { slot, geometry, texture, color: meta.color || (!texture && glb.color) || null,
    plain: geometry.plain || null, plainColor: meta.plainColor || glb.plainColor || null,
    transparency: meta.transparency ?? (glb.alpha < 1 ? 1 - glb.alpha : 0), face: !!meta.face,
    uv, wrap: meta.wrap || (uv && uv.wrap !== 'repeat' ? uv.wrap : null) || glb.wrap || 'repeat', overColor: !!meta.overColor, clothing: meta.clothing, clothFit: meta.clothFit, warnings: glb.warnings };
}

// ---- アバター記述子 ----
const ASSET_TYPE = { 2: 'tshirt', 11: 'shirt', 12: 'pants', 18: 'face' };
// 頭(Head=17 / DynamicHead=79)は読み込んでR6の頭に当てる。それ以外のボディ系は、R6既定のボディを使うため読み込まない: Torso, RightArm, LeftArm, LeftLeg, RightLeg
const HEAD_ASSET_TYPES = new Set([17, 79]);
const BODY_ASSET_TYPES = new Set([27, 28, 29, 30, 31]);
// レイヤー服(読み込まない): TShirt/Shirt/Pants/Jacket/Sweater/Shorts/LeftShoe/RightShoe/DressSkirtAccessory
const LAYERED_TYPES = new Set([64, 65, 66, 67, 68, 69, 70, 71, 72]);
const ACCESSORY_TYPES = new Set([8, 41, 42, 43, 44, 45, 46, 47]); // Hat, Hair, Face, Neck, Shoulder, Front, Back, Waist

function hex(v, fallback) {
  if (!v) return fallback;
  const s = String(v).replace(/^#/, '');
  return /^[0-9a-fA-F]{6}$/.test(s) ? `#${s.toUpperCase()}` : fallback;
}

function readColors(av) {
  const c3 = av.bodyColor3s || {};
  const ids = av.bodyColors || {};
  // 優先順: bodyColor3s の *Color3 → v4の bodyColors の *Color(16進) → v1の bodyColors の *ColorId(BrickColor)
  const key = (n) => hex(c3[`${n}Color3`], hex(ids[`${n}Color`], brickHex(ids[`${n}ColorId`])));
  return { head: key('head'), torso: key('torso'), leftArm: key('leftArm'), rightArm: key('rightArm'),
    leftLeg: key('leftLeg'), rightLeg: key('rightLeg') };
}

/**
 * avatar API のJSON → descriptor。
 * report: 各アセットの適用状況 [{ id, name, type, status:'ok'|'skip'|'error', note }]
 */
export async function buildDescriptor(av, onProgress = () => {}) {
  // このエンジンはR6専用。R15のアバターでもボディはR6既定(体色・クラシック服・顔・アクセサリだけ引き継ぐ)
  const desc = { sourceRigType: av.playerAvatarType === 'R6' ? 'R6' : 'R15', colors: readColors(av),
    clothing: {}, face: null, accessories: [], customParts: {}, report: [] };

  const jobs = [];
  let done = 0;
  for (const a of av.assets || []) {
    const tid = a.assetType && a.assetType.id;
    const slot = ASSET_TYPE[tid];
    const entry = { id: a.id, name: a.name, type: (a.assetType && a.assetType.name) || '?', status: 'skip', note: '未対応' };
    desc.report.push(entry);
    if (BODY_ASSET_TYPES.has(tid)) { entry.note = 'R6既定のボディを使用'; continue; }
    if (LAYERED_TYPES.has(tid)) { entry.note = 'レイヤー服は読み込まない'; continue; }
    const isAcc = ACCESSORY_TYPES.has(tid);
    const isHead = HEAD_ASSET_TYPES.has(tid);
    if (!slot && !isAcc && !isHead) continue;
    jobs.push((async () => {
      try {
        let adjNote = '';
        if (isHead) {
          desc.customParts.Head = await loadHeadAsset(a.id, desc.sourceRigType);
        } else if (isAcc) {
          const acc = await loadAccessory(a.id);
          acc.name = a.name;
          // ユーザー調整(avatar API の meta)。通常のヘアは対象外(null)
          const adj = adjustFor(a.meta, tid);
          if (adj) { applyAdjust(acc, adj); acc.adjust = adj; adjNote = ` 調整: ${describeAdjust(adj)}`; }
          desc.accessories.push(acc);
        } else {
          const img = await textureForAsset(a.id);
          if (slot === 'face') desc.face = img; else desc.clothing[slot] = img;
        }
        entry.status = 'ok'; entry.note = `適用済み${adjNote}`;
      } catch (e) {
        entry.status = 'error'; entry.note = e.message;
      } finally {
        done++; onProgress(done, jobs.length);
      }
    })());
  }
  onProgress(0, jobs.length);
  await Promise.all(jobs);
  // 顔の板は、顔アセットがある、または頭メッシュに顔が焼き込まれていない(自前テクスチャ無し)ときだけ付ける
  const head = desc.customParts.Head;
  if (head && head.overColor) head.face = !!desc.face || !head.texture;
  return desc;
}

/**
 * ユーザー入力 → { user, desc } まで一括。
 * 数字ID: 表示名(おまけ)とアバター定義を同時に取りに行く(表示名の失敗・遅延でアバターの読み込みを待たせない)。
 * ユーザー名: IDが分からないので、ユーザー検索 → アバター定義の順。
 */
export async function loadUserAvatar(input, onStatus = () => {}) {
  const s = normalizeUserInput(input);
  onStatus('ユーザーとアバター情報を取得中…');
  let user, av;
  if (/^\d+$/.test(s)) {
    [user, av] = await Promise.all([resolveUser(s), getAvatarJson(Number(s))]);
  } else {
    user = await resolveUser(s);
    onStatus(`${user.displayName} のアバター情報を取得中…`);
    av = await getAvatarJson(user.id);
  }
  const desc = await buildDescriptor(av, (d, n) => onStatus(`パーツを読み込み中… ${d}/${n}`));
  return { user, desc };
}

// ── プロキシの接続確認 ──
export const proxyHealthUrl = () => `${CONFIG.proxyBase.replace(/\/+$/, '')}/health`;

/** プロキシの接続確認。{ ok, message, detail? } を返す(例外は投げない) */
export async function checkProxy(fetchImpl = fetch, origin = (typeof location !== 'undefined' ? location.origin : '')) {
  const url = proxyHealthUrl();
  let res;
  try { res = await fetchImpl(url, { cache: 'no-store' }); }
  catch (e) {
    return { ok: false, message: `接続できません。URLの誤りか、Workerの ALLOWED_ORIGIN にこのページのOrigin「${origin}」が入っていない可能性があります(CORS)`, detail: String(e && e.message || e) };
  }
  if (!res.ok) return { ok: false, message: `HTTP ${res.status}(プロキシURLを確認してください)` };
  let j;
  try { j = await res.json(); } catch (e) { return { ok: false, message: '応答がJSONではありません(Workerのバージョンが古い可能性)' }; }
  const notes = [];
  if (!j.hasApiKey) notes.push('APIキー未設定(アセット取得不可)');
  if (j.hasCache === false) notes.push('R2キャッシュ未設定(毎回Robloxへ問い合わせ→429しやすい)');
  if (j.originRestricted) notes.push('Origin制限あり');
  return { ok: !!j.ok && !!j.hasApiKey, message: `接続OK(v${j.version ?? '?'})${notes.length ? ' - ' + notes.join(' / ') : ''}`, detail: j };
}

// ───────────── プロキシ経由の汎用GET ─────────────
/** プロキシ経由でRobloxのAPIをGETしてJSONで返す(CORS回避。プロキシ側の許可ホストに catalog / avatar が必要) */
export const fetchRobloxJson = (url) => getJson(url);
