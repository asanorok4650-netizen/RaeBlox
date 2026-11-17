// R6アバターのパーツ組み立て: 記述子(descriptor)→ THREE.Group
// リグの6パーツ(Head/Torso/腕/脚)を BodyColors・クラシック服・顔で組み上げる。独自ボディパーツ(GLB)で個別に差し替え可能。
import * as THREE from 'three';
import { normalizeUV, isIdentityUV, uvAffine } from './uv.js';
import { layoutR6, faceRectsFor, clothLayers, clothProjection, CLOTH_RECTS, TEMPLATE, bodyAttachPoint } from './rigs.js';

/** 角を丸めたBox(R6のHeadの近似)。法線は解析的に求めて継ぎ目を消す。 */
function roundedBoxGeometry(size, radius) {
  const [w, h, d] = size;
  const geo = new THREE.BoxGeometry(w, h, d, 8, 8, 8);
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const inner = new THREE.Vector3(w / 2 - radius, h / 2 - radius, d / 2 - radius);
  const p = new THREE.Vector3(), q = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    q.set(Math.max(-inner.x, Math.min(inner.x, p.x)), Math.max(-inner.y, Math.min(inner.y, p.y)),
      Math.max(-inner.z, Math.min(inner.z, p.z)));
    n.copy(p).sub(q);
    const len = n.length();
    if (len > 1e-6) { n.divideScalar(len); p.copy(q).addScaledVector(n, radius); } else { n.fromBufferAttribute(nor, i); }
    pos.setXYZ(i, p.x, p.y, p.z);
    nor.setXYZ(i, n.x, n.y, n.z);
  }
  return geo;
}

/** BoxGeometry(分割1)のUVを、服テンプレートの矩形に差し替える。 */
function remapBoxUV(geo, faceRects) {
  const uv = geo.attributes.uv;
  for (let f = 0; f < 6; f++) {
    const r = faceRects[f];
    for (let i = 0; i < 4; i++) {
      const idx = f * 4 + i;
      let u = uv.getX(idx);
      let v = uv.getY(idx);
      // top/bottom は three側の向きとテンプレートの向きが180°回転の関係(正面が上下逆)なので u・v とも反転
      if (f === 2 || f === 3) { u = 1 - u; v = 1 - v; }
      uv.setXY(idx, (r[0] + u * r[2]) / TEMPLATE.w, 1 - (r[1] + (1 - v) * r[3]) / TEMPLATE.h);
    }
  }
  uv.needsUpdate = true;
}

function newTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}


/** ボディカラーで塗ったテンプレートの上に、パンツ→シャツ→Tシャツの順に重ねる。 */
function paintClothCanvas(colorHex, layers, clothing) {
  const c = document.createElement('canvas');
  c.width = TEMPLATE.w; c.height = TEMPLATE.h;
  const g = c.getContext('2d');
  if (colorHex) { g.fillStyle = colorHex; g.fillRect(0, 0, c.width, c.height); } // colorHex が無ければ透明のまま(独自パーツの上に重ねる用)
  for (const L of layers) {
    const img = clothing[L];
    if (!img) continue;
    if (L === 'tshirt') { const r = CLOTH_RECTS.torso.front; g.drawImage(img, r[0], r[1], r[2], r[3]); }
    else g.drawImage(img, 0, 0, c.width, c.height);
  }
  return c;
}

/** 既定の顔(にっこり)。カスタムの顔が無い場合に使う。 */
function defaultFaceCanvas() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#1b1b1b';
  g.beginPath(); g.ellipse(88, 98, 12, 20, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(168, 98, 12, 20, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#1b1b1b'; g.lineWidth = 10; g.lineCap = 'round';
  g.beginPath(); g.arc(128, 128, 62, Math.PI * 0.18, Math.PI * 0.82); g.stroke();
  return c;
}

function faceCanvasFrom(bitmap) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  c.getContext('2d').drawImage(bitmap, 0, 0, 256, 256);
  return c;
}

/**
 * アクセサリ1点をメッシュ化して、ボディのアタッチメントに合わせて配置する。
 * Handle側アタッチメントとボディ側アタッチメントを一致させる: M = T(bodyPos) * inverse(handleAttachCFrame)
 */
function buildAccessoryMesh(acc, layout) {
  const g = acc.geometry, h = acc.handle;
  const pos = new Float32Array(g.positions);
  if (h.kind === 'meshpart') { // MeshPart: バウンディングボックス中心を原点に、Sizeへ合わせて拡縮
    const mn = g.bbox.min, mx = g.bbox.max;
    for (let i = 0; i < pos.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const ext = mx[k] - mn[k] || 1;
        pos[i + k] = (pos[i + k] - (mn[k] + mx[k]) / 2) * ((h.size[k] || ext) / ext);
      }
    }
  } else { // SpecialMesh(FileMesh): 生の頂点 × Scale + Offset
    for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) pos[i + k] = pos[i + k] * h.scale[k] + h.offset[k];
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(g.normals), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.uvs), 2));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(g.indices), 1));

  let map = null;
  if (acc.texture) {
    map = new THREE.Texture(acc.texture); map.flipY = false; map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping; // RobloxはUVが0〜1の外でもテクスチャを繰り返す(Clampだと縁の色が引き伸ばされてズレて見える)
    map.needsUpdate = true;
  }
  const c = h.color;
  const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.8, side: THREE.DoubleSide,
    color: map || !c ? 0xffffff : new THREE.Color(c[0], c[1], c[2]),
    transparent: h.transparency > 0, opacity: 1 - (h.transparency || 0) });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = `Accessory: ${acc.name}`;

  const att = acc.attachment || { name: 'HatAttachment', pos: [0, 0, 0], rot: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
  const body = bodyAttachPoint(layout, att.name) || bodyAttachPoint(layout, 'HatAttachment');
  const R = att.rot, p = att.pos;
  const Rt = [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]]; // 転置 = 逆回転
  const inv = [-(Rt[0] * p[0] + Rt[1] * p[1] + Rt[2] * p[2]), -(Rt[3] * p[0] + Rt[4] * p[1] + Rt[5] * p[2]), -(Rt[6] * p[0] + Rt[7] * p[1] + Rt[8] * p[2])];
  mesh.matrixAutoUpdate = false;
  mesh.matrix.set(Rt[0], Rt[1], Rt[2], body.pos[0] + inv[0],
    Rt[3], Rt[4], Rt[5], body.pos[1] + inv[1],
    Rt[6], Rt[7], Rt[8], body.pos[2] + inv[2],
    0, 0, 0, 1);
  return { mesh, attachedTo: body.part };
}

const WRAP_CONST = () => ({ repeat: THREE.RepeatWrapping, clamp: THREE.ClampToEdgeWrapping, mirror: THREE.MirroredRepeatWrapping });

/**
 * テクスチャへUV変換(位置・拡大・回転・反転)と繰り返し方法を設定する。ジオメトリは触らないので、後からいつでも・再構築なしで変えられる。
 * uv: avatar/uv.js の形(null で変換なし) / wrap: 'repeat' | 'clamp' | 'mirror' または [s, t]
 */
export function applyTextureUV(tex, uv, wrap) {
  if (!tex) return;
  const W = WRAP_CONST(), w = Array.isArray(wrap) ? wrap : [wrap, wrap];
  const ws = W[w[0]] ?? W.repeat, wt = W[w[1]] ?? W.repeat;
  const wrapChanged = tex.wrapS !== ws || tex.wrapT !== wt;
  tex.wrapS = ws; tex.wrapT = wt;
  const n = normalizeUV(uv);
  if (n && !isIdentityUV(n)) {
    const { m, t } = uvAffine(n);
    tex.matrixAutoUpdate = false;
    tex.matrix.set(m[0], m[1], t[0], m[2], m[3], t[1], 0, 0, 1); // uv' = M·uv + t(three の texture.matrix は uv' = matrix · (u, v, 1))
  } else if (tex.matrix) { tex.matrixAutoUpdate = true; tex.matrix.identity && tex.matrix.identity(); }
  if (wrapChanged) tex.needsUpdate = true; // 繰り返し方法を変えたときだけ再アップロード(UVの位置・拡大は行列だけなので不要)
}

/** Robloxの頭のテクスチャ用: ボディカラーの上にテクスチャを重ねる(透明部分が黒くならないように)。UVは v=0 が画像の上(flipY=false) */
function textureOverColor(img, colorHex) {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d');
  g.fillStyle = colorHex;
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0);
  const t = newTexture(c);
  t.flipY = false;
  return t;
}

/** 顔の板。頭のメッシュの手前に貼る。 */
function faceMesh(width, canvas) {
  const fs = width * 0.62;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(fs, fs),
    new THREE.MeshBasicMaterial({ map: newTexture(canvas), transparent: true, polygonOffset: true, polygonOffsetFactor: -2 }));
  face.name = 'Face';
  face.rotation.y = Math.PI; // 正面(-Z)へ向ける
  return face;
}

/**
 * 独自ボディパーツ(GLBなど)を、そのパーツの座標系(原点=パーツ中心)でメッシュ化する。
 * cp = { geometry, texture, color, transparency, face, uv?(テクスチャの位置・拡大), wrap?, overColor? }。関節ノードの子になるので、アニメーションにそのまま追従する。
 */
const pc0 = (cp, c, colorHex) => { const q = cp.plainColor || c; return q ? new THREE.Color(q[0], q[1], q[2]) : new THREE.Color(colorHex); };
/**
 * 独自パーツの上にクラシック服(シャツ/パンツ/Tシャツ)を重ねる。GLBのUVは独自なので、服テンプレートへは位置からの箱投影で貼る(rigs.js clothProjection)。
 * 服の無い所は透明なので、元のテクスチャ・色がそのまま見える。貼らない面(cp.plain=投げ縄)には服を貼らない。cp.clothing === false で無効、cp.clothFit === 'standard' でR6標準サイズの箱(def.size)に合わせて投影。
 */
function buildClothOverlay(def, cp, clothing) {
  if (!def.cloth || cp.clothing === false || !clothing) return null;
  const layers = clothLayers(def.cloth).filter((L) => clothing[L]);
  if (!layers.length) return null;
  const g = cp.geometry;
  const half = def.size.map((v) => v / 2);
  const box = cp.clothFit === 'standard' ? { min: half.map((v) => -v), max: half } : null;
  const pr = clothProjection(g, def.cloth, box, cp.plain); // 投げ縄で「貼らない」にした三角形(cp.plain)には服も貼らない
  if (!pr.positions.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pr.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(pr.normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(pr.uvs, 2));
  const tex = newTexture(paintClothCanvas(null, clothLayers(def.cloth), clothing));
  tex.flipY = false; // 投影UVは v=0 が画像の上
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, side: THREE.DoubleSide, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, opacity: 1 - (cp.transparency || 0) });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'ClothingOverlay';
  mesh.renderOrder = 1;
  return mesh;
}

function buildCustomPart(def, cp, colorHex, faceBitmap, clothing) {
  const g = cp.geometry;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(g.positions), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(g.normals), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.uvs), 2));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(g.indices), 1));
  let map = null;
  if (cp.texture && cp.overColor) map = textureOverColor(cp.texture, colorHex);
  else if (cp.texture) { map = new THREE.Texture(cp.texture); map.flipY = false; map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping; map.needsUpdate = true; }
  if (map && (cp.uv || cp.wrap)) applyTextureUV(map, cp.uv, cp.wrap || 'repeat');
  const c = cp.color;
  const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.8, side: THREE.DoubleSide,
    color: map ? 0xffffff : (c ? new THREE.Color(c[0], c[1], c[2]) : colorHex),
    transparent: cp.transparency > 0, opacity: 1 - (cp.transparency || 0) });
  // 貼らない面(cp.plain)があるときは、三角形を「テクスチャあり → なし」の順に並べ、グループで別マテリアル(単色)にする
  let material = mat;
  const plain = cp.plain, nTri = g.indices.length / 3;
  if (plain && plain.length >= nTri) {
    const a = [], p = [];
    for (let t = 0; t < nTri; t++) (plain[t] ? p : a).push(g.indices[t * 3], g.indices[t * 3 + 1], g.indices[t * 3 + 2]);
    if (p.length && a.length) {
      geo.setIndex(new THREE.BufferAttribute(new Uint32Array([...a, ...p]), 1));
      geo.addGroup(0, a.length, 0); geo.addGroup(a.length, p.length, 1);
      const pc = cp.plainColor || c;
      material = [mat, new THREE.MeshStandardMaterial({ roughness: 0.8, side: THREE.DoubleSide, color: pc ? new THREE.Color(pc[0], pc[1], pc[2]) : colorHex, transparent: cp.transparency > 0, opacity: 1 - (cp.transparency || 0) })];
    } else if (p.length && !a.length) { mat.map = null; mat.color = pc0(cp, c, colorHex); }
  }
  const mesh = new THREE.Mesh(geo, material);
  const overlay = buildClothOverlay(def, cp, clothing);
  if (overlay) mesh.add(overlay);
  if (cp.transparency >= 0.99) mesh.visible = false; // ヘッドレスなど
  if (def.shape === 'head' && cp.face && !(cp.transparency >= 0.99)) { // 顔の板は、指定したときだけ付ける(顔入りテクスチャの頭には不要)
    const { min, max } = g.bbox;
    const face = faceMesh(max[0] - min[0], faceBitmap ? faceCanvasFrom(faceBitmap) : defaultFaceCanvas());
    face.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, min[2] - 0.004);
    mesh.add(face);
  }
  return mesh;
}

/**
 * @param desc { colors:{head,torso,leftArm,rightArm,leftLeg,rightLeg}, clothing:{shirt,pants,tshirt}(ImageBitmap|Canvas|null),
 *               face:(ImageBitmap|Canvas|null), accessories:[], customParts:{ 'Head'|'Torso'|'Left Arm'|… : cp } }
 * 常にR6。
 */
export function buildAvatar(desc) {
  const group = new THREE.Group();
  group.name = 'Avatar_R6';
  const clothing = desc.clothing || {};
  const custom = desc.customParts || {};
  const parts = [];
  const layout = layoutR6();
  for (const def of layout) {
    const colorHex = (desc.colors && desc.colors[def.color]) || '#A3A2A5';
    const cp = custom[def.name];
    const isCustom = !!(cp && cp.geometry);
    let mesh;
    if (isCustom) {
      mesh = buildCustomPart(def, cp, colorHex, desc.face, clothing);
    } else if (def.shape === 'head') {
      mesh = new THREE.Mesh(roundedBoxGeometry(def.size, 0.22 * def.size[0] / 1.25), new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.75 }));
      const face = faceMesh(def.size[0], desc.face ? faceCanvasFrom(desc.face) : defaultFaceCanvas());
      face.position.z = -(def.size[2] / 2) - 0.004;
      mesh.add(face);
    } else {
      const geo = new THREE.BoxGeometry(def.size[0], def.size[1], def.size[2]);
      const usable = def.cloth ? clothLayers(def.cloth).filter((L) => clothing[L]) : [];
      let mat;
      if (usable.length) {
        remapBoxUV(geo, faceRectsFor(def.cloth));
        mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, map: newTexture(paintClothCanvas(colorHex, clothLayers(def.cloth), clothing)) });
      } else {
        mat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.75 });
      }
      mesh = new THREE.Mesh(geo, mat);
    }
    mesh.name = def.name;
    mesh.position.set(def.center[0], def.center[1], def.center[2]);
    group.add(mesh);
    parts.push({ name: def.name, object: mesh });
  }
  const bodyBox = new THREE.Box3().setFromObject(group); // ボディ(独自パーツ込み・アクセサリ除く)。足元の基準
  for (const acc of desc.accessories || []) {
    try {
      const { mesh, attachedTo } = buildAccessoryMesh(acc, layout);
      group.add(mesh);
      parts.push({ name: acc.name, object: mesh, accessory: true, attachedTo });
    } catch (e) {
      parts.push({ name: acc.name, object: new THREE.Group(), accessory: true, error: e.message });
    }
  }
  const box = new THREE.Box3().setFromObject(group);
  return { group, parts, box, bodyBox, layout, report: desc.report || [], desc };
}

export function disposeObject(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); }
  });
}
