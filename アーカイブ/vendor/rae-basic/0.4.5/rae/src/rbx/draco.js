// version 7.00 メッシュの Draco ビットストリームを three の DRACOLoader でデコードする(ブラウザ専用)。
// デコーダ本体(draco_wasm_wrapper.js / draco_decoder.wasm)は vendor/draco/ に置いてある。
// Roblox の Draco ストリームの属性ID(unique id): 0=位置 1=法線 2=UV(3=タンジェント 4=頂点色は使わない)
//
// DRACOLoader の読み込み順: ① importmap の "three/addons/" → ② 無ければ import('three') の REVISION から同じ版のCDN URLを組み立てて読む
// (DRACOLoader.js 自身は 'three' を import するので、importmap に "three" さえあれば動く)。どちらも失敗したときは原因が分かるエラーにする。
let loader = null, loading = null;

async function importDracoLoader() {
  const errs = [];
  try { return (await import('three/addons/loaders/DRACOLoader.js')).DRACOLoader; } catch (e) { errs.push(`three/addons/: ${e.message}`); }
  try {
    const THREE = await import('three');
    const url = `https://cdn.jsdelivr.net/npm/three@0.${THREE.REVISION}.0/examples/jsm/loaders/DRACOLoader.js`;
    return (await import(/* @vite-ignore */ url)).DRACOLoader;
  } catch (e) { errs.push(`CDN: ${e.message}`); }
  throw new Error(`Dracoデコーダ(three の DRACOLoader)を読み込めません。index.html の importmap に "three/addons/": ".../three@<版>/examples/jsm/" を追加してください(${errs.join(' / ')})`);
}

function getLoader() {
  if (loader) return Promise.resolve(loader);
  if (!loading) {
    loading = importDracoLoader().then((DRACOLoader) => {
      const l = new DRACOLoader();
      l.setDecoderPath(new URL('../../vendor/draco/', import.meta.url).href); // 同梱のデコーダ(draco_wasm_wrapper.js / draco_decoder.wasm)
      l.setDecoderConfig({ type: 'wasm' });
      return (loader = l);
    }).catch((e) => { loading = null; throw e; }); // 失敗を覚え込まない(importmap を直して再読み込みなしで再試行できる)
  }
  return loading;
}

function decodeWith(l, bytes, ids, types) {
  const buf = bytes.slice().buffer; // デコード側へ転送(移譲)されるのでコピーを渡す
  return new Promise((resolve, reject) => {
    // decodeDracoFile は版によって Promise を返す/返さないがあるので、コールバックで受ける
    const p = l.decodeDracoFile(buf, resolve, ids, types, undefined, reject);
    if (p && typeof p.catch === 'function') p.catch(reject);
  });
}

export async function dracoDecode(bytes) {
  const l = await getLoader();
  let geo = null, firstErr = null;
  // ① Roblox の unique id(0=位置 1=法線 2=UV) ② 属性の種類(POSITION/NORMAL/TEX_COORD)で探す
  const tries = [[{ position: 0, normal: 1, uv: 2 }, { position: 'Float32Array', normal: 'Float32Array', uv: 'Float32Array' }], [undefined, undefined]];
  for (const [ids, types] of tries) {
    try {
      const g = await decodeWith(l, bytes, ids, types);
      if (g && g.attributes && g.attributes.position && g.attributes.position.count > 0) { geo = g; break; }
    } catch (e) { firstErr = firstErr || e; }
  }
  if (!geo) throw new Error(`Dracoのデコードに失敗しました${firstErr ? `: ${firstErr.message || firstErr}` : '(位置データがありません)'}。vendor/draco/ のファイルが配信されているか(ネットワークタブで draco_wasm_wrapper.js / draco_decoder.wasm が200か)確認してください`);
  const a = geo.attributes;
  const out = { positions: a.position.array, normals: a.normal && a.normal.array, uvs: a.uv && a.uv.array,
    indices: geo.index ? Uint32Array.from(geo.index.array) : Uint32Array.from({ length: a.position.count }, (_, i) => i) };
  geo.dispose();
  return out;
}
