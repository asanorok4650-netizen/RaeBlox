// カメラ補正(src/basic/camera.js)の確認。Rapier・three は不要(レイ判定は直方体との交差を自前で計算するスタブ)。
//   node test/camera.mjs
import assert from 'node:assert/strict';
import { attachCameraRig } from '../src/basic/camera.js';

let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const V = (x = 0, y = 0, z = 0) => ({ x, y, z, set(a, b, c) { this.x = a; this.y = b; this.z = c; return this; } });

/** 直方体(AABB)だけの世界。castRay は RAPIER の World.castRay と同じ引数・同じ戻り値({ timeOfImpact })。excludeBody を渡すと無視する */
const mkPhysics = (boxes) => {
  const seen = [];
  const RAPIER = { Ray: class { constructor(o, d) { this.origin = o; this.dir = d; } } };
  const world = { castRay(ray, maxToi, solid, ff, fg, fc, exBody) {
    seen.push(exBody);
    let best = null;
    for (const b of boxes) {
      if (b.body && b.body === exBody) continue;
      let t0 = 0, t1 = maxToi, ok = true;
      for (const ax of ['x', 'y', 'z']) {
        const o = ray.origin[ax], d = ray.dir[ax];
        if (Math.abs(d) < 1e-9) { if (o < b.min[ax] || o > b.max[ax]) ok = false; continue; }
        let a = (b.min[ax] - o) / d, c = (b.max[ax] - o) / d; if (a > c) [a, c] = [c, a];
        t0 = Math.max(t0, a); t1 = Math.min(t1, c);
      }
      if (ok && t0 <= t1 && (best === null || t0 < best)) best = t0;
    }
    return best === null ? null : { timeOfImpact: best };
  } };
  return { RAPIER, world, seen };
};
/** addCameraHook だけ持つエンジン。frame(dt) で、既定のカメラ位置 → フック を実行して view を返す */
const mkEngine = (target, position, feetY = 0) => {
  const hooks = [], listeners = {}; const view = { target: V(), position: V() };
  const e = { followTarget: { holder: { position: V(0, feetY, 0) } }, addCameraHook(fn) { hooks.push(fn); return () => hooks.splice(hooks.indexOf(fn), 1); },
    on(n, fn) { (listeners[n] ||= []).push(fn); return () => listeners[n].splice(listeners[n].indexOf(fn), 1); }, emit(n) { for (const fn of listeners[n] || []) fn(); }, listeners,
    yaw: 0, pitch: 0.3, dist: 14, minDist: 2, maxDist: 80, minPitch: -0.5, maxPitch: 1.35,
    hooks, frame(dt) { view.target.set(...target); view.position.set(...position); for (const h of hooks) h(view, dt, e); return view; } };
  return e;
};
const dist = (v) => Math.hypot(v.position.x - v.target.x, v.position.y - v.target.y, v.position.z - v.target.z);
const wallAt = (z) => ({ min: { x: -50, y: -50, z }, max: { x: 50, y: 50, z: z + 2 } }); // z〜z+2 の壁(カメラは +z 側)

t('壁が無ければカメラは動かない', () => {
  const e = mkEngine([0, 3, 0], [0, 6, 14]); attachCameraRig(e, mkPhysics([]), { follow: false });
  const v = e.frame(0.016); assert.deepEqual([v.position.x, v.position.y, v.position.z], [0, 6, 14]);
});
t('壁があると、その手前(margin 分あけて)まで即座に寄る。向きは変わらない', () => {
  const e = mkEngine([0, 3, 0], [0, 3, 14]); attachCameraRig(e, mkPhysics([wallAt(8)]), { follow: false });
  const v = e.frame(0.016); assert.ok(Math.abs(v.position.z - (8 - 0.3)) < 1e-9, `z=${v.position.z}`); assert.equal(v.position.y, 3);
  assert.equal(v.target.z, 0);
});
t('離れたらなめらかに戻る(1フレームでは戻りきらない・最後は元の距離)', () => {
  const ph = mkPhysics([wallAt(8)]); const e = mkEngine([0, 3, 0], [0, 3, 14]); attachCameraRig(e, ph, { follow: false });
  e.frame(0.016); ph.world.castRay = () => null; // 壁が消えた
  const d1 = dist(e.frame(0.016)); assert.ok(d1 > 7.7 && d1 < 14, `d1=${d1}`);
  let d = d1; for (let i = 0; i < 300; i++) d = dist(e.frame(0.016)); assert.ok(Math.abs(d - 14) < 1e-3, `d=${d}`);
});
t('dt=0 のとき戻りは進まない(寄せは効く)', () => {
  const ph = mkPhysics([wallAt(8)]); const e = mkEngine([0, 3, 0], [0, 3, 14]); attachCameraRig(e, ph, { follow: false });
  e.frame(0.016); const d0 = dist(e.frame(0)); ph.world.castRay = () => null; assert.equal(dist(e.frame(0)), d0);
});
t('カメラの幅(radius)で、中心レイが通る壁の端にも当たる(横にずれた壁)', () => {
  const side = { min: { x: 0.4, y: -50, z: 4 }, max: { x: 5, y: 50, z: 6 } }; // 中心(x=0)のレイは通るが、右へ 0.6 ずらしたレイは当たる
  const e = mkEngine([0, 3, 0], [0, 3, 14]); attachCameraRig(e, mkPhysics([side]), { follow: false });
  const v = e.frame(0.016); assert.ok(v.position.z < 4, `z=${v.position.z}`);
});
t('minDist より近くには寄らない(壁が目の前でも)', () => {
  const e = mkEngine([0, 3, 0], [0, 3, 14]); attachCameraRig(e, mkPhysics([wallAt(0.5)]), { follow: false });
  assert.ok(Math.abs(dist(e.frame(0.016)) - 1.5) < 1e-9);
});
t('もともと minDist より近い(ズーム最小)ときは、さらに離れない', () => {
  const e = mkEngine([0, 3, 0], [0, 3, 1]); attachCameraRig(e, mkPhysics([wallAt(0.2)]), { follow: false });
  assert.ok(dist(e.frame(0.016)) <= 1 + 1e-9);
});
t('exclude で渡した剛体は無視される(自分のコライダーにカメラが寄らない)', () => {
  const body = { id: 'me' }; const self = { body, min: { x: -1, y: 0, z: -1 }, max: { x: 1, y: 5, z: 1 } };
  const ph = mkPhysics([self]); const e = mkEngine([0, 3, 0], [0, 3, 14]); attachCameraRig(e, ph, { follow: false, exclude: () => body });
  assert.equal(dist(e.frame(0.016)), 14); assert.ok(ph.seen.every((x) => x === body));
});
t('真上から見下ろしても(右ベクトルが退化しても)壊れない', () => {
  const e = mkEngine([0, 3, 0], [0, 20, 0]); attachCameraRig(e, mkPhysics([{ min: { x: -9, y: 12, z: -9 }, max: { x: 9, y: 13, z: 9 } }]), { follow: false });
  const v = e.frame(0.016); assert.ok(Number.isFinite(v.position.y) && v.position.y < 12);
});
t('高さの追従: 足元の y を、なめらかに注視点とカメラへ足す。大きく離れたら即座', () => {
  const e = mkEngine([0, 3, 0], [0, 6, 14], 0); attachCameraRig(e, mkPhysics([]), { collision: false });
  assert.equal(e.frame(0.016).target.y, 3); // 初回は即座(足元 y=0)
  e.followTarget.holder.position.y = 4; const y1 = e.frame(0.016).target.y; assert.ok(y1 > 3 && y1 < 7, `y1=${y1}`);
  e.followTarget.holder.position.y = 100; assert.equal(e.frame(0.016).target.y, 103); // snap(20 超)
});
t('両方有効: 追従のあとに衝突(追従した高さで判定する)', () => {
  const e = mkEngine([0, 3, 0], [0, 3, 14], 10); attachCameraRig(e, mkPhysics([{ min: { x: -50, y: 12, z: 8 }, max: { x: 50, y: 14, z: 10 } }]));
  const v = e.frame(0.016); assert.equal(v.target.y, 13); assert.ok(v.position.z < 8, `z=${v.position.z}`);
});
t('dispose でフックが外れ、minDist も戻る', () => {
  const e = mkEngine([0, 3, 0], [0, 3, 14]); const rig = attachCameraRig(e, mkPhysics([]));
  assert.equal(e.hooks.length, 3); assert.equal(e.minDist, 0.5); rig.dispose(); assert.equal(e.hooks.length, 0); assert.equal(e.minDist, 2);
});
t('false で無効にできる', () => {
  const e = mkEngine([0, 3, 0], [0, 3, 14]); attachCameraRig(e, mkPhysics([]), { head: false, follow: false, firstPerson: false, collision: false }); assert.equal(e.hooks.length, 0);
});

// ── 頭を中心 / 一人称 ──
const mkBuilt = ({ headY = 3, groupY = 1.5, headVisible = true } = {}) => {
  const obj = (visible = true) => ({ visible });
  const head = { ...obj(headVisible), position: { y: 0 } }; // RAE の attachRig は、パーツの position を 0 にして関節ノードの子にする(位置は layout の中心)
  const hat = obj(), wings = obj(), torso = obj();
  return { group: { position: { y: groupY } }, layout: [{ name: 'Torso', center: [0, 1.5, 0] }, { name: 'Head', center: [0, headY, 0] }], objs: { head, hat, wings, torso },
    parts: [{ name: 'Torso', object: torso }, { name: 'Head', object: head }, { name: 'Hat', object: hat, accessory: true, attachedTo: 'Head' }, { name: 'Wings', object: wings, accessory: true, attachedTo: 'Torso' }] };
};
const withBuilt = (e, built) => { e.followTarget.built = built; return built; };
const near = (a, b, m = '') => assert.ok(Math.abs(a - b) < 1e-9, `${m} ${a} vs ${b}`);

t('頭を中心にする: 注視点 = 足元 + 頭の高さ。カメラは注視点と一緒に動く(向き・距離は変わらない)', () => {
  const e = mkEngine([0, 3, 0], [0, 6, 14], 10); withBuilt(e, mkBuilt()); attachCameraRig(e, mkPhysics([]), { firstPerson: false, collision: false });
  const v = e.frame(0.016); near(v.target.y, 10 + 4.5, 'target'); near(v.position.y - v.target.y, 3, 'offset'); assert.equal(v.position.z, 14);
});
t('頭を中心にする: メッシュの position が 0 でも(attachRig 後の実際の形)、layout の頭の高さを使う。足元には落ちない', () => {
  const e = mkEngine([0, 3, 0], [0, 6, 14], 0); withBuilt(e, mkBuilt({ headY: 4.5, groupY: 0 })); attachCameraRig(e, mkPhysics([]), { firstPerson: false, collision: false });
  near(e.frame(0.016).target.y, 4.5);
});
t('頭が見つからない(layout なし)ときは、従来どおり RAE の注視点(足元には落ちない)', () => {
  const e = mkEngine([0, 3, 0], [0, 6, 14], 0); const b = withBuilt(e, mkBuilt()); delete b.layout; attachCameraRig(e, mkPhysics([]), { firstPerson: false, collision: false });
  near(e.frame(0.016).target.y, 3);
});
t('頭を中心にする: 足元の上下になめらかに付いてくる(段差でも跳ねない)', () => {
  const e = mkEngine([0, 3, 0], [0, 6, 14], 0); withBuilt(e, mkBuilt()); attachCameraRig(e, mkPhysics([]), { firstPerson: false, collision: false });
  near(e.frame(0.016).target.y, 4.5); e.followTarget.holder.position.y = 2;
  const y = e.frame(0.016).target.y; assert.ok(y > 4.5 && y < 6.5, `y=${y}`);
});
t('head: false なら従来どおり(RAE の注視点に足元の高さを足す)', () => {
  const e = mkEngine([0, 3, 0], [0, 6, 14], 10); withBuilt(e, mkBuilt()); attachCameraRig(e, mkPhysics([]), { head: false, firstPerson: false, collision: false });
  near(e.frame(0.016).target.y, 13);
});
t('一人称: enter 未満(1 は含まない)まで近づくと入る。カメラは頭の位置・見る向きは yaw/pitch・dist は min に揃う', () => {
  const e = mkEngine([0, 3, 0], [0, 6, 14]); withBuilt(e, mkBuilt()); const seen = []; attachCameraRig(e, mkPhysics([]), { onFirstPerson: (on) => seen.push(on) });
  e.dist = 1; assert.equal(e.frame(0.016).firstPerson, false);
  e.dist = 0.99; e.yaw = 0; e.pitch = 0; const v = e.frame(0.016);
  assert.equal(v.firstPerson, true); assert.deepEqual(seen, [true]); assert.equal(e.dist, 0.5);
  near(v.position.y, 4.5); near(v.position.z, 0); near(v.target.z - v.position.z, -1, 'look -Z'); near(v.target.y, v.position.y);
});
t('一人称の見る向き: yaw と pitch(pitch 正 = 見下ろす)。カメラ距離でない', () => {
  const e = mkEngine([0, 3, 0], [0, 6, 14]); withBuilt(e, mkBuilt()); attachCameraRig(e, mkPhysics([]));
  e.dist = 0.5; e.yaw = Math.PI / 2; e.pitch = 0.5; const v = e.frame(0.016);
  near(v.target.x - v.position.x, -Math.cos(0.5), 'x'); near(v.target.y - v.position.y, -Math.sin(0.5), 'y'); near(v.target.z - v.position.z, 0, 'z');
});
t('一人称: 頭と頭のアクセサリだけが隠れる(胴・背中のアクセサリは見える)。出ると戻る', () => {
  const e = mkEngine([0, 3, 0], [0, 6, 14]); const b = withBuilt(e, mkBuilt()); attachCameraRig(e, mkPhysics([]));
  e.dist = 0.5; e.frame(0.016); assert.deepEqual([b.objs.head.visible, b.objs.hat.visible, b.objs.wings.visible, b.objs.torso.visible], [false, false, true, true]);
  e.dist = 0.55; const v = e.frame(0.016);
  assert.equal(v.firstPerson, false); assert.deepEqual([b.objs.head.visible, b.objs.hat.visible], [true, true]);
});
t('一人称: もともと見えない頭(ヘッドレス)は、戻しても見えないまま', () => {
  const e = mkEngine([0, 3, 0], [0, 6, 14]); const b = withBuilt(e, mkBuilt({ headVisible: false })); attachCameraRig(e, mkPhysics([]));
  e.dist = 0.5; e.frame(0.016); e.dist = 0.55; e.frame(0.016); assert.equal(b.objs.head.visible, false);
});
t('一人称から離れる(ズームアウト)と、すぐ三人称の exit 距離に戻る。壁も効く', () => {
  const e = mkEngine([0, 3, 0], [0, 3, 14]); withBuilt(e, mkBuilt()); const seen = []; attachCameraRig(e, mkPhysics([]), { onFirstPerson: (on) => seen.push(on) });
  e.dist = 0.5; e.yaw = 0; e.pitch = 0; e.frame(0.016); e.dist = 0.55;
  const v = e.frame(0.016); assert.equal(v.firstPerson, false); assert.deepEqual(seen, [true, false]); assert.equal(e.dist, 4);
  near(Math.hypot(v.position.x - v.target.x, v.position.y - v.target.y, v.position.z - v.target.z), 4, 'dist'); near(v.position.z, 4, 'behind');
  assert.equal(e.frame(0.016).firstPerson, false); // 次のフレームも三人称のまま
});
t('一人称の間は pitch の範囲が広がり、出ると三人称の範囲に戻って収まる', () => {
  const e = mkEngine([0, 3, 0], [0, 3, 14]); withBuilt(e, mkBuilt()); attachCameraRig(e, mkPhysics([]));
  e.dist = 0.5; e.frame(0.016); assert.deepEqual([e.minPitch, e.maxPitch], [-1.4, 1.4]);
  e.pitch = -1.3; e.dist = 0.55; e.frame(0.016); assert.deepEqual([e.minPitch, e.maxPitch], [-0.5, 1.35]); assert.equal(e.pitch, -0.5);
});
t('一人称では壁のレイを飛ばさない(頭の位置にカメラを置く)', () => {
  const ph = mkPhysics([{ min: { x: -50, y: -50, z: -50 }, max: { x: 50, y: 50, z: 50 } }]); const e = mkEngine([0, 3, 0], [0, 3, 14]); withBuilt(e, mkBuilt()); attachCameraRig(e, ph);
  e.dist = 0.5; const v = e.frame(0.016); near(v.position.y, 4.5); assert.equal(ph.seen.length, 0);
});
t('一人称の間にアバターが作り直されても(新しい頭・アクセサリ)隠し直す。古いものは忘れる', () => {
  const e = mkEngine([0, 3, 0], [0, 3, 14]); withBuilt(e, mkBuilt()); attachCameraRig(e, mkPhysics([]));
  e.dist = 0.5; e.frame(0.016);
  const b2 = withBuilt(e, mkBuilt()); e.emit('avatar'); assert.deepEqual([b2.objs.head.visible, b2.objs.hat.visible, b2.objs.wings.visible], [false, false, true]);
  e.dist = 0.55; e.frame(0.016); assert.deepEqual([b2.objs.head.visible, b2.objs.hat.visible], [true, true]);
});
t('一人称のまま dispose すると、見た目と pitch の範囲が戻る', () => {
  const e = mkEngine([0, 3, 0], [0, 3, 14]); const b = withBuilt(e, mkBuilt()); const rig = attachCameraRig(e, mkPhysics([]));
  e.dist = 0.5; e.frame(0.016); assert.equal(rig.firstPerson, true); rig.dispose();
  assert.equal(b.objs.head.visible, true); assert.deepEqual([e.minPitch, e.maxPitch], [-0.5, 1.35]); assert.equal(e.listeners.avatar.length, 0);
});
t('firstPerson: false なら、近づいても一人称にならない(minDist も変えない)', () => {
  const e = mkEngine([0, 3, 0], [0, 3, 14]); withBuilt(e, mkBuilt()); attachCameraRig(e, mkPhysics([]), { firstPerson: false });
  e.dist = 0.3; assert.ok(!e.frame(0.016).firstPerson); assert.equal(e.minDist, 2);
});
console.log(`\n${n} tests passed`);
