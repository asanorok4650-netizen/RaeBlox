import * as THREE from 'three';

// 浮遊島をジャンプでつないで進むサンプルマップ。落下すると spawn へ戻る(Basic の既定)。
export default {
  title: 'Sky Islands',
  background: '#8fb6e8',
  spawn: [0, 3, 0],
  setup({ engine, world }) {
    engine.scene.fog = new THREE.Fog(0x8fb6e8, 140, 420);
    const island = (x, y, z, w, d, color) => world.addBlock({ position: [x, y - 1, z], size: [w, 2, d], color });
    island(0, 0, 0, 30, 30, 0x86b66a);               // 出発島
    island(0, 2, -34, 14, 14, 0x9cc77a);             // 以降、少しずつ高く・遠く
    island(22, 5, -52, 12, 12, 0x86b66a);
    island(44, 9, -60, 10, 10, 0x9cc77a);
    island(62, 14, -46, 10, 10, 0x86b66a);
    island(70, 19, -24, 12, 12, 0x9cc77a);
    island(58, 24, 0, 22, 22, 0xd9c36a);             // ゴール島
    world.addBlock({ position: [58, 27, 0], size: [3, 6, 3], color: 0xe5543b }); // ゴールの塔
  },
};
