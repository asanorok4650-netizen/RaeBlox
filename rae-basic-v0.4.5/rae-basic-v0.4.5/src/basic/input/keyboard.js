// キーボード: WASD / 矢印で移動、Space でジャンプ。入力欄にフォーカスがあるときは無視する。
const MAP = { KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r', Space: 'j' };

export function attachKeyboard(target = window) {
  const keys = new Set();
  const typing = (e) => { const t = e.target; return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable); };
  const down = (e) => {
    const k = MAP[e.code];
    if (!k || typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    keys.add(k);
    e.preventDefault(); // Space・矢印でページがスクロールしないように
  };
  const up = (e) => { const k = MAP[e.code]; if (k) keys.delete(k); };
  const clear = () => keys.clear();
  target.addEventListener('keydown', down);
  target.addEventListener('keyup', up);
  window.addEventListener('blur', clear);
  return {
    get x() { return (keys.has('r') ? 1 : 0) - (keys.has('l') ? 1 : 0); },
    get y() { return (keys.has('f') ? 1 : 0) - (keys.has('b') ? 1 : 0); },
    get jump() { return keys.has('j'); },
    dispose() {
      target.removeEventListener('keydown', down);
      target.removeEventListener('keyup', up);
      window.removeEventListener('blur', clear);
      keys.clear();
    },
  };
}
