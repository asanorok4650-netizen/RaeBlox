// R6のリグ(Motor6D)。THREE非依存。関節の C0 / C1 はRoblox標準のR6の定数(固定)。
// アニメーション(KeyframeSequence)のPoseは「Part1(子パーツ)名」をキーに、Motor6D.Transform として適用される:
//   Part1.CFrame = Part0.CFrame * C0 * Transform * C1:Inverse()
// R6の関節座標系は回転している(肩・腰: Y軸まわりに±90°、首・ルート: X/Y入れ替え)。回転軸の意味:
//   肩・腰(右) ローカルZ = ワールドX軸まわり(前後に振る。+で前) / ローカルX = 側方へ開く(−で外へ)
//   首・ルート  ローカルX = ワールド−X軸まわり(+で前に倒れる) / ローカルZ = ワールド+Y(上)方向への平行移動
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const mv = (R, v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
const mm = (A, B) => { const o = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o.push(A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]); return o; };
const tr = (R) => [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]];

/** CFrame = { pos:[x,y,z], rot:[3x3 行優先] } */
export const cfMul = (a, b) => ({ pos: mv(a.rot, b.pos).map((v, k) => v + a.pos[k]), rot: mm(a.rot, b.rot) });
export const cfInv = (a) => { const t = tr(a.rot); return { pos: mv(t, a.pos).map((v) => -v), rot: t }; };

const RX = [-1, 0, 0, 0, 0, 1, 0, 1, 0];   // ルート・首
const RR = [0, 0, 1, 0, 1, 0, -1, 0, 0];   // 右肩・右腰
const RL = [0, 0, -1, 0, 1, 0, 1, 0, 0];   // 左肩・左腰
const cf = (pos, rot) => ({ pos, rot });

/** [Part0, Part1, 関節名, C0, C1]。親が先に並ぶ。Pose名 = Part1 の名前 */
export const R6_JOINTS = [
  ['HumanoidRootPart', 'Torso', 'RootJoint', cf([0, 0, 0], RX), cf([0, 0, 0], RX)],
  ['Torso', 'Head', 'Neck', cf([0, 1, 0], RX), cf([0, -0.5, 0], RX)],
  ['Torso', 'Right Arm', 'Right Shoulder', cf([1, 0.5, 0], RR), cf([-0.5, 0.5, 0], RR)],
  ['Torso', 'Left Arm', 'Left Shoulder', cf([-1, 0.5, 0], RL), cf([0.5, 0.5, 0], RL)],
  ['Torso', 'Right Leg', 'Right Hip', cf([1, -1, 0], RR), cf([0.5, 1, 0], RR)],
  ['Torso', 'Left Leg', 'Left Hip', cf([-1, -1, 0], RL), cf([-0.5, 1, 0], RL)],
];

/**
 * @param layout layoutR6() の結果(パーツの静止位置)
 * @returns { joints:[{name, part0, part1, c0, c1}], byChild, rest }
 *   rest: パーツ名 → 静止姿勢のワールドCFrame(HumanoidRootPart は Torso の中心)
 */
export function buildR6Rig(layout) {
  const by = Object.fromEntries(layout.map((d) => [d.name, d]));
  if (!by.Torso) throw new Error('R6のレイアウトではありません(Torsoがありません)');
  const rest = {};
  for (const d of layout) rest[d.name] = { pos: [...d.center], rot: I3 };
  rest.HumanoidRootPart = { pos: [...by.Torso.center], rot: I3 };
  const joints = [], byChild = {};
  for (const [p, c, name, c0, c1] of R6_JOINTS) {
    if (!rest[p] || !rest[c]) continue;
    const j = { name, part0: p, part1: c, c0, c1 };
    joints.push(j);
    byChild[c] = j;
  }
  return { joints, byChild, rest };
}

export const describeRig = (rig) => `R6リグ: ${rig.joints.length}関節(Motor6D)`;
