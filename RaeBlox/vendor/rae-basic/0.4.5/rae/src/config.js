// エンジン設定(localStorageに保存。使えない環境でも落ちない)。ビルド時の環境変数には依存しない。
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* 無視 */ } };

// 既定のプロキシ(Roblox APIのCORS回避 + アセット取得)。設定画面で差し替え可能。
// Worker側の ALLOWED_ORIGIN に、このページのOrigin(例 http://localhost:8080)を入れておくこと。
// rbx-db-proxy(R2キャッシュ付き)。Worker名が違う場合はここか、メニューのプロキシURLで差し替える。
export const DEFAULTS = {
  proxyBase: 'https://rbx-db-proxy.konoyo9641.workers.dev',
};
// 旧プロキシ(proxycode)のURL。localStorageに残っていても使わず、既定(新プロキシ)に切り替える
const LEGACY_PROXIES = ['https://rbxl-player-proxy.konoyo9641.workers.dev'];
const storedProxy = () => { const v = lsGet('rbxe.proxyBase', '').trim(); return LEGACY_PROXIES.includes(v.replace(/\/+$/, '')) ? '' : v; };

export const CONFIG = {
  get proxyBase() { return storedProxy() || DEFAULTS.proxyBase; },
  set proxyBase(v) { lsSet('rbxe.proxyBase', String(v || '').trim()); },
  get proxyBaseOverride() { return storedProxy(); },
  get pixelRatioCap() { return Number(lsGet('rbxe.pixelRatioCap', '2')) || 2; },
  set pixelRatioCap(v) { lsSet('rbxe.pixelRatioCap', String(v)); },
  get antialias() { return lsGet('rbxe.antialias', '1') === '1'; },
  set antialias(v) { lsSet('rbxe.antialias', v ? '1' : '0'); },
  get lastUser() { return lsGet('rbxe.lastUser', ''); },
  set lastUser(v) { lsSet('rbxe.lastUser', String(v || '')); },
};
