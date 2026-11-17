// rebuild.mjs 用: three / builder / animator / api / animations をスタブに差し替えるローダーフック
import { pathToFileURL } from 'node:url';
const stub = (n) => pathToFileURL(new URL(`./stubs/${n}.mjs`, import.meta.url).pathname).href;
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: stub('three'), shortCircuit: true };
  if (/avatar\/builder\.js$/.test(spec)) return { url: stub('builder'), shortCircuit: true };
  if (/animation\/animator\.js$/.test(spec)) return { url: stub('animator'), shortCircuit: true };
  if (/avatar\/api\.js$/.test(spec)) return { url: stub('api'), shortCircuit: true };
  if (/avatar\/animations\.js$/.test(spec)) return { url: stub('animations'), shortCircuit: true };
  return next(spec, ctx);
}
