// Avatar の再構築まわり(desc の保持・読み込み順序・set の一括適用・setBodyPart の入力振り分け)のテスト。three / builder / api はスタブ。
//   cd test && node --import ./rebuild-loader.mjs rebuild.mjs     (Node 22+)
import assert from 'node:assert/strict';
import { Avatar } from '../src/engine/avatar.js';
import { AvatarEngine } from '../src/engine/engine.js';

const eng = { scene: { add() {}, remove() {} }, emit() {} };
const mk = (id, opts) => new Avatar(eng, id, opts);
const parts = (a) => Object.fromEntries(Object.entries(a.built.desc.customParts).map(([k, v]) => [k, v.from]));
const accs = (a) => a.built.desc.accessories.map((x) => x.name);
const head = (a) => a.built.desc.colors.head;
const DESC = (c) => ({ colors: { head: c }, clothing: {}, face: null, accessories: [], customParts: {}, report: [] });
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };

// ── バグ修正: desc の保持 ──
await t('addActor({ desc }) の見た目が、後の装備変更でも残る', async () => {
  const a = mk('a', { desc: DESC('#MARK') });
  assert.equal(head(a), '#MARK');
  await a.equipAccessory('hat');
  assert.equal(head(a), '#MARK'); assert.deepEqual(accs(a), ['hat']);
});
await t('setAvatar(built) の見た目が、後の装備変更でも残る(built.desc を保持)', async () => {
  const a = mk('b');
  a.setAvatar({ ...mk('tmp', { desc: DESC('#BUILT') }).built });
  await a.equipAccessory('hat');
  assert.equal(head(a), '#BUILT');
});
await t('setAvatar(built) は独自アクセサリ・独自パーツを外す(二重に載らない)', async () => {
  const a = mk('c'); await a.equipAccessory('hat'); await a.setBodyPart('Torso', 'x');
  a.setAvatar(mk('tmp', { desc: DESC('#B') }).built);
  assert.deepEqual(accs(a), []); assert.deepEqual(parts(a), {});
  await a.equipAccessory('cap'); assert.deepEqual(accs(a), ['cap']);
});
await t('built.desc の無い built は、再構築で既定に戻る(従来どおり)', async () => {
  const a = mk('d'); const b = mk('tmp').built; delete b.desc; a.setAvatar(b);
  await a.equipAccessory('hat'); assert.equal(head(a), '#F5CD30');
});

// ── 読み込み順序 ──
await t('順不同: setBodyPart → loadUser / loadUser → setBodyPart / 通信中の setBodyPart・equipAccessory', async () => {
  let a = mk('o1'); await a.setBodyPart('Head', 'x'); await a.loadUser(1); assert.deepEqual(parts(a), { Head: 'glb' });
  a = mk('o2'); await a.loadUser(1); await a.setBodyPart('Head', 'x'); assert.deepEqual(parts(a), { Head: 'glb' });
  a = mk('o3'); const p = a.loadUser(1); await a.setBodyPart('Torso', 'x'); await a.equipAccessory('hat'); await p;
  assert.deepEqual(parts(a), { Head: 'roblox', Torso: 'glb' }); assert.deepEqual(accs(a), ['hat']);
});

// ── set(): 一括適用 ──
await t('set: 全部を1回の再構築で適用する(順序も不問)', async () => {
  const a = mk('s1'); globalThis.__builds = 0;
  const r = await a.set({ user: 7, accessories: ['hat', { source: 'wing', attach: 'BodyBackAttachment' }], bodyParts: { Head: 'h', 'Left Arm': 'la' } });
  assert.equal(globalThis.__builds, 1);
  assert.equal(r.user.id, 7); assert.equal(r.built, a.built); assert.equal(head(a), '#U7');
  assert.deepEqual(accs(a), ['hat', 'wing']); assert.equal(a.built.desc.accessories[1].meta.attach, 'BodyBackAttachment');
  assert.deepEqual(parts(a), { Head: 'glb', 'Left Arm': 'glb' });  // 独自Headが Robloxの頭より優先
});
await t('set: user 無しなら現在の見た目に足す(再構築1回)。replace で独自分をいったん外す', async () => {
  const a = mk('s2'); await a.set({ user: 1 });
  await a.set({ accessories: ['hat'], bodyParts: { Torso: 't' } }); globalThis.__builds = 0;
  await a.set({ accessories: ['cap'] }); assert.equal(globalThis.__builds, 1);
  assert.deepEqual(accs(a), ['hat', 'cap']);
  await a.set({ accessories: ['only'], replace: true });
  assert.deepEqual(accs(a), ['only']); assert.deepEqual(parts(a), { Head: 'roblox' }); // 独自パーツは外れ、Robloxの頭に戻る
});
await t('set: 並列に読み込む(直列より速い)', async () => {
  const a = mk('s3'); const t0 = Date.now();
  await a.set({ user: 1, accessories: Array(10).fill('x') });   // 直列なら 30 + 5×10 ms 以上
  assert.ok(Date.now() - t0 < 70, `${Date.now() - t0}ms`);
});
await t('set: 1つでも失敗したら何も変えずに例外(途中まで反映されない)', async () => {
  const a = mk('s4'); await a.equipAccessory('keep'); globalThis.__builds = 0;
  await assert.rejects(a.set({ accessories: ['ok', 'BAD'], bodyParts: { Head: 'h' } }), /読み込み失敗/);
  assert.equal(globalThis.__builds, 0); assert.deepEqual(accs(a), ['keep']); assert.deepEqual(parts(a), {});
});
await t('set: user 付きを連続で呼んだら後から呼んだほうだけ反映', async () => {
  const a = mk('s5'); globalThis.__loadDelay = 40;
  const p1 = a.set({ user: 1, accessories: ['a1'] }); await new Promise((r) => setTimeout(r, 5)); globalThis.__loadDelay = 5;
  const p2 = a.set({ user: 2, accessories: ['a2'] }); const [r1, r2] = await Promise.all([p1, p2]);
  globalThis.__loadDelay = 30;
  assert.equal(r1.built, null); assert.ok(r2.built); assert.equal(head(a), '#U2'); assert.deepEqual(accs(a), ['a2']);
});
await t('set: user 無しの呼び出しは、通信中の loadUser を打ち切らない', async () => {
  const a = mk('s6'); const p = a.loadUser(3); await a.set({ accessories: ['hat'] }); const r = await p;
  assert.ok(r.built); assert.equal(head(a), '#U3'); assert.deepEqual(accs(a), ['hat']);
});
await t('set: 空の呼び出しは再構築しない / 破棄済みなら何もしない', async () => {
  const a = mk('s7'); globalThis.__builds = 0; await a.set({}); assert.equal(globalThis.__builds, 0);
  const b = mk('s8'); const p = b.set({ user: 1 }); b.dispose(); assert.equal((await p).built, null);
});
await t('set: イベント(accessory / bodypart)を、反映後に出す', async () => {
  const ev = []; const e2 = { scene: eng.scene, emit: (n, p) => ev.push([n, Object.keys(p)[0]]) };
  const a = new Avatar(e2, 'ev'); ev.length = 0;
  await a.set({ accessories: ['hat'], bodyParts: { Head: 'h' } });
  assert.deepEqual(ev, [['avatar', 'group'], ['accessory', 'equipped'], ['bodypart', 'set']]);
});

// ── setBodyPart: 入力の振り分け ──
await t('setBodyPart: GLB / ジオメトリ / 読み込み済みデータを自動で振り分ける', async () => {
  const a = mk('b1');
  await a.setBodyPart('Head', 'x'); assert.equal(a.extraBodyParts.Head.from, 'glb');
  await a.setBodyPart('Torso', { positions: new Float32Array(9), indices: [0, 1, 2] }, { color: [1, 0, 0] }); assert.equal(a.extraBodyParts.Torso.from, 'geom');
  await a.setBodyPart('Left Arm', new Uint8Array([1, 2]).buffer); assert.equal(a.extraBodyParts['Left Arm'].from, 'glb');   // ArrayBuffer は GLB 扱い
  const loaded = { slot: 'Head', geometry: { positions: [] }, color: null, from: 'r15' };
  await a.setBodyPart('Right Leg', loaded, { color: [0, 1, 0], transparency: 0.5 });
  const cp = a.extraBodyParts['Right Leg'];
  assert.equal(cp.from, 'r15'); assert.equal(cp.slot, 'Right Leg'); assert.deepEqual(cp.color, [0, 1, 0]); assert.equal(cp.transparency, 0.5);
  assert.equal(loaded.slot, 'Head'); assert.equal(loaded.color, null);   // 入力は書き換えない
});
await t('setBodyPartGeometry は setBodyPart と同じ(互換)', async () => {
  const a = mk('b2'); await a.setBodyPartGeometry('Head', { positions: new Float32Array(9) }); assert.equal(a.extraBodyParts.Head.from, 'geom');
});

// ── AvatarEngine の委譲 ──
await t('AvatarEngine に残る委譲は 8 個だけ(他は engine.player から)', () => {
  const own = Object.getOwnPropertyNames(AvatarEngine.prototype);
  for (const k of ['loadUser', 'set', 'setState', 'setMotion', 'setHeading', 'playEmote', 'stopEmote', 'emoting']) assert.ok(own.includes(k), k);
  for (const k of ['setAvatar', 'setAvatarDesc', 'resetAvatar', 'equipAccessory', 'unequipAccessory', 'clearAccessories', 'setBodyPart', 'setBodyPartGeometry', 'updateBodyPart', 'clearBodyPart', 'clearBodyParts', 'setPoseOverride', 'rigJoints', 'jointScreenPositions']) assert.ok(!own.includes(k), `${k} が残っている`);
});
console.log(`\n${n} tests passed`);
