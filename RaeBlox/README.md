# RaeBlox Home

RAE Engineを基盤とするゲームプラットフォーム「RaeBlox」のホーム画面プロトタイプです。

## 起動方法

このフォルダを静的HTTPサーバーで配信してください。JavaScript ES Modulesを使用するため、`file://` で直接開かずHTTP経由で開きます。

```bash
npx http-server -c-1 .
```

ターミナルに表示されたローカルURLをブラウザで開いてください。

## ファイル構成

```
scripts/gen-games.mjs  games/ から manifest.js を生成
me/                     「自分」ページ(ボディパーツを選ぶ画面。RAE だけ使う)
index.html, src/        ホーム画面(three も物理も読み込まない)
play/                   ゲーム実行ページ(RAE-Basic はここだけで使う)
  index.html            importmap(three / Rapier)と #stage
  runtime.js            RaeBlox と RAE-Basic の境界(プロキシ設定・アバター・ゲーム読み込み・後片付け)
  config.js             プロキシURL・Basicの版・ボディパーツ選択の保存キー
  bodyparts.js          ボディパーツの選択(保存・読み込み・アバターへの反映)。me/ と runtime.js が共有
  games/<id>/           ゲーム1本ぶん(meta.js + game.js)。manifest.js は自動生成
  bodyset.json, parts/  ボディパーツ
vendor/rae-basic/0.4.5/ RAE-Basic v0.4.5(rae/ と src/basic/)。無改変・読み取り専用
```

## ボディパーツ
ゲーム内のパネルは無く、ホームの「自分」(`me/`)で選びます。選択は localStorage の `raeblox.bodyparts` に保存され、ゲーム起動時に `play/runtime.js` が付けます(未設定のときは標準のボディパーツ。「全部外す」でも標準に戻ります)。
パーツを増やすには `play/parts/` に GLB を置き、`play/bodyset.json` に足します。キーは `"<セット名> <部位>"` です(部位は `Head` / `Torso` / `Left Arm` / `Right Arm` / `Left Leg` / `Right Leg`)。
例: `"NCCv2 Left Arm": { "file": "parts/NCCv2-LeftArm.glb", "meta": {} }`。同じセット名のパーツは、「自分」ページの「セット」ボタンでまとめて着られます(部位が欠けたセットも可)。

## ゲームの遊び方
ホームのゲームカードをクリックすると `play/?game=<id>` へ移動します(`game.js` を持つゲームのみ。他は準備中)。
アバターは `?user=<RobloxユーザーID>` か、localStorage の `raeblox.userId` で指定します(無ければブロックアバター)。

## ゲームを追加する
`play/games/<id>/` フォルダを作って、2ファイルを置いて push するだけです(`<id>` がそのまま `?game=<id>` になります)。
- `meta.js` … ホームのカード情報(title / category / description / players / rating / symbol / tag / bg / filter / order)。`play/games/sky-islands/meta.js` が見本
- `game.js` … ゲーム本体(形は `play/games/index.js` の先頭コメント)。**省略すると「準備中」カード**になる

`play/games/manifest.js` は `scripts/gen-games.mjs` が生成するファイルで、push すると GitHub Actions(`gen-games.yml`)が自動で更新します。
ローカルで確認するときだけ `node scripts/gen-games.mjs` を実行してください。

## RAE-Basic を更新する
`vendor/rae-basic/<新しい版>/` を追加し、`play/runtime.js` と `me/me.js` の import 先、`play/config.js` の `BASIC_VERSION` を揃える。

## プロキシ
`play/config.js` の `PROXY_BASE` を、起動時に `CONFIG.proxyBase` へ明示的に設定します。Worker の `ALLOWED_ORIGIN` に、ページのOrigin(ポートまで完全一致)が必要です。

## 現在の状態
フレンドとゲーム一覧は仮データです。実際に遊べるのは Sky Islands と Neon Rush(サンプルマップ)のみです。
