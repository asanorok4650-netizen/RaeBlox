// RaeBlox ホームのログイン機能。Worker(rbx-db-proxy)の /auth/* を呼ぶ。
// 登録: Robloxのプロフィール説明文にワンタイムコードを貼って本人確認 → パスワード設定。
// ログイン中は localStorage の raeblox.userId にユーザーIDを入れるので、play/runtime.js が自動でそのアバターを読む。
import { PROXY_BASE, USER_ID_KEY } from "../play/config.js";

const TOKEN_KEY = "raeblox.token";
const USER_KEY = "raeblox.user";
const ORIGINAL_TITLE = "おかえりなさい！";

const ls = {
  get(k) { try { return localStorage.getItem(k) || ""; } catch { return ""; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 無視 */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* 無視 */ } },
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const codeErr = (code, extra) => Object.assign(new Error(code), { code }, extra || {});

let toast = () => {};
let session = null;   // { token, user: { userId, name, displayName } }
let dialog = null;

// ---- API ----
async function api(path, { method = "POST", body, token } = {}) {
  let res;
  try {
    res = await fetch(PROXY_BASE + path, {
      method,
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: "Bearer " + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch { throw codeErr("NETWORK"); }
  const j = await res.json().catch(() => ({ ok: false, error: "BAD_RESPONSE" }));
  if (!res.ok || j.ok === false) throw codeErr(j.error || "ERROR", { retryAfter: j.retryAfter });
  return j;
}

// 入力は数字ならユーザーID、それ以外はユーザー名として、既存の中継(?url=)でIDに変換する
async function resolveUserId(input) {
  const s = String(input || "").trim();
  if (!s) throw codeErr("EMPTY");
  if (/^\d{1,19}$/.test(s)) return s;
  let res;
  try {
    res = await fetch(`${PROXY_BASE}/?url=${encodeURIComponent("https://users.roblox.com/v1/usernames/users")}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usernames: [s], excludeBannedUsers: true }),
    });
  } catch { throw codeErr("NETWORK"); }
  if (res.status === 429) throw codeErr("RATE_LIMITED");
  if (!res.ok) throw codeErr("LOOKUP_FAILED");
  const j = await res.json().catch(() => null);
  const id = j && j.data && j.data[0] && j.data[0].id;
  if (!id) throw codeErr("USER_NOT_FOUND");
  return String(id);
}

function errText(e) {
  const wait = e.retryAfter ? Math.max(1, Math.ceil(e.retryAfter / 60)) : 1;
  switch (e.code) {
    case "EMPTY": return "ユーザー名またはユーザーIDを入力してください";
    case "NETWORK": return "通信に失敗しました。もう一度お試しください";
    case "BAD_CREDENTIALS": return "ユーザーIDまたはパスワードが違います";
    case "LOCKED": return `失敗が続いたため一時的にロックされました。約${wait}分後にお試しください`;
    case "USER_NOT_FOUND": return "そのRobloxアカウントが見つかりません";
    case "USER_BANNED": return "このRobloxアカウントは利用できません";
    case "ACCOUNT_EXISTS": return "このアカウントは登録済みです。ログインするか、パスワードの再設定をしてください";
    case "NO_ACCOUNT": return "このアカウントはまだ登録されていません。新規登録してください";
    case "PASSWORD_MISMATCH": return "パスワードが一致しません";
    case "BAD_PASSWORD": return "パスワードは8〜128文字にしてください";
    case "NO_PENDING":
    case "CODE_EXPIRED": return "コードの有効期限(15分)が切れました。「最初からやり直す」を押してください";
    case "CODE_NOT_FOUND": return "プロフィールの説明文にコードが見つかりません。保存してから反映まで数秒かかることがあります。少し待って、もう一度押してください";
    case "RATE_LIMITED":
    case "LOOKUP_FAILED": return `混み合っています。約${wait}分待ってからお試しください`;
    case "ORIGIN_NOT_ALLOWED": return "このサイトからは利用できません(Worker の ALLOWED_ORIGIN を確認してください)";
    case "NOT_LOGGED_IN": return "ログインの有効期限が切れました";
    default: return `エラーが起きました (${e.code || "不明"})`;
  }
}

// ---- セッション ----
function loadSession() {
  const token = ls.get(TOKEN_KEY);
  let user = null;
  try { user = JSON.parse(ls.get(USER_KEY)); } catch { /* 無視 */ }
  session = token && user && user.userId ? { token, user } : null;
}
function setSession(r) {
  session = { token: r.token, user: r.user };
  ls.set(TOKEN_KEY, r.token);
  ls.set(USER_KEY, JSON.stringify(r.user));
  ls.set(USER_ID_KEY, r.user.userId);   // play/runtime.js がこのIDでアバターを読む
  applyUi();
}
function clearSession() {
  if (session && ls.get(USER_ID_KEY) === session.user.userId) ls.del(USER_ID_KEY);
  session = null;
  ls.del(TOKEN_KEY);
  ls.del(USER_KEY);
  applyUi();
}
const initialOf = (u) => (String(u.displayName || u.name || "R").trim()[0] || "R").toUpperCase();

function applyUi() {
  document.querySelectorAll(".mini-avatar.avatar-you").forEach((el) => { el.textContent = session ? initialOf(session.user) : "R"; });
  const h1 = document.querySelector(".welcome-row h1");
  if (h1) h1.textContent = session ? `おかえりなさい、${session.user.displayName || session.user.name}さん！` : ORIGINAL_TITLE;
  const btn = document.querySelector("#accountButton");
  if (btn) btn.setAttribute("aria-label", session ? "アカウントメニュー" : "ログイン");
}

// ---- ダイアログ ----
const CSS = `
.auth-modal .auth-msg{min-height:1.2em;margin:.4rem 0;color:#f87171;font-size:.85rem;line-height:1.5}
.auth-modal input{margin-bottom:.5rem}
.auth-modal .auth-code{display:flex;gap:.6rem;align-items:center;justify-content:space-between;padding:.7rem .9rem;margin:.4rem 0 .8rem;border-radius:.6rem;background:rgba(127,127,127,.18);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:1.05rem;letter-spacing:.04em;word-break:break-all}
.auth-modal .auth-code b{user-select:all}
.auth-modal .auth-steps{text-align:left;margin:.4rem 0 .6rem;padding-left:1.2rem;font-size:.9rem;line-height:1.7}
.auth-modal .auth-links{display:flex;justify-content:center;gap:1rem;margin-top:.7rem;flex-wrap:wrap}
`;

function render(html) {
  dialog.innerHTML = `<form class="modal-card" novalidate><button class="modal-close" type="button" data-act="close" aria-label="閉じる">×</button>${html}</form>`;
  const form = dialog.querySelector("form");
  form.addEventListener("click", (ev) => {
    const act = ev.target.closest("[data-act]");
    if (!act) return;
    if (act.dataset.act === "close") dialog.close();
    else if (form.actions && form.actions[act.dataset.act]) form.actions[act.dataset.act](act);
  });
  return form;
}
const msg = (form, text) => { form.querySelector(".auth-msg").textContent = text || ""; };
function onSubmit(form, fn) {
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    msg(form, "");
    try { await fn(); } catch (e) { msg(form, errText(e)); } finally { btn.disabled = false; }
  });
}

function showLogin(prefill = "") {
  const f = render(`<span class="modal-icon">R</span><h2>ログイン</h2>
    <p>RobloxのユーザーID(またはユーザー名)とパスワードでログインします。</p>
    <input name="user" type="text" placeholder="Robloxのユーザー名 または ユーザーID" autocomplete="username" value="${esc(prefill)}">
    <input name="password" type="password" placeholder="パスワード" autocomplete="current-password" maxlength="128">
    <p class="auth-msg" role="alert"></p>
    <button class="primary-button" type="submit">ログイン</button>
    <div class="auth-links"><button class="text-button" type="button" data-act="register">新規登録</button><button class="text-button" type="button" data-act="reset">パスワードを忘れた</button></div>`);
  f.actions = {
    register: () => showStart("register", f.elements.user.value),
    reset: () => showStart("reset", f.elements.user.value),
  };
  onSubmit(f, async () => {
    const userId = await resolveUserId(f.elements.user.value);
    const r = await api("/auth/login", { body: { userId, password: f.elements.password.value } });
    setSession(r);
    dialog.close();
    toast(`${r.user.displayName || r.user.name} としてログインしました`);
  });
}

function showStart(purpose, prefill = "") {
  const reg = purpose === "register";
  const f = render(`<span class="modal-icon">${reg ? "＋" : "↻"}</span><h2>${reg ? "新規登録" : "パスワードの再設定"}</h2>
    <p>あなたのRobloxアカウントであることを、プロフィールの説明文で確認します。</p>
    <input name="user" type="text" placeholder="Robloxのユーザー名 または ユーザーID" autocomplete="username" value="${esc(prefill)}">
    <p class="auth-msg" role="alert"></p>
    <button class="primary-button" type="submit">確認コードを発行</button>
    <div class="auth-links"><button class="text-button" type="button" data-act="login">ログインに戻る</button></div>`);
  f.actions = { login: () => showLogin(f.elements.user.value) };
  onSubmit(f, async () => {
    const userId = await resolveUserId(f.elements.user.value);
    const r = await api("/auth/start", { body: { userId, purpose } });
    showVerify({ purpose, userId, ticket: r.ticket, code: r.code, user: r.user });
  });
}

function showVerify(flow) {
  const reg = flow.purpose === "register";
  const who = flow.user.displayName && flow.user.displayName !== flow.user.name ? `${flow.user.displayName}(@${flow.user.name})` : `@${flow.user.name}`;
  const f = render(`<span class="modal-icon">✓</span><h2>本人確認</h2>
    <p>${esc(who)}</p>
    <ol class="auth-steps">
      <li>下のコードをコピーする</li>
      <li>Robloxのプロフィールの「自己紹介」に貼り付けて保存する</li>
      <li>パスワードを決めて、下のボタンを押す</li>
    </ol>
    <div class="auth-code"><b>${esc(flow.code)}</b><button class="text-button" type="button" data-act="copy">コピー</button></div>
    <input name="password" type="password" placeholder="パスワード(8文字以上)" autocomplete="new-password" maxlength="128">
    <input name="password2" type="password" placeholder="パスワードをもう一度" autocomplete="new-password" maxlength="128">
    <p class="auth-msg" role="alert"></p>
    <button class="primary-button" type="submit">${reg ? "確認して登録" : "確認して再設定"}</button>
    <small>登録できたら、自己紹介のコードは消して大丈夫です。コードの有効期間は15分です。</small>
    <div class="auth-links"><button class="text-button" type="button" data-act="restart">最初からやり直す</button></div>`);
  f.actions = {
    copy: (btn) => {
      const done = () => { btn.textContent = "コピーしました"; setTimeout(() => { btn.textContent = "コピー"; }, 1800); };
      if (navigator.clipboard) navigator.clipboard.writeText(flow.code).then(done, () => msg(f, "コピーできませんでした。コードを長押しで選択してください"));
      else msg(f, "コピーできませんでした。コードを長押しで選択してください");
    },
    restart: () => showStart(flow.purpose, flow.userId),
  };
  onSubmit(f, async () => {
    const pw = f.elements.password.value;
    if (pw !== f.elements.password2.value) throw codeErr("PASSWORD_MISMATCH");
    const r = await api(flow.purpose === "register" ? "/auth/register" : "/auth/reset", { body: { userId: flow.userId, password: pw, ticket: flow.ticket } });
    setSession(r);
    dialog.close();
    toast(reg ? "登録してログインしました" : "パスワードを再設定しました");
  });
}

function showAccount() {
  const u = session.user;
  const f = render(`<span class="modal-icon">${esc(initialOf(u))}</span><h2>${esc(u.displayName || u.name)}</h2>
    <p>@${esc(u.name)}　ID: ${esc(u.userId)}</p>
    <p>このアカウントのRobloxアバターでゲームを遊べます。</p>
    <p class="auth-msg" role="alert"></p>
    <button class="primary-button" type="submit">ログアウト</button>`);
  onSubmit(f, async () => {
    try { await api("/auth/logout", { token: session.token }); } catch { /* サーバー側に残っても、この端末では破棄する */ }
    clearSession();
    dialog.close();
    toast("ログアウトしました");
  });
}

export function initAuth({ showToast } = {}) {
  if (showToast) toast = showToast;
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.append(style);
  dialog = document.createElement("dialog");
  dialog.className = "modal auth-modal";
  document.body.append(dialog);

  loadSession();
  applyUi();
  document.querySelector("#accountButton").addEventListener("click", () => {
    if (session) showAccount(); else showLogin();
    dialog.showModal();
  });

  // 保存済みトークンがまだ有効か、裏で確認する(通信できないときは何もしない)
  if (session) {
    api("/auth/me", { method: "GET", token: session.token }).then((r) => {
      session.user = r.user; ls.set(USER_KEY, JSON.stringify(r.user)); applyUi();
    }).catch((e) => {
      if (e.code === "NOT_LOGGED_IN") { clearSession(); toast("ログインの有効期限が切れました。もう一度ログインしてください"); }
    });
  }
}
