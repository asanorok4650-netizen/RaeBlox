import * as THREE from 'three';
import { loadGlbWorld } from '../../world-glb.js';

export default {
  title: 'Evil Lineage',
  background: '#691c23',
  spawn: [-90, 4, -8],
  async setup(basic) {
    basic.engine.scene.fog = new THREE.Fog(0x1a1626, 60, 280);
    await loadGlbWorld(basic, new URL('./world.glb', import.meta.url));
  },
};
