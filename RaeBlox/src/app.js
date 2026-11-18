import { initAuth } from "./auth.js";
import { GAMES } from "../play/games/manifest.js";

const friends = [
  { name: "Mochi", activity: "プレイ中: Sky Islands", initial: "M", bg: "linear-gradient(145deg,#c4b5fd,#7c3aed)", online: true },
  { name: "Hima", activity: "オンライン", initial: "H", bg: "linear-gradient(145deg,#fde68a,#d97706)", online: true },
  { name: "Aqua", activity: "プレイ中: Ocean Quest", initial: "A", bg: "linear-gradient(145deg,#67e8f9,#2563eb)", online: true },
  { name: "Neko", activity: "オンライン", initial: "N", bg: "linear-gradient(145deg,#f9a8d4,#9333ea)", online: true },
  { name: "Kuro", activity: "オフライン", initial: "K", bg: "linear-gradient(145deg,#9ca3af,#374151)", online: false },
  { name: "Rin", activity: "オフライン", initial: "R", bg: "linear-gradient(145deg,#86efac,#15803d)", online: false },
];

// ゲーム一覧は play/games/<id>/meta.js から自動生成(play/games/manifest.js)。ここは編集不要。
// game.js があるものだけ遊べる(無いものは「準備中」)。
const games = GAMES.map(g => ({ ...g.meta, id: g.id, playable: !!g.load }));
const friendStrip = document.querySelector("#friendStrip");
const gameGrid = document.querySelector("#gameGrid");
const searchInput = document.querySelector("#searchInput");
const emptyState = document.querySelector("#emptyState");
let activeFilter = "recommended";

function renderFriends() {
  friendStrip.innerHTML = `
    <button class="friend add-friend" id="addFriendTile" aria-label="フレンドを追加">
      <span class="friend-avatar-wrap"><span class="friend-avatar">＋</span></span>
      <span class="friend-name">フレンド追加</span><span class="friend-activity">一緒に遊ぼう</span>
    </button>
    ${friends.map(friend => `
      <button class="friend" data-friend="${friend.name}">
        <span class="friend-avatar-wrap"><span class="friend-avatar" style="--avatar-bg:${friend.bg}">${friend.initial}</span></span>
        <span class="friend-name">${friend.name}</span>
        <span class="friend-activity">${friend.activity}</span>
      </button>`).join("")}`;
  document.querySelector("#addFriendTile").addEventListener("click", openFriendModal);
  friendStrip.querySelectorAll("[data-friend]").forEach(button => button.addEventListener("click", () => showToast(`${button.dataset.friend} のプロフィールは準備中です`)));
}

function renderGames() {
  const query = searchInput.value.trim().toLowerCase();
  const filtered = games.filter(game => {
    const matchesTab = game.filter.includes(activeFilter);
    const matchesSearch = `${game.title} ${game.category} ${game.description}`.toLowerCase().includes(query);
    return matchesTab && matchesSearch;
  });
  gameGrid.innerHTML = filtered.map(game => `
    <article class="game-card" tabindex="0" role="button" aria-label="${game.title}を開く" data-game="${game.id}">
      <div class="game-art art-scene" style="--art-bg:${game.bg}">
        <span class="art-tag">${game.tag}</span>
        <span class="art-symbol">${game.symbol}</span>
        <div class="art-bottom"><span class="art-title">${game.title}</span><span class="art-mini">${game.category}</span></div>
      </div>
      <div class="game-info">
        <div class="game-title-row"><span class="game-title">${game.title}</span><span class="game-rating">★ ${game.rating}</span></div>
        <div class="game-meta"><span>♟ ${game.players} プレイ中</span><span>${game.description}</span></div>
      </div>
    </article>`).join("");
  emptyState.classList.toggle("hidden", filtered.length > 0);
  gameGrid.querySelectorAll("[data-game]").forEach(card => {
    const launch = () => {
      const game = games.find(item => item.id === card.dataset.game);
      // game.js があるゲームは、ゲーム実行ページ(play/)へ移動する。無いものは準備中
      if (game.playable) location.href = `./play/?game=${encodeURIComponent(game.id)}`;
      else showToast(`${game.title} はゲーム接続準備中です`);
    };
    card.addEventListener("click", launch);
    card.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); launch(); } });
  });
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2400);
}

const friendModal = document.querySelector("#friendModal");
function openFriendModal() { friendModal.showModal(); document.querySelector("#friendName").focus(); }
document.querySelector("#addFriendButton").addEventListener("click", openFriendModal);
document.querySelector("#friendForm").addEventListener("submit", event => {
  event.preventDefault();
  const name = document.querySelector("#friendName").value.trim();
  if (!name) { showToast("プレイヤー名を入力してください"); return; }
  friendModal.close();
  document.querySelector("#friendName").value = "";
  showToast(`${name} へのフレンド申請機能は準備中です`);
});

document.querySelectorAll(".tab").forEach(tab => tab.addEventListener("click", () => {
  activeFilter = tab.dataset.filter;
  document.querySelectorAll(".tab").forEach(item => {
    const selected = item === tab;
    item.classList.toggle("active", selected);
    item.setAttribute("aria-selected", String(selected));
  });
  renderGames();
}));
searchInput.addEventListener("input", renderGames);
document.addEventListener("keydown", event => {
  if (event.key === "/" && !["INPUT","TEXTAREA"].includes(document.activeElement.tagName)) {
    event.preventDefault(); searchInput.focus();
  }
});
document.querySelectorAll(".nav-item").forEach(item => item.addEventListener("click", () => {
  if (item.dataset.page === "profile") { location.href = "./me/"; return; }   // 「自分」: ボディパーツ編集ページ
  if (item.dataset.page !== "home") showToast(`${item.textContent.trim()} は順次公開予定です`);
  document.querySelectorAll(".nav-item").forEach(nav => nav.classList.toggle("active", nav === item));
}));
initAuth({ showToast });
document.querySelector(".notification-button").addEventListener("click", () => showToast("新しい通知はありません"));
document.querySelector(".currency-pill").addEventListener("click", () => showToast("Rae 通貨システムは準備中です"));
const sidebar = document.querySelector("#sidebar");
document.querySelector("#menuButton").addEventListener("click", () => sidebar.classList.toggle("open"));
document.addEventListener("click", event => {
  if (window.innerWidth <= 650 && sidebar.classList.contains("open") && !sidebar.contains(event.target) && !event.target.closest("#menuButton")) sidebar.classList.remove("open");
});

renderFriends();
renderGames();
