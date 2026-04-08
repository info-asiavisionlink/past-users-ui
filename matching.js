/**
 * Past participants matching — vanilla JS
 * Data shape is normalized from common webhook field names.
 */

const DATA_URL =
  "https://nextasia.app.n8n.cloud/webhook/c328b61c-9d8a-4488-97de-3632536dbd41";
const SUBMIT_URL =
  "https://nextasia.app.n8n.cloud/webhook/ac46b708-bc1c-4d23-92ab-12f41490702b";

/** @typedef {{ lineId: string, name: string, company: string }} CurrentUser */
/** @typedef {{ lineId: string, name: string, company: string, jobTitle: string, hobby: string, selfPr: string, profileUrl: string }} Participant */

const state = {
  lineId: "",
  /** @type {CurrentUser | null} */
  currentUser: null,
  /** @type {Participant[]} */
  participants: [],
  /** @type {Set<string>} */
  selectedLineIds: new Set(),
};

// ——— URL ———

function getLineIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return (params.get("line_id") || "").trim();
}

// ——— Normalize API payload (flexible keys) ———

function pickStr(obj, keys, fallback = "") {
  if (!obj || typeof obj !== "object") return fallback;
  for (const k of keys) {
    const v = obj[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return fallback;
}

/**
 * @param {Record<string, unknown>} o
 * @returns {Participant}
 */
function participantFromRecord(o) {
  return {
    lineId: pickStr(o, ["line_id", "lineId", "lineID"]),
    name: pickStr(o, ["name", "full_name", "displayName", "display_name"]),
    company: pickStr(o, ["company", "company_name", "companyName", "org"]),
    jobTitle: pickStr(o, ["job_title", "jobTitle", "title", "occupation", "position"]),
    hobby: pickStr(o, ["hobby", "hobbies", "interest", "interests"]),
    selfPr: pickStr(o, ["self_pr", "selfPr", "selfPR", "pr", "introduction", "bio"]),
    profileUrl: pickStr(o, ["profile_url", "profileUrl", "url", "link", "website"]),
  };
}

/**
 * @param {unknown} raw
 * @returns {{ currentUser: CurrentUser | null, participants: Participant[] }}
 */
function normalizePayload(raw) {
  if (Array.isArray(raw)) {
    const participants = /** @type {unknown[]} */ (raw)
      .filter((item) => item && typeof item === "object")
      .map((item) => participantFromRecord(/** @type {Record<string, unknown>} */ (item)))
      .filter((p) => p.lineId)
      .slice(0, 10);
    return { currentUser: null, participants };
  }

  const root =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? /** @type {Record<string, unknown>} */ (raw)
      : {};

  const userBlock =
    root.currentUser ||
    root.user ||
    root.me ||
    root.profile ||
    root.self ||
    null;

  const userObj =
    userBlock && typeof userBlock === "object"
      ? /** @type {Record<string, unknown>} */ (userBlock)
      : root;

  const currentUserLineId = pickStr(userObj, ["line_id", "lineId", "lineID"]);
  const currentUser = {
    lineId: currentUserLineId || state.lineId,
    name: pickStr(userObj, ["name", "full_name", "displayName", "display_name"]),
    company: pickStr(userObj, [
      "company",
      "company_name",
      "companyName",
      "org",
      "organization",
    ]),
  };

  let list = root.participants ?? root.users ?? root.past_participants ?? root.items;
  if (!Array.isArray(list)) list = [];

  /** @type {Participant[]} */
  const participants = list
    .filter((item) => item && typeof item === "object")
    .map((item) => participantFromRecord(/** @type {Record<string, unknown>} */ (item)))
    .filter((p) => p.lineId);

  return {
    currentUser: currentUser.lineId ? currentUser : null,
    participants: participants.slice(0, 10),
  };
}

// ——— XSS-safe text ———

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// ——— DOM refs ———

const el = {
  loading: document.getElementById("state-loading"),
  error: document.getElementById("state-error"),
  errorMessage: document.getElementById("error-message"),
  content: document.getElementById("state-content"),
  currentName: document.getElementById("current-user-name"),
  currentCompany: document.getElementById("current-user-company"),
  list: document.getElementById("participant-list"),
  submitBtn: document.getElementById("submit-btn"),
  selectionCount: document.getElementById("selection-count"),
  submitSuccess: document.getElementById("submit-success"),
  retryBtn: document.getElementById("retry-btn"),
};

function showLoading() {
  el.loading.classList.remove("hidden");
  el.error.classList.add("hidden");
  el.content.classList.add("hidden");
  el.loading.setAttribute("aria-busy", "true");
}

function showError(message) {
  el.loading.classList.add("hidden");
  el.error.classList.remove("hidden");
  el.content.classList.add("hidden");
  el.errorMessage.textContent = message;
  el.loading.setAttribute("aria-busy", "false");
}

function showContent() {
  el.loading.classList.add("hidden");
  el.error.classList.add("hidden");
  el.content.classList.remove("hidden");
  el.loading.setAttribute("aria-busy", "false");
}

function updateSelectionUi() {
  const n = state.selectedLineIds.size;
  el.selectionCount.textContent = `${n} / 10 名を選択中`;
  el.submitBtn.disabled = n === 0;
  el.submitSuccess.classList.add("hidden");
  el.submitSuccess.classList.remove("submit-success--error");
  el.submitSuccess.textContent = "";

  document.querySelectorAll(".select-row__input").forEach((input) => {
    const id = input.getAttribute("data-line-id");
    if (!id) return;
    const atMax = n >= 10 && !state.selectedLineIds.has(id);
    input.disabled = atMax;
  });
}

/**
 * @param {Participant} p
 * @param {number} index
 */
function renderParticipantCard(p, index) {
  const li = document.createElement("li");
  li.className = "card participant-card";
  const inputId = `meet-toggle-${index}`;

  const profileLink =
    p.profileUrl && /^https?:\/\//i.test(p.profileUrl)
      ? `<a class="participant-card__link" href="${escapeHtml(p.profileUrl)}" target="_blank" rel="noopener noreferrer">プロフィールを見る</a>`
      : p.profileUrl
        ? `<span class="participant-card__meta">${escapeHtml(p.profileUrl)}</span>`
        : "";

  const safeName = escapeHtml(p.name || "（名前なし）");
  const safeCompany = escapeHtml(p.company || "—");
  const safeJob = escapeHtml(p.jobTitle || "—");
  const safeHobby = escapeHtml(p.hobby || "—");
  const safePr = escapeHtml(p.selfPr || "—");

  li.innerHTML = `
    <h3 class="participant-card__title">${safeName}</h3>
    <p class="participant-card__meta">${safeCompany}</p>
    <div class="participant-card__block">
      <span class="participant-card__label">職種・役職</span>
      ${safeJob}
    </div>
    <div class="participant-card__block">
      <span class="participant-card__label">趣味</span>
      ${safeHobby}
    </div>
    <div class="participant-card__block">
      <span class="participant-card__label">自己PR</span>
      ${safePr}
    </div>
    ${profileLink ? `<div>${profileLink}</div>` : ""}
    <div class="select-row">
      <label class="select-row__label" for="${inputId}">
        <span class="select-row__text">この人に会いたい</span>
        <input
          type="checkbox"
          class="select-row__input"
          id="${inputId}"
          data-line-id="${escapeHtml(p.lineId)}"
          ${state.selectedLineIds.has(p.lineId) ? "checked" : ""}
        />
        <span class="select-row__switch" aria-hidden="true"></span>
      </label>
    </div>
  `;

  const checkbox = li.querySelector(".select-row__input");
  checkbox?.addEventListener("change", () => {
    const lineId = checkbox.getAttribute("data-line-id");
    if (!lineId) return;
    if (checkbox.checked) {
      if (state.selectedLineIds.size >= 10) {
        checkbox.checked = false;
        return;
      }
      state.selectedLineIds.add(lineId);
    } else {
      state.selectedLineIds.delete(lineId);
    }
    updateSelectionUi();
  });

  return li;
}

function render() {
  if (state.currentUser) {
    el.currentName.textContent = state.currentUser.name || "—";
    el.currentCompany.textContent = state.currentUser.company || "—";
  } else {
    el.currentName.textContent = "—";
    el.currentCompany.textContent = "—";
  }

  el.list.innerHTML = "";
  state.participants.forEach((p, i) => {
    el.list.appendChild(renderParticipantCard(p, i));
  });

  updateSelectionUi();
}

async function fetchData() {
  const url = new URL(DATA_URL);
  url.searchParams.set("line_id", state.lineId);

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(`サーバーが応答しませんでした（${res.status}）`);
  }

  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const text = await res.text();
    throw new Error(text ? "想定外の形式のデータが返りました" : "JSONではありません");
  }

  return res.json();
}

async function load() {
  state.lineId = getLineIdFromUrl();
  if (!state.lineId) {
    showError("URL に line_id が含まれていません。LINE から開き直してください。");
    return;
  }

  showLoading();
  try {
    const json = await fetchData();
    const { currentUser, participants } = normalizePayload(json);
    state.currentUser = currentUser || {
      lineId: state.lineId,
      name: "",
      company: "",
    };
    state.participants = participants;
    state.selectedLineIds = new Set();
    render();
    showContent();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "通信エラーが発生しました";
    showError(msg);
  }
}

async function submitSelections() {
  const ids = Array.from(state.selectedLineIds);
  if (ids.length === 0) return;

  el.submitBtn.disabled = true;
  el.submitBtn.classList.add("is-loading");
  const originalText = el.submitBtn.textContent;
  el.submitBtn.textContent = "送信中…";
  el.submitSuccess.classList.add("hidden");
  el.submitSuccess.classList.remove("submit-success--error");

  try {
    const url = new URL(SUBMIT_URL);
    url.searchParams.set("from_line_id", state.lineId);
    url.searchParams.set("selected_line_ids", ids.join(","));

    const res = await fetch(url.toString(), { method: "GET" });

    if (!res.ok) {
      throw new Error(`送信に失敗しました（${res.status}）`);
    }

    el.submitSuccess.textContent = "交流申請を送信しました。しばらくお待ちください。";
    el.submitSuccess.classList.remove("hidden");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "送信に失敗しました";
    el.submitSuccess.textContent = msg;
    el.submitSuccess.classList.add("submit-success--error");
    el.submitSuccess.classList.remove("hidden");
  } finally {
    el.submitBtn.classList.remove("is-loading");
    el.submitBtn.textContent = originalText || "選択した人に交流申請する";
    updateSelectionUi();
  }
}

function init() {
  el.retryBtn?.addEventListener("click", () => load());
  el.submitBtn?.addEventListener("click", () => submitSelections());
  load();
}

init();
