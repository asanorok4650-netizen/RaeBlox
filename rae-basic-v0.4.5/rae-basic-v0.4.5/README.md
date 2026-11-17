# RAE-Basic v0.4.5

[RAE(rbx-avatar-engine) v0.4.2](rae/README.md)(`rae/` に同梱。RAE-BodyBuilder v0.3.3 の「貼らない面」の修正入り。v0.4.1 でカメラのフック `addCameraHook`、v0.4.2 で pitch の範囲 `minPitch` / `maxPitch` を追加)に、Rapier 3D の物理とキャラクター操作をつないだもの。
PC・スマホ・タブレットで、歩く・ジャンプ・落下と、地面や壁との衝突ができる。

## 動かす
`index.html` のあるフォルダをHTTPで配信する(`file://` は不可)。例: `npx http-server -c-1 .` → `http://localhost:8080`
左上の「アバター」パネルにユーザーID(または名前)を入れて「読み込み」(プロキシは RAE の既定。`rae/README.md` の「プロキシ」)。`?user=ID` でも指定可。無指定ならブロックアバター。
three(0.170.0)と Rapier(`@dimforge/rapier3d-compat` 0.21.0)は `index.html` の importmap でCDNから取得。

## 操作
| | 移動 | ジャンプ | カメラ |
|---|---|---|---|
| PC | WASD / 矢印 | Space | ドラッグで回転・ホイールでズーム |
| タッチ | 画面の左半分(触った場所に動的スティック) | 右下のボタン | 画面の右半分をドラッグ・2本指ピンチ |

移動とカメラは別のポインターで処理する(多点タッチ可)。移動方向はカメラの向き基準。

## 使い方
```js
import RAPIER from '@dimforge/rapier3d-compat';
import { createBasic } from './src/basic/index.js';

const basic = await createBasic(document.getElementById('stage'), { RAPIER });
basic.world.addBlock({ position: [0, -1, 0], size: [160, 2, 160] });   // 地面(上面 y=0)
basic.character.teleport(0, 1, 0);
await basic.engine.loadUser(1234567);                                    // RAE のAPIはそのまま使える
await basic.engine.set({ user: 1234567, accessories: ['hat:cat-ears'] }); // 見た目をまとめて適用(並列に読み込み、再構築は1回)
basic.engine.player.equipAccessory(...)                                  // engine に委譲があるのは8個だけ。他は engine.player.xxx
```
`createBasic(host, { RAPIER, engine, physics, character, controls, camera })`
- `character`: `CHARACTER_DEFAULTS`(`src/basic/character.js`)の上書き。`walkSpeed` `jumpHeight` `halfWidth` `autostepHeight` `maxClimbDeg` など。`spawn: [x,y,z]`
- `cameraHead` / `cameraFollow` / `cameraFirstPerson` / `cameraCollision`: カメラの設定(下の「カメラ」)。`false` で無効
- `controls: false` で標準の入力を外し、`basic.character.input = { x, y, jump }` を自分で書く(x=右 / y=前 / -1〜1)
- 静的な当たり判定: `world.addBlock({position,size,rotation(度),color})`(直方体) / `world.addMeshCollider(mesh)`(三角形メッシュ。動かないものだけ)

## 仕組み
- **RAE側は読むだけ・書くのは3つだけ**(カメラは `engine.addCameraHook` で補正): `avatar.position`(足元) / `avatar.heading` / `avatar.setMotion(実際の水平速度, 接地)`。アバターが作り直される(`'avatar'` イベント)と、`bodyBox` の高さでコライダーを作り直す。RAE の `set()` は再構築が1回なので、コライダーの作り直しも1回で済む。
- **Cuboid + KCC**: 高さは `bodyBox`、幅(XZ)は胴体基準の `halfWidth`(腕込みにしない)。回転しない軸平行ボックスで、`heading` は見た目だけ。KCCの slide(壁沿いに滑る)・autostep(段差)・snap-to-ground(下り坂)・坂の登り/滑り角を使う。
- **固定ステップ 1/60 秒** + 描画位置の補間(描画のフレームレートが違っても滑らか)。単位は stud、重力 196.2・歩行 16・ジャンプ高さ 7.2(Roblox準拠)。
- アニメ(歩き・ジャンプ・落下)には、入力ではなく**実際に進んだ速さ**を渡すので、壁に押し付けると足が止まる。

## カメラ(Roblox の標準カメラに合わせたもの)
`src/basic/camera.js` の `attachCameraRig(engine, physics, opts)` が、RAE の `engine.addCameraHook` に3つの処理を付ける(`createBasic` が自動で付ける。単体でも使える)。RAE の内部関数の差し替えはしない。
- **頭が中心**(`cameraHead`): 注視点は操作キャラクターの頭(Head の中心。足元 + 頭の高さ)。ボディパーツで頭を替えても、Head の位置に追従する。`false` で RAE の既定(身長×focus)。
- **高さの追従**(`cameraFollow: { rate: 10, snap: 20 }`): アバターの上下(階段・段差・ジャンプ)になめらかに追従。`snap` stud 以上離れたら(テレポート)即座に合わせる。
- **一人称**(`cameraFirstPerson: { enter: 1, min: 0.5, exit: 4, pitch: [-1.4, 1.4], hide: true }`): ズームしてカメラ距離が `enter`(1 stud)未満になると一人称。カメラは頭の位置になり、頭とその周りのアクセサリ(頭につけたもの)が隠れる。胴・腕・脚と、背中などのアクセサリは見える。一人称の間は、
  - 見る向きは `engine.yaw` / `engine.pitch`(三人称と同じ操作)。上下は ±80° まで見渡せる(三人称は従来の -0.5〜1.35 rad)。
  - 体は常にカメラの向きを向く(`character.faceCamera`。横移動でも体は前を向く)。
  - ズームで離れる(ホイール・ピンチ)と、すぐ三人称に戻る(距離 `exit` = 4 stud)。
  - 壁めり込み防止は働かない(頭の位置なので)。
  - `engine.minDist` を `min`(0.5)にする(RAE の既定は 2)。`dispose()` で戻る。
- **壁めり込み防止**(`cameraCollision: { radius: 0.6, margin: 0.3, minDist: 1.5, rate: 6 }`、三人称のみ): 頭(注視点)からカメラへレイを飛ばし、壁・床に当たったら手前までカメラを寄せる。カメラの大きさ(近クリップ面)を見て、中心+上下左右にずらした5本のうち最も近い当たりを使う。寄せるのは即座、戻るのはなめらか。キャラクター自身のコライダーは無視。当たるのは静的コライダー(`world.addBlock` / `addMeshCollider`)。
- `createBasic` の戻り値の `cameraRig.firstPerson` で、いま一人称かが分かる。

## ボディパーツの付け替え(v0.4.1)
`bodyset.json` と `parts/` を、`src/` や `rae/` と同じ階層に置く。`createBasic` に `bodyset` を渡すと、画面右端のボタン(🧍)で付け替えパネルが開く。
```js
const SKIN = { clothBase: 'skin' };   // 全パーツ共通の meta(setBodyPart の meta。個別は bodyset.json の各 "meta")
const basic = await createBasic(stage, { RAPIER, bodyset: { url: './bodyset.json', meta: SKIN } });
await basic.engine.loadUser(10288879862);   // ユーザーを読み込み直しても、独自パーツは残る
```
- 起動時に各部位の先頭のパーツを自動でつける(`autoEquip: false` で無効)。カードをタップで付ける/外す、「全部つける」「全部外す」、検索、部位タブ(すべて/胴体/腕/脚。頭は `Head` のパーツがあれば出る)。
- サムネはGLBを小さく描いて作る(`thumbs: false` で灰色のシルエットのまま)。
- 1つの部位に複数のパーツを入れるときは、`bodyset.json` の値を配列にする: `"Torso": [ { "name": "騎士の胴", "file": "parts/TorsoKnight.glb", "meta": {} }, { "file": "parts/Torso.glb" } ]`。同じ部位でつけられるのは1つ(別のものを選ぶと入れ替わる)。
- 呼び出しはすべて `engine.player.setBodyPart` / `set` / `clearBodyPart(s)`(RAE v0.4.0 の仕様)。最初の一括は `player.set({ bodyParts })` なので再構築は1回。2回目以降は読み込み済みのパーツを使い回す。
- 単体でも使える: `createBodypartsPanel(engine, host, opts)`(`src/basic/ui/bodyparts-panel.js`)。戻り値の `items` `equip(item)` `equipAll()` `clearAll()` `isEquipped(item)` `setOpen(bool)`。
- **注意**: 同梱の RAE v0.4.1 に `clothBase` はまだ無く、渡しても無視される(クラシック服の重ね貼りの設定は `clothing` / `clothFit` / `overColor`)。RAE 側に入ったら、そのまま効く。

## 変更履歴
- v0.4.5: **v0.4.4 の不具合の修正**。カメラの注視点が頭ではなく足元になり、カメラが床に埋まっていた。原因: 頭の高さを Head メッシュの `position` から取っていたが、RAE の `attachRig` はパーツを関節ノードの子にして `position` を 0 にするため、常に 0 になっていた。静止姿勢のレイアウト(`built.layout` の Head の中心 + 足元の補正)から取るように変更(アニメで頭が揺れてもカメラは揺れない)。テストのダミーのアバターが、実際の形(メッシュの `position` が 0)になっていなかったのが、見逃した原因。実際の形のテストを2件追加(`position` が 0 でも頭の高さになる / layout が無ければ従来の注視点)。RAE は変更なし(v0.4.2)
- v0.4.4: カメラを Roblox に合わせた(上の「カメラ」)。**注視点がキャラクターの頭**になり、**ズームで近づくと一人称視点**になる(頭と頭のアクセサリが隠れ、体はカメラの向きを向く。ズームで離れると三人称に戻る)。`character.faceCamera` を追加(true の間、入力が無くてもカメラの向き=yaw を向く)。RAE を v0.4.2 に更新: `engine.minPitch` / `engine.maxPitch` を追加しただけで、既定は従来どおり(`rae/CHANGELOG.md`)。`createBasic` に `cameraHead` / `cameraFirstPerson` オプション、戻り値の `cameraRig` に `firstPerson` を追加。`test/camera.mjs` に頭・一人称の確認を追加し、`test/rae-contract.mjs` に pitch の範囲の確認を追加。**実機での操作感は未確認**(下記)。注視点が足元寄りの高さから頭に上がったので、既定のカメラはこれまでより少し高い位置から見る
- v0.4.3: カメラの補正を `src/basic/camera.js` に分離し、**壁めり込み防止を追加**(上の「カメラ」)。RAE を v0.4.1 に更新: `engine.addCameraHook(fn)`(カメラ位置の計算後・描画の前に `fn(view, dt, engine)`。`rae/CHANGELOG.md`)を追加しただけで、既存の挙動は変わらない。これまで basic が RAE の内部関数 `engine._updateCamera` を差し替えて高さの追従をしていたのを、このフックに移した(`followCameraHeight` は削除。`createBasic` の `cameraFollow` オプションはそのまま)。`createBasic` の戻り値に `cameraRig` を追加。`test/camera.mjs`(カメラ補正の確認。Rapier不要)を追加し、`test/rae-contract.mjs` を `addCameraHook` の確認に更新。**実機のRapierでの `castRay` は未確認**(下記)
- v0.4.2: 同梱の RAE を、RAE-BodyBuilder v0.3.3 の版に更新(`rae/src/avatar/api.js` `builder.js` `rbx/glb.js` と `rae/tools/glb-write.js` の4ファイル。詳細は `rae/CHANGELOG.md`)。BodyBuilder の投げ縄で「貼らない」にした面が、テクスチャ無しの書き出し(UVグリッドを書き出さない場合を含む)でも読み込みで無視されなくなり、クラシック服もその面に重ならない。`bodyset.json` と `parts/` を新しい bodyset(BodyBuilder v0.3.3 で書き出し)に差し替え。basic 本体(物理・キャラクター・パネル)は変更なし
- v0.4.1: ボディパーツ付け替えパネル(`src/basic/ui/bodyparts-panel.js`)・`createBasic` の `bodyset` オプション・`bodyset.json` と `parts/`(胴・腕・脚)を追加。RAE と物理は変更なし。実機のWebGLでの描画(サムネ・パーツの見た目)は未確認(three・CDNに繋がらない環境だったため、three とエンジンを差し替えたスタブでパネルの操作だけをChromiumで確認)
- v0.4.0: 同梱の RAE を v0.4.0 に更新(`rae/` を丸ごと差し替え。RAE のコードは無改変)。RAE v0.4.0 で `engine.resetAvatar` など14個の委譲が削除されたため、アバターパネルの「ブロックアバターに戻す」を `engine.player.resetAvatar()` に変更(basic で影響があったのはこの1か所だけ)。RAE v0.4.0 の主な変更: `addActor({desc})` / `setAvatar(built)` の見た目が、あとの装備変更で既定に戻るバグの修正 / `avatar.set()` による一括適用 / `setBodyPart` の入力の自動振り分け / 開発用コードを `rae/tools/` へ分離。物理(`physics.js` `character.js` `world.js` `input/`)は変更なし。`test/rae-contract.mjs`(basic が RAE に頼る契約と、削除済みAPIを使っていないことの確認)を追加
- v0.2.0: アバター読み込みパネル(`src/basic/ui/avatar-panel.js`)を追加。ID/名前入力・読み込み状況の表示・ブロックアバターに戻す・前回の入力の記憶。失敗時はプロキシ接続確認(`checkProxy`)の結果を表示。`createBasic` の `ui: false` で無効化
- v0.1.1: 上下に動いたときカメラが追従しない問題を修正(RAEはカメラの注視点の高さが固定のため。RAEは変更せず `src/basic/index.js` の `followCameraHeight` で補正。追従の速さは `cameraFollow: { rate }`)

## 既知の制限 / 次の候補
- カメラの壁めり込み防止は、静的コライダーだけが対象で、キャラクターとの間に挟まる細い柱などは通り抜ける(レイ5本の間をすり抜ける細さ=0.6 stud 以下のもの)
- 動く床・押せる箱(動的ボディ)は未対応(KCCは `setApplyImpulsesToDynamicBodies(false)`)
- `offset` は 0.05 未満にしない(0.02 以下だと、床に少しずつ沈むことを確認した)
- 一人称・頭中心・`faceCamera` は、スタブでのテストのみ確認済み(`test/character.mjs` の `faceCamera` の2行は、Rapier が必要で未実行)。マウスは、Robloxのようなポインターロック(マウスを動かすだけで見回す)ではなく、これまでどおりドラッグで見回す
- カメラ補正のレイ判定は、直方体との交差を自前で計算するスタブでのみ確認済み。実際の Rapier(`world.castRay` の引数・戻り値の `timeOfImpact`)と描画・タッチ操作は未確認。スマホの実機で確認してください(v0.4.0 では、Rapier を入れられない環境だったため物理テスト `test/character.mjs` は再実行できておらず、物理のコードは v0.2.0 から変更なし)

## 構成
```
index.html           importmap + デモ
rae/                 RAE v0.4.2(貼らない面の修正入り。src/ tools/ test/ vendor/ とドキュメント一式)
src/main.js          デモの地形(階段・段差・坂・柱・壁)
bodyset.json         ボディパーツの一覧(parts/ のGLBを指す)
parts/               ボディパーツのGLB
src/basic/           index.js(createBasic) camera.js(カメラ: 頭中心・一人称・壁) physics.js character.js world.js input/(keyboard・pointer・index) ui/avatar-panel.js ui/bodyparts-panel.js
test/character.mjs   物理のヘッドレス確認(Rapier が必要)
test/camera.mjs      カメラの確認(頭中心・一人称・壁・追従)(Rapier不要。レイ判定はスタブ)
test/rae-contract.mjs  RAE との契約の確認(Rapier不要。three・builder・api はスタブ)
```
