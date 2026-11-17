// play/games/<id>/ を走査して play/games/manifest.js を生成する(依存なし・Node 18+)。
//   meta.js … 必須(ホームのカード情報)
//   game.js … 任意(無ければ「準備中」カード)
// 使い方: node scripts/gen-games.mjs   ※ GitHub Actions(gen-games.yml)が push 時に自動実行します。
import { readdirSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

const dir = fileURLToPath(new URL('../play/games/', import.meta.url));
const ids = readdirSync(dir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'meta.js')))
  .map((d) => d.name);

const items = [];
for (const id of ids) {
  const meta = (await import(pathToFileURL(join(dir, id, 'meta.js')).href)).default;
  items.push({ id, order: meta.order ?? 1e9, playable: existsSync(join(dir, id, 'game.js')) });
}
items.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

const v = (i) => 'meta' + i;
const out = [
  '// 自動生成ファイル(scripts/gen-games.mjs)。手で編集しないでください。',
  ...items.map((g, i) => `import ${v(i)} from './${g.id}/meta.js';`),
  '',
  'export const GAMES = [',
  ...items.map((g, i) => `  { id: '${g.id}', meta: ${v(i)}, load: ${g.playable ? `() => import('./${g.id}/game.js')` : 'null'} },`),
  '];',
  '',
].join('\n');
writeFileSync(join(dir, 'manifest.js'), out);
console.log(`manifest.js: ${items.length} games (${items.filter((g) => g.playable).length} playable)`);
