// ボディパーツ付け替えパネル: 画面右端のボタン → 右側に開くカード一覧(検索・部位タブ・サムネ付き)。
// bodyset.json と parts/ を読み、タップで engine.player.setBodyPart / clearBodyPart を呼ぶ。
//
// bodyset.json(rae-bodyset v1。そのまま使える):
//   { "parts": { "Torso": { "file": "parts/Torso.glb", "meta": {} }, ... } }
// 拡張: 1部位に複数のパーツを置くときは配列にする(name は表示名。省略するとファイル名)。
//   { "parts": { "Torso": [ { "name": "騎士の胴", "file": "parts/TorsoKnight.glb" }, { "file": "parts/Torso.glb" } ] } }
//
// 使い方(createBasic の opts.bodyset でも、単体でも同じ):
//   const panel = await createBodypartsPanel(engine, host, { url: './bodyset.json', meta: { clothBase: 'skin' } });
// RAE v0.4.0 以降: setBodyPart / set は engine ではなく engine.player(Avatar)のメソッド。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const SLOT_LABEL = { 'Head': '頭', 'Torso': '胴体', 'Left Arm': '左腕', 'Right Arm': '右腕', 'Left Leg': '左脚', 'Right Leg': '右脚' };
const SLOT_ORDER = Object.keys(SLOT_LABEL);
const TABS = [ // タブ(複数部位をまとめる)
  { id: 'all', label: 'すべて', slots: SLOT_ORDER },
  { id: 'head', label: '頭', slots: ['Head'] },
  { id: 'torso', label: '胴体', slots: ['Torso'] },
  { id: 'arm', label: '腕', slots: ['Left Arm', 'Right Arm'] },
  { id: 'leg', label: '脚', slots: ['Left Leg', 'Right Leg'] },
];

const CSS = `
.bp *{box-sizing:border-box}
.bp{font:14px/1.4 system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif;color:#e9f5ee;-webkit-user-select:none;user-select:none}
.bp-open{position:absolute;right:max(10px,env(safe-area-inset-right));top:50%;transform:translateY(-50%);z-index:6;width:56px;height:64px;
  border-radius:10px 0 0 10px;border:0;border-right:4px solid #0d2a1c;background:rgba(32,40,40,.82);color:#fff;font-size:28px;cursor:pointer;
  -webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);touch-action:manipulation}
.bp-open:active{background:rgba(52,64,60,.9)}
.bp-win{position:absolute;right:max(10px,env(safe-area-inset-right));top:50%;transform:translateY(-50%);z-index:7;display:none;flex-direction:column;
  width:min(440px,calc(100vw - 20px));height:min(520px,calc(100% - 20px));padding:14px;border-radius:14px;background:rgba(32,62,50,.92);
  box-shadow:0 8px 30px rgba(0,0,0,.35);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
.bp.open .bp-win{display:flex}.bp.open .bp-open{display:none}
.bp-top{display:flex;gap:8px;align-items:center}
.bp-search{flex:1;min-width:0;display:flex;align-items:center;gap:8px;height:42px;padding:0 12px;border-radius:10px;border:2px solid #2f6b52;background:#25503f}
.bp-search input{flex:1;min-width:0;border:0;outline:0;background:transparent;color:#fff;font:inherit;font-size:16px}
.bp-search input::placeholder{color:#8fb8a5}
.bp-close{flex:none;width:42px;height:42px;border:0;border-radius:10px;background:#e8403a;color:#fff;font-size:22px;font-weight:700;cursor:pointer}
.bp-tabs{display:flex;gap:8px;margin:10px 0;overflow-x:auto;scrollbar-width:none;flex:none}
.bp-tabs::-webkit-scrollbar{display:none}
.bp-tab{flex:none;height:34px;padding:0 14px;border:0;border-radius:10px;background:#1c3a2e;color:#cfe8da;font:inherit;font-weight:600;cursor:pointer}
.bp-tab.on{background:#72ee3c;color:#0f2a17}
.bp-grid{flex:1;min-height:0;overflow-y:auto;display:grid;grid-template-columns:repeat(3,1fr);gap:10px;align-content:start;padding:2px 2px 12px;-webkit-overflow-scrolling:touch}
.bp-card{position:relative;display:flex;flex-direction:column;gap:4px;padding:0;border:0;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer;touch-action:manipulation}
.bp-thumb{aspect-ratio:1;width:100%;border-radius:12px;background:#1f3d33;display:flex;align-items:center;justify-content:center;overflow:hidden;border:3px solid transparent}
.bp-thumb img{width:100%;height:100%;object-fit:contain;display:block}
.bp-thumb .ph{width:40%;height:60%;border-radius:8px;background:#9a9a9a;opacity:.7}
.bp-card.on .bp-thumb{border-color:#72ee3c;background:#245240}
.bp-card.on::after{content:"✓";position:absolute;right:6px;top:6px;width:22px;height:22px;border-radius:50%;background:#72ee3c;color:#0f2a17;font-weight:800;font-size:14px;display:flex;align-items:center;justify-content:center}
.bp-card.busy{opacity:.55;pointer-events:none}
.bp-name{font-size:13px;font-weight:600;line-height:1.25;word-break:break-word}
.bp-slot{font-size:12px;color:#72ee3c;font-weight:700}
.bp-empty{grid-column:1/-1;padding:28px 0;text-align:center;color:#8fb8a5}
.bp-foot{display:flex;gap:8px;align-items:center;margin-top:10px;flex:none}
.bp-foot .st{flex:1;min-width:0;font-size:12px;color:#a9d3bf;word-break:break-word}.bp-foot .st.err{color:#ffb0aa}
.bp-btn{flex:none;height:36px;padding:0 12px;border:0;border-radius:10px;background:#1c3a2e;color:#e9f5ee;font:inherit;font-weight:600;cursor:pointer}
.bp-btn:active{background:#2b5744}
`;

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const stem = (f) => String(f).split('/').pop().replace(/\.[^.]+$/, '');

/** bodyset.json → [{ id, slot, name, url, meta }](部位の並び順で) */
export function parseBodyset(json, baseUrl) {
  if (!json || json.format !== 'rae-bodyset') throw new Error('bodyset.json の形式が違います(format: "rae-bodyset" が必要)');
  const items = [];
  for (const slot of SLOT_ORDER) {
    const raw = json.parts && json.parts[slot];
    if (!raw) continue;
    (Array.isArray(raw) ? raw : [raw]).forEach((e, i) => {
      if (!e || !e.file) return;
      items.push({ id: `${slot}#${i}`, slot, name: e.name || stem(e.file), url: new URL(e.file, baseUrl).href, meta: e.meta || {} });
    });
  }
  return items;
}

// サムネ: パーツのGLBを小さく描いて画像にする(1枚ずつ。失敗したら灰色のシルエットのまま)
let thumbRenderer = null;
async function renderThumb(url, size = 160) {
  if (!thumbRenderer) {
    thumbRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    thumbRenderer.setSize(size, size, false); thumbRenderer.setPixelRatio(1);
  }
  const gltf = await new GLTFLoader().loadAsync(url);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x556070, 2.2));
  const d = new THREE.DirectionalLight(0xffffff, 2.4); d.position.set(2, 3, 4); scene.add(d);
  const obj = gltf.scene; scene.add(obj);
  const box = new THREE.Box3().setFromObject(obj), c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
  const r = Math.max(s.x, s.y, s.z) || 1;
  const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
  cam.position.set(c.x + r * 0.9, c.y + r * 0.55, c.z + r * 2.4); // 斜め前から
  cam.lookAt(c);
  thumbRenderer.setClearColor(0x000000, 0);
  thumbRenderer.render(scene, cam);
  const png = thumbRenderer.domElement.toDataURL('image/png');
  obj.traverse((o) => { if (o.geometry) o.geometry.dispose(); const ms = o.material ? [].concat(o.material) : []; for (const m of ms) { if (m.map) m.map.dispose(); m.dispose(); } });
  return png;
}

/**
 * @param engine AvatarEngine
 * @param host 置き先の要素(position が static なら relative にする)
 * @param opts { url: './bodyset.json', meta: 全パーツに共通の setBodyPart の meta(例 { clothBase: 'skin' }), autoEquip: true(最初に各部位の先頭を付ける), open: false, thumbs: true }
 */
export async function createBodypartsPanel(engine, host, opts = {}) {
  const { url = './bodyset.json', meta: baseMeta = {}, autoEquip = true, thumbs = true } = opts;
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  const style = el('style'); style.textContent = CSS; document.head.appendChild(style);

  const root = el('div', 'bp');
  const openBtn = el('button', 'bp-open', '🧍'); openBtn.type = 'button'; openBtn.setAttribute('aria-label', 'ボディパーツ');
  const win = el('div', 'bp-win');
  const top = el('div', 'bp-top');
  const search = el('label', 'bp-search'); search.append(el('span', '', '🔍'));
  const input = el('input'); input.type = 'text'; input.placeholder = '検索…'; input.setAttribute('enterkeyhint', 'search');
  input.autocomplete = 'off'; input.spellcheck = false; search.append(input);
  const closeBtn = el('button', 'bp-close', '✕'); closeBtn.type = 'button'; closeBtn.setAttribute('aria-label', '閉じる');
  top.append(search, closeBtn);
  const tabsEl = el('div', 'bp-tabs');
  const grid = el('div', 'bp-grid');
  const foot = el('div', 'bp-foot');
  const st = el('div', 'st');
  const allOn = el('button', 'bp-btn', '全部つける'); allOn.type = 'button';
  const allOff = el('button', 'bp-btn', '全部外す'); allOff.type = 'button';
  foot.append(st, allOn, allOff);
  win.append(top, tabsEl, grid, foot);
  root.append(openBtn, win); host.appendChild(root);

  const say = (m, err) => { st.textContent = m || ''; st.className = 'st' + (err ? ' err' : ''); };
  const setOpen = (v) => { root.classList.toggle('open', v); if (!v) input.blur(); };
  openBtn.addEventListener('click', () => setOpen(true));
  closeBtn.addEventListener('click', () => setOpen(false));
  // 入力中のキーをゲーム(WASD)に渡さない
  for (const t of ['keydown', 'keyup']) win.addEventListener(t, (e) => e.stopPropagation());
  // パネル上の操作でカメラが回らないように(入力は host の pointer を見ている)
  for (const t of ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'wheel']) win.addEventListener(t, (e) => e.stopPropagation(), { passive: true });
  openBtn.addEventListener('pointerdown', (e) => e.stopPropagation());

  // ── データ ──
  const base = new URL(url, location.href);
  const res = await fetch(base);
  if (!res.ok) throw new Error(`${url} を読み込めませんでした(HTTP ${res.status})`);
  const items = parseBodyset(await res.json(), base);
  const player = engine.player;
  const loaded = new Map(); // item.id → 読み込み済みのパーツ(2回目からは再読み込みしない)
  const live = new Map();   // item.id → 今 player.extraBodyParts に入っているオブジェクト(今ついているかの判定)
  const cards = new Map();
  let tab = 'all', query = '', working = 0;

  const isOn = (it) => !!live.get(it.id) && player.extraBodyParts[it.slot] === live.get(it.id);
  const metaOf = (it) => ({ ...baseMeta, ...it.meta });
  // setBodyPart / set に渡す入力: 読み込み済みならそのパーツ、まだなら { source: URL, ...meta }
  const inputOf = (it) => (loaded.has(it.id) ? loaded.get(it.id) : { source: it.url, ...metaOf(it) });
  // 付いた結果(player.extraBodyParts[slot])を記録する。同じ部位の別パーツは「ついていない」扱いにする
  function remember(it) {
    const cp = player.extraBodyParts[it.slot];
    for (const o of items) if (o.slot === it.slot) live.delete(o.id);
    if (!cp) return;
    live.set(it.id, cp);
    if (!loaded.has(it.id)) loaded.set(it.id, cp);
    for (const w of cp.warnings || []) console.warn('[bodypart]', it.name, w);
  }
  async function equip(it) { await (loaded.has(it.id) ? player.setBodyPart(it.slot, loaded.get(it.id)) : player.setBodyPart(it.slot, it.url, metaOf(it))); remember(it); }
  async function toggle(it) {
    const card = cards.get(it.id); card && card.classList.add('busy'); working++;
    try {
      if (isOn(it)) { player.clearBodyPart(it.slot); live.delete(it.id); say(`${it.name} を外しました`); }
      else { say(`${it.name} を読み込み中…`); await equip(it); say(`${it.name} をつけました`); }
    } catch (e) { console.error(e); say(`${it.name}: ${e.message || e}`, true); }
    finally { working--; card && card.classList.remove('busy'); refresh(); }
  }
  async function setAll(on) {
    working++; allOn.disabled = allOff.disabled = true;
    try {
      if (on) { // 各部位の先頭を付ける(すでに別のものが付いている部位はそのまま)。まとめて読み込み、再構築は1回
        const pick = [];
        for (const slot of SLOT_ORDER) {
          if (player.extraBodyParts[slot]) continue;
          const it = items.find((x) => x.slot === slot); if (it) pick.push(it);
        }
        if (pick.length) {
          await player.set({ bodyParts: Object.fromEntries(pick.map((it) => [it.slot, inputOf(it)])) });
          for (const it of pick) remember(it);
        }
        say('全部つけました');
      } else { player.clearBodyParts(); live.clear(); say('全部外しました(標準の箱)'); }
    } catch (e) { console.error(e); say(String(e.message || e), true); }
    finally { working--; allOn.disabled = allOff.disabled = false; refresh(); }
  }
  allOn.addEventListener('click', () => setAll(true));
  allOff.addEventListener('click', () => setAll(false));

  // ── 表示 ──
  function renderTabs() {
    tabsEl.textContent = '';
    const have = new Set(items.map((i) => i.slot));
    for (const t of TABS) {
      if (t.id !== 'all' && !t.slots.some((s) => have.has(s))) continue;
      const b = el('button', 'bp-tab' + (t.id === tab ? ' on' : ''), t.label); b.type = 'button';
      b.addEventListener('click', () => { tab = t.id; renderTabs(); renderGrid(); });
      tabsEl.appendChild(b);
    }
  }
  function renderGrid() {
    grid.textContent = ''; cards.clear();
    const slots = TABS.find((t) => t.id === tab).slots, q = query.trim().toLowerCase();
    const list = items.filter((it) => slots.includes(it.slot) &&
      (!q || it.name.toLowerCase().includes(q) || it.slot.toLowerCase().includes(q) || SLOT_LABEL[it.slot].includes(q)));
    if (!list.length) grid.appendChild(el('div', 'bp-empty', items.length ? '見つかりません' : 'パーツがありません'));
    for (const it of list) {
      const card = el('button', 'bp-card' + (isOn(it) ? ' on' : '')); card.type = 'button';
      const th = el('div', 'bp-thumb');
      if (it.thumb) { const img = el('img'); img.src = it.thumb; img.alt = ''; th.appendChild(img); } else th.appendChild(el('div', 'ph'));
      card.append(th, el('div', 'bp-slot', SLOT_LABEL[it.slot]), el('div', 'bp-name', it.name));
      card.addEventListener('click', () => toggle(it));
      cards.set(it.id, card); grid.appendChild(card);
    }
  }
  function refresh() { for (const it of items) { const c = cards.get(it.id); if (c) c.classList.toggle('on', isOn(it)); } }
  input.addEventListener('input', () => { query = input.value; renderGrid(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape' || e.key === 'Enter') input.blur(); });
  // アバターを読み込み直しても独自パーツは残る。見た目の「ついている」表示だけ合わせる
  const offs = [engine.on('bodypart', (_p, actor) => { if (!actor || actor === player) { for (const it of items) if (live.get(it.id) && player.extraBodyParts[it.slot] !== live.get(it.id)) live.delete(it.id); refresh(); } })];

  renderTabs(); renderGrid();
  setOpen(!!opts.open);

  // サムネは後から順に作る(1つ作るごとに差し替え)
  if (thumbs) (async () => {
    for (const it of items) {
      try { it.thumb = await renderThumb(it.url); const c = cards.get(it.id); const th = c && c.querySelector('.bp-thumb');
        if (th) { th.textContent = ''; const img = el('img'); img.src = it.thumb; img.alt = ''; th.appendChild(img); } }
      catch (e) { console.warn('[bodypart] サムネ作成に失敗', it.name, e); }
    }
  })();

  if (autoEquip) await setAll(true);

  return {
    el: root, items, setOpen, equip: toggle, equipAll: () => setAll(true), clearAll: () => setAll(false),
    isEquipped: isOn, get busy() { return working > 0; },
    dispose() { for (const o of offs) { try { typeof o === 'function' && o(); } catch (_) {} } root.remove(); style.remove(); },
  };
}
