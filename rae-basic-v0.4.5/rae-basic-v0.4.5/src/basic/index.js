// RAE-Basic の入口。RAE(AvatarEngine)に、Rapier の物理・キャラクター操作・入力をつなぐ。
//   import RAPIER from '@dimforge/rapier3d-compat';
//   const basic = await createBasic(document.getElementById('stage'), { RAPIER });
//   basic.world.addBlock(...)                    // 地面・壁(見た目 + 当たり判定)
//   await basic.engine.loadUser(1234567);        // RAE のアバター読み込みはそのまま
// RAE(../../rae)は、カメラのフック(addCameraHook)以外は無改変。Rapier は呼び出し側から渡す(importmap でも npm でもよい)。
import { AvatarEngine } from '../../rae/src/index.js';
import { Physics } from './physics.js';
import { CharacterController, CHARACTER_DEFAULTS } from './character.js';
import { createControls } from './input/index.js';
import { createWorld } from './world.js';
import { attachCameraRig, CAMERA_DEFAULTS } from './camera.js';
import { createAvatarPanel } from './ui/avatar-panel.js';
import { createBodypartsPanel } from './ui/bodyparts-panel.js';

export { Physics, CharacterController, CHARACTER_DEFAULTS, createControls, createWorld, attachCameraRig, CAMERA_DEFAULTS, createAvatarPanel, createBodypartsPanel };

/**
 * @param host 描画先の要素
 * @param opts { RAPIER(必須), engine: AvatarEngine の opts, physics: Physics の opts, character: CharacterController の opts,
 *               controls: false で入力を付けない(自前の入力を character.input に書く), camera: { yaw, pitch, dist }, cameraHead: false で注視点を頭にしない, cameraFollow: { rate(高さの追従の速さ。既定10), snap } / false で追従なし,
 *               cameraFirstPerson: { enter, min, exit, pitch, hide } / false で一人称なし, cameraCollision: { radius, margin, minDist, rate } / false で壁めり込み防止なし(`src/basic/camera.js`),
 *               ui: false でアバター読み込みパネルを付けない(既定は付ける。{ open: true/false } で初期の開閉),
 *               bodyset: { url: './bodyset.json', meta, autoEquip, open, thumbs } を渡すと、右端にボディパーツ付け替えパネルを付ける(省略・false で付けない。失敗してもゲームは動く) }
 */
export async function createBasic(host, opts = {}) {
  const { RAPIER } = opts;
  if (!RAPIER) throw new Error('createBasic: opts.RAPIER(@dimforge/rapier3d-compat)が必要です');
  await RAPIER.init();

  const engine = new AvatarEngine(host, opts.engine);
  // 三人称の既定: アバターの背中側(+Z)から、少し見下ろす
  Object.assign(engine, { yaw: 0, pitch: 0.3, dist: 14 }, opts.camera);

  const physics = new Physics(RAPIER, opts.physics);
  const controls = opts.controls === false ? null : createControls(engine, host);
  const character = new CharacterController(physics, engine.player, {
    engine, getInput: controls ? () => controls.read() : null, ...opts.character,
  });
  const cameraRig = attachCameraRig(engine, physics, {
    head: opts.cameraHead, follow: opts.cameraFollow, firstPerson: opts.cameraFirstPerson, collision: opts.cameraCollision,
    exclude: () => character.body,
    onFirstPerson: (on) => { character.faceCamera = on; }, // 一人称の間は、体がカメラの向きを向く
  });
  const world = createWorld(engine.scene, physics);
  const avatarPanel = opts.ui === false ? null : createAvatarPanel(engine, host, typeof opts.ui === 'object' ? opts.ui : {});
  let bodypartsPanel = null;
  if (opts.bodyset) {
    try { bodypartsPanel = await createBodypartsPanel(engine, host, opts.bodyset === true ? {} : opts.bodyset); }
    catch (e) { console.error('[bodyset] ボディパーツパネルを作れませんでした:', e); }
  }
  const off = engine.addUpdater((dt) => physics.update(dt)); // アニメ更新の後・カメラと描画の前

  return {
    engine, physics, character, controls, world, cameraRig, avatarPanel, bodypartsPanel, RAPIER,
    dispose() { off(); cameraRig.dispose(); character.dispose(); if (controls) controls.dispose(); if (avatarPanel) avatarPanel.dispose(); if (bodypartsPanel) bodypartsPanel.dispose(); physics.dispose(); engine.dispose(); },
  };
}
