// GLB(glTF 2.0 バイナリ)の書き出し。THREE非依存。RAE の独自ボディパーツ / アクセサリ用。
// 入力はRoblox空間(stud・Y上・正面-Z)のジオメトリ。出力は glTF空間(メートル・正面+Z)で、
// RAE の既定設定(unit = 1/0.28, flipFront = true)で読み込むと、元の位置・大きさ・向きにそのまま戻る。
//
//   g.plain(Uint8Array、三角形ごとに 1)があると、その三角形はテクスチャなしの別プリミティブ(色 opts.plainColor)として書き出す。
//   const glb = writeGlb({ positions, normals, uvs, indices }, { image: { bytes, mime: 'image/png' }, color: [r,g,b], alpha, wrap: ['repeat','repeat'], name })
//   → ArrayBuffer

const WRAP_CODE = { repeat: 10497, clamp: 33071, mirror: 33648 };

/** opts: { plainColor?:[r,g,b](0..1)、image?:{bytes:Uint8Array,mime}, color?:[r,g,b](0..1), alpha=1, wrap=['repeat','repeat'], name, unit=1/0.28(1mあたりのstud数), flipFront=true } */
export function writeGlb(g, opts = {}) {
  const unit = opts.unit ?? 1 / 0.28, meter = 1 / unit;
  const flip = opts.flipFront === false ? 1 : -1;
  const n = g.positions.length / 3;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    const p = [g.positions[i * 3] * flip * meter, g.positions[i * 3 + 1] * meter, g.positions[i * 3 + 2] * flip * meter];
    for (let k = 0; k < 3; k++) { pos[i * 3 + k] = p[k]; if (p[k] < mn[k]) mn[k] = p[k]; if (p[k] > mx[k]) mx[k] = p[k]; }
    nor[i * 3] = g.normals[i * 3] * flip; nor[i * 3 + 1] = g.normals[i * 3 + 1]; nor[i * 3 + 2] = g.normals[i * 3 + 2] * flip;
  }
  const uv = Float32Array.from(g.uvs);
  const big = n > 65535;
  const tris = g.indices.length / 3;
  let nPlain = 0;
  if (g.plain) for (let t = 0; t < tris; t++) if (g.plain[t]) nPlain++;
  const useImage = !!opts.image && nPlain < tris; // 全部が「貼らない」ならテクスチャは不要
  const split = nPlain > 0 && nPlain < tris; // テクスチャが無くても、貼らない面(クラシック服を重ねない面)は別プリミティブ(材質名 Plain)として残す
  const tex = [], pln = [];
  for (let t = 0; t < tris; t++) (split && g.plain[t] ? pln : tex).push(g.indices[t * 3], g.indices[t * 3 + 1], g.indices[t * 3 + 2]);
  const mkIdx = (a) => (big ? Uint32Array.from(a) : Uint16Array.from(a));
  const idx = mkIdx(split ? tex : g.indices), idx2 = split ? mkIdx(pln) : null;

  const chunks = []; // { bytes:Uint8Array, target? }
  const views = [], accessors = [];
  let off = 0;
  const addView = (bytes, target) => {
    const pad = (4 - (off % 4)) % 4; off += pad;
    views.push({ buffer: 0, byteOffset: off, byteLength: bytes.byteLength, ...(target ? { target } : {}) });
    chunks.push({ at: off, bytes });
    off += bytes.byteLength;
    return views.length - 1;
  };
  const bPos = addView(new Uint8Array(pos.buffer), 34962), bNor = addView(new Uint8Array(nor.buffer), 34962), bUv = addView(new Uint8Array(uv.buffer), 34962);
  const bIdx = addView(new Uint8Array(idx.buffer, idx.byteOffset, idx.byteLength), 34963);
  accessors.push({ bufferView: bPos, componentType: 5126, count: n, type: 'VEC3', min: mn, max: mx });
  accessors.push({ bufferView: bNor, componentType: 5126, count: n, type: 'VEC3' });
  accessors.push({ bufferView: bUv, componentType: 5126, count: n, type: 'VEC2' });
  accessors.push({ bufferView: bIdx, componentType: big ? 5125 : 5123, count: idx.length, type: 'SCALAR' });
  if (idx2) {
    const bIdx2 = addView(new Uint8Array(idx2.buffer, idx2.byteOffset, idx2.byteLength), 34963);
    accessors.push({ bufferView: bIdx2, componentType: big ? 5125 : 5123, count: idx2.length, type: 'SCALAR' });
  }

  const json = { asset: { version: '2.0', generator: 'RAE BodyBuilder' }, scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: opts.name || 'BodyPart' }],
    meshes: [{ name: opts.name || 'BodyPart', primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0, mode: 4 }] }] };
  if (idx2) json.meshes[0].primitives.push({ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 4, material: 1, mode: 4 });
  const alpha = opts.alpha ?? 1;
  const baseColor = (nPlain === tris && opts.plainColor) ? opts.plainColor : opts.color; // 全面「貼らない」なら、その色を基本色にする
  const pbr = { baseColorFactor: [...(baseColor || [1, 1, 1]).slice(0, 3), alpha], metallicFactor: 0, roughnessFactor: 0.8 };
  json.materials = [{ name: nPlain === tris && tris > 0 ? 'Plain' : 'Body', pbrMetallicRoughness: pbr, doubleSided: true, ...(alpha < 1 ? { alphaMode: 'BLEND' } : {}) }];
  if (idx2) json.materials.push({ name: 'Plain', pbrMetallicRoughness: { baseColorFactor: [...(opts.plainColor || opts.color || [1, 1, 1]).slice(0, 3), alpha], metallicFactor: 0, roughnessFactor: 0.8 }, doubleSided: true, ...(alpha < 1 ? { alphaMode: 'BLEND' } : {}) });
  if (useImage) {
    const bImg = addView(opts.image.bytes);
    json.images = [{ bufferView: bImg, mimeType: opts.image.mime || 'image/png' }];
    const w = opts.wrap || ['repeat', 'repeat'];
    json.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: WRAP_CODE[w[0]] || 10497, wrapT: WRAP_CODE[w[1]] || 10497 }];
    json.textures = [{ source: 0, sampler: 0 }];
    pbr.baseColorTexture = { index: 0 };
    pbr.baseColorFactor = [1, 1, 1, alpha];
  }
  json.bufferViews = views; json.accessors = accessors;
  json.buffers = [{ byteLength: (off + 3) & ~3 }];

  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = (jsonBytes.length + 3) & ~3, binLen = (off + 3) & ~3;
  const total = 12 + 8 + jsonLen + 8 + binLen;
  const out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true); dv.setUint32(16, 0x4e4f534a, true);
  out.fill(0x20, 20, 20 + jsonLen); out.set(jsonBytes, 20); // JSONチャンクの余白は空白で埋める
  const b0 = 20 + jsonLen;
  dv.setUint32(b0, binLen, true); dv.setUint32(b0 + 4, 0x004e4942, true);
  for (const c of chunks) out.set(c.bytes, b0 + 8 + c.at);
  return out.buffer;
}
