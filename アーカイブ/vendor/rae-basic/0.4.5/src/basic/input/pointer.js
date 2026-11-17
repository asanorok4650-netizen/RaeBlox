// ポインター入力(マウス・タッチ・ペン)。移動の入力とカメラの入力を、別々のポインターで扱う。
//   タッチ: 画面の左半分 → 動的スティック(触った場所が中心。ドラッグで指に追従) / 右半分 → カメラ(ドラッグで回転・2本指ピンチでズーム)
//   マウス: ドラッグ → カメラ / ホイール → ズーム(移動はキーボード)
//   ジャンプボタン: 右下(タッチ操作が使われたとき・タッチ端末で表示)
// カメラは engine.look(dx,dy) / engine.zoom(f) を呼ぶだけ(RAE本体は変更しない)。
const CSS = `
.rb-ui{position:absolute;inset:0;pointer-events:none;overflow:hidden;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}
.rb-stick,.rb-knob{position:absolute;border-radius:50%;display:none;transform:translate(-50%,-50%);pointer-events:none}
.rb-stick{border:2px solid rgba(255,255,255,.45);background:rgba(255,255,255,.08)}
.rb-knob{background:rgba(255,255,255,.55)}
.rb-jump{position:absolute;right:max(28px,env(safe-area-inset-right));bottom:max(28px,calc(env(safe-area-inset-bottom) + 16px));width:84px;height:84px;border-radius:50%;
  border:2px solid rgba(255,255,255,.5);background:rgba(255,255,255,.14);color:rgba(255,255,255,.85);font:600 15px system-ui,sans-serif;
  display:none;align-items:center;justify-content:center;pointer-events:auto;touch-action:none;cursor:pointer}
.rb-jump.on{background:rgba(255,255,255,.4)}
`;

export function attachPointerControls(engine, host, { lookScale = 1, stickRadius = 0, deadzone = 0.12 } = {}) {
  const canvas = engine.renderer.domElement;
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const ui = document.createElement('div'); ui.className = 'rb-ui';
  const stickEl = document.createElement('div'); stickEl.className = 'rb-stick';
  const knobEl = document.createElement('div'); knobEl.className = 'rb-knob';
  const jumpEl = document.createElement('div'); jumpEl.className = 'rb-jump'; jumpEl.textContent = 'ジャンプ';
  ui.append(stickEl, knobEl, jumpEl); host.appendChild(ui);

  const out = { x: 0, y: 0, jump: false };
  const stick = { id: null, cx: 0, cy: 0, r: 60 };
  const cam = new Map(); // pointerId → { x, y }
  let pinch = 0;
  const showTouchUi = () => { jumpEl.style.display = 'flex'; };
  if (matchMedia('(pointer: coarse)').matches) showTouchUi();

  const place = (el, x, y, size) => { el.style.left = x + 'px'; el.style.top = y + 'px'; if (size) { el.style.width = el.style.height = size + 'px'; } };
  const radius = () => stickRadius || Math.min(80, Math.max(44, Math.min(host.clientWidth, host.clientHeight) * 0.11));
  const showStick = (on) => { stickEl.style.display = knobEl.style.display = on ? 'block' : 'none'; };
  const stickMove = (px, py) => {
    let dx = px - stick.cx, dy = py - stick.cy;
    const d = Math.hypot(dx, dy);
    if (d > stick.r) { // 指が円の外へ出たら、円が指に付いてくる(親指がずれても使える)
      const f = (d - stick.r) / d;
      stick.cx += dx * f; stick.cy += dy * f;
      dx = px - stick.cx; dy = py - stick.cy;
      place(stickEl, stick.cx, stick.cy, stick.r * 2);
    }
    const dd = Math.min(Math.hypot(dx, dy), stick.r);
    const a = Math.atan2(dy, dx);
    place(knobEl, stick.cx + Math.cos(a) * dd, stick.cy + Math.sin(a) * dd, stick.r * 0.8);
    const m = dd / stick.r;
    if (m < deadzone) { out.x = out.y = 0; return; }
    const s = (m - deadzone) / (1 - deadzone);
    out.x = Math.cos(a) * s; out.y = -Math.sin(a) * s; // 画面の上 = 前
  };
  const stickEnd = () => { stick.id = null; out.x = out.y = 0; showStick(false); };
  const dist = () => { const [a, b] = [...cam.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };

  const down = (e) => {
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* 無視 */ }
    const r = canvas.getBoundingClientRect();
    const touch = e.pointerType !== 'mouse';
    if (touch) showTouchUi();
    if (touch && stick.id === null && e.clientX - r.left < r.width / 2) {
      stick.id = e.pointerId; stick.r = radius();
      stick.cx = e.clientX - r.left; stick.cy = e.clientY - r.top;
      place(stickEl, stick.cx, stick.cy, stick.r * 2); showStick(true);
      stickMove(stick.cx, stick.cy);
    } else {
      cam.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (cam.size === 2) pinch = dist();
    }
  };
  const move = (e) => {
    if (e.pointerId === stick.id) { const r = canvas.getBoundingClientRect(); stickMove(e.clientX - r.left, e.clientY - r.top); return; }
    const p = cam.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (cam.size >= 2) { const d = dist(); if (pinch > 0 && d > 0) engine.zoom(pinch / d); pinch = d; }
    else engine.look(dx * lookScale, dy * lookScale);
  };
  const up = (e) => {
    if (e.pointerId === stick.id) stickEnd();
    cam.delete(e.pointerId);
    if (cam.size < 2) pinch = 0;
  };
  const wheel = (e) => { e.preventDefault(); engine.zoom(1 + Math.sign(e.deltaY) * 0.1); };
  const noMenu = (e) => e.preventDefault();

  const jumpDown = (e) => { e.preventDefault(); try { jumpEl.setPointerCapture(e.pointerId); } catch (_) { /* 無視 */ } out.jump = true; jumpEl.classList.add('on'); };
  const jumpUp = () => { out.jump = false; jumpEl.classList.remove('on'); };

  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', wheel, { passive: false });
  canvas.addEventListener('contextmenu', noMenu);
  jumpEl.addEventListener('pointerdown', jumpDown);
  jumpEl.addEventListener('pointerup', jumpUp);
  jumpEl.addEventListener('pointercancel', jumpUp);

  return {
    get x() { return out.x; }, get y() { return out.y; }, get jump() { return out.jump; },
    dispose() {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('contextmenu', noMenu);
      ui.remove(); style.remove(); cam.clear();
    },
  };
}
