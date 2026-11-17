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
index.html, src/        ホーム画面(three も物理も読み込まない)
play/                   ゲーム実行ページ(RAE-Basic はここだけで使う)
  index.html            importmap(three / Rapier)と #stage
  runtime.js            RaeBlox と RAE-Basic の境界(プロキシ設定・アバター・ゲーム読み込み・後片付け)
  config.js             プロキシURL・Basicの版・ボディパーツパネルの有無
  games/                ゲーム定義(index.js に登録 → sky-islands.js など)
  bodyset.json, parts/  ボディパーツ
vendor/rae-basic/0.4.5/ RAE-Basic v0.4.5(rae/ と src/basic/)。無改変・読み取り専用
```

## ゲームの遊び方
ホームのゲームカードをクリックすると `play/?game=<entry>` へ移動します(`entry` を持つゲームのみ。他は準備中)。
アバターは `?user=<RobloxユーザーID>` か、localStorage の `raeblox.userId` で指定します(無ければブロックアバター)。

## ゲームを追加する
1. `play/games/<name>.js` を作る(形は `play/games/index.js` の先頭コメント)
2. `play/games/index.js` の `GAMES` に1行足す
3. `src/app.js` の該当ゲームに `entry: "<name>"` を足す

## RAE-Basic を更新する
`vendor/rae-basic/<新しい版>/` を追加し、`play/runtime.js` の import 先と `play/config.js` の `BASIC_VERSION` を揃える。

## プロキシ
`play/config.js` の `PROXY_BASE` を、起動時に `CONFIG.proxyBase` へ明示的に設定します。Worker の `ALLOWED_ORIGIN` に、ページのOrigin(ポートまで完全一致)が必要です。

## 現在の状態
フレンドとゲーム一覧は仮データです。実際に遊べるのは Sky Islands と Neon Rush(サンプルマップ)のみです。
