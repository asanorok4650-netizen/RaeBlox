// ゲームの読み込み口。ゲームを追加してもこのファイルは編集しません(manifest.js は自動生成)。
//
// 新しいゲーム: play/games/<id>/ に次の2ファイルを置いて push するだけ。
//   meta.js … カード情報(title, category, description, players, rating, symbol, tag, bg, filter, order)
//   game.js … ゲーム本体(省略すると「準備中」カード)
//
// game.js の形:
//   export default {
//     title: 'Sky Islands',
//     background: '#9db4cc',                 // 空の色(省略可)
//     spawn: [x, y, z],                      // 開始位置(足元)
//     character: { walkSpeed: 16 },          // CHARACTER_DEFAULTS の上書き(省略可)
//     camera: { dist: 14, pitch: 0.3 },      // 初期カメラ(省略可)
//     setup(basic) { basic.world.addBlock({...}) },  // 地形など。createBasic の戻り値が渡る
//   };
import { GAMES } from './manifest.js';

export { GAMES };

export async function loadGame(id) {
  const g = GAMES.find((x) => x.id === id);
  if (!g || !g.load) throw new Error(`ゲーム「${id}」は遊べません(play/games/${id}/game.js を確認)`);
  return (await g.load()).default;
}
