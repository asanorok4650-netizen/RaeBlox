import * as THREE from 'three';

// 一本道のオビー(障害物コース)のサンプル。
export default {
  title: 'Neon Rush',
  background: '#1a1033',
  spawn: [0, 3, 0],
  character: { jumpHeight: 7.2 },
  setup({ engine, world }) {
    engine.scene.fog = new THREE.Fog(0x1a1033, 60, 300);
    const colors = [0xec4899, 0x7c3aed, 0x22d3ee, 0xfbbf24];
    world.addBlock({ position: [0, -1, 0], size: [20, 2, 20], color: 0x2a1d52 });      // スタート
    let z = -18;
    for (let i = 0; i < 14; i++) {                                                         // 飛び石(だんだん細く・離れる)
      const s = Math.max(3, 8 - i * 0.35), gap = 6 + i * 0.5;
      z -= gap;
      world.addBlock({ position: [Math.sin(i * 1.3) * 6, i * 0.6 - 0.5, z], size: [s, 1, s], color: colors[i % colors.length] });
    }
    world.addBlock({ position: [0, 8, z - 14], size: [16, 2, 16], color: 0xfbbf24 });  // ゴール
  },
};
