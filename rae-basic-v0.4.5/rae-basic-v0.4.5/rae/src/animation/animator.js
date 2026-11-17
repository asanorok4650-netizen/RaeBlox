// 歩行アニメーション。R6の関節(Motor6D)の入れ子(skeleton.js)に、標準のKeyframeSequenceを流し込む。
// アニメが読み込めない状態は、肩・腰の関節を回す手続き式で代用する。
import { attachRig } from '../avatar/skeleton.js';
import { createAnimate } from './animate.js';
import { loadDefaultAnimations } from '../avatar/animations.js';

// 歩行で振る関節(子パーツ名 = Pose名)
const LIMB_JOINTS = { lArm: 'Left Arm', rArm: 'Right Arm', lLeg: 'Left Leg', rLeg: 'Right Leg' };

/** 歩行の位相と振れ幅を進めて、4肢の角度を返す。speed: 水平速度(studs/s) */
function makeGait() {
  let phase = 0, amp = 0;
  return (dt, speed, grounded) => {
    phase += dt * speed * 0.55;
    const target = grounded ? Math.min(speed / 16, 1) * 0.85 : 0.25;
    amp += (target - amp) * Math.min(1, dt * 12);
    const s = Math.sin(phase) * amp;
    return {
      lLeg: s, rLeg: -s,
      lArm: grounded ? -s * 0.9 : 2.4 * (1 - amp) + 0.3,
      rArm: grounded ? s * 0.9 : 2.4 * (1 - amp) + 0.3
    };
  };
}

/** built = buildAvatar() の戻り値。group の原点は足元の中心 */
export function makeAnimator(built) {
  const sk = attachRig(built.group, built.parts, built.layout);
  built.skeleton = sk;
  const found = Object.keys(LIMB_JOINTS).filter((k) => sk.nodes[LIMB_JOINTS[k]]);
  const gait = makeGait();
  const ctl = createAnimate();
  let mode = null, clock = 0;
  // 標準のR6アニメ(歩行・ジャンプ…)。読み込み済みなら即座に、未読なら読み込めたものから順に入る(クリップはアバター間で共有)。
  // 読み込めるまで/読めない状態は手続き式の振りで代用。
  loadDefaultAnimations(ctl).catch((e) => console.warn('[anim] 読み込み処理に失敗 -', e.message));
  return {
    found, anim: ctl,
    /** ポーズ集合({ 子パーツ名: { pos, q } })をそのまま適用する。通常のアニメ更新の代わりに呼ぶ(エモートエディタなど) */
    setPose(poses) { sk.setPoses(poses || {}); mode = 'clip'; },
    update(dt, speed, grounded) {
      const poses = ctl.update(dt, speed, grounded);
      if (poses) { sk.setPoses(poses); mode = 'clip'; return; }
      if (ctl.state === 'idle') { // 待機のアニメが無いときの代用: 息づかい程度の小さな揺れ
        clock += dt;
        if (mode !== 'sway') { sk.resetPose(); mode = 'sway'; }
        const b = Math.sin(clock * 2.1);
        sk.swing('Head', 0.04 * b); sk.swing('Left Arm', 0.06 * b); sk.swing('Right Arm', 0.06 * b);
        return;
      }
      const a = gait(dt, speed, grounded);
      if (mode !== 'gait') { sk.resetPose(); mode = 'gait'; }
      for (const k of found) sk.swing(LIMB_JOINTS[k], a[k]);
    }
  };
}
