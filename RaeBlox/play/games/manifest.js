// 自動生成ファイル(scripts/gen-games.mjs)。手で編集しないでください。
import meta0 from './sky-islands/meta.js';
import meta1 from './neon-rush/meta.js';
import meta2 from './haunted-mansion/meta.js';
import meta3 from './cove-island/meta.js';

export const GAMES = [
  { id: 'sky-islands', meta: meta0, load: () => import('./sky-islands/game.js') },
  { id: 'neon-rush', meta: meta1, load: () => import('./neon-rush/game.js') },
  { id: 'haunted-mansion', meta: meta2, load: () => import('./haunted-mansion/game.js') },
  { id: 'cove-island', meta: meta3, load: () => import('./cove-island/game.js') },
];
