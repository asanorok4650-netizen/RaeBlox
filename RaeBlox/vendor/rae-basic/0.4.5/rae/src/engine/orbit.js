// 視点操作(オービット)の入力: ドラッグで回転 / ホイール・2本指ピンチでズーム / タップを通知。
//   const orbit = attachOrbit(engine, host, { onTap: (x, y) => {} });   orbit.dispose();
const TAP_PX = 8, TAP_MS = 350;

export function attachOrbit(engine, host, { onTap } = {}) {
  const canvas = engine.renderer.domElement;
  const pts = new Map(); // pointerId → { x, y, x0, y0, t0, moved }
  let pinch = 0;
  const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  const down = (e) => {
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* 無視 */ }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: false });
    if (pts.size === 2) pinch = dist();
  };
  const move = (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (Math.hypot(e.clientX - p.x0, e.clientY - p.y0) > TAP_PX) p.moved = true;
    p.x = e.clientX; p.y = e.clientY;
    if (pts.size >= 2) {
      const d = dist();
      if (pinch > 0 && d > 0) engine.zoom(pinch / d);
      pinch = d;
    } else if (p.moved) engine.look(dx, dy);
  };
  const up = (e) => {
    const p = pts.get(e.pointerId);
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = 0;
    if (p && !p.moved && pts.size === 0 && performance.now() - p.t0 < TAP_MS && onTap) {
      const r = canvas.getBoundingClientRect();
      onTap(e.clientX - r.left, e.clientY - r.top);
    }
  };
  const wheel = (e) => { e.preventDefault(); engine.zoom(1 + Math.sign(e.deltaY) * 0.1); };
  const noMenu = (e) => e.preventDefault();
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', wheel, { passive: false });
  canvas.addEventListener('contextmenu', noMenu);
  return {
    dispose() {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('contextmenu', noMenu);
      pts.clear();
    },
  };
}
