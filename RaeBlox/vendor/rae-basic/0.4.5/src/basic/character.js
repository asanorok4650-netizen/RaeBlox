// キャラクター: Rapier の Cuboid + Kinematic Character Controller(KCC)で動かし、結果を RAE の Avatar に反映する。
// RAE は無改変。使うのは Avatar の position(足元) / heading / setMotion と、'avatar' イベント(作り直し)、engine.yaw だけ。
//
// 単位は stud(Roblox準拠)。足元が avatar.position。コライダーは足元から上へ高さ分(bodyBox の高さ)。
// KCC は回転を扱えないので、Cuboid は回さない(軸平行の正方形断面)。向き(heading)は見た目だけ。

const DEG = Math.PI / 180;
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export const CHARACTER_DEFAULTS = {
  halfWidth: 1,          // Cuboid の半幅(XZ)。腕込みの幅ではなく胴体幅(R6の胴は2)
  walkSpeed: 16,         // studs/秒(RAEの歩行アニメの基準)
  jumpHeight: 7.2,       // studs(Robloxの既定のジャンプ高さ)
  groundAccel: 90,       // 水平速度が入力に追いつく速さ(大きいほど即応)
  airAccel: 25,
  coyoteTime: 0.08,      // 足場を離れてもジャンプできる猶予(秒)
  jumpBuffer: 0.1,       // 着地前のジャンプ入力を覚えておく時間(秒)
  maxFallSpeed: 400,
  turnRate: 18,          // 向きの追従の速さ(大きいほど素早く向く)
  respawnY: -150,        // これより落ちたら spawn へ戻す
  // Rapier KCC
  offset: 0.05,          // 壁・床との間に残す隙間(stud)。小さすぎる(0.02以下)と床に少しずつ沈む
  autostepHeight: 1.0,   // 自動で乗り越える段差の高さ
  autostepWidth: 0.3,    // 段の上に必要な奥行き
  snapDistance: 0.4,     // 下り坂・段差で床に吸着する距離
  maxClimbDeg: 50,       // 登れる坂の最大角
  minSlideDeg: 50,       // これ以上の急斜面は滑り落ちる
};

export class CharacterController {
  /**
   * @param physics Physics
   * @param avatar RAE の Avatar(engine.player など)
   * @param opts CHARACTER_DEFAULTS の上書き + { engine, getInput, spawn: [x,y,z] }
   *   getInput: () => ({ x: 右(-1〜1), y: 前(-1〜1), jump: boolean })。engine を渡すと engine.yaw 基準(カメラの向き)で動く
   */
  constructor(physics, avatar, opts = {}) {
    const { engine = null, getInput = null, spawn = null, ...rest } = opts;
    this.o = { ...CHARACTER_DEFAULTS, ...rest };
    this.physics = physics;
    this.avatar = avatar;
    this.engine = engine || avatar.engine || null;
    this.getInput = getInput;
    this.input = { x: 0, y: 0, jump: false }; // getInput が無いとき、ここへ直接書いてもよい
    this.faceCamera = false;                  // true のとき、入力が無くても常にカメラの向き(yaw)を向く(一人称視点。横移動でも体は前を向く)

    const p = avatar.position;
    this.pos = { x: p.x, y: p.y, z: p.z };   // 足元(物理ステップ後の最新)
    this.prev = { ...this.pos };              // 1つ前のステップ(描画の補間用)
    this.spawn = spawn ? { x: spawn[0], y: spawn[1], z: spawn[2] } : { ...this.pos };
    this.vel = { x: 0, y: 0, z: 0 };
    this.grounded = false;
    this.speed = 0;                           // 実際に進んでいる水平速度(アニメに渡す)
    this._coyote = 0; this._jumpBuf = 0; this._jumpPrev = false; this._airTime = 0;

    const { RAPIER, world } = physics;
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x, p.y, p.z));
    this.kcc = world.createCharacterController(this.o.offset);
    const k = this.kcc, o = this.o;
    k.setUp({ x: 0, y: 1, z: 0 });
    k.setSlideEnabled(true);
    k.enableAutostep(o.autostepHeight, o.autostepWidth, false);
    k.enableSnapToGround(o.snapDistance);
    k.setMaxSlopeClimbAngle(o.maxClimbDeg * DEG);
    k.setMinSlopeSlideAngle(o.minSlideDeg * DEG);
    k.setApplyImpulsesToDynamicBodies(false);

    this.collider = null;
    this._makeCollider(avatar.built);
    // アバターが作り直される(loadUser・アクセサリ変更など)と体の高さが変わるので、コライダーも作り直す
    this._offAvatar = this.engine ? this.engine.on('avatar', (built, actor) => { if (actor === avatar) this._makeCollider(built); }) : null;
    this._offFixed = physics.addFixed((h) => this._step(h));
    this._offRender = physics.addRender((a) => this._render(a));
  }

  /** bodyBox(ボディのみ・アクセサリ除く)の高さで Cuboid を作る。足元(position)が bodyBox の最下点 */
  _makeCollider(built) {
    const { RAPIER, world } = this.physics;
    const box = built && (built.bodyBox || built.box);
    const h = box ? Math.max(2, box.max.y - box.min.y) : 5;
    if (this.collider) world.removeCollider(this.collider, true);
    this.height = h;
    const hw = this.o.halfWidth;
    this.collider = world.createCollider(RAPIER.ColliderDesc.cuboid(hw, h / 2, hw).setTranslation(0, h / 2, 0), this.body);
  }

  /** 指定位置(足元)へ移動する。速度はリセット */
  teleport(x, y, z) {
    this.pos.x = x; this.pos.y = y; this.pos.z = z;
    Object.assign(this.prev, this.pos);
    this.vel.x = this.vel.y = this.vel.z = 0;
    this.body.setTranslation({ x, y, z }, true);
    this.body.setNextKinematicTranslation({ x, y, z });
    this.physics.world.propagateModifiedBodyPositionsToColliders(); // コライダーの位置を今すぐ反映(次の判定が古い位置から始まらないように)
    this.avatar.position.set(x, y, z);
  }

  _step(h) {
    const o = this.o, pos = this.pos, vel = this.vel;
    const inp = this.getInput ? this.getInput() : this.input;

    // ── 水平: 入力(前/右)をカメラの向きに合わせて目標速度にする ──
    let ix = inp.x || 0, iy = inp.y || 0;
    const len = Math.hypot(ix, iy);
    if (len > 1) { ix /= len; iy /= len; }
    const yaw = this.engine ? this.engine.yaw : Math.PI;
    // カメラは (sin yaw, cos yaw) 側にあり原点を見るので、前 = (-sin, -cos)、右 = (cos, -sin)
    const dx = -Math.sin(yaw) * iy + Math.cos(yaw) * ix;
    const dz = -Math.cos(yaw) * iy - Math.sin(yaw) * ix;
    const kh = 1 - Math.exp(-(this.grounded ? o.groundAccel : o.airAccel) * h);
    vel.x += (dx * o.walkSpeed - vel.x) * kh;
    vel.z += (dz * o.walkSpeed - vel.z) * kh;

    // ── 垂直: ジャンプと重力 ──
    if (inp.jump && !this._jumpPrev) this._jumpBuf = o.jumpBuffer;
    this._jumpPrev = !!inp.jump;
    this._jumpBuf -= h;
    this._coyote = this.grounded ? o.coyoteTime : this._coyote - h;
    if (this.grounded && vel.y < 0) vel.y = 0;
    if ((this._jumpBuf > 0 || inp.jump) && this._coyote > 0) { // 押しっぱなしでも着地したら跳ぶ(Robloxと同じ)
      vel.y = Math.sqrt(2 * this.physics.gravity * o.jumpHeight) + 0.5 * this.physics.gravity * h; // +g·h/2 は、離散ステップで頭頂が jumpHeight になるための補正
      this._coyote = 0; this._jumpBuf = 0; this.grounded = false;
    }
    vel.y = Math.max(vel.y - this.physics.gravity * h, -o.maxFallSpeed);

    // ── KCC: 目標の移動量を、壁・床に当たりながら滑らせた移動量にする ──
    const k = this.kcc;
    if (vel.y > 0) k.disableSnapToGround(); else k.enableSnapToGround(o.snapDistance);
    const want = { x: vel.x * h, y: vel.y * h, z: vel.z * h };
    k.computeColliderMovement(this.collider, want);
    const m = k.computedMovement();
    const grounded = k.computedGrounded();
    const mx = m.x, my = m.y, mz = m.z;
    if (vel.y > 0 && my < want.y - 1e-3) vel.y = 0; // 天井に頭をぶつけた
    if (grounded && vel.y < 0) vel.y = 0;
    this.grounded = grounded;

    Object.assign(this.prev, pos);
    pos.x += mx; pos.y += my; pos.z += mz;
    this.body.setNextKinematicTranslation({ x: pos.x, y: pos.y, z: pos.z });
    if (pos.y < o.respawnY) this.teleport(this.spawn.x, this.spawn.y, this.spawn.z);

    // ── アバターの見た目: 向きと、アニメ用の動き(実際に進んだ速さ・接地) ──
    if (this.faceCamera || len > 0.1) {
      // heading 0 = -Z。+heading は左回り(Three.js の rotation.y)。カメラを向くときは heading = yaw
      const target = this.faceCamera ? yaw : Math.atan2(-dx, -dz);
      this.avatar.heading += wrapPi(target - this.avatar.heading) * (1 - Math.exp(-o.turnRate * h));
    }
    const actual = Math.hypot(mx, mz) / h;
    this.speed += (actual - this.speed) * (1 - Math.exp(-20 * h));
    this._airTime = grounded ? 0 : this._airTime + h;
    // 段差・坂で接地が一瞬切れても落下アニメにしない(上昇中は除く)
    const animGrounded = grounded || (this._airTime < 0.1 && vel.y <= 0);
    this.avatar.setMotion(this.speed < 0.5 ? 0 : this.speed, animGrounded);
  }

  /** 描画位置: 直前と最新のステップの間を補間する(描画のフレームレートが物理と違っても滑らか) */
  _render(a) {
    const p = this.pos, q = this.prev;
    this.avatar.position.set(q.x + (p.x - q.x) * a, q.y + (p.y - q.y) * a, q.z + (p.z - q.z) * a);
  }

  dispose() {
    if (this._offAvatar) this._offAvatar();
    this._offFixed(); this._offRender();
    const { world } = this.physics;
    world.removeCollider(this.collider, true);
    world.removeRigidBody(this.body);
    world.removeCharacterController(this.kcc);
  }
}
