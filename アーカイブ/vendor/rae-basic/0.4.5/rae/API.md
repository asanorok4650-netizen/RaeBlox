# RAE API リファレンス (v0.4.2)

`import { ... } from './src/index.js'` で使える公開APIです。`index.js` に無いものは、ファイルを直接 import できます(内部寄りで、互換性は保証しません)。開発用ツール(R15→R6変換・バンドル検索・GLB書き出し・デモ)は `./tools/index.js`([→ 11. tools](#11-tools開発用))。
座標系: stud / Y上 / アバターの正面は -Z。角度はラジアン(指定が「度」のものは明記)。

目次: [1. 入口の一覧](#1-入口の一覧) / [2. AvatarEngine](#2-avatarengine) / [3. Avatar](#3-avatar) / [4. attachOrbit](#4-attachorbit) / [5. 独自アセット](#5-独自アセット) / [6. Roblox API・通信](#6-roblox-api通信) / [7. アニメーション](#7-アニメーション) / [8. 低レベルAPI](#8-低レベルapi) / [9. 設定](#9-設定) / [10. エラー](#10-エラー) / [11. tools](#11-tools開発用)

---

## 1. 入口の一覧
| 分類 | export | 定義 |
|---|---|---|
| エンジン | `AvatarEngine` `Avatar` `defaultAvatarDesc` `MOTION_STATES` | engine/engine.js |
| 入力 | `attachOrbit` | engine/orbit.js |
| 読み込み | `loadUserAvatar` `loadCustomAccessory` `loadCustomBodyPart` `bodyPartFromGeometry` | avatar/api.js |
| 通信 | `fetchRobloxJson` `checkProxy` `clearAssetCache` `NET` | avatar/api.js |
| エラー | `ApiError` `SourceError` | avatar/api.js, avatar/sources.js |
| 独自アセット | `registerAssetMap` `registerAssetSource` | avatar/sources.js |
| アニメ | `loadEmote` `loadAnimation` `DEFAULT_ANIMS` `DEFAULT_EMOTES` | avatar/animations.js |
| 設定 | `CONFIG` `DEFAULTS` | config.js |
| GLB | `parseGlb` `bakeTransform` | rbx/glb.js |
| UV | `normalizeUV` `isIdentityUV` `transformUVs` `uvAffine` `uvForward` `DEFAULT_UV` `WRAPS` `applyTextureUV` | avatar/uv.js, avatar/builder.js |
| 定数 | `BODY_SLOTS` | avatar/api.js |

**index.js に無いが、必要になりやすいもの**: `resolveUser` / `getAvatarJson` / `fetchAssetBytes` / `loadHeadAsset`(avatar/api.js)、`buildAvatar`(avatar/builder.js)、`parseAnimation`(rbx/animation.js)。

---

## 2. AvatarEngine
```js
new AvatarEngine(host, { antialias, background })
```
| 引数 | 説明 |
|---|---|
| `host` | 描画先のDOM要素(canvasを追加し、ResizeObserverで追従) |
| `antialias` | 既定は `CONFIG.antialias` |
| `background` | CSSカラー(既定 `'#1d2229'`)。`null` で透明 |

生成と同時に描画ループが始まり、`player`(ID `'player'`)が1体立ちます。

### プロパティ
| 名前 | 説明 |
|---|---|
| `player` | 最初のアクター(`Avatar`)。消せない |
| `actors` | `Map<id, Avatar>` |
| `followTarget` | カメラの追従先(`Avatar` / `null`=原点) |
| `scene` `camera` `renderer` | Three.js のオブジェクト(`PerspectiveCamera` fov50) |
| `yaw` `pitch` `dist` `focus` | カメラ。初期値 π / 0.12 / 12 / 0.55。`focus` は注視点の高さ(身長に対する比) |
| `minPitch` `maxPitch` | `look()` が pitch を収める範囲(rad。初期値 -0.5 / 1.35。pitch が正 = 見下ろす) |
| `minDist` `maxDist` | ズーム範囲(2〜80) |
| `emoting` | player がエモート再生中か(getter) |

### アクター
| API | 説明 |
|---|---|
| `addActor(id, { position, heading, desc })` → `Avatar` | 同じIDがあると例外。`position` は `[x,y,z]` |
| `getActor(id)` → `Avatar \| null` | |
| `removeActor(id)` → `boolean` | player は消せない(false)。追従中なら player に戻る |
| `follow(target)` | `Avatar` かID。`null` で原点 |

### player への委譲(8個だけ)
以下は `engine.player` の同名メソッド(・getter)を呼びます(詳細は [Avatar](#3-avatar))。

`loadUser(idOrName, onStatus)` / `set(spec)` / `setState(name)` / `setMotion(speed, grounded)` / `setHeading(rad)` / `playEmote(id, opts)` / `stopEmote()` / `emoting`(getter)

**これ以外は `engine.player.xxx` で呼びます**: `setAvatar` `setAvatarDesc` `resetAvatar` `equipAccessory` `unequipAccessory` `clearAccessories` `setBodyPart` `updateBodyPart` `clearBodyPart` `clearBodyParts` `setPoseOverride` `rigJoints` `jointScreenPositions`(v0.3.2 までは `engine.xxx` で呼べた。`setBodyPartGeometry` は `setBodyPart` に統合)。複数体を扱うときは `Avatar` を直接操作します。

### イベント・拡張
| API | 説明 |
|---|---|
| `on(name, fn)` → 解除関数 | `off(name, fn)` でも解除 |
| `addUpdater(fn)` → 解除関数 | `fn(dt, engine)`。アニメ更新の後・描画の前。`dt` は最大0.05秒 |
| `addCameraHook(fn)` → 解除関数 | `fn(view, dt, engine)`。カメラの位置の計算後・描画の前。`view = { target, position }`(`THREE.Vector3`、書き換えるとそのままカメラになる)。追加順に呼ぶ。注視点の追従・壁めり込み防止など、利用側でカメラを補正するための口 |
| `emit(name, ...args)` | リスナの例外は握りつぶして `console.error` |
| `log(level, msg)` | `'log'` イベントを発火 |

**イベント一覧**
| name | 引数 | 発火タイミング |
|---|---|---|
| `avatar` | `(built, actor)` | アバターを(再)構築した |
| `emote` | `({ id, anim }, actor)` | エモート再生開始 |
| `accessory` | `({ equipped \| unequipped \| cleared }, actor)` | 独自アクセサリの変更 |
| `bodypart` | `({ set \| updated \| cleared, part? }, actor)` | 独自パーツの変更 |
| `actor` | `({ added: id } \| { removed: id }, actor)` | アクターの追加・削除 |
| `log` | `(level, msg)` | エンジンのログ |
| `frame` | `(dt)` | 描画の直後(カメラ行列が最新。オーバーレイ描画向け) |

### カメラ・描画
| API | 説明 |
|---|---|
| `look(dx, dy)` | yaw/pitch を動かす(pitch は `minPitch`〜`maxPitch`。既定 -0.5〜1.35)。`attachOrbit` が呼ぶ |
| `zoom(factor)` | `dist` を倍率で変える(範囲内に丸める) |
| `resize()` | host のサイズに合わせる(通常は自動) |
| `setPixelRatioCap(v)` | 描画解像度の上限(`CONFIG.pixelRatioCap` に保存) |
| `update(dt)` | 全アクターのアニメを進める(`tick` から呼ばれる。描画ループなしで進めたいときに直接呼べる) |
| `dispose()` | 描画停止・全アクター破棄・WebGLコンテキスト解放・canvas削除 |

---

## 3. Avatar
`engine.addActor()` / `engine.player` で得ます(直接 `new` しない)。`engine` に委譲があるメソッド(8個。[2.](#player-への委譲8個だけ))は、ここと同じ名前・同じ挙動です。

### プロパティ
| 名前 | 説明 |
|---|---|
| `id` | アクターID |
| `position` | 足元の `THREE.Vector3`(= `holder.position`)。直接動かしてよい。作り直しても保たれる |
| `heading` | 向き(rad)。0 で -Z |
| `motion` | `{ speed, grounded }` |
| `height` | 身長(stud。アクセサリの頭上側を含む) |
| `holder` / `built` / `anim` | 描画用グループ / `buildAvatar` の戻り値 / アニメーター |
| `avatarDesc` | 基本の desc(独自アクセサリ・独自パーツを含まない) |
| `extraAccessories` `extraBodyParts` | 独自アクセサリ(配列) / 独自パーツ(スロット名→データ) |
| `poseOverride` | `setPoseOverride` の値 |
| `userData` | 呼び出し側が自由に使える入れ物(NPCのAI状態など) |
| `emoting` | エモート再生中か(getter) |

### 状態・位置
| API | 説明 |
|---|---|
| `setState(name)` | `'idle' \| 'walk' \| 'run' \| 'jump' \| 'fall'`。不明な名前は例外。**位置は動かさない** |
| `setMotion(speed, grounded = true)` | 速度(stud/秒)と接地を直接指定。約0.5以下で idle、16前後で walk、約16.5以上で run(runのアニメがあるとき) |
| `setHeading(rad)` | 向き |
| `setPosition(x, y = 0, z = 0)` | 足元の位置 |

`MOTION_STATES`: `idle {0, true}` / `walk {16, true}` / `run {24, true}` / `jump {0, false}` / `fall {0, false}`。`jump` と `fall` は空中の状態で、最初の約0.31秒が jump、その後 fall。

### アバター
| API | 戻り値 | 説明 |
|---|---|---|
| `loadUser(idOrName, onStatus?)` | `Promise<{ user, desc, built }>` | RobloxのユーザーID(推奨)/ ユーザー名。連続で呼んだら**後から呼んだほうだけ**を反映(古い呼び出しは `built: null`)。`onStatus(text)` は進捗 |
| `set(spec)` | `Promise<{ user, desc, built }>` | **見た目の一括適用**(下記) |
| `setAvatarDesc(desc)` | `built` | descから組み立て。独自アクセサリ・独自パーツを足して構築。`desc` は基本のdescとして保持される |
| `setAvatar(built)` | — | `buildAvatar()` の戻り値を直接設定(独自アクセサリ・独自パーツはいったん外れる)。足元(ボディ基準)が position に来る。`built.desc` を基本のdescとして保持するので、あとの装備変更でも見た目が残る(`built.desc` の無い built は、再構築で既定に戻る) |
| `resetAvatar()` | `built` | 既定のブロックアバターに戻す |

`addActor(id, { desc })` の `desc` も同様に基本のdescとして保持されます。

**`set(spec)`** — 全部を**並列に読み込み**、**1回だけ再構築**する(部品ごとに呼ぶより速く、エモートの中断も1回)。
```js
await avatar.set({
  user: 1234567,                          // 省略可。loadUser と同じ(連続で呼んだら後から呼んだほうだけ反映)
  accessories: ['hat:cat-ears', { source: '/wing.glb', attach: 'BodyBackAttachment' }],   // source か { source, ...meta }
  bodyParts: { Head: '/head.glb', 'Left Arm': { source: geometry, color: [1, 0, 0] } },   // setBodyPart と同じ入力
  replace: false,                         // true: 今の独自アクセサリ・独自パーツをいったん全部外してから適用
  onStatus: (text) => {},
});
```
- 1つでも読み込みに失敗したら、**何も変えずに**例外を投げる(途中まで反映されない)。
- `user` を渡さない呼び出しは、現在の見た目に足す。通信中の `loadUser` を打ち切らない(`equipAccessory` などと同じく、あとから合流する)。`user` 付きの呼び出しは、`loadUser` と同じく後から呼んだほうだけが反映される。
- 独自の `Head` はRobloxの頭より優先。順序は関係ない。
- イベントは、反映後に `avatar` → `accessory`(1つずつ `equipped`)→ `bodypart`(1つずつ `set`)の順。
- 返り値: `{ user, desc, built }`(`user` を渡さなかったときは `user` / `desc` が `null`。古い呼び出しは `built: null`)。

`user` = `{ id, name, displayName }`。`desc` = `{ sourceRigType, colors, clothing, face, accessories, customParts, report }`(`report`: `[{ id, name, type, status: 'ok'\|'skip'\|'error', note }]`)。

### 独自アクセサリ
| API | 説明 |
|---|---|
| `equipAccessory(source, meta?)` → `Promise<acc>` | 装備(アバターを読み直しても残る)。`meta` は [loadCustomAccessory](#loadcustomaccessorysource-meta) |
| `unequipAccessory(accOrName)` → `boolean` | `equipAccessory` の戻り値か名前で外す |
| `clearAccessories()` | 全部外す |

### 独自ボディパーツ
`slot` は `BODY_SLOTS` = `'Head' 'Torso' 'Left Arm' 'Right Arm' 'Left Leg' 'Right Leg'`。
| API | 説明 |
|---|---|
| `setBodyPart(slot, source, meta?)` → `Promise<part>` | 部位を差し替え。`source` の種類で**自動的に振り分ける**: ① GLB(ArrayBuffer / TypedArray / Blob / URL / 登録ID)→ [loadCustomBodyPart](#loadcustombodypartsource-meta) ② ジオメトリ `{ positions, … }` → [bodyPartFromGeometry](#bodypartfromgeometrygeometry-meta) ③ 読み込み済みのパーツ `{ geometry, … }`(`loadHeadAsset` / tools の `loadR15BodyParts` の戻り値)→ そのまま使う(`meta` は `color` `transparency` `face` `overColor` `uv` `wrap` `clothing` `clothFit` だけ効く。入力は書き換えない) |
| ~~`setBodyPartGeometry(slot, geometry, meta?)`~~ | 非推奨。`setBodyPart` と同じ(互換のために残してある) |
| `updateBodyPart(slot, patch)` → `boolean` | 作り直さずに見た目だけ変える。`patch`: `{ uv, wrap, color, transparency }`。ドラッグ中のスライダー向け |
| `clearBodyPart(slot)` → `boolean` / `clearBodyParts()` | 標準の箱に戻す |

### エモート
| API | 説明 |
|---|---|
| `playEmote(id, opts?)` → `Promise<boolean>` | `id`: 標準エモート名(`DEFAULT_EMOTES` のキー、大文字小文字無視)/ アニメのアセットID / 解析済みアニメ・エモートJSON / 独自アセットID(`'emote:xxx'`)。読み込み中にアバターが変わった・消えたら `false` |
| `stopEmote()` | フェードアウトして止める |

`opts`: `loop`(省略時はアニメ自身の設定)/ `fade`(秒。既定0.15)/ `cancelOnMove`(既定 `true`: `walk` / `run` / 空中にすると中断)/ `onEnd`(終了・中断時)。
標準エモート: `wave` `point` `cheer` `laugh` `dance` `dance2` `dance3`。

### リグ・ツール向け
| API | 説明 |
|---|---|
| `setPoseOverride(poses \| null)` | `{ 'Right Arm': { pos: [x,y,z], q: [x,y,z,w] }, … }`。設定中は待機・歩行・エモートが止まる。`null` で解除。作り直しても残る |
| `rigJoints()` | `[{ name(Pose名), joint(Motor6D名), parent }]` |
| `jointScreenPositions()` | `[{ name, joint, x, y, visible }]`。描画領域のCSS px。直近の描画のカメラで計算 |

**関節の回転軸**(Motor6D.Transform のローカル座標): 肩・腰は Z=前後に振る(+で前)/ X=側方へ開く(−で外へ)/ Y=ひねり。首・胴は X=前に倒す(+)/ 位置のZ=上下。

### ネットワーク同期
| API | 説明 |
|---|---|
| `getNetState()` | `{ id, pos: [x,y,z], heading, speed, grounded }`。JSONにできる小さな状態(見た目・エモートは含まない) |
| `applyNetState(state, { smooth = 1 })` | `smooth`(0〜1)の割合だけ位置・向きを近づける(向きは最短回り)。省略で即時 |

### その他
`update(dt)`(アニメを進めて位置・向きを反映。通常はエンジンが呼ぶ)/ `dispose()`(`engine.removeActor` が呼ぶ)。

---

## 4. attachOrbit
```js
const orbit = attachOrbit(engine, host, { onTap: (x, y) => {} });
orbit.dispose();
```
ドラッグで回転 / ホイール・2本指ピンチでズーム / タップ(8px未満・350ms未満)で `onTap(x, y)`(canvas内のCSS px)。コンテキストメニューは無効化。

---

## 5. 独自アセット

### registerAssetMap(map) / registerAssetSource(resolver)
```js
const off = registerAssetMap({ 'hat:cat-ears': '/assets/cat-ears.glb' });   // 値: URL | ArrayBuffer | TypedArray | Blob
registerAssetSource((id) => id.startsWith('mine:') ? loadFromMyStorage(id) : null);  // null/undefined = 担当外
```
- 返り値は解除関数。後から登録したものが先に問い合わせられます。
- 数字のIDも上書き可(Roblox形式のrbxmを自前で差し替えたいとき)。
- IDは数字以外の文字列。URLらしい文字列(`http(s):` `blob:` `data:` `/` `./` `../` で始まる)は登録IDではなくURLとして扱います。

### loadCustomAccessory(source, meta)
`source`: ArrayBuffer / TypedArray / Blob / URL / 登録ID。GLB以外はRoblox形式(Handle+Attachment の rbxm/rbxmx)として読みます。
| meta | 既定 | 説明 |
|---|---|---|
| `name` | source | 外すときの名前 |
| `attach` | `'HatAttachment'` | 取り付け位置(下表) |
| `scale` | 1 | 数値 or `[x,y,z]` |
| `rotation` | `[0,0,0]` | **度** `[x,y,z]` |
| `offset` | `[0,0,0]` | stud `[x,y,z]` |
| `unit` | `1/0.28` | GLBの単位→stud(メートルとみなす) |
| `flipFront` | `true` | glTF正面+Z → Roblox正面-Z |
| `color` / `transparency` | — | 色 / 透明度 |

GLBの原点が取り付け位置。`attach`: `HatAttachment` `HairAttachment` `FaceFrontAttachment` `FaceCenterAttachment` `NeckAttachment` `BodyFrontAttachment` `BodyBackAttachment` `Left/RightCollarAttachment` `Left/RightShoulderAttachment` `WaistFront/Back/CenterAttachment`(未対応名は `BAD_ATTACHMENT`)。

### loadCustomBodyPart(source, meta)
GLBのみ(`UNSUPPORTED_FORMAT`)。GLBの原点がパーツの中心。単位・向きの扱いはアクセサリと同じ。
| meta | 説明 |
|---|---|
| `slot` | **必須**。`BODY_SLOTS` のどれか |
| `scale` `rotation` `offset` `unit` `flipFront` `color` `transparency` | アクセサリと同じ |
| `face` | 頭のみ。既定の顔の板を重ねる(既定 false) |
| `clothing` | `false` でクラシックの服を重ねない |
| `clothFit` | `'bbox'`(メッシュ全体に合わせる・既定)/ `'standard'`(R6標準サイズの箱に合わせる) |
| `texture` | GLB内蔵の絵を別の画像に差し替え(画像 / Blob / URL / 登録ID) |
| `uv` `wrap` | テクスチャの位置・拡大・回転 / `'repeat' \| 'clamp' \| 'mirror'`([uv.js](#8-低レベルapi)) |
| `overColor` | 透明部分を体の色で塗る |
| `plainColor` | GLBの「テクスチャなし」面の単色(テクスチャ付き/なしが混在するGLB向け) |

R6標準サイズ: Head 1.25立方 / Torso 2×2×1 / 腕・脚 1×2×1。

### bodyPartFromGeometry(geometry, meta)
`geometry`: `{ positions, normals, uvs, indices, plain? }`(stud・Roblox座標・原点=パーツ中心)。`meta`: `{ slot, texture(画像), uv, wrap, color, plainColor, transparency, face, overColor, clothing, clothFit }`。ツール・手続き生成向け。通常は `setBodyPart(slot, geometry, meta)` から使う。

---

## 6. Roblox API・通信
プロキシ(`CONFIG.proxyBase`)経由。前提・429対策は README を参照。

| API | 説明 |
|---|---|
| `loadUserAvatar(input, onStatus?)` → `{ user, desc }` | ユーザーID/名前 → desc まで一括。数字IDは表示名とアバター定義を並列取得 |
| `checkProxy(fetchImpl?, origin?)` → `{ ok, message, detail? }` | 接続確認(`/health`)。例外は投げない。`ok` はAPIキー設定済みのときだけ true |
| `clearAssetCache()` → `Promise<boolean>` | Cache API に保存したアセットを消す |
| `NET` | `{ concurrency: 3, retries: 3, baseDelay: 1500, maxDelay: 20000, sleep, log }`。書き換えて調整できる |
| `fetchRobloxJson(url)` | プロキシ経由でRoblox APIをGET(許可ホストのみ) |

カタログ検索・R15バンドルの取り込みは、開発用ツール([11. tools](#11-tools開発用))に移しました。

---

## 7. アニメーション
| API | 説明 |
|---|---|
| `DEFAULT_ANIMS` | 状態ごとの標準アニメID(先頭から順に試す): `idle [180435571, 180435792]` `walk [180426354]` `run [180426354]` `jump [125750702]` `fall [180436148]` |
| `DEFAULT_EMOTES` | `wave 128777973` `point 128853357` `cheer 129423030` `laugh 129423131` `dance 182435998` `dance2 182491037` `dance3 182491065` |
| `loadAnimation(id)` | アニメアセット(KeyframeSequence / CurveAnimation)を取得・解析(同じIDは使い回す) |
| `loadEmote(id)` | `playEmote` が内部で使う。アセットID・解析済みアニメ・エモートJSON・独自ID(`'emote:xxx'`)のどれでも可 |

IDは記憶ベースです。読み込めないときはここを直してください。標準アニメが無い状態は、手続き式の揺れ・歩行で代用します。
エモートJSONは `{ length, tracks | channels, loop? }`(`length > 0` が必須)。

---

## 8. 低レベルAPI
独自ツールを作る人向け。形が変わりやすいので、必要なものだけ使ってください。

- **GLB**: `parseGlb(buf)` / `bakeTransform(g, opts)`(書き出しは tools の `writeGlb`)
- **UV** (`avatar/uv.js`): `DEFAULT_UV` = `{ offset: [0,0], scale: [1,1], rotation: 0, center: [0.5,0.5], wrap: 'repeat' }` / `WRAPS` / `normalizeUV(uv)` / `isIdentityUV(uv)` / `transformUVs(uvs, uv)` / `uvAffine(uv)` / `uvForward(uv)` / `applyTextureUV(tex, uv, wrap)`(Three.jsのテクスチャへ適用)
- **組立**: `buildAvatar(desc)`(`avatar/builder.js`)→ `{ group, parts, box, bodyBox, layout, report, desc }`(`desc` は渡したdesc。`Avatar.setAvatar` が基本のdescとして保持する。`skeleton` は `Avatar` がアニメーターを作った後に付く)。`group` の原点は足元の中心、`bodyBox` はアクセサリを除くボディの bbox。

---

## 9. 設定
`CONFIG`(localStorage保存。使えない環境でも落ちない)

| 名前 | 既定 | 説明 |
|---|---|---|
| `proxyBase` | `DEFAULTS.proxyBase` | プロキシURL。代入で保存。旧プロキシ(`rbxl-player-proxy`)の値が残っていても無視 |
| `proxyBaseOverride` | — | 保存済みの上書き値(読み取りのみ) |
| `pixelRatioCap` | 2 | 描画解像度の上限 |
| `antialias` | true | 次回の `AvatarEngine` 生成から有効 |
| `lastUser` | `''` | 最後に読み込んだユーザー(デモUI用) |

---

## 10. エラー
通信・読み込みの失敗は `ApiError`(`e.code` / `e.message`)、独自アセット取得は `SourceError`。どちらも `index.js` から import でき、`e.code` で分岐できます(`e instanceof ApiError`)。

| code | 意味 |
|---|---|
| `NO_PROXY` / `NETWORK` / `ORIGIN_NOT_ALLOWED` | プロキシ未設定 / 接続不可 / Workerの `ALLOWED_ORIGIN` に未登録(CORS) |
| `OLD_WORKER` | Workerが `/user/{id}` 等に未対応(rbx-db-proxyの更新が必要) |
| `NO_API_KEY` / `KEY_REJECTED` | WorkerのAPIキー未設定 / 拒否 |
| `RATE_LIMITED` | 429が再試行しても続いた |
| `ASSET_UNAVAILABLE` / `ASSET_TOO_LARGE` / `PROXY_UPSTREAM` `PROXY_CDN` `PROXY_NO_LOCATION` `PROXY_BAD_LOCATION` | アセット取得の失敗 |
| `HTTP_<status>` | 上記以外のHTTPエラー |
| `EMPTY` / `NOT_FOUND` / `BAD_USER` | ユーザー入力が空 / 見つからない / 応答が不正 |
| `BAD_SLOT` / `BAD_ATTACHMENT` / `BAD_TEXTURE` / `NOT_IMAGE` | 引数・画像が不正 |
| `UNSUPPORTED_FORMAT` / `PARSE_ERROR` | 未対応形式(XML頭アセット・GLB以外のボディパーツなど) / 解析失敗 |
| `NO_PART` / `NO_HANDLE` / `NO_MESH` / `NO_TEXTURE` / `NO_ASSETS` | アセットに必要な部品が無い |
| `CATALOG_BLOCKED` / `BAD_CATALOG` / `BAD_ID` | カタログ関連(Workerが `catalog.roblox.com` を許可していない等) |
| `CUSTOM_FETCH` / `CUSTOM_BAD_SOURCE` | (SourceError)独自アセットのURL取得失敗 / 形式不明 |

---

## 11. tools(開発用)
`import { … } from './tools/index.js'`。エンジン本体(`src/`)はこれに依存しません。

### loadBodyBundle(avatar, input, { fit, onStatus })
R15バンドル(ID / URL)またはアセットID配列を、**取得 → R6へ変換 → `avatar.set({ bodyParts })` で反映**まで一度に行う。再構築は1回。変換できたパーツが無ければ何も変えない。
```js
import { loadBodyBundle } from './tools/index.js';
const { name, parts, skipped } = await loadBodyBundle(engine.player, 'https://www.roblox.com/bundles/123456', { fit: 'stretch' });
```
- `avatar`: `Avatar`(`engine.player` など)。`input`: バンドルID / URL、またはアセットIDの配列。`fit`: `'stretch'`(既定)/ `'uniform'` / `'none'`。
- 返り値: `{ name, parts, skipped }`(`name` はバンドル名。配列入力のときは空)。

### その他
| API | 説明 |
|---|---|
| `loadR15BodyParts(assetIds, { fit }, onStatus?)` → `{ parts, skipped }` | R15の胴・腕・脚をR6の各パーツへ組み立てる。`parts[slot]` は `setBodyPart(slot, part)` にそのまま渡せる。ブラウザ専用(複数テクスチャを canvas でアトラス化) |
| `searchBodyBundles({ keyword, sort, limit, cursor })` → `{ items, next }` | カタログのボディパーツ検索。`sort`: `popular`(既定)/ `favorited` / `relevance` / `updated`。Workerが `catalog.roblox.com` を許可している必要あり(`CATALOG_BLOCKED`) |
| `bundleAssetIds(input)` → `{ name, assetIds }` | バンドルID/URL → アセットID一覧 |
| `extractR15Parts` `planChain` `slotsIn` `bakePiece` `mergeGeometry` `fitToR6` `remapUVsToCell` `R15_CHAINS` `R6_SIZE` | R15→R6変換の部品(`tools/r15.js`) |
| `writeGlb(g, opts)` | ジオメトリ → GLB(`tools/glb-write.js`)。既定設定(`unit = 1/0.28`, `flipFront = true`)で読み込むと元の位置・大きさ・向きに戻る |
| `DEMOS` | オフライン用のUV検証アバター(`tools/demo.js`) |
