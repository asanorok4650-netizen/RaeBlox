// ボディパーツの選択(「自分」ページ me/ で決め、ゲーム play/ が読む)。選択は localStorage に保存する。
//   保存形式: { "Torso": "Torso#0", "Left Arm": "" }   ""=外す。キーが無い部位は「先頭のパーツをつける」(既定)
import { BODYPARTS_KEY, BODYSET_META } from './config.js';

export const SLOT_LABEL = { 'Head': '頭', 'Torso': '胴体', 'Left Arm': '左腕', 'Right Arm': '右腕', 'Left Leg': '左脚', 'Right Leg': '右脚' };
export const TABS = [
  { id: 'all', label: 'すべて', slots: Object.keys(SLOT_LABEL) },
  { id: 'head', label: '頭', slots: ['Head'] },
  { id: 'torso', label: '胴体', slots: ['Torso'] },
  { id: 'arm', label: '腕', slots: ['Left Arm', 'Right Arm'] },
  { id: 'leg', label: '脚', slots: ['Left Leg', 'Right Leg'] },
];

const SLOTS = Object.keys(SLOT_LABEL);
const stem = (f) => String(f).split('/').pop().replace(/\.[^.]+$/, '');

// bodyset.json のキー → 部位とセット名。"NCCv2 Left Arm" → { slot: 'Left Arm', set: 'NCCv2' } / "Torso" → { slot: 'Torso', set: '' }
function splitKey(key) {
  for (const slot of SLOTS) {
    if (key === slot) return { slot, set: '' };
    if (key.endsWith(' ' + slot)) return { slot, set: key.slice(0, -slot.length - 1).trim() };
  }
  return null;
}

/**
 * bodyset.json(rae-bodyset v1)→ [{ id, slot, set, name, url, meta }](部位の順、同じ部位の中は JSON の順)
 *   "NCCv2 Torso": { "file": "parts/NCCv2-Torso.glb" }   … キーの「<セット名> <部位>」から、セット名(NCCv2)と部位(Torso)を決める
 *   "Torso": [ { "name": "騎士の胴", "file": "..." }, ... ]  … 部位だけのキー・配列でも書ける(RAE-Basic の bodyset と同じ)
 */
export function parseBodyset(json, baseUrl) {
  if (!json || json.format !== 'rae-bodyset') throw new Error('bodyset.json の形式が違います(format: "rae-bodyset" が必要)');
  const items = [];
  for (const [key, raw] of Object.entries(json.parts || {})) {
    const k = splitKey(key);
    if (!k) { console.warn('[bodyset] 部位を判別できないキーを飛ばしました:', key); continue; }
    (Array.isArray(raw) ? raw : [raw]).forEach((e, i) => {
      if (!e || !e.file) return;
      const set = e.set || k.set;
      items.push({ id: `${key}#${i}`, slot: k.slot, set, name: e.name || set || stem(e.file), url: new URL(e.file, baseUrl).href, meta: e.meta || {} });
    });
  }
  return items.sort((x, y) => SLOTS.indexOf(x.slot) - SLOTS.indexOf(y.slot));
}

/** play/bodyset.json を読んで items にする */
export async function loadBodyset() {
  const base = new URL('./bodyset.json', import.meta.url);
  const res = await fetch(base);
  if (!res.ok) throw new Error(`bodyset.json を読み込めませんでした(HTTP ${res.status})`);
  return parseBodyset(await res.json(), base);
}

const slotsOf = (items) => [...new Set(items.map((i) => i.slot))];
const readSaved = () => { try { return JSON.parse(localStorage.getItem(BODYPARTS_KEY) || '{}') || {}; } catch { return {}; } };

/** 保存済みの選択 → Map(部位 → item | null)。未設定の部位は、その部位の先頭のパーツ */
export function loadSelection(items) {
  const saved = readSaved(), sel = new Map();
  for (const slot of slotsOf(items)) {
    const list = items.filter((i) => i.slot === slot);
    const id = saved[slot];
    sel.set(slot, id === '' ? null : (list.find((i) => i.id === id) || list[0]));
  }
  return sel;
}

/** { 部位: id|'' } の形(保存・やり直し履歴用) */
export const selectionToObject = (sel) => Object.fromEntries([...sel].map(([slot, it]) => [slot, it ? it.id : '']));
export function selectionFromObject(items, obj) {
  const sel = new Map();
  for (const slot of slotsOf(items)) sel.set(slot, items.find((i) => i.slot === slot && i.id === (obj || {})[slot]) || null);
  return sel;
}
export function saveSelection(sel) { try { localStorage.setItem(BODYPARTS_KEY, JSON.stringify(selectionToObject(sel))); } catch { /* 無視 */ } }

/**
 * 選択をアバター(Avatar)へ反映する。選ばれていない部位は標準の箱に戻る。
 * cache(Map: item.id → 読み込み済みパーツ)を渡すと、2回目からは GLB を読み直さない。
 */
export async function applySelection(player, items, sel, { cache = new Map(), meta = BODYSET_META } = {}) {
  const bodyParts = {};
  for (const [slot, it] of sel) if (it) bodyParts[slot] = cache.has(it.id) ? cache.get(it.id) : { source: it.url, ...meta, ...it.meta };
  await player.set({ bodyParts, replace: true });
  for (const [slot, it] of sel) if (it && !cache.has(it.id) && player.extraBodyParts[slot]) cache.set(it.id, player.extraBodyParts[slot]);
}

// ── 体色 ──
// ボディパーツ(GLB)は自前の色(グレー)を持っていて、アバターの体色(BodyColors)を上書きしてしまう。
// 読み込んだアバターの体色を、テクスチャの無い独自パーツへ当て直す(テクスチャ付きのパーツは、その絵を優先)。
const PART_COLOR = { 'Head': 'head', 'Torso': 'torso', 'Left Arm': 'leftArm', 'Right Arm': 'rightArm', 'Left Leg': 'leftLeg', 'Right Leg': 'rightLeg' };
const srgbToLinear = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
function hexToLinear(hex) { // 体色は sRGB の16進。パーツの色は three の作業色空間(線形)で持つ
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => srgbToLinear(v / 255));
}
export function paintBodyParts(player, colors) {
  if (!colors) return;
  for (const [slot, cp] of Object.entries(player.extraBodyParts || {})) {
    const rgb = hexToLinear(colors[PART_COLOR[slot]]);
    if (!rgb || !cp || cp.texture) continue;
    cp.color = rgb; cp.plainColor = rgb;          // 以後の再構築(付け替え・読み込み直し)でも保たれる
    const part = player.built && player.built.parts.find((p) => p.name === slot && !p.accessory);
    const mats = part && part.object.material ? [].concat(part.object.material) : [];
    for (const m of mats) if (!m.map) m.color.setRGB(rgb[0], rgb[1], rgb[2]);
  }
}
