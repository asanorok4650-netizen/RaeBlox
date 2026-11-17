// 地面・壁などの作成: Three.js の見た目と Rapier の静的コライダーを一緒に作る。
import * as THREE from 'three';

export function createWorld(scene, physics) {
  const euler = new THREE.Euler();
  const quat = new THREE.Quaternion();
  return {
    /**
     * 直方体(見た目 + 当たり判定)。position: 中心 [x,y,z] / size: 全長 [幅,高さ,奥行] / rotation: 度 [x,y,z] / color
     * 返り値: { mesh, collider }
     */
    addBlock({ position = [0, 0, 0], size = [1, 1, 1], rotation = [0, 0, 0], color = 0x8a93a6 } = {}) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
      mesh.position.set(...position);
      mesh.rotation.copy(euler.set(...rotation.map((d) => d * Math.PI / 180)));
      scene.add(mesh);
      quat.copy(mesh.quaternion);
      const collider = physics.addStaticBox({ position, size, quaternion: [quat.x, quat.y, quat.z, quat.w] });
      return { mesh, collider };
    },
    /**
     * 任意の Mesh を静的な当たり判定にする(三角形メッシュ。ワールド座標に焼き込む)。見た目は呼び出し側で scene に足す。
     * 動かないものだけ。なめらかな床・坂は直方体の組み合わせのほうが引っかかりにくい。
     */
    addMeshCollider(mesh) {
      mesh.updateWorldMatrix(true, false);
      const geo = mesh.geometry;
      const pos = geo.attributes.position, v = new THREE.Vector3();
      const vertices = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld); vertices.set([v.x, v.y, v.z], i * 3); }
      const indices = geo.index ? Uint32Array.from(geo.index.array) : Uint32Array.from({ length: pos.count }, (_, i) => i);
      return physics.addStaticTrimesh(vertices, indices);
    },
  };
}
