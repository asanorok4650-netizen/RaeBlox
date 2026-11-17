// 自動生成ファイル(scripts/gen-games.mjs)。手で編集しないでください。
import meta0 from './sky-islands/meta.js';
import meta1 from './ocean-quest/meta.js';
import meta2 from './block-city-rp/meta.js';
import meta3 from './neon-rush/meta.js';
import meta4 from './boo-hotel/meta.js';
import meta5 from './treasure-tycoon/meta.js';
import meta6 from './cove-island/meta.js';

export const GAMES = [
  { id: 'sky-islands', meta: meta0, load: () => import('./sky-islands/game.js') },
  { id: 'ocean-quest', meta: meta1, load: null },
  { id: 'block-city-rp', meta: meta2, load: null },
  { id: 'neon-rush', meta: meta3, load: () => import('./neon-rush/game.js') },
  { id: 'boo-hotel', meta: meta4, load: null },
  { id: 'treasure-tycoon', meta: meta5, load: null },
  { id: 'cove-island', meta: meta6, load: () => import('./cove-island/game.js') },
];
