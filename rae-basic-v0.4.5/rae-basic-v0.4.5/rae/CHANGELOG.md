# CHANGELOG

新しいものが上。

## v0.4.2(v0.4.1 から。basic v0.4.4)
**追加**: `engine.minPitch` / `engine.maxPitch`(`look()` の pitch の範囲。既定は従来どおり -0.5 / 1.35)。一人称視点で真上近くまで見上げられるように、利用側が範囲を変えられる。既存の挙動は変わらない。

## v0.4.1(v0.4.0 + 貼らない面の修正から。basic v0.4.3)
**追加**: `engine.addCameraHook(fn)`: カメラ位置の計算後・描画の前に `fn(view, dt, engine)` を呼ぶ(`view = { target, position }`、`THREE.Vector3`)。書き換えた値がそのままカメラになる。`_updateCamera(dt)` が dt を受け取る(省略で 0)。
**変更なし**: 既存のAPI・挙動(フックが無ければ従来と同じカメラ)。basic が `_updateCamera` を差し替えていた処理を、このフックへ移すための追加。

## v0.4.0 + 貼らない面の修正(RAE-BodyBuilder v0.3.3 から取り込み。basic v0.4.2)
**修正**: テクスチャの無いGLBでも「貼らない面」(plain)を保持する。`tools/glb-write.js` は plain があれば(画像の有無に関わらず)別プリミティブ・材質名 `Plain` で書き出し、`rbx/glb.js` は画像が無いときも材質名 `Plain` のプリミティブを plain として返す。`loadCustomBodyPart` は texture が無くても plain を残し、`builder.js` は map が無くても plain を別材質で描く(クラシック服は plain の面に重ならない)。

## v0.4.0(v0.3.2 から)
**修正**:
- `addActor(id, { desc })` で与えた見た目が、あとで `equipAccessory` / `setBodyPart` などを呼ぶと既定のブロックアバターに戻っていた。
- `setAvatar(built)` で直接設定した見た目も同様に戻っていた。`buildAvatar` の戻り値に `desc` を加え、`setAvatar` がそれを基本のdescとして保持する(`built.desc` の無い built は従来どおり既定に戻る)。`setAvatar` は独自アクセサリ・独自パーツをいったん外す。
**追加**:
- `avatar.set({ user, accessories, bodyParts, replace, onStatus })`(`engine.set` も): 全部を並列に読み込み、1回だけ再構築する。失敗時は何も変えない。
- `setBodyPart(slot, source, meta)` が GLB / ジオメトリ / 読み込み済みのパーツ(`loadHeadAsset` や `loadR15BodyParts` の戻り値)を自動で振り分ける。
- `tools/` の `loadBodyBundle(avatar, bundleIdOrAssetIds, opts)`: バンドルの取得 → R6へ変換 → 反映を一度に。
- `index.js` から `ApiError` / `SourceError` を export。
- `test/rebuild.mjs`(three・builder・api をスタブにした再構築のテスト)。
**変更(破壊的)**:
- `AvatarEngine` の player への委譲を8個(`loadUser` `set` `setState` `setMotion` `setHeading` `playEmote` `stopEmote` `emoting`)に絞った。**削除**: `engine.setAvatar` `setAvatarDesc` `resetAvatar` `equipAccessory` `unequipAccessory` `clearAccessories` `setBodyPart` `setBodyPartGeometry` `updateBodyPart` `clearBodyPart` `clearBodyParts` `setPoseOverride` `rigJoints` `jointScreenPositions`。`engine.player.xxx` に書き換える(`engine.setBodyPart(...)` → `engine.player.setBodyPart(...)`)。
- 開発用のコードを `tools/` へ移動し、`src/index.js` から外した: `rbx/r15.js` → `tools/r15.js`(`extractR15Parts` など)、`rbx/glb-write.js` → `tools/glb-write.js`(`writeGlb`)、`avatar/demo.js` → `tools/demo.js`、`api.js` のバンドル系(`searchBodyBundles` `bundleAssetIds` `loadR15BodyParts`)→ `tools/bundles.js`。`import` を `./tools/index.js` に変える。`api.js` は分割せず、`getJson` / `textureOrNull` を export しただけ。
**非推奨**: `Avatar.setBodyPartGeometry`(`setBodyPart` と同じ。互換のために残してある)。
**整理**: `engine.js` の宙に浮いたコメントを削除。

## v0.3.2(v0.2.1 から)
**修正**: アクセサリが足より下に垂れる(尻尾・マントなど)と、アバターが浮いていた。足元の基準(接地)をボディ(独自パーツ込み・アクセサリ除く)の bbox で決め、身長はアクセサリの頭上側を含めて計算する。`buildAvatar` の戻り値に `bodyBox` を追加(`box` は従来どおりアクセサリ込み)。
**削除**: `nameCache`(ユーザー名→IDのlocalStorageキャッシュ)、`engine.holder / avatar / anim / height / avatarDesc / extraAccessories / extraBodyParts / poseOverride / heading / motion` の player 委譲プロパティ(状態は `engine.player.*` から参照。`engine.setState` / `loadUser` / `playEmote` / `setHeading` などのメソッドと `engine.emoting` は残す)、`Avatar.avatar`、`posesToCFs` / `quatToRot`(エモートエディタ廃止のため)。
**据え置き**: 複数アクター・ネット同期(`getNetState` / `applyNetState`)、モジュール共有の設定・既定プロキシ、v1 avatar APIへのフォールバック、手続き式の歩行・揺れフォールバック。

## v0.2.1(v0.2.0 から。挙動は変えず、無駄の整理と通信の見直し)
**通信**: 数字IDのとき、表示名(`/user/{id}`)とアバター定義を**並列**で取得。表示名は429でも待たず・再試行せず、IDだけで続行(全体の待機も起こさない)。`/user` `/asset` `?url=` の通信を `proxyRequest` に統合し、`users/avatar` の取得も429の全体待機に従う。アセットの生バイト列を永久保持していた `bytesCache` を廃止(同時取得のまとめ `inflight` と Cache API は残す)。
**重複の解消**: アクセサリ読み込み(`loadAccessory` / `loadCustomAccessory` のrbxm分岐)、GLB読み込み(独自アクセサリ / 独自ボディパーツ)、テクスチャ取得を共通化。
**アニメ**: 標準アニメの読み込みとログを、アバターを作り直すたびではなく**1回だけ**にして全アバターで共有(一部でも読めなかったときは次のアバターで再試行)。ポーズ適用は `Matrix4.compose` で直接行い、フレームごとの中間配列を減らした。
**エンジン**: `resize` で pixelRatio が変わったときだけ canvas を再確保。`loadUser` を連続で呼んだとき、後から呼んだほうだけを反映。`Avatar` の動的 `import()` を静的に。
**削除**: `bodypart.js` を頭専用の `extractHead` に(胴・腕・脚・R15ArtistIntent・Attachment 等を削除)、`rbxm.js` の未使用の型リーダー、`solveRig` / `CF_IDENTITY` / リグの静止位置チェック、`GLOBAL_ACCESSORY_POS`、効いていなかった `castShadow`、`desc.rigType` / `built.rigType`、`built.onAnimLog`、`posesToCFs` の `posScale`。
**内部寄りのAPI変更**: `adjustFor` は調整が無いとき `null` を返す(以前は単位の調整を返していた。見た目は同じ)。`extractBodyPart` は `extractHead(tree, rigType)` に置き換え。

## v0.2.0(v0.1.0 から)
**追加**: `Avatar` クラス(`src/engine/avatar.js`)、`engine.addActor` / `getActor` / `removeActor` / `actors` / `player` / `follow` / `followTarget`、`Avatar.getNetState` / `applyNetState`、イベント `'actor'`。
**変更**: アバター1体分の状態と処理を `AvatarEngine` から `Avatar` へ移し、既存のエンジンAPI(`loadUser` `setState` `playEmote` など)は player への委譲にした。カメラは `followTarget` を追う。イベントの引数の末尾に発生元の Avatar が付く。

## v0.1.0 — `rbx-engine-r6 v0.3.0` からの切り出し
**削除**: 衝突判定(`collision`)、World(`world` / `setWorldJson` / テストマップ)、タグ付きトリガー(`trigger-index` / `touchingTriggers`)、動くパーツ(`behaviors` / `dynamics`)、Environment・Rules(`setEnvironment` / `setRules`)、rbxl→world.json変換(`tgw`)、歩行・ジャンプ物理、キーボード・タッチの移動入力(`input.js`)、rbxlのドロップ読み込み。
**変更**: `Engine` → `AvatarEngine`(オービットカメラのみ。既定は正面表示)。`src/game/` → `src/animation/`。`checkProxy` は `src/avatar/api.js` へ。`engine.playEmote` の既定の中断条件は「歩く・走る・空中の状態にしたとき」。
**追加**: `src/index.js`、`loadUser` / `resetAvatar` / `setState` / `setMotion` / `setHeading` / `emoting`。
アニメーション・R6リグ・独自パーツ/アクセサリ・R15→R6変換・エモートエディタは従来どおり。
