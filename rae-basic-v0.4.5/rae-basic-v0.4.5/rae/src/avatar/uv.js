// テクスチャのUV変換(位置・拡大・回転・反転)。THREE非依存の純粋な計算。
//
//   uv = { offset: [du, dv], scale: [su, sv], rotation: 度, center: [cu, cv], wrap: 'repeat'|'clamp'|'mirror' }
//
// 画像の座標(u 右向き / v 下向き。v=0 が画像の上)で考える。「テクスチャ上の点 T が、モデルのUV上のどこに来るか」を定義する:
//     uv_model = center + offset + R(rotation) · S(scale) · (T − center)
//   scale   … 拡大率(2 = 2倍に大きく見える、0.5 = 半分。負の値で反転)
//   offset  … 画像を ずらす量(UV単位。+u で右、+v で下)
//   rotation… 画像を時計回りに回す角度(度)。center が回転・拡大の中心(既定 0.5, 0.5 = 画像の中心)
// メッシュの頂点UVにはその逆変換(uv_model → T)を掛けてテクスチャを引く。

export const WRAPS = ['repeat', 'clamp', 'mirror'];

export const DEFAULT_UV = Object.freeze({ offset: [0, 0], scale: [1, 1], rotation: 0, center: [0.5, 0.5], wrap: 'repeat' });

const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);
const pair = (v, d) => (Array.isArray(v) ? [num(v[0], d[0]), num(v[1], d[1])] : typeof v === 'number' ? [v, v] : [d[0], d[1]]);

/** 省略可能な入力を完全な形へ。null/undefined は null(= 変換なし) */
export function normalizeUV(uv) {
  if (!uv) return null;
  const wrap = WRAPS.includes(uv.wrap) ? uv.wrap : 'repeat';
  let scale = pair(uv.scale, [1, 1]);
  scale = scale.map((s) => (Math.abs(s) < 1e-6 ? 1e-6 : s)); // 0 は割れないので極小に
  return { offset: pair(uv.offset, [0, 0]), scale, rotation: num(uv.rotation, 0), center: pair(uv.center, [0.5, 0.5]), wrap };
}

export function isIdentityUV(uv) {
  const n = normalizeUV(uv);
  return !n || (n.offset[0] === 0 && n.offset[1] === 0 && n.scale[0] === 1 && n.scale[1] === 1 && n.rotation === 0);
}

/** モデルUV → テクスチャ座標 の2×3アフィン { m: [a, b, c, d], t: [e, f] }(T_u = a·u + b·v + e, T_v = c·u + d·v + f) */
export function uvAffine(uvIn) {
  const uv = normalizeUV(uvIn) || normalizeUV({});
  const th = (uv.rotation * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th);
  const [su, sv] = uv.scale, [cu, cv] = uv.center, [ou, ov] = uv.offset;
  // M = S⁻¹ · R(−θ)
  const a = c / su, b = s / su, cc = -s / sv, d = c / sv;
  return { m: [a, b, cc, d], t: [cu - (a * (cu + ou) + b * (cv + ov)), cv - (cc * (cu + ou) + d * (cv + ov))] };
}

/** 頂点UV(Float32Array、2個ずつ)へ変換を焼き込んだ新しい配列を返す */
export function transformUVs(uvs, uv) {
  const { m, t } = uvAffine(uv);
  const out = new Float32Array(uvs.length);
  for (let i = 0; i < uvs.length; i += 2) {
    const u = uvs[i], v = uvs[i + 1];
    out[i] = m[0] * u + m[1] * v + t[0];
    out[i + 1] = m[2] * u + m[3] * v + t[1];
  }
  return out;
}

/** テクスチャ座標 → モデルUV(transformUVs の逆。UV編集画面で画像を描くのに使う) */
export function uvForward(uvIn) {
  const { m, t } = uvAffine(uvIn);
  const det = m[0] * m[3] - m[1] * m[2] || 1e-12;
  const im = [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det];
  return { m: im, t: [-(im[0] * t[0] + im[1] * t[1]), -(im[2] * t[0] + im[3] * t[1])] };
}
