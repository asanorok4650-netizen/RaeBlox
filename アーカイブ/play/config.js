// RaeBlox のゲーム実行ページ(play/)の設定。RAE / RAE-Basic の既定値に頼らず、ここで明示する。

// Roblox のアバター・アセット取得用プロキシ(Cloudflare Worker: rbx-db-proxy)。
// Worker の ALLOWED_ORIGIN に、本番とローカルのOrigin(ポートまで完全一致。例 http://localhost:8080)を入れておくこと。
export const PROXY_BASE = 'https://rbx-db-proxy.konoyo9641.workers.dev';

// 使用している RAE-Basic の版(vendor/rae-basic/<版>/)。版を上げるときは runtime.js の import 先も揃える。
export const BASIC_VERSION = '0.4.5';

// ボディパーツ付け替えパネル(右端の🧍)。RaeBlox のアバター画面ができたら false にして置き換える。
export const ENABLE_BODYSET = true;

// 「自分」のアバターに使う Roblox ユーザーID を保存する localStorage のキー(?user=ID でも上書きできる)
export const USER_ID_KEY = 'raeblox.userId';
