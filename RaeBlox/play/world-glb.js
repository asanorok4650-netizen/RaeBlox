// GLB ワールドの読み込み(RaeBlox 側の共通処理。vendor の RAE-Basic は触らない)。
// 使い方(game.js の setup 内):
//   const { spawn } = await loadGlbWorld(basic, new URL('./world.glb', import.meta.url));
//
// GLB 内のオブジェクト名の約束(どれも省略可。付けなければ「見た目+当たり判定」になる):
//   nocol_*  … 見た目だけ(当たり判定なし)。草・飾り・窓など
//   col_*    … 当たり判定だけ(見えない)。坂や床を単純な形で代用したいとき
//   spawn    … 空オブジェクト。その位置を開始位置として返す
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/**
 * @param basic  createBasic の戻り値
 * @param url    GLB の URL
 * @param opts   { scale = 1, collide = true }
 * @returns      { root, spawn: [x,y,z] | null, colliders: number }
 */
export async function loadGlbWorld(basic, url, { scale = 1, collide = true } = {}) {
  const { engine, world } = basic;

  const draco = new DRACOLoader().setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/'); // 使うときだけ取得される
  const loader = new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(String(url));
  draco.dispose();

  const root = gltf.scene;
  root.scale.setScalar(scale);
  root.updateMatrixWorld(true);

  const meshes = [];
  let spawn = null;
  root.traverse((o) => {
    if (o.isMesh) meshes.push(o);
    else if (o.name === 'spawn') { const p = o.getWorldPosition(new THREE.Vector3()); spawn = [p.x, p.y, p.z]; }
  });

  let colliders = 0;
  for (const m of meshes) {
    const name = m.name || '';
    if (collide && !name.startsWith('nocol_') && !m.isSkinnedMesh) {
      world.addMeshCollider(m);
      colliders++;
    }
    if (name.startsWith('col_')) m.visible = false;   // 当たり判定専用は見せない
  }

  engine.scene.add(root);
  return { root, spawn, colliders };
}
