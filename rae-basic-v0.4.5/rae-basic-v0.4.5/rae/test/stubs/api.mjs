const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bad = (s) => { if (s === 'BAD') throw new Error('読み込み失敗'); };
globalThis.__loadDelay = 30;
export const loadUserAvatar = async (id) => { await sleep(globalThis.__loadDelay); return { user: { id }, desc: { colors: { head: `#U${id}` }, clothing: {}, face: null, accessories: [], customParts: { Head: { slot: 'Head', geometry: {}, from: 'roblox' } }, report: [] } }; };
export const loadCustomAccessory = async (s, m) => { await sleep(5); bad(s); return { name: m.name || s, meta: m }; };
export const loadCustomBodyPart = async (s, m) => { await sleep(5); bad(s); return { slot: m.slot, geometry: {}, from: 'glb', meta: m }; };
export const bodyPartFromGeometry = async (g, m) => ({ slot: m.slot, geometry: g, from: 'geom', color: m.color || null });
