// GLB(glTF 2.0 バイナリ)のパーサ。THREE非依存。独自アクセサリ(Roblox外の3Dモデル)用。
// 全メッシュ・全ノードを1つのジオメトリにまとめ(ノードの変換を焼き込み)、最初に見つかったベースカラーテクスチャを返す。
// 対応: 三角形リスト / 索引あり・なし / byteStride / 正規化整数 / ノードのTRS・matrix / GLB内蔵画像(bufferView)・data: URI画像
// KHR_texture_transform(ベースカラーテクスチャのoffset/rotation/scale)はUVへ焼き込む。サンプラーのwrap(繰り返し/クランプ/ミラー)も返す。
// 非対応: Draco・Meshopt圧縮、スパースアクセサ、スキン/モーフ/アニメ(無視)、外部ファイル参照(.gltf+bin)、複数テクスチャ(先頭のみ)
// 座標は glTF のまま(メートル・Y上・正面+Z)。Roblox向けの単位・向き調整は bakeTransform で行う。

export class GlbError extends Error {}

const CT = { 5120: ['getInt8', 1], 5121: ['getUint8', 1], 5122: ['getInt16', 2], 5123: ['getUint16', 2], 5125: ['getUint32', 4], 5126: ['getFloat32', 4] };
const NORM_DIV = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

export const isGlb = (buf) => buf && buf.byteLength >= 12 && new DataView(buf).getUint32(0, true) === 0x46546c67;

function readChunks(buf) {
  const dv = new DataView(buf);
  if (!isGlb(buf)) throw new GlbError('GLBではありません(先頭が glTF ではない)');
  if (dv.getUint32(4, true) !== 2) throw new GlbError(`GLBバージョン ${dv.getUint32(4, true)} は未対応(2のみ)`);
  const total = Math.min(dv.getUint32(8, true), buf.byteLength);
  let json = null, bin = null;
  for (let o = 12; o + 8 <= total;) {
    const len = dv.getUint32(o, true), type = dv.getUint32(o + 4, true);
    const data = buf.slice(o + 8, o + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(data));
    else if (type === 0x004e4942 && !bin) bin = data;
    o += 8 + len + ((4 - (len % 4)) % 4);
  }
  if (!json) throw new GlbError('GLBにJSONチャンクがありません');
  return { json, bin };
}

/** アクセサを Float32Array / Uint32Array(components個ずつ)として読む */
function readAccessor(json, bin, index, asInt = false) {
  const a = json.accessors && json.accessors[index];
  if (!a) throw new GlbError(`accessor ${index} がありません`);
  if (a.sparse) throw new GlbError('スパースアクセサは未対応です');
  const nc = NCOMP[a.type], ct = CT[a.componentType];
  if (!nc || !ct) throw new GlbError(`accessor ${index}: 型が不正です`);
  const out = asInt ? new Uint32Array(a.count * nc) : new Float32Array(a.count * nc);
  if (a.bufferView === undefined) return out; // 仕様上ゼロ埋め
  const bv = json.bufferViews[a.bufferView];
  if (!bv || !bin) throw new GlbError('BINチャンクが見つかりません(外部.binは未対応)');
  const dv = new DataView(bin);
  const [fn, size] = ct;
  const stride = bv.byteStride || nc * size;
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const div = a.normalized ? NORM_DIV[a.componentType] : 0;
  for (let i = 0; i < a.count; i++) {
    for (let k = 0; k < nc; k++) {
      let v = dv[fn](base + i * stride + k * size, true);
      if (div) v = Math.max(v / div, -1);
      out[i * nc + k] = v;
    }
  }
  return out;
}

// ---- 4x4行列(列優先) ----
const IDENT4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul4(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function nodeMatrix(n) {
  if (n.matrix) return n.matrix.slice();
  const [x, y, z, w] = n.rotation || [0, 0, 0, 1], [sx, sy, sz] = n.scale || [1, 1, 1], [tx, ty, tz] = n.translation || [0, 0, 0];
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return [
    (1 - 2 * (yy + zz)) * sx, (2 * (xy + wz)) * sx, (2 * (xz - wy)) * sx, 0,
    (2 * (xy - wz)) * sy, (1 - 2 * (xx + zz)) * sy, (2 * (yz + wx)) * sy, 0,
    (2 * (xz + wy)) * sz, (2 * (yz - wx)) * sz, (1 - 2 * (xx + yy)) * sz, 0,
    tx, ty, tz, 1];
}
/** 上3x3の余因子行列(逆転置に比例)と行列式 */
function normalMatrix(m) {
  const a = m[0], b = m[4], c = m[8], d = m[1], e = m[5], f = m[9], g = m[2], h = m[6], i = m[10]; // 行列 [[a b c][d e f][g h i]]
  const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g;
  return { n: [A, B, C, c * h - b * i, a * i - c * g, b * g - a * h, b * f - c * e, c * d - a * f, a * e - b * d], det: a * A + b * B + c * C };
}

const WRAP_NAME = { 10497: 'repeat', 33071: 'clamp', 33648: 'mirror' };
/** テクスチャのサンプラーの wrapS / wrapT → ['repeat'|'clamp'|'mirror', …] */
function wrapFrom(json, texIndex) {
  const tex = json.textures && json.textures[texIndex];
  const sm = tex && tex.sampler !== undefined && json.samplers && json.samplers[tex.sampler];
  return [WRAP_NAME[sm && sm.wrapS] || 'repeat', WRAP_NAME[sm && sm.wrapT] || 'repeat'];
}
/** KHR_texture_transform(offset / rotation / scale)→ UV を変換する関数。無ければ null。uv' = T · R · S · uv(glTF仕様) */
function kttFrom(info) {
  const k = info && info.extensions && info.extensions.KHR_texture_transform;
  if (!k) return null;
  const [ox, oy] = k.offset || [0, 0], [sx, sy] = k.scale || [1, 1], r = k.rotation || 0, c = Math.cos(r), s = Math.sin(r);
  return (u, v) => [c * sx * u + s * sy * v + ox, -s * sx * u + c * sy * v + oy];
}

function imageFrom(json, bin, texIndex) {
  const tex = json.textures && json.textures[texIndex];
  const img = tex && json.images && json.images[tex.source];
  if (!img) return null;
  if (img.bufferView !== undefined) {
    const bv = json.bufferViews[img.bufferView];
    if (!bin || !bv) return null;
    return { bytes: new Uint8Array(bin, bv.byteOffset || 0, bv.byteLength), mime: img.mimeType || 'image/png' };
  }
  const m = typeof img.uri === 'string' && img.uri.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (m) {
    const bytes = m[2] ? Uint8Array.from(atob(m[3]), (c) => c.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(m[3]));
    return { bytes, mime: m[1] || img.mimeType || 'image/png' };
  }
  return null; // 外部画像ファイルは未対応
}

/**
 * @param buf GLBのArrayBuffer
 * @returns { positions, normals, uvs, indices, bbox, image:{bytes,mime}|null, color:[r,g,b]|null, alpha, wrap:['repeat'|'clamp'|'mirror' ×2], plain:Uint8Array|null(三角形ごと 1=テクスチャを貼らない), plainColor, warnings:string[] }
 */
export function parseGlb(buf) {
  const { json, bin } = readChunks(buf);
  const bad = (json.extensionsRequired || []).filter((e) => /draco|meshopt/i.test(e));
  if (bad.length) throw new GlbError(`圧縮GLB(${bad.join(', ')})は未対応です。圧縮なしで書き出してください`);

  const warnings = [];
  const P = [], N = [], U = [], I = [];
  const triRanges = [];
  let vbase = 0, image = null, imageMat = -1, color = null, alpha = 1, anyNormalsMissing = false, wrap = ['repeat', 'repeat'];

  const addPrimitive = (prim, M) => {
    if (prim.mode !== undefined && prim.mode !== 4) { warnings.push(`三角形リスト以外のプリミティブ(mode ${prim.mode})を無視しました`); return; }
    const at = prim.attributes || {};
    if (at.POSITION === undefined) return;
    const pos = readAccessor(json, bin, at.POSITION);
    const count = pos.length / 3;
    const nor = at.NORMAL !== undefined ? readAccessor(json, bin, at.NORMAL) : null;
    const uv = at.TEXCOORD_0 !== undefined ? readAccessor(json, bin, at.TEXCOORD_0) : null;
    const idx = prim.indices !== undefined ? readAccessor(json, bin, prim.indices, true) : Uint32Array.from({ length: count }, (_, i) => i);
    const { n: NM, det } = normalMatrix(M);
    const mat = prim.material !== undefined && json.materials ? json.materials[prim.material] : null;
    const pbr = mat && mat.pbrMetallicRoughness;
    const ktt = pbr && kttFrom(pbr.baseColorTexture);
    for (let i = 0; i < count; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      P.push(M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]);
      if (nor) {
        const nx = nor[i * 3], ny = nor[i * 3 + 1], nz = nor[i * 3 + 2];
        let ox = NM[0] * nx + NM[1] * ny + NM[2] * nz, oy = NM[3] * nx + NM[4] * ny + NM[5] * nz, oz = NM[6] * nx + NM[7] * ny + NM[8] * nz;
        if (det < 0) { ox = -ox; oy = -oy; oz = -oz; }
        const l = Math.hypot(ox, oy, oz) || 1;
        N.push(ox / l, oy / l, oz / l);
      } else { N.push(0, 0, 0); anyNormalsMissing = true; }
      if (uv && ktt) U.push(...ktt(uv[i * 2], uv[i * 2 + 1]));
      else U.push(uv ? uv[i * 2] : 0, uv ? uv[i * 2 + 1] : 0);
    }
    const t0 = I.length / 3;
    for (let i = 0; i + 2 < idx.length; i += 3) { // 鏡像(行列式<0)は巻き順が反転するので戻す
      if (det < 0) I.push(vbase + idx[i], vbase + idx[i + 2], vbase + idx[i + 1]);
      else I.push(vbase + idx[i], vbase + idx[i + 1], vbase + idx[i + 2]);
    }
    vbase += count;
    triRanges.push({ t0, t1: I.length / 3, tex: !!(pbr && pbr.baseColorTexture), named: !!(mat && mat.name === 'Plain'), color: pbr && pbr.baseColorFactor ? pbr.baseColorFactor.slice(0, 3) : [1, 1, 1] });

    if (pbr) {
      if (!color && pbr.baseColorFactor) { color = pbr.baseColorFactor.slice(0, 3); alpha = pbr.baseColorFactor[3] ?? 1; }
      if (pbr.baseColorTexture) {
        if (!image) { image = imageFrom(json, bin, pbr.baseColorTexture.index); imageMat = prim.material; wrap = wrapFrom(json, pbr.baseColorTexture.index); }
        else if (imageMat !== prim.material) warnings.push('複数のテクスチャがあります。最初のテクスチャだけを使います(1枚にまとめて書き出してください)');
      }
    }
  };

  const walk = (ni, parent, seen) => {
    const n = json.nodes[ni];
    if (!n || seen.has(ni)) return;
    seen.add(ni);
    const M = mul4(parent, nodeMatrix(n));
    if (n.mesh !== undefined && json.meshes && json.meshes[n.mesh]) for (const p of json.meshes[n.mesh].primitives || []) addPrimitive(p, M);
    for (const c of n.children || []) walk(c, M, seen);
  };
  const seen = new Set();
  if (json.scenes && json.scenes.length) {
    for (const ni of (json.scenes[json.scene || 0] || json.scenes[0]).nodes || []) walk(ni, IDENT4, seen);
  } else if (json.nodes) {
    const child = new Set(json.nodes.flatMap((n) => n.children || []));
    json.nodes.forEach((_, i) => { if (!child.has(i)) walk(i, IDENT4, seen); });
  }
  if (!I.length) throw new GlbError('GLBに三角形メッシュがありません');

  const positions = Float32Array.from(P), normals = Float32Array.from(N), uvs = Float32Array.from(U), indices = Uint32Array.from(I);
  if (anyNormalsMissing) computeNormals(positions, normals, indices);
  // テクスチャ付きと無しのプリミティブが混在していれば、無しの三角形を「貼らない面」として返す(plain: 三角形ごとに 0/1、plainColor: その色)
  let plain = null, plainColor = null;
  // テクスチャが無いGLBでも、材質名が Plain のプリミティブ(BodyBuilder の書き出し)は「貼らない面」(服を重ねない面)として返す
  if (image && triRanges.some((r) => !r.tex) && triRanges.some((r) => r.tex)) {
    plain = new Uint8Array(I.length / 3);
    for (const r of triRanges) if (!r.tex) { plain.fill(1, r.t0, r.t1); plainColor = plainColor || r.color; }
  } else if (!image && triRanges.some((r) => r.named)) {
    plain = new Uint8Array(I.length / 3);
    for (const r of triRanges) if (r.named) { plain.fill(1, r.t0, r.t1); plainColor = plainColor || r.color; }
  }
  return { positions, normals, uvs, indices, bbox: bboxOf(positions), image, color, alpha, wrap, plain, plainColor, warnings };
}

function bboxOf(p) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { if (p[i + k] < min[k]) min[k] = p[i + k]; if (p[i + k] > max[k]) max[k] = p[i + k]; }
  return { min, max };
}

/** 法線が無い(ゼロ)頂点だけ、面法線の合算で埋める */
function computeNormals(pos, nor, idx) {
  const acc = new Float32Array(nor.length);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    for (const o of [a, b, c]) { acc[o] += fx; acc[o + 1] += fy; acc[o + 2] += fz; }
  }
  for (let i = 0; i < nor.length; i += 3) {
    if (nor[i] || nor[i + 1] || nor[i + 2]) continue;
    const l = Math.hypot(acc[i], acc[i + 1], acc[i + 2]) || 1;
    nor[i] = acc[i] / l; nor[i + 1] = acc[i + 1] / l; nor[i + 2] = acc[i + 2] / l;
  }
}

/**
 * glTF空間 → Roblox空間(stud・正面-Z)へ頂点を変換して新しいジオメトリを返す(元は変更しない)。
 * 順序: 拡大(unit × scale) → 正面反転(flipFront: Y軸180°) → 回転(rotation: 度。X→Y→Zの順に回す) → 平行移動(offset: stud)
 * opts: { unit = 1/0.28(メートル→stud), scale = 1 | [x,y,z], flipFront = true, rotation = [0,0,0], offset = [0,0,0] }
 */
export function bakeTransform(g, opts = {}) {
  const unit = opts.unit ?? 1 / 0.28;
  const s = (Array.isArray(opts.scale) ? opts.scale : [opts.scale ?? 1, opts.scale ?? 1, opts.scale ?? 1]).map((v) => v * unit);
  const [rx, ry, rz] = (opts.rotation || [0, 0, 0]).map((d) => (d * Math.PI) / 180);
  const off = opts.offset || [0, 0, 0];
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
  // R = Rz * Ry * Rx
  const R = [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
    sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
    -sy, cy * sx, cy * cx];
  const flip = opts.flipFront === false ? 1 : -1; // Y軸180°回転 = x,z の符号反転
  const mir = s[0] * s[1] * s[2] < 0;
  const rot = (x, y, z) => [R[0] * x + R[1] * y + R[2] * z, R[3] * x + R[4] * y + R[5] * z, R[6] * x + R[7] * y + R[8] * z];
  const positions = new Float32Array(g.positions.length), normals = new Float32Array(g.normals.length);
  for (let i = 0; i < positions.length; i += 3) {
    const p = rot(g.positions[i] * s[0] * flip, g.positions[i + 1] * s[1], g.positions[i + 2] * s[2] * flip);
    positions[i] = p[0] + off[0]; positions[i + 1] = p[1] + off[1]; positions[i + 2] = p[2] + off[2];
    const n = rot((g.normals[i] / s[0]) * flip, g.normals[i + 1] / s[1], (g.normals[i + 2] / s[2]) * flip);
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    normals[i] = n[0] / l; normals[i + 1] = n[1] / l; normals[i + 2] = n[2] / l;
  }
  let indices = g.indices;
  if (mir) { indices = Uint32Array.from(g.indices); for (let i = 0; i + 2 < indices.length; i += 3) { const t = indices[i + 1]; indices[i + 1] = indices[i + 2]; indices[i + 2] = t; } }
  return { positions, normals, uvs: g.uvs, indices, bbox: bboxOf(positions), plain: g.plain || null };
}
