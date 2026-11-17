globalThis.__builds = 0;
export const buildAvatar = (desc) => { globalThis.__builds++; return { group: { position: { y: 0 } }, parts: [], box: { min: { y: 0 }, max: { y: 5 } }, bodyBox: { min: { y: 0 }, max: { y: 5 } }, layout: {}, report: [], desc }; };
export const disposeObject = () => {}; export const applyTextureUV = () => {};
