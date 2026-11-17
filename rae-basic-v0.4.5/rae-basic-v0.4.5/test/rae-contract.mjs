// RAE-Basic が RAE に頼っている契約の確認。Rapier・three・通信は不要(RAE 側のスタブローダーを使う)。
//   node --import ./rae/test/rebuild-loader.mjs test/rae-contract.mjs      (Node 22+)
// 1) 使っている Avatar のAPI(position / heading / setMotion / 'avatar' イベントと bodyBox / engine.player / engine.loadUser)が新しい RAE で動く
// 2) RAE v0.4.0 で削除された engine.xxx の委譲を、basic のコードが呼んでいない
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { Avatar } from '../rae/src/engine/avatar.js';
import { AvatarEngine } from '../rae/src/engine/engine.js';

import * as THREE from 'three';
const await_V = () => (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };
const events = [];
const eng = { scene: { add() {}, remove() {} }, emit: (name, payload, actor) => events.push([name, payload, actor]) };
const player = new Avatar(eng, 'player');

await t("CharacterController が使う Avatar: position.set / heading / setMotion / built.bodyBox / 'avatar' イベント(built, actor)", async () => {
  player.position.set(1, 2, 3); assert.deepEqual([player.position.x, player.position.y, player.position.z], [1, 2, 3]);
  player.heading += 0.5; assert.equal(player.heading, 0.5);
  player.setMotion(16, true); assert.deepEqual(player.motion, { speed: 16, grounded: true });
  assert.ok(player.built.bodyBox.min && player.built.bodyBox.max);
  events.length = 0; await player.loadUser(1);
  const av = events.filter(([n]) => n === 'avatar'); assert.equal(av.length, 1); assert.equal(av[0][2], player); assert.ok(av[0][1].bodyBox);
});
await t('作り直しでも位置・向きが保たれる(コライダー再作成の前後で足元が動かない)', async () => {
  player.position.set(5, 0, -4); player.heading = 1.2; await player.equipAccessory('hat');
  assert.deepEqual([player.position.x, player.position.y, player.position.z, player.heading], [5, 0, -4, 1.2]);
});
await t("avatar.set() は 'avatar' イベントが1回(= コライダーの作り直しも1回)", async () => {
  events.length = 0; await player.set({ user: 2, accessories: ['a', 'b', 'c'], bodyParts: { Head: 'h', Torso: 't' } });
  assert.equal(events.filter(([n]) => n === 'avatar').length, 1);
});
await t('パネルが使う engine.loadUser / engine.player.resetAvatar が存在し、resetAvatar で既定の見た目に戻る', async () => {
  assert.equal(typeof AvatarEngine.prototype.loadUser, 'function');
  assert.equal(typeof player.resetAvatar, 'function');
  player.resetAvatar(); assert.equal(player.built.desc.colors.head, '#F5CD30');
});
await t('camera.js が使う engine.addCameraHook と、カメラ入力の look / zoom / follow が残っている', () => {
  for (const k of ['addCameraHook', '_updateCamera', 'look', 'zoom', 'addUpdater', 'on', 'follow']) assert.equal(typeof AvatarEngine.prototype[k], 'function', k);
});
await t('look() の pitch は engine.minPitch / maxPitch の範囲(camera.js が一人称で広げる)。既定は従来どおり -0.5〜1.35', () => {
  const E = AvatarEngine.prototype, e = { yaw: 0, pitch: 0, minPitch: -0.5, maxPitch: 1.35 };
  E.look.call(e, 0, 100000); assert.equal(e.pitch, 1.35); E.look.call(e, 0, -100000); assert.equal(e.pitch, -0.5);
  e.minPitch = -1.4; e.maxPitch = 1.4; E.look.call(e, 0, -100000); assert.equal(e.pitch, -1.4); E.look.call(e, 0, 100000); assert.equal(e.pitch, 1.4);
  const src = readFileSync(fileURLToPath(new URL('../rae/src/engine/engine.js', import.meta.url)), 'utf8'); // コンストラクタは WebGL が要るので、既定値はソースで確認
  assert.match(src, /this\.minPitch = -0\.5; this\.maxPitch = 1\.35;/);
});
await t('addCameraHook: view(target / position)を書き換えるとカメラになる。追加順・dt・解除・例外の握りつぶし', () => {
  const E = AvatarEngine.prototype, V = (await_V()); const calls = [];
  const fake = { cameraHooks: [], _view: { target: V(), position: V() }, camera: { position: V(), lookAt(v) { this.look = { x: v.x, y: v.y, z: v.z }; } },
    pitch: 0, yaw: 0, dist: 10, focus: 0.5, followTarget: { height: 6, holder: { position: V(1, 2, 3) } } };
  const off = E.addCameraHook.call(fake, (v, dt) => { calls.push(['a', dt]); v.position.y += 100; });
  E.addCameraHook.call(fake, (v, dt) => { calls.push(['b', dt]); v.target.x += 5; });
  E.addCameraHook.call(fake, () => { throw new Error('boom'); }); // 握りつぶされて、他のフックと描画は続く
  const err = console.error; console.error = () => {};
  try { E._updateCamera.call(fake, 0.016); } finally { console.error = err; }
  assert.deepEqual(calls, [['a', 0.016], ['b', 0.016]]);
  assert.deepEqual([fake.camera.position.x, fake.camera.position.y, fake.camera.position.z], [1, 3 + 100, 13]); // 既定の計算 (x=1+sin0*10, y=3+0, z=3+10) に a が +100
  assert.deepEqual(fake.camera.look, { x: 6, y: 3, z: 3 });
  off(); calls.length = 0; console.error = () => {}; try { E._updateCamera.call(fake); } finally { console.error = err; }
  assert.deepEqual(calls, [['b', 0]]); // a は解除された。dt 省略は 0
});
await t('basic のコードが、削除済みの engine.xxx を呼んでいない', () => {
  const removed = ['setAvatar', 'setAvatarDesc', 'resetAvatar', 'equipAccessory', 'unequipAccessory', 'clearAccessories', 'setBodyPart', 'setBodyPartGeometry', 'updateBodyPart', 'clearBodyPart', 'clearBodyParts', 'setPoseOverride', 'rigJoints', 'jointScreenPositions'];
  const re = new RegExp(`\\bengine\\.(${removed.join('|')})\\b`);
  const root = fileURLToPath(new URL('../src', import.meta.url)); const bad = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.js$/.test(f)) readFileSync(p, 'utf8').split('\n').forEach((l, i) => { if (re.test(l.replace(/\/\/.*$/, ''))) bad.push(`${p}:${i + 1}: ${l.trim()}`); }); } };
  walk(root); assert.deepEqual(bad, []);
});
console.log(`\n${n} tests passed`);
