// カメラ(Roblox の標準カメラに合わせる)。RAE の engine.addCameraHook に、次の3つを付ける。RAE は無改変のまま(衝突も一人称も RAE は知らない)。
//   1) 頭を中心にする + 高さの追従: カメラの注視点は操作キャラクターの頭(Head の中心)。足元(アバターの上下)に、なめらかに付いてくる。
//      階段・段差・ジャンプで画面が跳ねないよう指数的に追い、大きく離れたとき(テレポート)は即座に合わせる。
//   2) 一人称視点: ズームして近づくと(カメラ距離 enter 未満)、カメラが頭の位置になり、見た目の頭とその周りのアクセサリが隠れる。
//      ズームで離れるとすぐ三人称に戻る(距離 exit)。一人称の間は、上下に見渡せる範囲が広がる(pitch)。
//   3) 壁めり込み防止(三人称のみ): 注視点からカメラへレイを飛ばし、壁・床に当たったらその手前までカメラを寄せる。
//      カメラは大きさを持つので(近クリップ面で壁が切れる)、中心と上下左右にずらした5本で最も近い当たりを使う。
//      寄せるのは即座・戻すのはなめらか(壁の向こうが一瞬見えないように)。
// THREE には依存しない(view は x / y / z と set だけ使う)。レイ判定は physics.world.castRay(静的コライダー)。

/** 5本のレイの原点のずらし方向(カメラの右・上方向の係数) */
const OFFSETS = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];

export const CAMERA_DEFAULTS = {
  head: true,                                      // 注視点を頭にする(false なら RAE の既定=身長×focus)
  follow: { rate: 10, snap: 20 },                  // 高さの追従の速さ / これ以上離れたら即座に合わせる距離(stud)。follow: false で追従なし
  firstPerson: { enter: 1, min: 0.5, exit: 4, pitch: [-1.4, 1.4], hide: true },
  //   enter: この距離(stud)未満までズームしたら一人称 / min: 一人称のときの距離(= engine.minDist に設定) / exit: 一人称からズームで離れたときの三人称の距離
  //   pitch: 一人称の [minPitch, maxPitch](rad。±1.4 ≒ 80°) / hide: 頭とそのアクセサリを隠す。firstPerson: false で一人称なし
  collision: { radius: 0.6, margin: 0.3, minDist: 1.5, rate: 6 }, // collision: false で壁めり込み防止なし
  //   radius: カメラの半径(近クリップ面 0.5 を覆う大きさ) / margin: 壁との間に残す隙間 / minDist: これより近くには寄せない / rate: 戻る速さ
};

/**
 * 足元から頭の中心までの高さ。Head が見つからなければ null。
 * 静止姿勢のレイアウト(built.layout の Head の中心)から取る。メッシュの position は使えない(RAE の attachRig が、
 * パーツを関節ノードの子にして position を 0 にするため)。アニメで頭が揺れても、カメラは揺れない。
 */
export function headHeight(avatar) {
  const b = avatar && avatar.built;
  const head = b && b.layout && b.layout.find((d) => d.name === 'Head');
  return head && head.center && b.group && b.group.position ? head.center[1] + b.group.position.y : null;
}

/**
 * @param engine AvatarEngine
 * @param physics Physics(collision に使う)
 * @param opts { head, follow, firstPerson, collision, exclude: () => RigidBody|null(レイが無視する剛体。通常はキャラクターの body),
 *               onFirstPerson: (on) => void(一人称への出入りで呼ばれる) }
 * @returns { dispose(), firstPerson(getter) }
 */
export function attachCameraRig(engine, physics, opts = {}) {
  const offs = [];
  const f = opts.follow === false ? null : { ...CAMERA_DEFAULTS.follow, ...(opts.follow || {}) };
  const fp = opts.firstPerson === false ? null : { ...CAMERA_DEFAULTS.firstPerson, ...(opts.firstPerson || {}) };
  const c = opts.collision === false ? null : { ...CAMERA_DEFAULTS.collision, ...(opts.collision || {}) };
  const useHead = opts.head !== false;
  let inFp = false;
  const restore = [];

  // 1) 頭を中心 + 高さの追従
  if (useHead || f) {
    let camY = null;
    offs.push(engine.addCameraHook((view, dt) => {
      const t = engine.followTarget;
      if (!t || !t.holder) return;
      const y = t.holder.position.y;
      camY = !f || camY === null || Math.abs(y - camY) > f.snap ? y : camY + (y - camY) * (1 - Math.exp(-f.rate * dt));
      const hh = useHead ? headHeight(t) : null;
      // 頭が分かるときは、注視点 = 足元 + 頭の高さ。分からない/頭を使わないときは、従来どおり RAE の注視点に足元の高さを足す(追従なしなら足さない)
      const dy = hh !== null ? camY + hh - view.target.y : (f ? camY : 0);
      view.target.y += dy; view.position.y += dy;
    }));
  }

  // 2) 一人称
  if (fp) {
    restore.push([engine, 'minDist', engine.minDist]);
    engine.minDist = Math.min(engine.minDist, fp.min);
    const tp = [engine.minPitch, engine.maxPitch]; // 三人称の範囲(付けた時点のもの)
    const hidden = new Map(); // object → もとの visible
    const hide = () => { // 頭と、頭につけたアクセサリを隠す。もとの visible は覚えておく(ヘッドレスなど、もともと見えないものは戻しても見えない)
      const t = engine.followTarget, b = t && t.built;
      const now = new Set();
      if (fp.hide && b && b.parts) {
        for (const p of b.parts) {
          const isHead = p.name === 'Head' && !p.accessory, isHeadAcc = p.accessory && p.attachedTo === 'Head';
          if ((isHead || isHeadAcc) && p.object) { now.add(p.object); if (!hidden.has(p.object)) hidden.set(p.object, p.object.visible); p.object.visible = false; }
        }
      }
      for (const o of [...hidden.keys()]) if (!now.has(o)) hidden.delete(o); // 作り直しで捨てられた古いオブジェクト
    };
    const unhide = () => { for (const [o, v] of hidden) o.visible = v; hidden.clear(); };
    // アバターの作り直し・パーツ・アクセサリの変更のあとも、一人称の間は隠し直す
    for (const ev of ['avatar', 'bodypart', 'accessory']) offs.push(engine.on(ev, () => { if (inFp) hide(); }));
    const set = (on) => {
      if (on === inFp) return;
      inFp = on;
      if (on) { engine.minPitch = fp.pitch[0]; engine.maxPitch = fp.pitch[1]; hide(); }
      else { engine.minPitch = tp[0]; engine.maxPitch = tp[1]; engine.pitch = Math.min(tp[1], Math.max(tp[0], engine.pitch)); unhide(); }
      if (opts.onFirstPerson) opts.onFirstPerson(on);
    };
    const place = (view, d) => { // 三人称のカメラ位置を、距離 d で置き直す(注視点はそのまま)
      const cp = Math.cos(engine.pitch), sp = Math.sin(engine.pitch);
      view.position.set(view.target.x + Math.sin(engine.yaw) * cp * d, view.target.y + sp * d, view.target.z + Math.cos(engine.yaw) * cp * d);
    };
    offs.push(engine.addCameraHook((view) => {
      if (!inFp && engine.dist < fp.enter) { set(true); engine.dist = engine.minDist; }
      else if (inFp && engine.dist > engine.minDist + 1e-6) { set(false); engine.dist = fp.exit; place(view, fp.exit); } // ズームで離れた → すぐ三人称へ
      view.firstPerson = inFp;
      if (inFp) { // カメラ = 頭の位置。見る向きは yaw / pitch(三人称で注視点を見る向きと同じ)
        const cp = Math.cos(engine.pitch), sp = Math.sin(engine.pitch);
        view.position.set(view.target.x, view.target.y, view.target.z);
        view.target.set(view.position.x - Math.sin(engine.yaw) * cp, view.position.y - sp, view.position.z - Math.cos(engine.yaw) * cp);
      }
    }));
    offs.push(() => { if (inFp) { inFp = false; unhide(); engine.minPitch = tp[0]; engine.maxPitch = tp[1]; } });
  }

  // 3) 壁めり込み防止(三人称のみ)
  if (c) {
    let cur = null; // いまのカメラ距離
    offs.push(engine.addCameraHook((view, dt) => {
      if (view.firstPerson) { cur = null; return; }
      const { RAPIER, world } = physics;
      let dx = view.position.x - view.target.x, dy = view.position.y - view.target.y, dz = view.position.z - view.target.z;
      const len = Math.hypot(dx, dy, dz);
      if (len < 1e-4) return;
      dx /= len; dy /= len; dz /= len;
      // 右 = dir × up(真上・真下に近いときは x 軸)、上 = 右 × dir
      let rx = dz, ry = 0, rz = -dx; const rl = Math.hypot(rx, rz);
      if (rl < 1e-3) { rx = 1; rz = 0; } else { rx /= rl; rz /= rl; }
      const ux = ry * dz - rz * dy, uy = rz * dx - rx * dz, uz = rx * dy - ry * dx;

      const ex = opts.exclude ? opts.exclude() : null;
      let allowed = len;
      for (const [a, b] of OFFSETS) {
        const ox = (rx * a + ux * b) * c.radius, oy = (ry * a + uy * b) * c.radius, oz = (rz * a + uz * b) * c.radius;
        const ray = new RAPIER.Ray({ x: view.target.x + ox, y: view.target.y + oy, z: view.target.z + oz }, { x: dx, y: dy, z: dz });
        const hit = world.castRay(ray, len + c.margin, true, undefined, undefined, undefined, ex || undefined);
        if (hit) allowed = Math.min(allowed, (hit.timeOfImpact ?? hit.toi) - c.margin);
      }
      allowed = Math.min(len, Math.max(Math.min(c.minDist, len), allowed));

      // 寄せるのは即座、戻すのはなめらか(戻りの間も、いまの壁との距離は超えない)
      cur = cur === null || allowed < cur ? allowed : Math.min(allowed, cur + (allowed - cur) * (1 - Math.exp(-c.rate * dt)));
      view.position.x = view.target.x + dx * cur;
      view.position.y = view.target.y + dy * cur;
      view.position.z = view.target.z + dz * cur;
    }));
  }

  return {
    get firstPerson() { return inFp; },
    dispose() { for (const off of offs.reverse()) off(); offs.length = 0; for (const [o, k, v] of restore) o[k] = v; },
  };
}
