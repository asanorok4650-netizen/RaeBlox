// RaeBlox のゲーム実行ランタイム。RAE-Basic との境界はこのファイルだけ。
// Basic(vendor/)は無改変で使い、RaeBlox 側の都合(プロキシ・アバター・ゲーム定義・後片付け)はここで吸収する。
import RAPIER from '@dimforge/rapier3d-compat';
import { createBasic } from '../vendor/rae-basic/0.4.5/src/basic/index.js';
import { CONFIG, checkProxy } from '../vendor/rae-basic/0.4.5/rae/src/index.js';
import { PROXY_BASE, USER_ID_KEY } from './config.js';
import { loadGame } from './games/index.js';
import { loadBodyset, loadSelection, applySelection, paintBodyParts } from './bodyparts.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

function toast(msg) {
  const el = $('toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 3000);
}
function fail(title, err) {
  console.error(err);
  $('overlayTitle').textContent = title;
  $('overlayText').innerHTML = '';
  $('overlayText').textContent = String(err && err.message || err);
  const a = document.createElement('a'); a.href = '../'; a.textContent = '← ホームへ戻る';
  $('overlayText').append('\n\n', a);
  $('overlay').classList.remove('hidden');
}
const lsGet = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };

async function main() {
  const gameId = params.get('game');
  if (!gameId) throw new Error('ゲームが指定されていません(?game=sky-islands など)');

  // プロキシは既定に頼らず明示する(localStorage の古い値も上書きされる)
  CONFIG.proxyBase = PROXY_BASE;

  const game = await loadGame(gameId);
  document.title = `${game.title} - RaeBlox`;
  $('overlayTitle').textContent = game.title;

  const basic = await createBasic($('stage'), {
    RAPIER,
    engine: { background: game.background || '#9db4cc' },
    camera: game.camera,
    character: game.character,
    ui: false,                                   // 開発用のアバター読み込みパネルは使わない(「自分」ページの役目)
    bodyset: false,                              // ゲーム内のボディパーツ付け替えパネルは無し(「自分」ページ me/ で決める)
  });
  window.basic = basic;                          // デバッグ用(コンソールから触れる)

  // 「自分」ページで選んだボディパーツを付ける(失敗してもゲームは続ける)
  const bodyItems = await loadBodyset().catch((e) => { console.warn('[bodyparts]', e); return null; });
  if (bodyItems) await applySelection(basic.engine.player, bodyItems, loadSelection(bodyItems)).catch((e) => console.warn('[bodyparts]', e));

  await game.setup(basic);
  const [x, y, z] = game.spawn || [0, 3, 0];
  basic.character.spawn = { x, y, z };
  basic.character.teleport(x, y, z);

  $('overlay').classList.add('hidden');          // 見た目のアバターは裏で読む。ゲームは先に遊べる

  // アバター: ?user=ID があれば優先、無ければホームで保存した ID、どちらも無ければブロックアバター
  const uid = params.get('user') || lsGet(USER_ID_KEY);
  let bodyColors = null;
  // ボディパーツを後から付け替えたときも、体色を当てる
  basic.engine.on('bodypart', (_info, actor) => { if (!actor || actor === basic.engine.player) paintBodyParts(basic.engine.player, bodyColors); });
  if (uid) {
    try {
      const r = await basic.engine.loadUser(uid);
      bodyColors = r && r.desc && r.desc.colors;
      paintBodyParts(basic.engine.player, bodyColors);
    }
    catch (e) {
      console.error(e);
      const p = await checkProxy().catch(() => null);
      toast(`アバターを読み込めませんでした(ブロックアバターで続行)${p && p.ok === false ? ' / ' + p.message : ''}`);
    }
  }

  // ページを離れるとき、WebGL・物理を確実に解放する
  addEventListener('pagehide', () => { try { basic.dispose(); } catch (e) { /* 無視 */ } }, { once: true });
}

main().catch((e) => fail('起動できませんでした', e));
