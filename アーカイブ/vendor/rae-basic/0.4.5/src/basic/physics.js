// Rapier の World を包む薄い層: 固定ステップ(+描画用の補間係数)と静的コライダーの追加。THREE非依存。
// RAPIER モジュールは呼び出し側から渡す(読み込み方法=CDN/npm を固定しないため)。
//
// 毎フレーム physics.update(dt) を呼ぶと、dt を貯めて固定ステップ(既定 1/60 秒)で進める。
//   固定ステップごと: addFixed(fn) の fn(step) → world.step()
//   フレームの最後:   addRender(fn) の fn(alpha)   (alpha = 0〜1, 次のステップまでの進み具合。描画位置の補間用)

export class Physics {
  /**
   * @param RAPIER `await RAPIER.init()` 済みの @dimforge/rapier3d-compat
   * @param opts { gravity: studs/s² (既定 196.2 = Robloxの重力), step: 固定ステップ秒, maxSteps: 1フレームの最大ステップ数 }
   */
  constructor(RAPIER, { gravity = 196.2, step = 1 / 60, maxSteps = 4 } = {}) {
    this.RAPIER = RAPIER;
    this.gravity = gravity;
    this.step = step;
    this.maxSteps = maxSteps;
    this.world = new RAPIER.World({ x: 0, y: -gravity, z: 0 });
    this.world.timestep = step;
    this._acc = 0;
    this._fixed = new Set();
    this._render = new Set();
    this._dirty = true; // 静的コライダーを足した直後は、一度 step しないと当たり判定の検索(KCC)に反映されない
  }

  /** 固定ステップごとに fn(step) を呼ぶ(world.step の直前)。返り値で解除 */
  addFixed(fn) { this._fixed.add(fn); return () => this._fixed.delete(fn); }
  /** 毎フレームの最後に fn(alpha) を呼ぶ。返り値で解除 */
  addRender(fn) { this._render.add(fn); return () => this._render.delete(fn); }

  update(dt) {
    if (this._dirty) { this.world.step(); this._dirty = false; } // コライダー追加を検索に反映(しないと最初の1歩で床をすり抜ける)
    this._acc += dt;
    let n = 0;
    while (this._acc >= this.step && n < this.maxSteps) {
      for (const fn of this._fixed) fn(this.step);
      this.world.step();
      this._acc -= this.step;
      n++;
    }
    if (this._acc >= this.step) this._acc %= this.step; // 追いつけないときは遅れを捨てる
    const alpha = this._acc / this.step;
    for (const fn of this._render) fn(alpha);
  }

  // ── 静的コライダー(地面・壁など。動かない) ──
  /** 直方体。size: [幅,高さ,奥行](全長)。quaternion: [x,y,z,w](省略で回転なし)。Collider を返す */
  addStaticBox({ position = [0, 0, 0], size = [1, 1, 1], quaternion = [0, 0, 0, 1] } = {}) {
    const { RAPIER } = this;
    const desc = RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2)
      .setTranslation(position[0], position[1], position[2])
      .setRotation({ x: quaternion[0], y: quaternion[1], z: quaternion[2], w: quaternion[3] });
    this._dirty = true;
    return this.world.createCollider(desc);
  }

  /** 三角形メッシュ(ワールド座標の頂点 Float32Array と、三角形の頂点番号 Uint32Array)。Collider を返す */
  addStaticTrimesh(vertices, indices) {
    this._dirty = true;
    return this.world.createCollider(this.RAPIER.ColliderDesc.trimesh(vertices, indices));
  }

  removeCollider(collider) { this.world.removeCollider(collider, true); }

  dispose() {
    this._fixed.clear();
    this._render.clear();
    this.world.free();
  }
}
