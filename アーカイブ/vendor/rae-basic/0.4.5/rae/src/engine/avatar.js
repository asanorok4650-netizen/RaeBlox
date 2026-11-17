// 1体分のアバター(Actor): 見た目(desc・独自アクセサリ・独自パーツ)、アニメーション、位置・向き・動きの状態をまとめて持つ。
// プレイヤー・他プレイヤー・NPC はどれも同じ Avatar。違いは「誰が motion / position / heading を更新するか」だけ。
//   const npc = engine.addActor('npc-1', { position: [10, 0, 0] });
//   await npc.loadUser(1234567);  npc.setState('walk');  npc.playEmote('wave');
//
// ネットワーク同期向けの状態は getNetState() / applyNetState() で出し入れできる(送受信・補間は呼び出し側で作る)。
import * as THREE from 'three';
import { buildAvatar, disposeObject, applyTextureUV } from '../avatar/builder.js';
import { makeAnimator } from '../animation/animator.js';
import { loadUserAvatar, loadCustomAccessory, loadCustomBodyPart, bodyPartFromGeometry } from '../avatar/api.js';
import { normalizeUV } from '../avatar/uv.js';
import { DEFAULT_EMOTES, loadEmote } from '../avatar/animations.js';

/** locomotion の状態名 → アニメ更新に渡す { speed, grounded }。jump / fall は空中(最初の0.31秒がjump、以降fall) */
export const MOTION_STATES = Object.freeze({
  idle: { speed: 0, grounded: true },
  walk: { speed: 16, grounded: true },
  run: { speed: 24, grounded: true },
  jump: { speed: 0, grounded: false },
  fall: { speed: 0, grounded: false },
});

/**
 * 独自ボディパーツの入力 → パーツデータ(buildAvatar の desc.customParts[slot] の形)。入力の種類で振り分ける:
 *   GLB(ArrayBuffer / TypedArray / Blob / URL / 登録ID)→ loadCustomBodyPart
 *   ジオメトリ({ positions, normals, uvs, indices })   → bodyPartFromGeometry
 *   読み込み済みのデータ({ geometry, … }。loadHeadAsset / loadR15BodyParts の戻り値など)→ そのまま使う(meta の見た目項目だけ上書き)
 */
async function resolveBodyPart(slot, source, meta = {}) {
  if (source && typeof source === 'object') {
    if (source.positions) return bodyPartFromGeometry(source, { ...meta, slot });
    if (source.geometry) {
      const cp = { ...source, slot };
      for (const k of ['color', 'transparency', 'face', 'overColor', 'clothing', 'clothFit', 'wrap']) if (k in meta) cp[k] = meta[k];
      if ('uv' in meta) cp.uv = normalizeUV(meta.uv);
      return cp;
    }
  }
  return loadCustomBodyPart(source, { ...meta, slot });
}
/** set() の配列・表の要素: そのまま(source)か { source, ...meta } */
const splitSpec = (v) => (v && typeof v === 'object' && 'source' in v ? [v.source, (({ source, ...m }) => m)(v)] : [v, {}]);

/** ネットワーク不要の既定アバター(R6・ブロック体型)。アバター読み込み前の仮の姿 */
export function defaultAvatarDesc() {
  return {
    colors: { head: '#F5CD30', torso: '#0D69AC', leftArm: '#F5CD30', rightArm: '#F5CD30', leftLeg: '#A4BD47', rightLeg: '#A4BD47' },
    clothing: {}, face: null, accessories: [], customParts: {}, report: []
  };
}

export class Avatar {
  /**
   * @param engine 所属する AvatarEngine(scene・カメラ・イベントを借りる)
   * @param id アクターのID(エンジン内で一意。プレイヤーは 'player')
   * @param opts { position: [x,y,z], heading: rad, desc }
   */
  constructor(engine, id, opts = {}) {
    this.engine = engine;
    this.id = id;
    this.heading = opts.heading || 0; // ラジアン。0 = -Z を向く
    this.motion = { ...MOTION_STATES.idle };
    this.height = 5.3;
    this.holder = null; this.built = null; this.anim = null;
    this.avatarDesc = null; this.extraAccessories = []; this.extraBodyParts = {};
    this.poseOverride = null; // setPoseOverride で設定。アバターを作り直しても残る
    this.userData = {};       // 呼び出し側が自由に使える(NPCのAI状態・所有者IDなど)
    this._loadSeq = 0;        // loadUser の世代(後から呼んだほうだけを反映する)
    this._position = new THREE.Vector3();
    if (opts.position) this._position.set(opts.position[0] || 0, opts.position[1] || 0, opts.position[2] || 0);
    this.setAvatarDesc(opts.desc || defaultAvatarDesc()); // desc を保持する(あとの再構築でも元の見た目が残る)
  }

  // ── 位置(足元) ──
  /** 位置は holder.position と同じもの(`engine.holder.position` を直接動かす従来の方法もそのまま効く)。作り直しても保たれる */
  get position() { return this.holder ? this.holder.position : this._position; }
  setPosition(x, y = 0, z = 0) { this.position.set(x, y, z); }

  _emit(name, payload) { this.engine.emit(name, payload, this); }

  // ── 動きの状態 ──
  /** idle / walk / run / jump / fall のどれかにする */
  setState(name) {
    const s = MOTION_STATES[name];
    if (!s) throw new Error(`不明な状態: ${name}(${Object.keys(MOTION_STATES).join(' / ')})`);
    this.motion = { ...s };
  }
  /** 水平速度(studs/秒)と接地を直接指定する。speed が約0.5以下で idle、16前後で walk、約16.5以上で run(runのアニメがあるとき) */
  setMotion(speed, grounded = true) { this.motion = { speed: Math.max(0, Number(speed) || 0), grounded: !!grounded }; }
  setHeading(rad) { this.heading = rad; }

  // ── アバター ──
  /**
   * buildAvatar() の戻り値を直接設定する(独自アクセサリ・独自パーツはいったん外れる)。足元が position に来るよう配置する。
   * 後の装備変更で元の見た目に戻るよう、built.desc(buildAvatar が返す)を基本のdescとして保持する。built.desc が無い built は、再構築で既定のアバターに戻る。
   */
  setAvatar(built) {
    this.avatarDesc = built.desc || null;
    this.extraAccessories = []; this.extraBodyParts = {};
    this._install(built);
  }
  _install(built) {
    if (this.holder) { this._position.copy(this.holder.position); this.engine.scene.remove(this.holder); disposeObject(this.holder); }
    // 足元はボディだけで決める(足より下に垂れるアクセサリでアバターが浮かない)。身長はアクセサリの頭上側を含める
    const groundY = (built.bodyBox || built.box).min.y;
    this.height = Math.max(3, built.box.max.y - groundY);
    this.anim = makeAnimator(built);
    built.group.position.y = -groundY;
    this.holder = new THREE.Group();
    this.holder.name = `Actor:${this.id}`;
    this.holder.position.copy(this._position);
    this.holder.rotation.y = this.heading;
    this.holder.add(built.group);
    this.engine.scene.add(this.holder);
    this.built = built;
    this._emit('avatar', built);
  }
  /** descriptor(avatar/api.js の loadUserAvatar の desc)から組み立てて設定 */
  setAvatarDesc(desc) {
    this.avatarDesc = desc; // 基本のdesc(独自アクセサリは含めない)
    const built = buildAvatar({ ...desc, accessories: [...(desc.accessories || []), ...this.extraAccessories],
      customParts: { ...(desc.customParts || {}), ...this.extraBodyParts } });
    this._install(built);
    return built;
  }
  /** RobloxのユーザーID(またはユーザー名)からアバターを読み込んで設定する。{ user, desc, built } を返す */
  async loadUser(idOrName, onStatus) {
    const seq = ++this._loadSeq;
    const { user, desc } = await loadUserAvatar(idOrName, onStatus);
    if (this.disposed || seq !== this._loadSeq) return { user, desc, built: null }; // 消えた/後から別の読み込みが始まった
    const built = this.setAvatarDesc(desc);
    return { user, desc, built };
  }
  /**
   * 見た目をまとめて適用する。全部を**並列に読み込み**、**1回だけ再構築**する(部品ごとに呼ぶより速く、エモートも途切れにくい)。
   * どれか1つでも読み込みに失敗したら、何も変えずに例外を投げる(途中まで反映されない)。順序は関係ない。
   *   await avatar.set({
   *     user: 1234567,                                   // 省略可。loadUser と同じ(連続で呼んだら後から呼んだほうだけ反映)
   *     accessories: ['hat:cat-ears', { source: '/wing.glb', attach: 'BodyBackAttachment' }],   // source か { source, ...meta }
   *     bodyParts: { Head: '/head.glb', 'Left Arm': { source: geometry, color: [1,0,0] } },     // setBodyPart と同じ入力
   *     replace: false,                                  // true なら、今の独自アクセサリ・独自パーツをいったん全部外してから
   *     onStatus: (text) => {},
   *   });
   * 返り値は { user, desc, built }(user を渡さなかったときは user / desc が null)。
   * user を渡さない呼び出しは loadUser の読み込みを打ち切らない(equipAccessory などと同じく、あとから合流する)。
   */
  async set({ user, accessories = [], bodyParts = {}, replace = false, onStatus } = {}) {
    const withUser = user !== undefined && user !== null;
    const seq = withUser ? ++this._loadSeq : this._loadSeq;
    const [loaded, accs, parts] = await Promise.all([
      withUser ? loadUserAvatar(user, onStatus) : null,
      Promise.all(accessories.map((a) => { const [src, meta] = splitSpec(a); return loadCustomAccessory(src, meta); })),
      Promise.all(Object.entries(bodyParts).map(async ([slot, v]) => { const [src, meta] = splitSpec(v); return [slot, await resolveBodyPart(slot, src, meta)]; })),
    ]);
    if (this.disposed || (withUser && seq !== this._loadSeq)) return { user: loaded && loaded.user, desc: loaded && loaded.desc, built: null }; // 消えた/後から別の読み込みが始まった
    if (replace) {
      if (this.extraAccessories.length) { this.extraAccessories = []; this._emit('accessory', { cleared: true }); }
      if (Object.keys(this.extraBodyParts).length) { this.extraBodyParts = {}; this._emit('bodypart', { cleared: 'all' }); }
    }
    this.extraAccessories.push(...accs);
    for (const [slot, cp] of parts) this.extraBodyParts[slot] = cp;
    let built = this.built;
    if (loaded) built = this.setAvatarDesc(loaded.desc);          // 1回で構築(独自アクセサリ・独自パーツ込み)
    else if (accs.length || parts.length || replace) { this._rebuild(); built = this.built; }
    for (const acc of accs) this._emit('accessory', { equipped: acc });
    for (const [slot, cp] of parts) this._emit('bodypart', { set: slot, part: cp });
    return { user: loaded ? loaded.user : null, desc: loaded ? loaded.desc : null, built };
  }
  /** 既定のブロックアバターに戻す */
  resetAvatar() { return this.setAvatarDesc(defaultAvatarDesc()); }
  _rebuild() { this.setAvatarDesc(this.avatarDesc || defaultAvatarDesc()); }

  // ── 独自アクセサリ ──
  async equipAccessory(source, meta = {}) {
    const acc = await loadCustomAccessory(source, meta);
    if (this.disposed) return acc;
    this.extraAccessories.push(acc);
    this._rebuild();
    this._emit('accessory', { equipped: acc });
    return acc;
  }
  unequipAccessory(accOrName) {
    const i = this.extraAccessories.findIndex((a) => a === accOrName || a.name === accOrName);
    if (i < 0) return false;
    const [acc] = this.extraAccessories.splice(i, 1);
    this._rebuild();
    this._emit('accessory', { unequipped: acc });
    return true;
  }
  clearAccessories() {
    if (!this.extraAccessories.length) return;
    this.extraAccessories.length = 0;
    this._rebuild();
    this._emit('accessory', { cleared: true });
  }

  // ── 独自ボディパーツ ──
  /**
   * 部位を差し替える。source の種類で自動的に振り分ける:
   *   GLB(ArrayBuffer / TypedArray / Blob / URL / 登録ID)/ ジオメトリ { positions, normals, uvs, indices }(stud・Roblox座標)/
   *   読み込み済みのパーツ({ geometry, … }。loadHeadAsset や tools の loadR15BodyParts の戻り値)。
   * meta: GLBは loadCustomBodyPart、ジオメトリは bodyPartFromGeometry と同じ。読み込み済みのパーツには color / transparency / face / overColor / uv / wrap だけ効く。
   */
  async setBodyPart(slot, source, meta = {}) {
    const cp = await resolveBodyPart(slot, source, meta);
    if (this.disposed) return cp;
    this.extraBodyParts[slot] = cp;
    this._rebuild();
    this._emit('bodypart', { set: slot, part: cp });
    return cp;
  }
  /** @deprecated setBodyPart がジオメトリも受けるので、そちらを使う(互換のために残してある) */
  setBodyPartGeometry(slot, geometry, meta = {}) { return this.setBodyPart(slot, geometry, meta); }
  /**
   * 差し替え済みのパーツの見た目を、作り直さずに変える(ドラッグ中のスライダーなど)。patch: { uv, wrap, color, transparency }
   * uv はテクスチャの位置・拡大・回転(avatar/uv.js)。アバターを作り直しても保たれる。変えられたら true。
   */
  updateBodyPart(slot, patch = {}) {
    const cp = this.extraBodyParts[slot];
    if (!cp) return false;
    if ('uv' in patch) cp.uv = normalizeUV(patch.uv);
    if (patch.wrap) cp.wrap = patch.wrap;
    if ('color' in patch) cp.color = patch.color;
    if ('transparency' in patch) cp.transparency = patch.transparency || 0;
    const part = this.built && this.built.parts.find((p) => p.name === slot && !p.accessory);
    const mesh = part && part.object;
    if (mesh && mesh.material) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material], m0 = mats[0];
      if (m0.map && ('uv' in patch || patch.wrap)) applyTextureUV(m0.map, cp.uv, cp.wrap || 'repeat');
      if ('color' in patch && !m0.map && cp.color) m0.color.setRGB(cp.color[0], cp.color[1], cp.color[2]);
      if ('transparency' in patch) {
        for (const m of mats) { m.transparent = cp.transparency > 0; m.opacity = 1 - cp.transparency; m.needsUpdate = true; }
        const ov = mesh.children && mesh.children.find((c) => c.name === 'ClothingOverlay'); // 服の重ね貼りも同じ透明度に
        if (ov && ov.material) { ov.material.opacity = 1 - cp.transparency; ov.material.needsUpdate = true; }
        mesh.visible = !(cp.transparency >= 0.99);
      }
    }
    this._emit('bodypart', { updated: slot, part: cp });
    return true;
  }
  clearBodyPart(slot) {
    if (!this.extraBodyParts[slot]) return false;
    delete this.extraBodyParts[slot];
    this._rebuild();
    this._emit('bodypart', { cleared: slot });
    return true;
  }
  clearBodyParts() {
    if (!Object.keys(this.extraBodyParts).length) return;
    this.extraBodyParts = {};
    this._rebuild();
    this._emit('bodypart', { cleared: 'all' });
  }

  // ── エモート ──
  /** エモートを再生する(オプションは AvatarEngine.playEmote の説明と同じ)。再生できたら true */
  async playEmote(id, opts = {}) {
    const key = typeof id === 'string' ? id.trim().toLowerCase() : id;
    const real = typeof key === 'string' && key in DEFAULT_EMOTES ? DEFAULT_EMOTES[key] : id;
    const target = this.anim;
    if (!target || !target.anim || !target.anim.playEmote) throw new Error('このアバターはエモートに対応していません');
    const anim = await loadEmote(real);
    if (this.disposed || this.anim !== target) return false; // 読み込み中にアバターが変わった/消えた
    target.anim.playEmote(anim, opts);
    this._emit('emote', { id: real, anim });
    return true;
  }
  stopEmote() { if (this.anim && this.anim.anim && this.anim.anim.stopEmote) this.anim.anim.stopEmote(); }
  get emoting() { return !!(this.anim && this.anim.anim && this.anim.anim.emoting); }

  // ── リグ操作(ツール向け) ──
  setPoseOverride(poses) { this.poseOverride = poses || null; }
  rigJoints() {
    const sk = this.built && this.built.skeleton;
    return sk ? sk.rig.joints.map((j) => ({ name: j.part1, joint: j.name, parent: j.part0 })) : [];
  }
  /** 各関節の画面上の位置(描画領域のCSS px)。直近の描画のカメラで計算する */
  jointScreenPositions() {
    const sk = this.built && this.built.skeleton;
    const eng = this.engine;
    if (!sk || !this.holder) return [];
    this.holder.updateMatrixWorld(true);
    const w = eng.host.clientWidth, h = eng.host.clientHeight, v = new THREE.Vector3(), out = [];
    for (const j of sk.rig.joints) {
      const n = sk.nodes[j.part1];
      if (!n) continue;
      v.set(j.c1.pos[0], j.c1.pos[1], j.c1.pos[2]).applyMatrix4(n.matrixWorld).applyMatrix4(eng.camera.matrixWorldInverse).applyMatrix4(eng.camera.projectionMatrix);
      out.push({ name: j.part1, joint: j.name, x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, visible: v.z < 1 });
    }
    return out;
  }

  // ── ネットワーク同期 ──
  /** 送信用の小さな状態(JSONにできる)。見た目(desc)は含めない。見た目はユーザーIDなどで別に伝える */
  getNetState() {
    const p = this.position;
    return { id: this.id, pos: [p.x, p.y, p.z], heading: this.heading, speed: this.motion.speed, grounded: this.motion.grounded };
  }
  /**
   * 受信した状態を反映する。opts.smooth(0〜1)を渡すと、位置・向きをその割合だけ近づける(補間用。省略時は即時)。
   * エモートは含めない(再生する側で playEmote を呼ぶ)。
   */
  applyNetState(s, { smooth = 1 } = {}) {
    if (!s) return;
    const k = Math.min(1, Math.max(0, smooth));
    if (Array.isArray(s.pos)) {
      const p = this.position;
      p.set(p.x +(s.pos[0] - p.x) * k, p.y + (s.pos[1] - p.y) * k, p.z + (s.pos[2] - p.z) * k);
    }
    if (typeof s.heading === 'number') {
      let d = s.heading - this.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d)); // 最短の回り方
      this.heading += d * k;
    }
    if (typeof s.speed === 'number') this.motion = { speed: Math.max(0, s.speed), grounded: s.grounded !== false };
  }

  // ── 毎フレーム ──
  /** アニメを dt 秒進めて、位置・向きをシーンへ反映する */
  update(dt) {
    if (!this.holder) return;
    this.holder.rotation.y = this.heading;
    if (this.anim) {
      if (this.poseOverride && this.anim.setPose) this.anim.setPose(this.poseOverride); // ポーズ固定中は待機・歩行アニメを止める
      else this.anim.update(dt, this.motion.speed, this.motion.grounded);
    }
  }

  dispose() {
    this.disposed = true;
    if (this.holder) { this.engine.scene.remove(this.holder); disposeObject(this.holder); this.holder = null; }
    this.built = null; this.anim = null;
  }
}
