// R6リグ(パーツ構成)定義。THREE非依存の純粋ロジックのみ。このエンジンはR6専用。
// 座標系はRoblox準拠: Y上、足裏がy=0、キャラの正面は -Z、右手は +X。単位はstud。

// ---- クラシック服テンプレート(585x559)の各面の矩形 [x, y, w, h] ----
export const TEMPLATE = { w: 585, h: 559 };
const TORSO_RECTS = {
  front: [231, 74, 128, 128], back: [427, 74, 128, 128],
  right: [165, 74, 64, 128], left: [361, 74, 64, 128],
  top: [231, 8, 128, 64], bottom: [231, 204, 128, 64],
};
const RIGHT_LIMB_RECTS = { // アバターの右腕/右脚(画像の左側)
  top: [217, 289, 64, 64], bottom: [217, 483, 64, 64],
  front: [217, 355, 64, 128], right: [151, 355, 64, 128],
  back: [85, 355, 64, 128], left: [19, 355, 64, 128],
};
const LEFT_LIMB_RECTS = { // アバターの左腕/左脚(画像の右側)
  top: [308, 289, 64, 64], bottom: [308, 483, 64, 64],
  front: [308, 355, 64, 128], left: [374, 355, 64, 128],
  back: [440, 355, 64, 128], right: [506, 355, 64, 128],
};
export const CLOTH_RECTS = { torso: TORSO_RECTS, rLimb: RIGHT_LIMB_RECTS, lLimb: LEFT_LIMB_RECTS };

// BoxGeometryの面順(+x,-x,+y,-y,+z,-z) = Roblox面名
export const FACE_ORDER = ['right', 'left', 'top', 'bottom', 'back', 'front'];

// 服の貼り付け対象。layers: どの服を重ねるか
const CLOTH_GROUPS = {
  torso: { rects: 'torso', layers: ['pants', 'shirt', 'tshirt'] },
  lArm: { rects: 'lLimb', layers: ['shirt'] },
  rArm: { rects: 'rLimb', layers: ['shirt'] },
  lLeg: { rects: 'lLimb', layers: ['pants'] },
  rLeg: { rects: 'rLimb', layers: ['pants'] },
};

/** パーツの面ごとのUV矩形(FACE_ORDER順)。R6のパーツはテンプレートの矩形をそのまま使う。 */
export function faceRectsFor(clothKey) {
  const R = CLOTH_RECTS[CLOTH_GROUPS[clothKey].rects];
  return FACE_ORDER.map((n) => R[n]);
}
export function clothLayers(clothKey) { return CLOTH_GROUPS[clothKey].layers; }

/**
 * 独自メッシュ(UVが自由なGLBなど)にクラシック服を貼るための「箱投影」。THREE非依存。
 * 三角形ごとに、法線がいちばん向いている軸(±X/±Y/±Z)を選び、その面の服テンプレート矩形へメッシュの位置から直接UVを割り当てる(三角形は面をまたがない)。
 * 面の向きはRobloxのクラシック服と同じ: 正面(-Z)は +X が画像の左、背面(+Z)は +X が右、右面(+X)は -Z が右、左面(-X)は +Z が右、
 * 上面は -X が右・+Z が画像の上、下面は -X が右・-Z が画像の上。
 * @param g { positions, normals, indices, bbox:{min,max} }(stud・パーツ中心が原点)
 * @param clothKey 'torso' | 'lArm' | 'rArm' | 'lLeg' | 'rLeg'
 * @param box 投影する直方体 { min:[x,y,z], max:[x,y,z] }。省略時はメッシュのbbox(服がパーツ全体にぴったり広がる)
 * @param skip 三角形ごとの除外フラグ(1=その三角形は服を貼らない。投げ縄で「貼らない」にした面)。省略可
 * @returns 三角形ごとに頂点を分けた { positions, normals, uvs }(uvは v=0 が画像の上 = flipY=false のテクスチャ用)
 */
export function clothProjection(g, clothKey, box, skip) {
  const R = CLOTH_RECTS[CLOTH_GROUPS[clothKey].rects];
  const mn = (box || g.bbox).min, mx = (box || g.bbox).max;
  const ext = [0, 1, 2].map((k) => (mx[k] - mn[k]) || 1);
  const P = g.positions, N = g.normals, I = g.indices, nTall = I.length / 3;
  const use = [];
  for (let t = 0; t < nTall; t++) if (!(skip && skip.length >= nTall && skip[t])) use.push(t);
  const nT = use.length;
  const positions = new Float32Array(nT * 9), normals = new Float32Array(nT * 9), uvs = new Float32Array(nT * 6);
  for (let k = 0; k < nT; k++) {
    const t = use[k];
    const v3 = [I[t * 3], I[t * 3 + 1], I[t * 3 + 2]];
    // 面の向き: 頂点法線の平均(巻き方向に左右されない)。ほぼ0なら位置から求めた法線
    let nx = 0, ny = 0, nz = 0;
    for (const v of v3) { nx += N[v * 3]; ny += N[v * 3 + 1]; nz += N[v * 3 + 2]; }
    if (Math.hypot(nx, ny, nz) < 1e-6) {
      const a = v3.map((v) => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]);
      const e1 = [a[1][0] - a[0][0], a[1][1] - a[0][1], a[1][2] - a[0][2]], e2 = [a[2][0] - a[0][0], a[2][1] - a[0][1], a[2][2] - a[0][2]];
      nx = e1[1] * e2[2] - e1[2] * e2[1]; ny = e1[2] * e2[0] - e1[0] * e2[2]; nz = e1[0] * e2[1] - e1[1] * e2[0];
    }
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    let face;
    if (ax >= ay && ax >= az) face = nx > 0 ? 'right' : 'left';
    else if (ay >= az) face = ny > 0 ? 'top' : 'bottom';
    else face = nz > 0 ? 'back' : 'front';
    const r = R[face];
    for (let c = 0; c < 3; c++) {
      const v = v3[c], x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
      const fx = (x - mn[0]) / ext[0], fy = (y - mn[1]) / ext[1], fz = (z - mn[2]) / ext[2]; // 0〜1
      let s, u; // s: 矩形内の横(右が+)、u: 縦(下が+)
      switch (face) {
        case 'front': s = 1 - fx; u = 1 - fy; break;
        case 'back': s = fx; u = 1 - fy; break;
        case 'right': s = 1 - fz; u = 1 - fy; break;
        case 'left': s = fz; u = 1 - fy; break;
        case 'top': s = 1 - fx; u = 1 - fz; break;
        default: s = 1 - fx; u = fz; break; // bottom
      }
      s = Math.min(1, Math.max(0, s)); u = Math.min(1, Math.max(0, u));
      const o = k * 3 + c;
      positions[o * 3] = x; positions[o * 3 + 1] = y; positions[o * 3 + 2] = z;
      normals[o * 3] = N[v * 3]; normals[o * 3 + 1] = N[v * 3 + 1]; normals[o * 3 + 2] = N[v * 3 + 2];
      uvs[o * 2] = (r[0] + s * r[2]) / TEMPLATE.w; uvs[o * 2 + 1] = (r[1] + u * r[3]) / TEMPLATE.h;
    }
  }
  return { positions, normals, uvs };
}

// ---- R6 ----
export function layoutR6() {
  const P = (name, color, size, center, cloth, shape = 'box') => ({ name, color, size, center, cloth, shape });
  return [
    P('Head', 'head', [1.25, 1.25, 1.25], [0, 4.5, 0], null, 'head'),
    P('Torso', 'torso', [2, 2, 1], [0, 3, 0], 'torso'),
    P('Left Arm', 'leftArm', [1, 2, 1], [-1.5, 3, 0], 'lArm'),
    P('Right Arm', 'rightArm', [1, 2, 1], [1.5, 3, 0], 'rArm'),
    P('Left Leg', 'leftLeg', [1, 2, 1], [-0.5, 1, 0], 'lLeg'),
    P('Right Leg', 'rightLeg', [1, 2, 1], [0.5, 1, 0], 'rLeg'),
  ];
}

// ---- ボディ側アタッチメント(アクセサリの取り付け先) ----
// [パーツ名, パーツ中心からのオフセット(stud)]。※近似値(実際のR6リグの値で要確認)。
export const BODY_ATTACH = {
  HatAttachment: ['Head', [0, 0.6, 0]],
  HairAttachment: ['Head', [0, 0.6, 0]],
  FaceFrontAttachment: ['Head', [0, 0, -0.6]],
  FaceCenterAttachment: ['Head', [0, 0, 0]],
  NeckAttachment: ['Torso', [0, 1, 0]],
  BodyFrontAttachment: ['Torso', [0, 0, -0.5]],
  BodyBackAttachment: ['Torso', [0, 0, 0.5]],
  LeftCollarAttachment: ['Torso', [-1, 1, 0]],
  RightCollarAttachment: ['Torso', [1, 1, 0]],
  LeftShoulderAttachment: ['Left Arm', [0, 0.8, 0]],
  RightShoulderAttachment: ['Right Arm', [0, 0.8, 0]],
  WaistFrontAttachment: ['Torso', [0, -0.8, -0.5]],
  WaistBackAttachment: ['Torso', [0, -0.8, 0.5]],
  WaistCenterAttachment: ['Torso', [0, -0.8, 0]],
};

/** 取り付け先のワールド位置。layoutは layoutR6() の結果。見つからなければ null。 */
export function bodyAttachPoint(layout, attName) {
  const e = BODY_ATTACH[attName];
  if (!e) return null;
  const part = layout.find((p) => p.name === e[0]);
  if (!part) return null;
  return { part: e[0], pos: [part.center[0] + e[1][0], part.center[1] + e[1][1], part.center[2] + e[1][2]] };
}

// ---- BrickColor(ID→色) 主要色のみ。bodyColor3sがあればそちらを優先 ----
export const BRICK_HEX = {
  1: '#F2F3F3', 5: '#D7C59A', 9: '#E8BAC8', 18: '#CC8E69', 21: '#C4281C', 23: '#0D69AC', 24: '#F5CD30',
  26: '#1B2A35', 28: '#287F47', 37: '#4B974B', 38: '#A05F35', 45: '#B4D2E4', 101: '#DA867A', 102: '#6E99CA',
  104: '#6B327C', 105: '#E29B40', 106: '#DA8541', 119: '#A4BD47', 125: '#EAB892', 135: '#74869D',
  141: '#27462D', 192: '#694028', 194: '#A3A2A5', 199: '#635F62', 208: '#E5E4DF', 217: '#7C5C46',
  226: '#FDEA8D', 268: '#342B75', 292: '#7C9C6B', 306: '#9FC3E9', 308: '#3D1585', 1001: '#F8F8F8',
  1002: '#CDCDCD', 1003: '#111111', 1004: '#FF0000', 1005: '#FFAF00', 1006: '#B480FF', 1007: '#A34B4B',
  1008: '#C1BE42', 1009: '#FFFF00', 1010: '#0000FF', 1011: '#002060', 1012: '#2154B9', 1013: '#04AFEC',
  1014: '#AA5500', 1015: '#AA00AA', 1016: '#FF66CC', 1017: '#FFAF00', 1018: '#12EED4', 1019: '#00FFFF',
  1020: '#00FF00', 1021: '#3A7D15', 1022: '#7F8E64', 1023: '#8C5B9F', 1024: '#AFDDFF', 1025: '#FFC9C9',
  1026: '#B1A7FF', 1027: '#9FF3E9', 1028: '#CCFFCC', 1029: '#FFFFCC', 1030: '#FFCC99', 1031: '#6225D1',
  1032: '#FF00BF',
};
export function brickHex(id, fallback = '#A3A2A5') { return BRICK_HEX[id] || fallback; }
