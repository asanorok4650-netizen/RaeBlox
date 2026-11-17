// R6アバターエンジン本体: シーン / オービットカメラ / アバター(組立・独自パーツ・アクセサリ) / アニメーション。
// ワールド・衝突・歩行物理・環境設定は持たない。拡張は addUpdater / on(イベント) から行う。
//
// 座標系はRoblox準拠: 単位は stud、Y上、アバターの正面は -Z。
// アバターは原点(足元)に立つ。カメラは既定でアバターの正面(-Z側)から見る。
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { Avatar, MOTION_STATES, defaultAvatarDesc } from './avatar.js';

export { Avatar, MOTION_STATES, defaultAvatarDesc };

export class AvatarEngine {
  /**
   * @param host 描画先の要素
   * @param opts { antialias, background } background: CSSカラー(既定 '#1d2229')。null で透明
   */
  constructor(host, opts = {}) {
    this.host = host;
    const background = opts.background === undefined ? '#1d2229' : opts.background;
    this.renderer = new THREE.WebGLRenderer({ antialias: opts.antialias ?? CONFIG.antialias, alpha: background === null, powerPreference: 'high-performance' });
    this.renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;outline:none';
    host.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    if (background !== null) this.scene.background = new THREE.Color(background);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.5, 4000);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f9c, 1.5));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-0.4, 1, 0.6);
    this.scene.add(sun);

    this.listeners = new Map();
    this.updaters = [];
    this.cameraHooks = [];
    this._view = { target: new THREE.Vector3(), position: new THREE.Vector3() };

    // アクター(アバター)。'player' は最初から1体いる(従来の engine.loadUser などはこれに対して働く)。
    // NPC・他プレイヤーは addActor で足す。
    this.actors = new Map();

    // カメラ(オービット): yaw=π で正面から。focus はアバターの高さに対する注視点の比率
    this.yaw = Math.PI; this.pitch = 0.12; this.dist = 12; this.focus = 0.55;
    this.minDist = 2; this.maxDist = 80;
    this.minPitch = -0.5; this.maxPitch = 1.35; // look() の pitch の範囲(rad)。pitch が正 = 見下ろす

    this.last = performance.now();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.player = this.addActor('player');
    this.followTarget = this.player;
    this.renderer.setAnimationLoop(() => this.tick());
  }

  // ── イベント / 拡張 ──
  /** イベント: avatar / emote / accessory / bodypart / actor / log / frame。アクター由来のものは最後の引数が Avatar */
  on(name, fn) { (this.listeners.get(name) || this.listeners.set(name, []).get(name)).push(fn); return () => this.off(name, fn); }
  off(name, fn) { const a = this.listeners.get(name); if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } }
  emit(name, ...args) { for (const fn of this.listeners.get(name) || []) { try { fn(...args); } catch (e) { console.error(`[engine:${name}]`, e); } } }
  log(level, msg) { console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info']('[engine]', msg); this.emit('log', level, msg); }
  /** 毎フレーム(アニメ更新の後・描画の前)に呼ぶ関数を追加する。fn(dt, engine) */
  addUpdater(fn) { this.updaters.push(fn); return () => { const i = this.updaters.indexOf(fn); if (i >= 0) this.updaters.splice(i, 1); }; }

  /**
   * カメラの位置を、描画の直前に調整する関数を追加する。fn(view, dt, engine)。返り値で解除。
   * view = { target, position }(どちらも THREE.Vector3。target = 注視点、position = カメラの位置)。
   * 書き換えたものがそのままカメラになる。追加した順に呼ばれる。dt は最大0.05秒(engine._updateCamera() を直接呼ぶと 0)。
   * 用途: 注視点の高さの追従・壁めり込み防止など(RAE は衝突を知らないので、利用側がここで足す)。
   */
  addCameraHook(fn) { this.cameraHooks.push(fn); return () => { const i = this.cameraHooks.indexOf(fn); if (i >= 0) this.cameraHooks.splice(i, 1); }; }

  // ── アクター(複数のアバター) ──
  /**
   * アクターを追加する。id は一意の文字列(同じIDがあればエラー)。
   * opts: { position: [x,y,z], heading, desc }。返り値の Avatar を操作する(loadUser / setState / playEmote …)。
   */
  addActor(id, opts = {}) {
    id = String(id);
    if (this.actors.has(id)) throw new Error(`同じIDのアクターがいます: ${id}`);
    const actor = new Avatar(this, id, opts);
    this.actors.set(id, actor);
    this.emit('actor', { added: id }, actor);
    return actor;
  }
  getActor(id) { return this.actors.get(String(id)) || null; }
  /** アクターを消す。player は消せない。消せたら true */
  removeActor(id) {
    id = String(id);
    const actor = this.actors.get(id);
    if (!actor || actor === this.player) return false;
    if (this.followTarget === actor) this.followTarget = this.player;
    this.actors.delete(id);
    actor.dispose();
    this.emit('actor', { removed: id }, actor);
    return true;
  }
  /** カメラが追う対象を切り替える(Avatar か ID。null で原点) */
  follow(target) { this.followTarget = target == null ? null : (typeof target === 'object' ? target : this.getActor(target)); }

  // ── 設定 ──
  resize() {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    const pr = Math.min(window.devicePixelRatio || 1, CONFIG.pixelRatioCap);
    if (pr !== this.renderer.getPixelRatio()) this.renderer.setPixelRatio(pr); // 変わったときだけ(setPixelRatio は canvas を再確保する)
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  setPixelRatioCap(v) { CONFIG.pixelRatioCap = v; this.resize(); }

  // ── カメラ(attachOrbit から呼ばれる) ──
  look(dx, dy) {
    this.yaw -= dx * 0.006;
    this.pitch = Math.min(this.maxPitch, Math.max(this.minPitch, this.pitch + dy * 0.006));
  }
  zoom(factor) { this.dist = Math.min(this.maxDist, Math.max(this.minDist, this.dist * factor)); }

  // ── player への委譲(よく使う数個だけ)。それ以外(setAvatarDesc / equipAccessory / setBodyPart / setPoseOverride など)は engine.player から。複数体は addActor の返り値(Avatar)を使う ──
  get emoting() { return this.player.emoting; }

  /** idle / walk / run / jump / fall のどれかにする。アニメ(標準のR6アニメ)が状態に合わせて切り替わる */
  setState(name) { this.player.setState(name); }
  /** 水平速度(studs/秒)と接地を直接指定する。speed が約0.5以下で idle、16前後で walk、約16.5以上で run(runのアニメがあるとき) */
  setMotion(speed, grounded = true) { this.player.setMotion(speed, grounded); }
  /** アバターの向き(ラジアン) */
  setHeading(rad) { this.player.setHeading(rad); }
  /** RobloxのユーザーID(またはユーザー名)からアバターを読み込んで設定する。{ user, desc, built } を返す */
  loadUser(idOrName, onStatus) { return this.player.loadUser(idOrName, onStatus); }
  /** 見た目(ユーザー・独自アクセサリ・独自パーツ)をまとめて適用する。詳細は Avatar.set */
  set(spec) { return this.player.set(spec); }
  /**
   * エモートを再生する。id: アニメのアセットID / 装備エモートのアセットID / 解析済みアニメ、または DEFAULT_EMOTES の名前('wave' など)。
   * opts: loop / fade / cancelOnMove(既定 true: 動き(walk / run)や空中の状態にすると中断)。再生できたら true。
   */
  playEmote(id, opts) { return this.player.playEmote(id, opts); }
  stopEmote() { this.player.stopEmote(); }

  // ── 毎フレーム ──
  /** 全アクターのアニメを dt 秒進める(tick から呼ばれる。描画ループなしで進めたいときは直接呼んでもよい) */
  update(dt) {
    dt = Math.min(dt, 0.05);
    for (const actor of this.actors.values()) actor.update(dt);
  }

  _updateCamera(dt = 0) {
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    const t = this.followTarget;
    const h = t ? t.height : 5.3;
    const ty = h * this.focus;
    const targetX = t && t.holder ? t.holder.position.x : 0;
    const targetZ = t && t.holder ? t.holder.position.z : 0;

    const view = this._view;
    view.target.set(targetX, ty, targetZ);
    view.position.set(
      targetX + Math.sin(this.yaw) * cp * this.dist,
      ty + sp * this.dist,
      targetZ + Math.cos(this.yaw) * cp * this.dist
    );
    for (const fn of this.cameraHooks) { try { fn(view, dt, this); } catch (e) { console.error('[cameraHook]', e); } }
    this.camera.position.copy(view.position);
    this.camera.lookAt(view.target);
  }

  tick() {
    const now = performance.now();
    const dt = (now - this.last) / 1000;
    this.last = now;
    this.update(dt);
    for (const fn of this.updaters) { try { fn(Math.min(dt, 0.05), this); } catch (e) { console.error('[updater]', e); } }
    this._updateCamera(Math.min(dt, 0.05));
    this.renderer.render(this.scene, this.camera);
    this.emit('frame', dt); // 描画の直後(カメラ行列が最新): 画面上のオーバーレイ描画などに使う
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.ro.disconnect();
    for (const actor of this.actors.values()) actor.dispose();
    this.actors.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
