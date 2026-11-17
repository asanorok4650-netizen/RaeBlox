// アニメーションアセットの取得と、状態ごとの割り当て。R6の標準アニメ(Robloxの標準Animateスクリプトのもの)を読み、
// 失敗した状態は手続き式で代用する。IDは手元の記憶なので、読み込めない/違うときはここを直す。状態ごとに先頭から順に試す。
import { fetchAssetBytes } from './api.js';
import { parseAnimation } from '../rbx/animation.js';

export const DEFAULT_ANIMS = {
  idle: [180435571, 180435792],
  walk: [180426354],
  run: [180426354],
  jump: [125750702],
  fall: [180436148],
};
/** 標準R6のエモート(読み込めないIDは手元の記憶違いなので、ここを直す) */
export const DEFAULT_EMOTES = {
  wave: 128777973, point: 128853357, cheer: 129423030, laugh: 129423131,
  dance: 182435998, dance2: 182491037, dance3: 182491065,
};
export const ANIM_STATES = ['idle', 'walk', 'run', 'jump', 'fall'];

/** エモートJSON(rbxl-extractor の出力 / 自作)なら解析済みクリップを返す。JSONでなければ null */
function clipFromJson(buf) {
  const u = new Uint8Array(buf, 0, Math.min(buf.byteLength, 8));
  const first = u.find((c) => c > 32);
  if (first !== 0x7b) return null; // '{' で始まらなければrbxm/rbxmx
  let j;
  try { j = JSON.parse(new TextDecoder().decode(buf)); } catch (e) { throw new Error(`エモートJSONを解析できません: ${e.message}`); }
  if (!j || !(j.tracks || j.channels) || !(j.length > 0)) throw new Error('エモートJSONの形式が不正です(tracks/channels と length が必要)');
  return j;
}

const cache = new Map();
/** アニメーションアセット(KeyframeSequence / CurveAnimation)を取得して解析する(同じIDは使い回す) */
export function loadAnimation(id) {
  if (!cache.has(id)) {
    const p = fetchAssetBytes(id).then((buf) => clipFromJson(buf) || parseAnimation(buf));
    cache.set(id, p);
    p.catch(() => cache.delete(id));
  }
  return cache.get(id);
}

const describe = (a) => `${a.keyframeCount}キーフレーム / ${a.poseCount}ポーズ / ${a.length.toFixed(2)}秒${a.loop ? ' / ループ' : ''}${a.kind === 'curve' ? ' / カーブ形式' : ''}`;

const defaultClips = new Map(); // ids → { state: anim }(全状態が読めたものだけ残す)
const defaultPending = new Map(); // ids → Promise<{ state: anim }>(読み込み中の共有)

async function resolveDefaultClips(ids, log) {
  const clips = {};
  await Promise.all(ANIM_STATES.map(async (state) => {
    for (const id of ids[state] || []) {
      try {
        const a = await loadAnimation(id);
        clips[state] = a;
        log(`${state}: 標準 ${id} 読み込み OK (${describe(a)})`);
        return;
      } catch (e) {
        log(`${state}: 標準 ${id} 失敗 - ${e.message}`);
        if (e.code === 'RATE_LIMITED') break;
      }
    }
    if (ids[state]) log(`${state}: 読み込めないため手続き式で代用`);
  }));
  log(`読み込み結果: ${ANIM_STATES.filter((s) => clips[s]).join(' / ') || 'なし(すべて手続き式で代用)'}`);
  return clips;
}

/**
 * 状態ごとに標準のR6アニメを読み込んで ctl.setClip する。クリップはアバターに依存しないので、
 * 読み込みとログは ids ごとに1回だけ行い、以降のアバター(作り直し・複数アクター)は共有結果を即座に入れる。
 * 一部でも読めなかったときは共有せず、次のアバターで再試行する。
 */
export async function loadDefaultAnimations(ctl, ids = DEFAULT_ANIMS, log = (...a) => console.info('[anim]', ...a)) {
  const apply = (clips) => { for (const s of ANIM_STATES) if (clips[s]) ctl.setClip(s, clips[s]); };
  const ready = defaultClips.get(ids);
  if (ready) return apply(ready);
  let p = defaultPending.get(ids);
  if (!p) {
    p = resolveDefaultClips(ids, log).then((clips) => {
      if (ANIM_STATES.every((s) => clips[s] || !ids[s])) defaultClips.set(ids, clips);
      return clips;
    }).finally(() => defaultPending.delete(ids));
    defaultPending.set(ids, p);
  }
  apply(await p);
}

/** エモートを読む。アニメ本体のID(KeyframeSequence/Curve)、解析済みアニメ/エモートJSON、独自アセットID('emote:xxx')のどれでもよい */
export async function loadEmote(id) {
  if (id && typeof id === 'object' && (id.tracks || id.channels)) return id;
  // 数字ならRobloxのアセットID。数字以外の文字列は独自アセットID(registerAssetMap など。例 'emote:backflip')
  const n = typeof id === 'string' && id.trim() && !/^\d+$/.test(id.trim()) ? id.trim() : Number(id);
  if ((typeof id === 'string' && !id.trim()) || (typeof n === 'number' && !Number.isFinite(n))) throw new Error(`エモートIDが不正です: ${id}`);
  try { return await loadAnimation(n); }
  catch (e) {
    if (e.code === 'RATE_LIMITED') throw e;
    throw new Error(`エモート ${n} を読み込めません - ${e.message}`);
  }
}
