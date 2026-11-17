// デモ: 床・壁・段差・坂のテスト場。左上の「アバター」パネルにユーザーID(または名前)を入れて読み込む。
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createBasic } from './basic/index.js';

const stage = document.getElementById('stage');
// ボディパーツ: ./bodyset.json と ./parts/(src や rae と同じ階層)。右端のボタンで付け替えパネルが開く。
// 服を着ているパーツは、下のテクスチャを体の色にする(clothBase: 'skin')
const SKIN = { clothBase: 'skin' };
const basic = await createBasic(stage, { RAPIER, engine: { background: '#9db4cc' }, bodyset: { url: './bodyset.json', meta: SKIN } });
const { engine, world, character } = basic;
window.basic = basic; // コンソールから触れる

engine.scene.fog = new THREE.Fog(0x9db4cc, 120, 420);
const grid = new THREE.GridHelper(160, 80, 0x4c5a6b, 0x6d7d90);
grid.position.y = 0.02;
engine.scene.add(grid);

// 地面(上面が y=0, 160×160。縁の外は落下して spawn へ戻る)
world.addBlock({ position: [0, -1, 0], size: [160, 2, 160], color: 0xb7c2cf });
// 壁
world.addBlock({ position: [0, 5, -40], size: [60, 10, 2], color: 0x7d8aa0 });
world.addBlock({ position: [-30, 5, -20], size: [2, 10, 40], color: 0x7d8aa0 });
// 細い柱(壁に沿って滑る・回り込み)
for (let i = 0; i < 4; i++) world.addBlock({ position: [-8 + i * 5, 4, -14], size: [1, 8, 1], color: 0xc2563f });
// 階段(1段 0.8 = 自動で上がれる高さ)
for (let i = 0; i < 10; i++) world.addBlock({ position: [24, 0.4 * (i + 1), -4 - i * 2], size: [10, 0.8 * (i + 1), 2], color: 0x8fa58a });
// 高い段差(1.5 / 3 / 4.5 / 6 / 7.5。1.5と3は自動では上がれない=ジャンプで。ジャンプ高さは約7)
for (let i = 0; i < 5; i++) world.addBlock({ position: [-20 + i * 5, 0.75 * (i + 1), 14], size: [4, 1.5 * (i + 1), 4], color: 0xd9a441 });
// 坂(15° / 30° / 45° / 60°。60°は急で登れず滑る)。低い側の上面が y=0 になる配置
[15, 30, 45, 60].forEach((deg, i) => {
  const L = 16, t = 1, r = deg * Math.PI / 180;
  world.addBlock({ position: [-8 + i * 9, (L / 2) * Math.sin(r) - (t / 2) * Math.cos(r), 36], size: [7, t, L], rotation: [deg, 0, 0], color: 0x6f8fb8 });
});

character.spawn = { x: 0, y: 1, z: 18 };
character.teleport(0, 1, 18);

// ?user=ID でも指定可(指定があれば自動で読み込む。無ければパネルに前回の入力が入る)
const uid = new URLSearchParams(location.search).get('user');
if (uid) basic.avatarPanel.load(uid);
