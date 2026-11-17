// 標準のAnimateスクリプト相当: 移動の状態(待機・歩行・ジャンプ・落下)でアニメーションを切り替え、フェードでつなぐ。THREE非依存。
import { clipTime, samplePoses, blendPoses } from '../rbx/animation.js';

/**
 * update(dt, speed, grounded) → ポーズ集合 | null(今の状態のアニメーションが未読み込みのとき)
 * 歩行・ランの再生速度は speed / walkScale(Robloxの標準と同じ考え方)。
 */
export function createAnimate({ fade = 0.15, walkScale = 16, jumpTime = 0.31, moveThreshold = 0.5, runSpeed = 16.5 } = {}) {
  const clips = {};
  const t = {};
  let state = null, prev = null, fadeP = 1, airTime = 0, wasGrounded = true;
  // エモート層: 移動アニメの上に重ねる。動く・ジャンプ・落下すると中断してフェードで元に戻る。
  let emote = null; // { anim, t, loop, w, out, onEnd }
  const endEmote = () => { const e = emote; emote = null; if (e && e.onEnd) e.onEnd(); };
  const rate = (s, speed) => (s === 'walk' || s === 'run' ? Math.max(speed / walkScale, 0.1) : 1);
  return {
    setClip(name, anim) { clips[name] = anim; },
    hasClip: (name) => !!clips[name],
    get state() { return state; },
    /**
     * エモート(任意のアニメ)を再生する。anim は parseAnimation の結果。
     * opts: loop(省略時はアニメ自身の設定) / fade(秒) / cancelOnMove(既定 true) / onEnd(終了・中断時に呼ぶ)
     */
    playEmote(anim, { loop, fade: f = fade, cancelOnMove = true, onEnd } = {}) {
      if (emote) endEmote();
      emote = { anim, t: 0, loop: loop === undefined ? !!anim.loop : !!loop, fade: Math.max(f, 0.01), cancelOnMove, w: 0, out: false, onEnd };
    },
    /** 再生中のエモートをフェードアウトして止める */
    stopEmote() { if (emote) emote.out = true; },
    get emoting() { return !!emote; },
    update(dt, speed, grounded) {
      const base = this._locomotion(dt, speed, grounded);
      if (!emote) return base;
      const e = emote;
      if (e.cancelOnMove && (!grounded || speed > moveThreshold)) e.out = true;
      e.t += dt;
      const len = e.anim.length > 0 ? e.anim.length : 0;
      if (!e.loop && e.t >= len) e.out = true; // 最後まで再生したら戻る
      e.w = e.out ? Math.max(0, e.w - dt / e.fade) : Math.min(1, e.w + dt / e.fade);
      if (e.out && e.w <= 0) { endEmote(); return base; }
      const pose = samplePoses(e.anim, e.loop ? clipTime(e.anim, e.t) : Math.min(e.t, len));
      return e.w >= 1 ? pose : blendPoses(base || {}, pose, e.w);
    },
    _locomotion(dt, speed, grounded) {
      let want;
      if (!grounded) {
        if (wasGrounded) airTime = 0;
        airTime += dt;
        want = airTime < jumpTime ? 'jump' : 'fall';
      } else {
        airTime = 0;
        want = speed > moveThreshold ? (speed >= runSpeed && clips.run ? 'run' : 'walk') : 'idle'; // 標準のAnimateと同じく、通常速度(16)までは歩行、それより速いときだけラン(ラン用のアニメがあるときのみ)
      }
      wasGrounded = grounded;
      if (want !== state) { prev = state; state = want; t[state] = 0; fadeP = prev ? 0 : 1; }
      t[state] += dt * rate(state, speed);
      if (prev && prev !== state) t[prev] = (t[prev] || 0) + dt * rate(prev, speed);
      const cur = clips[state];
      if (!cur) return null;
      const pose = samplePoses(cur, clipTime(cur, t[state]));
      if (fadeP < 1 && prev && clips[prev]) {
        fadeP = Math.min(1, fadeP + dt / fade);
        return blendPoses(samplePoses(clips[prev], clipTime(clips[prev], t[prev])), pose, fadeP);
      }
      return pose;
    },
  };
}
