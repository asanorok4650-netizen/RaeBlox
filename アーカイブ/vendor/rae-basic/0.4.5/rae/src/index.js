// ライブラリの入口。必要なものだけ import してもよい(各ファイルは独立して使える)。
// 開発用ツール(R15→R6変換・バンドル検索・GLB書き出し・デモ)は ../tools/index.js。
//   import { AvatarEngine, attachOrbit, loadUserAvatar } from './src/index.js';
export { AvatarEngine, Avatar, defaultAvatarDesc, MOTION_STATES } from './engine/engine.js';
export { attachOrbit } from './engine/orbit.js';
export { loadUserAvatar, loadCustomAccessory, loadCustomBodyPart, bodyPartFromGeometry, fetchRobloxJson, checkProxy, clearAssetCache, NET, BODY_SLOTS, ApiError } from './avatar/api.js';
export { registerAssetMap, registerAssetSource, SourceError } from './avatar/sources.js';
export { loadEmote, loadAnimation, DEFAULT_ANIMS, DEFAULT_EMOTES } from './avatar/animations.js';
export { CONFIG, DEFAULTS } from './config.js';
export { parseGlb, bakeTransform } from './rbx/glb.js';
export { normalizeUV, isIdentityUV, transformUVs, uvAffine, uvForward, DEFAULT_UV, WRAPS } from './avatar/uv.js';
export { applyTextureUV } from './avatar/builder.js';
