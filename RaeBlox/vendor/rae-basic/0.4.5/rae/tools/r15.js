// R15のボディパーツ(上腕・前腕・手 など複数のMeshPart)を、R6の1パーツ分のジオメトリへ組み立てる。THREE非依存。
//
// R15の各MeshPartは、関節位置を示す RigAttachment(例: RightElbowRigAttachment)を子に持つ。
// 親側と子側で同じ名前のアタッチメントが同じ点で重なる(Motor6Dと同じ関係)ので、
//     T_child = T_parent · A_parent(att) · A_child(att)⁻¹
// で各パーツの位置・向きが決まる。アタッチメントが無いアセットは、ファイル内のCFrame(組み立て済みの姿勢)で代用する。
// 座標は stud・Roblox座標(Y上・正面 -Z)。メッシュは「bbox中心を原点に、Sizeへ拡縮」(頭の取り込みと同じ規則)。
import { parseAssetUri } from '../src/rbx/accessory.js';

const IDENT = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const nm = (i) => (i.props.Name !== undefined ? i.props.Name : i.className);

// ── CFrame { pos:[x,y,z], rot:[9個(行優先)] } ──
const mulM = (a, b) => { const o = new Array(9); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]; return o; };
const mulV = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const tr = (m) => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
export const cfMul = (a, b) => { const p = mulV(a.rot, b.pos); return { rot: mulM(a.rot, b.rot), pos: [p[0] + a.pos[0], p[1] + a.pos[1], p[2] + a.pos[2]] }; };
export const cfInv = (a) => { const r = tr(a.rot), p = mulV(r, a.pos); return { rot: r, pos: [-p[0], -p[1], -p[2]] }; };
export const cfIdent = () => ({ rot: IDENT.slice(), pos: [0, 0, 0] });
const asCF = (c) => (c && c.pos ? { pos: c.pos, rot: c.rot || IDENT } : null);

/** 部位ごとの構成。parts は根(root)から順に、joints は [親, 子, 共通のアタッチメント名] */
const side = (S, s) => ({
  [`${s} Arm`]: { parts: [`${S}UpperArm`, `${S}LowerArm`, `${S}Hand`], joints: [[`${S}UpperArm`, `${S}LowerArm`, `${S}ElbowRigAttachment`], [`${S}LowerArm`, `${S}Hand`, `${S}WristRigAttachment`]] },
  [`${s} Leg`]: { parts: [`${S}UpperLeg`, `${S}LowerLeg`, `${S}Foot`], joints: [[`${S}UpperLeg`, `${S}LowerLeg`, `${S}KneeRigAttachment`], [`${S}LowerLeg`, `${S}Foot`, `${S}AnkleRigAttachment`]] },
});
export const R15_CHAINS = {
  Torso: { parts: ['LowerTorso', 'UpperTorso'], joints: [['LowerTorso', 'UpperTorso', 'WaistRigAttachment']] },
  ...side('Right', 'Right'), ...side('Left', 'Left'),
};
const ALL_NAMES = new Set(Object.values(R15_CHAINS).flatMap((c) => c.parts));

/** R6の各パーツの標準サイズ(stud) */
export const R6_SIZE = { Head: [1.25, 1.25, 1.25], Torso: [2, 2, 1], 'Left Arm': [1, 2, 1], 'Right Arm': [1, 2, 1], 'Left Leg': [1, 2, 1], 'Right Leg': [1, 2, 1] };

const inFolder = (inst, names) => { for (let p = inst.parent; p; p = p.parent) if (names.includes(nm(p))) return true; return false; };
const colorOf = (p) => { const c = p.Color3uint8 || p.Color3 || p.Color; return Array.isArray(c) && c.length === 3 ? (c.some((v) => v > 1.0001) ? c.map((v) => v / 255) : c) : null; };

function readR15Part(inst) {
  const p = inst.props;
  const info = { name: nm(inst), size: p.Size || [1, 1, 1], color: colorOf(p), transparency: p.Transparency || 0, meshUri: null, textureUri: null, cframe: asCF(p.CFrame), attachments: {} };
  if (inst.className === 'MeshPart') { info.meshUri = p.MeshId || p.MeshContent || null; info.textureUri = p.TextureID || p.TextureId || p.TextureContent || null; }
  else { const sm = inst.children.find((c) => c.className === 'SpecialMesh'); if (sm) { info.meshUri = sm.props.MeshId || sm.props.MeshContent || null; info.textureUri = sm.props.TextureId || sm.props.TextureID || sm.props.TextureContent || null; } }
  if (!info.textureUri) { const sa = inst.children.find((c) => c.className === 'SurfaceAppearance'); if (sa) info.textureUri = sa.props.ColorMap || sa.props.ColorMapContent || null; }
  for (const a of inst.children) if (a.className === 'Attachment') { const cf = asCF(a.props.CFrame); info.attachments[nm(a)] = cf || cfIdent(); }
  return info;
}

/**
 * パース済みrbxmツリーから、R15のボディパーツを名前で集める。同名が複数ある場合の優先は R15Fixed > フォルダ外 > R15ArtistIntent(R6フォルダは無視)。
 * @returns Map<名前, info>  info = { name, size, color, transparency, meshUri, textureUri, cframe, attachments }
 */
export function extractR15Parts(tree) {
  const rank = (i) => (inFolder(i, ['R15Fixed']) ? 0 : inFolder(i, ['R15ArtistIntent']) ? 2 : 1);
  const best = new Map();
  for (const i of tree.instances.values()) {
    if (!/Part$/.test(i.className) || !ALL_NAMES.has(nm(i)) || inFolder(i, ['R6'])) continue;
    const cur = best.get(nm(i));
    if (!cur || rank(i) < rank(cur)) best.set(nm(i), i);
  }
  const out = new Map();
  for (const [k, i] of best) { const info = readR15Part(i); if (parseAssetUri(info.meshUri)) out.set(k, info); }
  return out;
}

/** この parts に含まれる、組み立て可能な部位名(根のパーツがあるもの) */
export const slotsIn = (parts) => Object.keys(R15_CHAINS).filter((s) => parts.has(R15_CHAINS[s].parts[0]));

/**
 * 部位の組み立て計画 → [{ name, info, T }](T = 根パーツ座標系での各パーツの位置・向き)。
 * アタッチメントで決められない関節があれば、ファイル内のCFrameで代用し、それも無ければ例外。
 */
export function planChain(slot, parts) {
  const ch = R15_CHAINS[slot];
  if (!ch) throw new Error(`未対応の部位: ${slot}`);
  const root = ch.parts[0];
  if (!parts.has(root)) throw new Error(`${slot}: 根のパーツ ${root} がありません`);
  const T = new Map([[root, cfIdent()]]);
  let viaAttachments = true;
  for (const [p, c, att] of ch.joints) {
    if (!parts.has(c) || !T.has(p)) continue;
    const A = parts.get(p).attachments[att], B = parts.get(c).attachments[att];
    if (!A || !B) { viaAttachments = false; break; }
    T.set(c, cfMul(cfMul(T.get(p), A), cfInv(B)));
  }
  if (!viaAttachments) { // CFrame(組み立て済みの姿勢)で代用
    const rc = parts.get(root).cframe, ok = ch.parts.every((n) => !parts.has(n) || parts.get(n).cframe);
    const cfs = ch.parts.filter((n) => parts.has(n)).map((n) => parts.get(n).cframe);
    const distinct = cfs.length > 1 && cfs.some((c) => c && rc && c.pos.some((v, k) => Math.abs(v - rc.pos[k]) > 1e-3));
    if (!rc || !ok || !distinct) throw new Error(`${slot}: 関節のアタッチメント(RigAttachment)もCFrameも使えず、パーツをつなげられません`);
    T.clear();
    for (const n of ch.parts) if (parts.has(n)) T.set(n, cfMul(cfInv(rc), parts.get(n).cframe));
  }
  return ch.parts.filter((n) => T.has(n)).map((n) => ({ name: n, info: parts.get(n), T: T.get(n) }));
}

/** メッシュ1枚 → 根パーツ座標系のジオメトリ(bbox中心を原点にSizeへ拡縮 → T を適用)。Sizeが仮の(1,1,1)ならメッシュの実寸を使う */
export function bakePiece(info, mesh, T) {
  const g = mesh, mn = g.bbox.min, mx = g.bbox.max, ext = [0, 1, 2].map((k) => mx[k] - mn[k] || 1);
  const size = info.size.every((v) => Math.abs(v - 1) < 1e-3) ? ext : info.size;
  const sc = [0, 1, 2].map((k) => (size[k] || ext[k]) / ext[k]);
  const n = g.positions.length / 3, pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const p = [0, 1, 2].map((k) => (g.positions[i * 3 + k] - (mn[k] + mx[k]) / 2) * sc[k]);
    const q = mulV(T.rot, p);
    for (let k = 0; k < 3; k++) pos[i * 3 + k] = q[k] + T.pos[k];
    const nn = mulV(T.rot, [0, 1, 2].map((k) => g.normals[i * 3 + k] / sc[k])), l = Math.hypot(...nn) || 1;
    for (let k = 0; k < 3; k++) nor[i * 3 + k] = nn[k] / l;
  }
  return { positions: pos, normals: nor, uvs: Float32Array.from(g.uvs), indices: Uint32Array.from(g.indices) };
}

/** 複数ジオメトリを1つにまとめる */
export function mergeGeometry(list) {
  let nv = 0, ni = 0;
  for (const g of list) { nv += g.positions.length / 3; ni += g.indices.length; }
  const positions = new Float32Array(nv * 3), normals = new Float32Array(nv * 3), uvs = new Float32Array(nv * 2), indices = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const g of list) {
    positions.set(g.positions, vo * 3); normals.set(g.normals, vo * 3); uvs.set(g.uvs, vo * 2);
    for (let i = 0; i < g.indices.length; i++) indices[io + i] = g.indices[i] + vo;
    vo += g.positions.length / 3; io += g.indices.length;
  }
  return withBBox({ positions, normals, uvs, indices });
}
export function withBBox(g) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < g.positions.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], g.positions[i + k]); max[k] = Math.max(max[k], g.positions[i + k]); }
  return { ...g, bbox: { min, max } };
}

/** UVを、cols×rows のアトラスの (col,row) 番目のセルへ縮める(複数テクスチャを1枚にまとめるとき) */
export function remapUVsToCell(uvs, col, row, cols, rows) {
  const o = new Float32Array(uvs.length);
  for (let i = 0; i < uvs.length; i += 2) { o[i] = (col + uvs[i]) / cols; o[i + 1] = (row + uvs[i + 1]) / rows; }
  return o;
}

/**
 * R6のパーツの大きさへ合わせる(中心を原点に)。mode: 'stretch'=各軸をぴったり / 'uniform'=縦横比を保って枠に収める / 'none'=拡縮しない。
 * 法線は拡縮の逆数で補正する。
 */
export function fitToR6(g, slot, mode = 'stretch') {
  const target = R6_SIZE[slot];
  if (!target) throw new Error(`未対応の部位: ${slot}`);
  const mn = g.bbox.min, mx = g.bbox.max, ext = [0, 1, 2].map((k) => mx[k] - mn[k] || 1);
  let s = [1, 1, 1];
  if (mode === 'stretch') s = [0, 1, 2].map((k) => target[k] / ext[k]);
  else if (mode === 'uniform') { const u = Math.min(...[0, 1, 2].map((k) => target[k] / ext[k])); s = [u, u, u]; }
  const c = [0, 1, 2].map((k) => (mn[k] + mx[k]) / 2), n = g.positions.length / 3;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) pos[i * 3 + k] = (g.positions[i * 3 + k] - c[k]) * s[k];
    const v = [0, 1, 2].map((k) => g.normals[i * 3 + k] / s[k]), l = Math.hypot(...v) || 1;
    for (let k = 0; k < 3; k++) nor[i * 3 + k] = v[k] / l;
  }
  return withBBox({ positions: pos, normals: nor, uvs: g.uvs, indices: g.indices });
}
