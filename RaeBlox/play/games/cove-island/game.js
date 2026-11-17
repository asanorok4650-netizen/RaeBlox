import * as THREE from 'three';

// Cove Island: 入江・砂浜・森・丘・灯台・桟橋を歩いて巡る探索ワールド。
export default {
  title: 'Cove Island',
  background: '#9bd8ee',
  spawn: [-18, 3, 48],
  character: {
    walkSpeed: 16,
    jumpHeight: 7.2,
    respawnY: -18
  },
  camera: { dist: 17, pitch: 0.32 },

  setup({ engine, world }) {
    const scene = engine.scene;
    scene.background = new THREE.Color('#9bd8ee');
    scene.fog = new THREE.Fog('#9bd8ee', 180, 430);

    const mat = (color, roughness = 0.92) =>
      new THREE.MeshStandardMaterial({ color, roughness });

    const materials = {
      grass: mat('#78ad63'),
      grassLight: mat('#91bf70'),
      sand: mat('#e8d19a'),
      water: new THREE.MeshStandardMaterial({
        color: '#36b9d0',
        roughness: 0.35
      }),
      rock: mat('#858b86'),
      wood: mat('#91613b'),
      darkWood: mat('#62452f'),
      leaf: mat('#397b50'),
      leafLight: mat('#57975a'),
      white: mat('#f4f0df'),
      red: mat('#c85b4b'),
    };

    // 海面
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(900, 900),
      materials.water
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -1.15;
    sea.receiveShadow = true;
    scene.add(sea);

    // 地面ポリゴン
    function groundPolygon(points, y, material, withCollider = false) {
      const shape = new THREE.Shape();

      points.forEach(([x, z], i) => {
        const px = x;
        const py = -z;

        if (i === 0) shape.moveTo(px, py);
        else shape.lineTo(px, py);
      });

      shape.closePath();

      const geometry = new THREE.ShapeGeometry(shape);
      geometry.rotateX(-Math.PI / 2);

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.y = y;
      mesh.receiveShadow = true;

      scene.add(mesh);

      if (withCollider) {
        world.addMeshCollider(mesh);
      }

      return mesh;
    }

    // 島本体。東側に入江を形成
    const coast = [
      [-78, -42], [-68, -68], [-35, -82],
      [8, -79], [43, -64], [69, -42],
      [79, -16], [73, 2], [59, 12],
      [47, 16], [39, 27], [27, 34],
      [14, 29], [8, 17], [13, 6],
      [29, -2], [45, -10], [50, -25],
      [36, -42], [5, -51], [-31, -49],
      [-58, -31], [-73, -8], [-78, 20],
      [-64, 48], [-34, 66], [1, 73],
      [34, 64], [58, 44], [70, 22],
    ];

    groundPolygon(coast, 0, materials.grass, true);

    // 砂浜
    groundPolygon([
      [-63, 35], [-52, 49], [-29, 58],
      [-4, 60], [18, 53], [30, 43],
      [20, 38], [-4, 45], [-29, 43], [-48, 30],
    ], 0.035, materials.sand);

    groundPolygon([
      [-62, -35], [-43, -44], [-15, -45],
      [15, -43], [38, -34], [45, -25],
      [35, -20], [8, -29], [-18, -30], [-43, -22],
    ], 0.04, materials.sand);

    groundPolygon([
      [40, 23], [50, 14], [61, 11],
      [67, 18], [59, 28], [47, 33],
    ], 0.045, materials.sand);

    // 草地の高まり
    const hill = (x, z, w, d, h, color) => {
      world.addBlock({
        position: [x, h / 2 - 0.04, z],
        size: [w, h, d],
        color
      });
    };

    hill(-37, 2, 26, 18, 0.8, 0x82b66a);
    hill(-14, -13, 30, 20, 0.65, 0x8cbb70);
    hill(22, -47, 24, 16, 0.7, 0x80ad62);
    hill(45, 42, 20, 16, 0.6, 0x86b66b);

    // 島内の散策路
    const path = (x, y, z, w, d, color = 0xc7ad7c) =>
      world.addBlock({
        position: [x, y, z],
        size: [w, 0.22, d],
        color
      });

    path(-18, 0.14, 43, 18, 8);
    path(-27, 0.14, 29, 8, 24);
    path(-26, 0.14, 8, 8, 20);
    path(-12, 0.14, -8, 28, 7);
    path(13, 0.14, -22, 22, 7);
    path(31, 0.14, -39, 8, 24);
    path(18, 0.14, -55, 25, 7);
    path(-8, 0.14, -57, 28, 7);
    path(-35, 0.14, -43, 24, 7);
    path(-48, 0.14, -18, 7, 27);
    path(-43, 0.14, 15, 8, 25);

    // 木
    function tree(x, z, scale = 1, light = false) {
      const trunkH = 3.2 * scale;

      world.addBlock({
        position: [x, trunkH / 2, z],
        size: [
          0.65 * scale,
          trunkH,
          0.65 * scale
        ],
        color: 0x795236
      });

      const crownMat = light
        ? materials.leafLight
        : materials.leaf;

      const crown = new THREE.Mesh(
        new THREE.ConeGeometry(2.25 * scale, 5.2 * scale, 7),
        crownMat
      );

      crown.position.set(x, trunkH + 1.3 * scale, z);
      crown.castShadow = true;
      scene.add(crown);

      const crown2 = new THREE.Mesh(
        new THREE.ConeGeometry(1.7 * scale, 4.1 * scale, 7),
        crownMat
      );

      crown2.position.set(x, trunkH + 3.0 * scale, z);
      crown2.castShadow = true;
      scene.add(crown2);
    }

    [
      [-58, 26, 1.15], [-48, 38, 1],
      [-34, 52, 1.1], [-18, 56, 0.9],
      [2, 52, 1.1], [20, 48, 0.9],
      [43, 51, 1], [53, 37, 1.1],
      [-60, 5, 1], [-55, -8, 0.9],
      [-39, -5, 1.15], [-33, 8, 0.9],
      [-25, -25, 1], [-8, -37, 0.9],
      [8, -38, 1.1], [20, -47, 0.9],
      [43, -52, 1], [56, -35, 1.1],
      [60, -22, 0.9],
    ].forEach(([x, z, s], i) => tree(x, z, s, i % 3 === 0));

    // 岩場
    function rock(x, y, z, sx, sy, sz, color = 0x858b86) {
      const mesh = new THREE.Mesh(
        new THREE.DodecahedronGeometry(1, 0),
        mat(color)
      );

      mesh.position.set(x, y, z);
      mesh.scale.set(sx, sy, sz);
      mesh.rotation.set(0.15, x * 0.07, z * 0.04);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);

      world.addBlock({
        position: [x, Math.max(0.4, sy * 0.45), z],
        size: [sx * 1.4, sy * 1.1, sz * 1.4],
        color
      });
    }

    [
      [-72, 1.1, -47, 4, 2.2, 3],
      [-65, 0.9, -56, 3, 1.8, 3],
      [-66, 1.0, 42, 4, 2, 3],
      [-52, 0.9, 55, 3, 1.7, 2.5],
      [68, 1.1, -33, 4, 2.2, 3],
      [72, 0.9, -23, 3, 1.8, 2],
      [57, 0.9, 5, 3, 1.8, 2.5],
      [44, 0.8, 30, 3, 1.5, 2],
    ].forEach(args => rock(...args));

    // 入江の桟橋
    const pier = (x, y, z, w, h, d, color = 0x91613b) =>
      world.addBlock({
        position: [x, y, z],
        size: [w, h, d],
        color
      });

    pier(48, 0.65, 3, 5, 0.35, 13);

    for (let z = -3; z <= 9; z += 4) {
      pier(46, -0.55, z, 0.55, 2.2, 0.55, 0x62452f);
      pier(50, -0.55, z, 0.55, 2.2, 0.55, 0x62452f);
    }

    for (let z = -3; z <= 9; z += 4) {
      pier(43.5, 1.25, z, 0.18, 0.9, 0.18, 0x62452f);
      pier(52.5, 1.25, z, 0.18, 0.9, 0.18, 0x62452f);
    }

    // 灯台
    world.addBlock({
      position: [-55, 0.65, -48],
      size: [12, 1.3, 12],
      color: 0xaaa99c
    });

    const cylinder = (radius, height, color, x, y, z, segments = 16) => {
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, height, segments),
        mat(color)
      );

      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);

      return mesh;
    };

    cylinder(2.0, 10, '#f4f0df', -55, 6.2, -48);
    cylinder(2.15, 0.7, '#c85b4b', -55, 11.4, -48);

    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(2.4, 2.6, 16),
      materials.red
    );

    roof.position.set(-55, 13.0, -48);
    roof.castShadow = true;
    scene.add(roof);

    cylinder(1.25, 1.5, '#f7d77b', -55, 12.0, -48);

    // 灯台の道と展望デッキ
    path(-42, 0.15, -45, 20, 6);

    world.addBlock({
      position: [-35, 0.5, -60],
      size: [14, 0.5, 10],
      color: 0x91613b
    });

    for (let x = -41; x <= -29; x += 6) {
      world.addBlock({
        position: [x, 1.3, -64],
        size: [0.35, 1.6, 0.35],
        color: 0x62452f
      });
    }

    // 砂浜の休憩所
    world.addBlock({
      position: [-10, 1.4, 49],
      size: [10, 0.45, 7],
      color: 0x91613b
    });

    for (const x of [-14, -6]) {
      for (const z of [46, 52]) {
        world.addBlock({
          position: [x, 1.0, z],
          size: [0.35, 2.0, 0.35],
          color: 0x62452f
        });
      }
    }

    world.addBlock({
      position: [-10, 2.25, 49],
      size: [11, 0.45, 8],
      color: 0xc7ad7c
    });

    world.addBlock({
      position: [-19, 0.65, 38],
      size: [4, 0.35, 1.2],
      color: 0x62452f
    });

    // 遠景の小島
    function distantIslet(x, z, sx, sz) {
      const island = new THREE.Mesh(
        new THREE.SphereGeometry(1, 12, 8),
        materials.grass
      );

      island.position.set(x, -0.3, z);
      island.scale.set(sx, 1.5, sz);
      scene.add(island);

      const stone = new THREE.Mesh(
        new THREE.DodecahedronGeometry(1, 0),
        materials.rock
      );

      stone.position.set(x + sx * 0.2, 0.8, z);
      stone.scale.set(sx * 0.3, 1.2, sz * 0.35);
      scene.add(stone);
    }

    distantIslet(-112, -24, 12, 8);
    distantIslet(112, 42, 15, 10);
    distantIslet(96, -75, 10, 7);

    // ライティング
    scene.add(
      new THREE.HemisphereLight(0xd9f3ff, 0x71845a, 1.55)
    );

    const sun = new THREE.DirectionalLight(0xfff1d5, 2.0);
    sun.position.set(-70, 110, 45);
    sun.castShadow = true;
    scene.add(sun);
  },
};
