// 入力の統合: キーボード + ポインター(スティック・カメラ・ジャンプボタン)。
// read() が { x: 右(-1〜1), y: 前(-1〜1), jump } を返す。カメラ操作は内部で engine.look / zoom を呼ぶので、返り値には含まれない。
import { attachKeyboard } from './keyboard.js';
import { attachPointerControls } from './pointer.js';

const clamp1 = (v) => Math.max(-1, Math.min(1, v));

export function createControls(engine, host, opts = {}) {
  const kb = attachKeyboard();
  const ptr = attachPointerControls(engine, host, opts);
  const state = { x: 0, y: 0, jump: false };
  return {
    read() {
      state.x = clamp1(kb.x + ptr.x);
      state.y = clamp1(kb.y + ptr.y);
      state.jump = kb.jump || ptr.jump;
      return state;
    },
    dispose() { kb.dispose(); ptr.dispose(); },
  };
}
