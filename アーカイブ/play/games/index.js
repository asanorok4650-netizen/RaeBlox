// ゲーム一覧(ホームの games[].entry と同じキー)。必要になったときに import するので、起動時に読むのは選ばれた1本だけ。
// 新しいゲーム: games/<name>.js を作って default export し、ここに1行足す。
//
// ゲーム定義の形:
//   export default {
//     title: 'Sky Islands',
//     background: '#9db4cc',                 // 空の色(省略可)
//     spawn: [x, y, z],                      // 開始位置(足元)
//     character: { walkSpeed: 16 },          // CHARACTER_DEFAULTS の上書き(省略可)
//     camera: { dist: 14, pitch: 0.3 },      // 初期カメラ(省略可)
//     setup(basic) { basic.world.addBlock({...}) },  // 地形など。createBasic の戻り値が渡る
//   };
export const GAMES = {
  'sky-islands': () => import('./sky-islands.js'),
  'neon-rush': () => import('./neon-rush.js'),
};

export async function loadGame(id) {
  const load = GAMES[id];
  if (!load) throw new Error(`ゲーム「${id}」は登録されていません(play/games/index.js)`);
  return (await load()).default;
}
