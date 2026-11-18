import * as THREE from 'three';
import { loadGlbWorld } from '../../world-glb.js';

// world.glb(300×300、高さ約106、単位はstud相当、原点は地面)を読み込む屋敷マップ。
// GLB に "spawn" オブジェクトは無いので、開始位置は下の spawn で決めている(屋敷の西側の開けた地面)。
export default {
  title: 'Evil Lineage',
  background: '#691c23',
  spawn: [-90, 4, -8],
  async setup(basic) {
    basic.engine.scene.fog = new THREE.Fog(0x1a1626, 60, 280);
    await loadGlbWorld(basic, new URL('./world.glb', import.meta.url));
  },
};
