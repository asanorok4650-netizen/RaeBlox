// 「自分」ページ: ボディパーツを選ぶ画面。選択は localStorage に保存し、ゲーム(play/)が読んで付ける。
// 見た目の確認用に AvatarEngine(RAE)だけを使う(物理・Basic は読み込まない)。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { AvatarEngine, attachOrbit, CONFIG } from '../vendor/rae-basic/0.4.5/rae/src/index.js';
import { PROXY_BASE, USER_ID_KEY } from '../play/config.js';
import {
  SLOT_LABEL, TABS, loadBodyset, loadSelection, saveSelection, selectionToObject, selectionFromObject, applySelection, paintBodyParts,
} from '../play/bodyparts.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const lsGet = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3000);
}

let items = [], sel = new Map(), tab = 'all';
const thumbs = new Map();          // item.id → サムネ(dataURL)
const cache = new Map();           // item.id → 読み込み済みパーツ(付け替えのたびに GLB を読み直さない)
let history = [], hi = 0;          // 元に戻す / やり直す
let engine = null, player = null, bodyColors = null;

// ── 選択の変更(履歴・保存・見た目への反映をまとめる) ──
const snap = () => JSON.stringify(selectionToObject(sel));
function updateTools() { $('undo').disabled = hi <= 0; $('redo').disabled = hi >= history.length - 1; }
function changed(push) {
  if (push) { history = history.slice(0, hi + 1); history.push(snap()); hi = history.length - 1; }
  saveSelection(sel); updateTools(); refresh(); queueApply();
}
function select(it) { sel.set(it.slot, sel.get(it.slot) === it ? null : it); changed(true); }
function setAll(on) { sel = new Map(items.map((i) => i.slot).filter((s, i, a) => a.indexOf(s) === i).map((slot) => [slot, on ? items.find((i) => i.slot === slot) : null])); changed(true); }
// セット(例: NCCv2)でまとめて着る。そのセットが持つ部位だけ入れ替わり、持たない部位(例: RobloxGirl の腕・脚)はそのまま
const setNames = () => [...new Set(items.map((i) => i.set).filter(Boolean))];
const setWorn = (name) => items.filter((i) => i.set === name).every((i) => sel.get(i.slot) === i);
function wearSet(name) { for (const it of items) if (it.set === name) sel.set(it.slot, it); changed(true); }
function jump(d) { const n = hi + d; if (n < 0 || n >= history.length) return; hi = n; sel = selectionFromObject(items, JSON.parse(history[hi])); changed(false); }

// 見た目への反映は1本ずつ順番に(連打しても、最後の選択に落ち着く)
let chain = Promise.resolve();
function queueApply() {
  chain = chain.then(async () => {
    if (!player) return;
    try { await applySelection(player, items, sel, { cache }); paintBodyParts(player, bodyColors); }
    catch (e) { console.error(e); toast(`パーツを読み込めませんでした: ${e.message || e}`); }
  });
}

// ── 表示 ──
function renderTabs() {
  const sub = $('subs'); sub.textContent = '';
  const have = new Set(items.map((i) => i.slot));
  for (const t of TABS) {
    if (t.id !== 'all' && !t.slots.some((s) => have.has(s))) continue;
    const b = el('button', 'sub' + (t.id === tab ? ' on' : ''), t.label); b.type = 'button';
    b.addEventListener('click', () => { tab = t.id; renderTabs(); renderGrid(); });
    sub.appendChild(b);
  }
}
function renderSets() {
  const box = $('sets'); box.textContent = '';
  const names = setNames();
  if (names.length < 2) return;                    // セットが1つ以下なら出さない
  box.appendChild(el('span', 'lbl', 'セット'));
  for (const name of names) {
    const b = el('button', 'chip' + (setWorn(name) ? ' on' : ''), name); b.type = 'button'; b.dataset.set = name;
    b.addEventListener('click', () => wearSet(name));
    box.appendChild(b);
  }
}
const cards = new Map();
function renderGrid() {
  const grid = $('grid'); grid.textContent = ''; cards.clear();
  const slots = TABS.find((t) => t.id === tab).slots;
  const list = items.filter((i) => slots.includes(i.slot));
  if (!list.length) grid.appendChild(el('div', 'empty', items.length ? 'パーツがありません' : 'ボディパーツがまだありません'));
  for (const it of list) {
    const card = el('button', 'card' + (sel.get(it.slot) === it ? ' on' : '')); card.type = 'button';
    const th = el('div', 'thumb');
    if (thumbs.has(it.id)) { const img = el('img'); img.src = thumbs.get(it.id); img.alt = ''; th.appendChild(img); } else th.appendChild(el('div', 'ph'));
    card.append(th, el('div', 'slot', SLOT_LABEL[it.slot]), el('div', 'name', it.name));
    card.addEventListener('click', () => select(it));
    cards.set(it.id, card); grid.appendChild(card);
  }
}
function refresh() {
  for (const [id, c] of cards) { const it = items.find((i) => i.id === id); c.classList.toggle('on', sel.get(it.slot) === it); }
  for (const c of $('sets').querySelectorAll('.chip')) c.classList.toggle('on', setWorn(c.dataset.set));
}

// サムネ: パーツの GLB を小さく描いて画像にする(1枚ずつ。失敗したら灰色のまま)
async function makeThumbs() {
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setSize(192, 192, false); r.setPixelRatio(1); r.setClearColor(0x000000, 0);
  const loader = new GLTFLoader();
  for (const it of items) {
    try {
      const gltf = await loader.loadAsync(it.url);
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xffffff, 0x556070, 2.2));
      const d = new THREE.DirectionalLight(0xffffff, 2.4); d.position.set(2, 3, 4); scene.add(d);
      scene.add(gltf.scene);
      const box = new THREE.Box3().setFromObject(gltf.scene), c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
      const rad = Math.max(s.x, s.y, s.z) || 1;
      const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
      cam.position.set(c.x + rad * 0.9, c.y + rad * 0.55, c.z + rad * 2.4); cam.lookAt(c);
      r.render(scene, cam);
      thumbs.set(it.id, r.domElement.toDataURL('image/png'));
      gltf.scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); for (const m of o.material ? [].concat(o.material) : []) { if (m.map) m.map.dispose(); m.dispose(); } });
      const th = cards.get(it.id) && cards.get(it.id).querySelector('.thumb');
      if (th) { th.textContent = ''; const img = el('img'); img.src = thumbs.get(it.id); img.alt = ''; th.appendChild(img); }
    } catch (e) { console.warn('[me] サムネ作成に失敗', it.name, e); }
  }
  r.dispose();
}

async function main() {
  CONFIG.proxyBase = PROXY_BASE;
  items = await loadBodyset();
  sel = loadSelection(items);
  history = [snap()]; hi = 0;
  renderTabs(); renderSets(); renderGrid(); updateTools();
  $('allOn').addEventListener('click', () => setAll(true));
  $('allOff').addEventListener('click', () => setAll(false));
  $('undo').addEventListener('click', () => jump(-1));
  $('redo').addEventListener('click', () => jump(1));

  engine = new AvatarEngine($('stage'), { background: null });
  engine.dist = 8; engine.pitch = 0.1;
  attachOrbit(engine, $('stage'));
  player = engine.player;
  queueApply();
  makeThumbs();

  // 見た目はログイン中のRobloxアバター(無ければブロックアバター)。体色を当て直す
  const uid = lsGet(USER_ID_KEY);
  if (!uid) $('hint').textContent = 'ホームでログインすると、あなたのRobloxアバターで表示されます';
  else {
    try { const r = await engine.loadUser(uid); bodyColors = r && r.desc && r.desc.colors; paintBodyParts(player, bodyColors); }
    catch (e) { console.error(e); toast('アバターを読み込めませんでした(ブロックアバターで表示)'); }
  }
  addEventListener('pagehide', () => { try { engine.dispose && engine.dispose(); } catch (e) { /* 無視 */ } }, { once: true });
}

main().catch((e) => {
  console.error(e);
  $('grid').textContent = ''; $('grid').appendChild(el('div', 'empty', `読み込めませんでした\n${e.message || e}`));
});
