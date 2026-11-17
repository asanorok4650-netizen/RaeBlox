# RBX Avatar Engine (RAE) v0.4.2

Robloxの**R6アバターを表示し、アニメーション(エモート)を再生する**、ビルド不要のブラウザ用ライブラリです。
ワールド・衝突判定・歩行物理・トリガー・環境設定・rbxl読み込みは持ちません(それらは利用側で作ります)。

- **npm / Vite / React 不要。** Three.js は `importmap` で CDN(jsDelivr, `three@0.170.0`)から取得します。
- 動作: フォルダをそのままHTTPで配信するだけ。`file://` は不可(ES Modules + importmap のため)。
- 座標系はRoblox準拠: 単位 stud、Y上、アバターの正面は **-Z**。アバターは原点(足元)に立ち、カメラは既定で正面(yaw=π)から見ます。

ドキュメント: **[API.md](./API.md)**(全API・型・エラーコード) / **[CHANGELOG.md](./CHANGELOG.md)**(変更履歴)

## クイックスタート
```html
<script type="importmap">
{ "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js" } }
</script>
<div id="stage" style="width:100vw;height:100vh"></div>
<script type="module">
  import { AvatarEngine, attachOrbit } from './src/index.js';

  const stage  = document.getElementById('stage');
  const engine = new AvatarEngine(stage);          // { background: '#1d2229' | null(透明), antialias }
  attachOrbit(engine, stage);                      // ドラッグで回転 / ホイール・ピンチでズーム(任意)

  await engine.loadUser(1234567);                  // RobloxのユーザーID(要プロキシ)
  engine.setState('walk');                         // idle / walk / run / jump / fall
  await engine.playEmote('wave');                  // 標準エモート名 / アセットID / エモートJSON

  // 見た目はまとめて指定もできる(並列に読み込み、再構築は1回。順序は不問)
  await engine.set({ user: 1234567, accessories: ['hat:cat-ears'], bodyParts: { Head: 'part:my-head' } });
</script>
```
プロキシ無しでも、既定のブロックアバター・独自GLB・エモートJSONは動きます。

## 基本の考え方
| 概念 | 説明 |
|---|---|
| `AvatarEngine` | シーン・カメラ・描画ループ・アクター管理。拡張は `addUpdater` / `on` から |
| `Avatar`(アクター) | 1体分の見た目・アニメ・位置・向き・動きの状態。プレイヤーもNPCも他プレイヤーも同じ |
| `engine.player` | 最初から居る1体(ID `'player'`、消せない)。`engine` に委譲があるのは `loadUser` `set` `setState` `setMotion` `setHeading` `playEmote` `stopEmote` `emoting` の8個だけ。それ以外(`equipAccessory` `setBodyPart` `setPoseOverride` など)は **`engine.player.xxx`** で呼ぶ |
| 動きの状態 | `setState('walk')` は**歩行アニメを再生するだけ**で、位置は動かしません。移動は `avatar.position` を自分で動かす |
| 独自アセット | `registerAssetMap` / `registerAssetSource` で、Roblox外のGLB・エモートを登録して使う |

状態の参照(`holder` / `built` / `motion` / `height` など)も `engine.player.*` から行います。

### 見た目の適用: `set`(推奨)と、個別の `equipAccessory` / `setBodyPart`
- **`avatar.set({ user, accessories, bodyParts, replace })`** は、全部を**並列に読み込んで1回だけ再構築**します(エモートの中断も1回)。1つでも失敗したら何も変えずに例外を投げます。
- 個別の `equipAccessory` / `setBodyPart` は、呼ぶたびに再構築します。順序は不問で、`loadUser` の前後でも通信中でも、独自アクセサリ・独自パーツは保持されて合成されます(独自の `Head` はRobloxの頭より優先)。
- `addActor(id, { desc })` や `setAvatar(built)` で与えた見た目も、あとの装備変更で保持されます(`built.desc` を基本のdescとして覚える)。

### 複数のアバター
```js
const npc = engine.addActor('npc-1', { position: [10, 0, 0], heading: Math.PI });
await npc.loadUser(1234567);
npc.setState('walk');
engine.addUpdater((dt) => { npc.position.x -= 16 * dt; });   // 動かし方は自由(AI・経路・衝突は自前)
engine.follow(npc);                                          // カメラの追従先を切り替え
```
- ネットワーク同期向けに `avatar.getNetState()` / `avatar.applyNetState(state, { smooth })` があります(通信・補間は利用側)。見た目は `loadUser(userId)` で渡せるユーザーIDを送るのが軽いです。
- **既知の制限**: アクセサリ・独自パーツを変えるたびにその1体を丸ごと作り直します(再生中のエモートは途切れる)。数十体を超える場合は形状・テクスチャの共有化が必要です。

## プロキシ(Roblox アバター・アセット取得に必要)
Roblox APIはCORSで直接呼べないため、Cloudflare Worker [rbx-db-proxy](https://github.com/asanorok4650-netizen/rbx-db-proxy)(`/asset/{id}`・`?url=`・`/user/{id}`・`/health`。アセットはR2にキャッシュ)経由で取得します。

- 既定のURLは `src/config.js` の `DEFAULTS.proxyBase`。`CONFIG.proxyBase = '...'` で差し替え(localStorageに保存)。`checkProxy()` で接続確認。
- Workerの `ALLOWED_ORIGIN` に、ページのOrigin(例 `http://localhost:8080`、**ポートまで完全一致**)が必要です。
- **ユーザーIDを推奨**: ID入力は `/user/{id}` で表示名を取るだけ。ユーザー名入力は usernames API を1回呼びます(結果はキャッシュしません)。
- アバター定義は `GET /v4/avatar/users/{id}` を優先し、失敗したらv1に戻します。
- **429対策**: アセット取得は同時3件・同IDは1回にまとめ、429は `Retry-After`(無ければ指数バックオフ)で最大3回再試行。取得済みアセットはCache APIに保存。上限は `NET`(`src/avatar/api.js`)で調整できます。

## R6専用について
- アバターは常に**R6**。R15ユーザーを読み込んでも、ボディは標準のR6(箱)で、体色・クラシックのシャツ/パンツ/Tシャツ・顔・アクセサリーだけ引き継ぎます。
- **頭**(ダイナミックヘッド / クラシック)はRobloxのアセットを読み込み、R6の頭に当てます(顔が焼き込まれた頭には顔の板を重ねません)。
- 胴・腕・脚のアセットとレイヤー服(type 64〜72)は読み込みません(理由は `desc.report`)。R15のボディパーツを使いたいときは、開発用ツール `tools/` の `loadBodyBundle(avatar, bundleIdOrAssetIds)` でR6へ変換して差し替えます(下記「開発用ツール」)。
- 関節は `src/avatar/rig6.js` のMotor6D(RootJoint / Neck / Right・Left Shoulder / Right・Left Hip)。Pose名は `Torso` `Head` `Left Arm` `Right Arm` `Left Leg` `Right Leg`。

## 動き・エモート
- `walk` は速度16、`run` は24相当で標準アニメを再生(速度に応じて再生速度が変わる)。`jump` / `fall` はどちらも空中で、最初の約0.31秒が jump、その後 fall。
- エモートは移動アニメの上に重ねて再生します。既定では `walk` / `run` / 空中の状態にすると中断(`cancelOnMove: false` で無効)。非ループは最後まで再生するとフェードで待機に戻ります。
- 標準エモート名: `wave` `point` `cheer` `laugh` `dance` `dance2` `dance3`。
- 標準アニメ・エモートのIDは記憶ベースです。読み込めないときは `src/avatar/animations.js` の `DEFAULT_ANIMS` / `DEFAULT_EMOTES` を直してください。R15用のアニメ(Pose名が `UpperTorso` など)は効きません。
- **関節の回転軸(Motor6D.Transform のローカル座標)**: 肩・腰は Z=前後に振る(+で前)/ X=側方へ開く(−で外へ)/ Y=ひねり。首・胴は X=前に倒す(+)/ 位置のZ=上下。

## 独自ボディパーツ・アクセサリ(Roblox外のGLB)
```js
import { registerAssetMap } from './src/index.js';
registerAssetMap({
  'hat:cat-ears':   '/assets/cat-ears.glb',        // URL・ArrayBuffer・Blob のどれでも可(IDは数字以外の文字列)
  'emote:backflip': '/assets/backflip.rbxmx',      // KeyframeSequence。エモートJSON(.json)も可
});

const hat = await engine.player.equipAccessory('hat:cat-ears', { attach: 'HatAttachment', offset: [0, 0.2, 0] });
engine.player.unequipAccessory(hat);

await engine.player.setBodyPart('Head', 'part:my-head', { scale: 1, face: false });   // 6部位を差し替え
engine.player.clearBodyPart('Head');
await engine.playEmote('emote:backflip');
```
- **GLBの原点が取り付け位置(アクセサリ)/ パーツの中心(ボディパーツ)**。単位はメートル→stud(1 stud = 0.28 m)、glTFの正面+Zは Roblox の -Z へ反転(`flipFront: false` で無効)。
- `setBodyPart(slot, source, meta)` の `source` は種類で自動的に振り分けます: **GLB**(ArrayBuffer / Blob / URL / 登録ID)/ **ジオメトリ** `{ positions, normals, uvs, indices }` / **読み込み済みのパーツ** `{ geometry, … }`(`loadHeadAsset` や tools の `loadR15BodyParts` の戻り値)。
- ボディパーツは関節(Motor6D)の子になり、アニメにそのまま追従します。関節位置は固定です。
- R6標準サイズ: Head 1.25立方 / Torso 2×2×1 / 腕・脚 1×2×1。クラシックの服は独自パーツには貼りません(`clothing` で制御)。
- 対応: 三角形メッシュ、ノード階層、GLB内蔵のベースカラーテクスチャ1枚。**非対応**: Draco/Meshopt圧縮、スキン・モーフ・アニメ、外部ファイル参照の `.gltf`、複数テクスチャ。
- Roblox形式(Handle+Attachmentの `.rbxm` / `.rbxmx`)もアクセサリとして渡せます(メッシュ・テクスチャIDは数字のRobloxアセットのみ)。
- `meta` の全項目・`attach` の一覧は [API.md](./API.md) を参照。

## ツール向け(エンジンのAPI)
`setPoseOverride`(関節ポーズ固定)/ `rigJoints` / `jointScreenPositions` / `updateBodyPart`(作り直さずに見た目だけ変更)/ `on('frame')`。ジオメトリからの差し替えは `setBodyPart(slot, geometry)`。いずれも `engine.player` から。詳細は API.md。

## 開発用ツール(`tools/`)
エンジン本体(`src/`)は使わない・依存しない、開発用のものです。`import { … } from './tools/index.js'`。
| 名前 | 説明 |
|---|---|
| `loadBodyBundle(avatar, bundleIdOrAssetIds, { fit, onStatus })` | R15バンドル(ID / URL)またはアセットID配列を、取得 → R6へ変換 → `avatar.set({ bodyParts })` で反映まで一度に行う |
| `loadR15BodyParts` / `searchBodyBundles` / `bundleAssetIds` | 変換・カタログ検索・バンドル→アセットID。カタログは Worker が `catalog.roblox.com` を許可している必要あり。アトラス化はブラウザ専用 |
| `extractR15Parts` `planChain` `slotsIn` `bakePiece` `mergeGeometry` `fitToR6` `remapUVsToCell` `R15_CHAINS` `R6_SIZE` | R15→R6変換の部品(`r15.js`) |
| `writeGlb` | ジオメトリ → GLB(`glb-write.js`) |
| `DEMOS` | オフライン用のUV検証アバター(`demo.js`) |

## ファイル構成(このzip)
```
src/index.js          ライブラリの入口(公開APIの再export)
src/config.js         設定(プロキシURL・pixelRatio上限など。localStorage保存)
src/engine/           engine.js(AvatarEngine) / avatar.js(Avatar) / orbit.js(視点操作の入力)
src/animation/        animate.js(待機・歩行・ジャンプ・落下の切替とエモート層。THREE非依存) / animator.js(リグへ流し込む)
src/avatar/           builder.js(R6パーツ・服・顔・アクセサリの組立) / api.js(Roblox API・アセット取得・独自アセット・checkProxy)
                      sources.js(独自アセットの取得口) / animations.js(標準アニメID) / rig6.js・skeleton.js・rigs.js(Motor6Dリグ・UV・アタッチメント)
                      adjust.js(アクセサリ調整の焼き込み) / uv.js(テクスチャUV変換)
src/rbx/              Roblox形式パーサ(rbxm / rbxmx / メッシュv1〜v7 / LZ4 / Draco / アニメーション)・GLBパーサ
tools/                開発用(本体は依存しない): index.js / bundles.js(バンドル検索・R15取得・loadBodyBundle) / r15.js(R15→R6変換) / glb-write.js / demo.js
test/                 rebuild.mjs(再構築・set・setBodyPartの振り分け。three・builder・apiはスタブ) と、そのローダー・スタブ
vendor/draco/         メッシュv7.00用デコーダ(wasm)。CDNではなく同梱
LICENSE
```
デモページ(`index.html` / `src/ui/`)と、既存のテスト(`actors.mjs` / `api.mjs`)は、このzipには含まれていません。

## テスト
Node 22+。
```
cd test && node --import ./rebuild-loader.mjs rebuild.mjs   # 再構築・descの保持・読み込み順序・set・setBodyPartの振り分け・engine委譲の数
cd test && node --import ./loader.mjs actors.mjs             # (別管理)複数アクター・同期状態・カメラ追従・ポーズ固定・loadUserの競合
cd test && node api.mjs                                      # (別管理)通信まわり(fetchはモック): 表示名の並列取得・429の扱い・同一アセットの取得まとめ
```
別管理の `actors.mjs` は、`engine.setBodyPart` など削除した委譲を呼んでいれば `engine.player.xxx` へ直してください。
実際のWebGL描画とRobloxアセット取得は自動テスト対象外です(実機で確認してください)。

## ライセンス
MIT License(元プロジェクトに準ずる)
