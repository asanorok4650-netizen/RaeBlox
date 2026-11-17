// アバター読み込みパネル: ユーザーID(またはユーザー名)を入れて「読み込み」→ プレイヤーのアバターを差し替える。
// 通信は RAE の engine.loadUser(プロキシ経由)をそのまま使う。ブロックアバターに戻すのは engine.player.resetAvatar()。入力は CONFIG.lastUser に保存して次回の初期値にする。
import { CONFIG, checkProxy } from '../../../rae/src/index.js';

const CSS = `
.rb-panel{position:absolute;left:max(10px,env(safe-area-inset-left));top:max(10px,env(safe-area-inset-top));z-index:5;
  font:13px/1.5 system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif;color:#e8edf3;max-width:min(340px,calc(100vw - 24px))}
.rb-panel *{box-sizing:border-box}
.rb-toggle{display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 12px;border-radius:18px;border:1px solid rgba(255,255,255,.25);
  background:rgba(20,26,34,.72);color:inherit;font:inherit;cursor:pointer;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
.rb-card{display:none;margin-top:8px;padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,.18);
  background:rgba(20,26,34,.82);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
.rb-panel.open .rb-card{display:block}
.rb-form{display:flex;gap:6px}
.rb-input{flex:1;min-width:0;height:38px;padding:0 10px;border-radius:8px;border:1px solid rgba(255,255,255,.28);
  background:rgba(0,0,0,.35);color:#fff;font-size:16px;outline:none}
.rb-input:focus{border-color:#7fb4ff}
.rb-btn{height:38px;padding:0 12px;border-radius:8px;border:1px solid rgba(255,255,255,.28);background:rgba(255,255,255,.14);color:#fff;font:inherit;cursor:pointer;white-space:nowrap}
.rb-btn.primary{background:#2f6fe0;border-color:#2f6fe0}
.rb-btn:disabled{opacity:.5;cursor:default}
.rb-status{min-height:20px;margin-top:8px;color:#b9c6d6;word-break:break-word}
.rb-status.err{color:#ff9d9d}.rb-status.ok{color:#9fe3b0}
.rb-row{margin-top:6px}
.rb-log{display:none;margin-top:8px;max-height:160px;overflow:auto;padding:6px 8px;border-radius:8px;background:rgba(0,0,0,.35);font-size:12px;line-height:1.45;word-break:break-word}
.rb-log.show{display:block}
.rb-log div{margin:2px 0}.rb-log .e{color:#ff9d9d}.rb-log .w{color:#ffd98a}.rb-log .i{color:#9aa8b8}
.rb-help{margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,.12);color:#9aa8b8;font-size:12px}
`;

export function createAvatarPanel(engine, host, { open } = {}) {
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);

  const root = document.createElement('div'); root.className = 'rb-panel';
  root.innerHTML = `
    <button type="button" class="rb-toggle" aria-expanded="false">👤 アバター</button>
    <div class="rb-card">
      <form class="rb-form" autocomplete="off">
        <input class="rb-input" type="text" placeholder="ユーザーIDまたは名前" enterkeyhint="go"
               autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" aria-label="ユーザーIDまたはユーザー名">
        <button type="submit" class="rb-btn primary">読み込み</button>
      </form>
      <div class="rb-status" role="status" aria-live="polite"></div>
      <div class="rb-log" aria-label="読み込みログ"></div>
      <div class="rb-row"><button type="button" class="rb-btn rb-reset">ブロックアバターに戻す</button></div>
      <div class="rb-help">PC: WASD/矢印で移動・Spaceでジャンプ・ドラッグでカメラ・ホイールでズーム<br>タッチ: 左で移動・右でカメラ(ピンチでズーム)・右下でジャンプ</div>
    </div>`;
  host.appendChild(root);

  const $ = (s) => root.querySelector(s);
  const toggle = $('.rb-toggle'), form = $('.rb-form'), input = $('.rb-input'), submit = $('.rb-btn.primary'), reset = $('.rb-reset'), statusEl = $('.rb-status'), logEl = $('.rb-log');
  input.value = CONFIG.lastUser || '';

  const setOpen = (v) => { root.classList.toggle('open', v); toggle.setAttribute('aria-expanded', String(v)); };
  // 既定: マウス環境では開く / タッチ環境では閉じる(画面を広く使う)
  setOpen(open !== undefined ? open : !matchMedia('(pointer: coarse)').matches);
  toggle.addEventListener('click', () => setOpen(!root.classList.contains('open')));

  const say = (msg, kind = '') => { statusEl.textContent = msg; statusEl.className = 'rb-status ' + kind; };
  const busy = (b) => { submit.disabled = reset.disabled = b; };
  let seq = 0;

  // 読み込めなかったもの・一部だけ反映されたものをパネルとコンソールに出す
  const clearLog = () => { logEl.textContent = ''; logEl.classList.remove('show'); };
  const log = (kind, text) => {
    const d = document.createElement('div'); d.className = kind; d.textContent = text; logEl.appendChild(d);
    logEl.classList.add('show');
    (kind === 'e' ? console.error : kind === 'w' ? console.warn : console.info)('[avatar]', text);
  };
  // 戻り値: 問題の件数 { errors, warnings }
  function reportProblems(res) {
    let errors = 0, warnings = 0;
    const rep = (res.desc && res.desc.report) || [];
    for (const r of rep) {
      const label = `${r.type} 「${r.name}」(ID ${r.id})`;
      if (r.status === 'error') { errors++; log('e', `読み込めませんでした: ${label} — ${r.note}`); }
      else if (r.status === 'skip') log('i', `未対応のため省略: ${label} — ${r.note}`);
    }
    // 読み込めたが一部欠けたもの(テクスチャ不足など)
    for (const a of (res.desc && res.desc.accessories) || []) {
      for (const w of a.warnings || []) { warnings++; log('w', `${a.name}: ${w}`); }
    }
    const hp = res.desc && res.desc.customParts && res.desc.customParts.Head;
    for (const w of (hp && hp.warnings) || []) { warnings++; log('w', `頭: ${w}`); }
    // 読み込めたが組み立てに失敗したアクセサリ
    for (const p of (res.built && res.built.parts) || []) {
      if (p.error) { errors++; log('e', `組み立てに失敗しました: アクセサリ「${p.name}」 — ${p.error}`); }
    }
    return { errors, warnings };
  }

  async function load(idOrName) {
    const q = String(idOrName ?? input.value).trim();
    if (!q) { say('ユーザーIDまたは名前を入力してください', 'err'); return null; }
    input.value = q;
    const my = ++seq;
    busy(true); clearLog(); say('読み込み中…');
    try {
      const res = await engine.loadUser(q, (m) => { if (my === seq) say(m); });
      if (my !== seq) return null; // 後から別の読み込みが始まった
      if (!res.built) return null;
      CONFIG.lastUser = q;
      const { errors, warnings } = reportProblems(res);
      const base = `${res.user.displayName} (ID ${res.user.id}) を反映しました`;
      if (errors || warnings) say(`${base}(${errors ? `読み込めなかったもの ${errors}件` : ''}${errors && warnings ? '、' : ''}${warnings ? `警告 ${warnings}件` : ''} — 下のログ参照)`, 'err');
      else say(base, 'ok');
      input.blur(); // 以降のキー入力(WASD)をゲームに戻す
      return res;
    } catch (e) {
      if (my !== seq) return null;
      // 通信系の失敗はプロキシ側の原因が多いので、接続確認の結果を添える
      let msg = (e && e.message) || String(e);
      try { const r = await checkProxy(); if (!r.ok) msg = r.message; } catch (_) { /* 無視 */ }
      say(`読み込めませんでした: ${msg}`, 'err');
      log('e', `ユーザー「${q}」の読み込みに失敗: ${msg}`);
      if (e && e.stack) console.error(e);
      return null;
    } finally { if (my === seq) busy(false); }
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); load(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') input.blur(); });
  reset.addEventListener('click', () => { seq++; clearLog(); engine.player.resetAvatar(); busy(false); say('ブロックアバターに戻しました'); });

  return { el: root, load, reset: () => reset.click(), setOpen, dispose() { root.remove(); style.remove(); } };
}
