/**
 * AI matching UI — vanilla JS
 */

/** GET: AI matching data (?line_id= appended at runtime) */
const MATCHES_WEBHOOK_URL =
  "https://nextasia.app.n8n.cloud/webhook/c328b61c-9d8a-4488-97de-3632536dbd41";

/** GET: submit selected users + me (query parameters) */
const SUBMIT_WEBHOOK_URL =
  "https://nextasia.app.n8n.cloud/webhook/ac46b708-bc1c-4d23-92ab-12f41490702b";

/** Minimum time to show the “AI analyzing” screen (ms) — ~20s */
const MIN_LOADING_MS = 20000;

/** Fake analysis steps 1→10 (spread across MIN_LOADING_MS) */
const LOADING_STEP_INTERVAL_MS = 2000;

// ——— State ———

const appState = {
  /** @type {MeUser | null} */
  me: null,
  /** @type {{ line_id: string, name: string }[]} */
  selectedUsers: [],
  /** @type {Map<string, { line_id: string, name: string }>} */
  matchByLineId: new Map(),
  submitInFlight: false,
  submissionSucceeded: false,
};

// ——— DOM ———

const dom = {
  app: document.getElementById("app"),
  success: document.getElementById("success"),
  successCloseBtn: document.getElementById("success-close-btn"),
  loading: document.getElementById("screen-loading"),
  loadingStep: document.getElementById("loading-step"),
  loadingCountdown: document.getElementById("loading-countdown"),
  loadingStream: document.getElementById("loading-stream"),
  progressAria: document.getElementById("progress-aria"),
  progressFlow: document.getElementById("progress-flow"),
  error: document.getElementById("screen-error"),
  errorMessage: document.getElementById("error-message"),
  retry: document.getElementById("retry-btn"),
  main: document.getElementById("screen-main"),
  meName: document.getElementById("me-name"),
  meTarget: document.getElementById("me-target"),
  meNg: document.getElementById("me-ng"),
  meSummary: document.getElementById("me-summary"),
  meTags: document.getElementById("me-tags"),
  grid: document.getElementById("user-grid"),
  cta: document.getElementById("cta-btn"),
  selectionHint: document.getElementById("selection-hint"),
  ctaStatus: document.getElementById("cta-status"),
};

const STREAM_CHARS = "·∙○◦░▒▓█▀▄╱╲";

function getLineIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return (params.get("line_id") || "").trim();
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

/** Placeholder display「—」→ empty for query strings */
function queryParamName(name) {
  const s = String(name ?? "").trim();
  return s === "—" ? "" : s;
}

function pickStr(obj, keys, fallback = "—") {
  if (!obj || typeof obj !== "object") return fallback;
  for (const k of keys) {
    const v = /** @type {Record<string, unknown>} */ (obj)[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return fallback === "—" ? "—" : fallback;
}

function normalizeTags(raw) {
  if (Array.isArray(raw)) {
    return raw.map((t) => String(t).trim()).filter(Boolean);
  }
  if (raw == null || raw === "") return [];
  const s = String(raw).trim();
  if (!s) return [];
  return s.split(/[,、]/).map((t) => t.trim()).filter(Boolean);
}

/**
 * @typedef {{ line_id: string, name: string, target: string, ng: string, ai_summary: string, tags: string[] }} MeUser
 * @typedef {{ line_id: string, name: string, ai_summary: string, reason: string }} MatchUser
 */

function parseMeRecord(m) {
  return {
    line_id: pickStr(m, ["line_id", "lineId"], ""),
    name: pickStr(m, ["name"], "—"),
    target: pickStr(
      m,
      ["target_people", "target", "協力して欲しいこと", "協力してほしいこと", "cooperation", "cooperation_wanted"],
      "—"
    ),
    ng: pickStr(m, ["ng_people", "ng", "関わりたくない人", "avoid"], "—"),
    ai_summary: pickStr(m, ["ai_summary", "aiSummary"], "—"),
    tags: normalizeTags(m.tags ?? m.tag),
  };
}

function parseMatchRecord(u) {
  return {
    line_id: pickStr(u, ["line_id", "lineId"], ""),
    name: pickStr(u, ["name"], "—"),
    ai_summary: pickStr(u, ["ai_summary", "aiSummary"], "—"),
    reason: pickStr(u, ["reason", "matching_reason"], "—"),
  };
}

/**
 * Webhook returns [{ me, matches }]. Always use payload = data[0], then payload.me / payload.matches.
 * Dev override may be a plain { me, matches } object.
 *
 * @param {unknown} raw
 * @returns {{ me: MeUser, matches: MatchUser[] }}
 */
function parsePayload(raw) {
  /** @type {MeUser} */
  const emptyMe = {
    line_id: "",
    name: "—",
    target: "—",
    ng: "—",
    ai_summary: "—",
    tags: [],
  };

  function matchesFromList(list) {
    if (!Array.isArray(list)) return [];
    return list
      .filter((x) => x && typeof x === "object")
      .map((x) => parseMatchRecord(/** @type {Record<string, unknown>} */ (x)))
      .filter((m) => m.line_id)
      .slice(0, 10);
  }

  /**
   * @param {unknown} payload
   */
  function fromPayloadObject(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { me: emptyMe, matches: [] };
    }
    const o = /** @type {Record<string, unknown>} */ (payload);
    let me = emptyMe;
    if (o.me && typeof o.me === "object") {
      me = parseMeRecord(/** @type {Record<string, unknown>} */ (o.me));
    }
    const matches = matchesFromList(o.matches);
    return { me, matches };
  }

  if (Array.isArray(raw)) {
    const arr = /** @type {unknown[]} */ (raw);
    if (arr.length === 0) {
      throw new Error("応答が空の配列です。[{ me, matches }] 形式を確認してください。");
    }
    // API returns [ { me, matches } ] — always use data[0], never data.me / data.matches
    const payload = arr[0];
    if (payload == null || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("data[0] がオブジェクトではありません。me / matches を含むオブジェクトが必要です。");
    }
    return fromPayloadObject(payload);
  }

  if (raw && typeof raw === "object") {
    return fromPayloadObject(raw);
  }

  return { me: emptyMe, matches: [] };
}

/**
 * @param {string} lineId
 */
async function loadPayload(lineId) {
  if (typeof window.__AI_MATCH_PAYLOAD__ !== "undefined" && window.__AI_MATCH_PAYLOAD__ !== null) {
    return window.__AI_MATCH_PAYLOAD__;
  }

  const url = new URL(MATCHES_WEBHOOK_URL);
  url.searchParams.set("line_id", lineId);

  let res;
  try {
    res = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new Error("ネットワークエラーです。接続を確認して再試行してください。");
  }

  if (!res.ok) {
    throw new Error(`データの取得に失敗しました（${res.status}）`);
  }

  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const text = await res.text();
    throw new Error(
      text.trim()
        ? `想定外の応答形式です: ${text.trim().slice(0, 120)}${text.length > 120 ? "…" : ""}`
        : "JSONではない応答が返りました"
    );
  }

  try {
    return await res.json();
  } catch {
    throw new Error("JSONの解析に失敗しました");
  }
}

/**
 * @param {(step: number) => void} stepCallback
 * @param {(stream: string) => void} streamCallback
 * @param {(secondsLeft: number) => void} countdownCallback — 20 → 0
 */
function runLoadingFx(stepCallback, streamCallback, countdownCallback) {
  let sec = 20;
  countdownCallback(sec);
  const countId = window.setInterval(() => {
    sec = Math.max(0, sec - 1);
    countdownCallback(sec);
  }, 1000);

  let step = 1;
  stepCallback(step);
  const stepId = window.setInterval(() => {
    step = Math.min(10, step + 1);
    stepCallback(step);
  }, LOADING_STEP_INTERVAL_MS);

  let stream = "";
  const streamId = window.setInterval(() => {
    const c = STREAM_CHARS[Math.floor(Math.random() * STREAM_CHARS.length)];
    stream = (stream + c).slice(-48);
    streamCallback(stream);
  }, 120);

  return () => {
    window.clearInterval(countId);
    window.clearInterval(stepId);
    window.clearInterval(streamId);
  };
}

function wait(ms) {
  return new Promise((r) => window.setTimeout(r, ms));
}

function renderMe(me) {
  dom.meName.textContent = me.name || "—";
  dom.meTarget.textContent = me.target;
  dom.meNg.textContent = me.ng;
  dom.meSummary.textContent = me.ai_summary;
  dom.meTags.innerHTML = "";
  if (me.tags.length === 0) {
    dom.meTags.textContent = "—";
    return;
  }
  me.tags.forEach((t) => {
    const span = document.createElement("span");
    span.className = "tag";
    span.textContent = t;
    dom.meTags.appendChild(span);
  });
}

/**
 * @param {MatchUser[]} matches
 */
function renderGrid(matches) {
  dom.grid.innerHTML = "";
  appState.matchByLineId.clear();
  appState.selectedUsers = [];

  matches.forEach((m) => {
    appState.matchByLineId.set(m.line_id, {
      line_id: m.line_id,
      name: m.name,
    });

    const card = document.createElement("article");
    card.className = "user-card";
    card.setAttribute("role", "listitem");
    card.setAttribute("tabindex", "0");
    card.dataset.lineId = m.line_id;

    card.innerHTML = `
      <div class="user-card__check" aria-hidden="true"></div>
      <h3 class="user-card__name">${escapeHtml(m.name)}</h3>
      <div class="user-card__block">
        <span class="user-card__label">AIサマリー</span>
        ${escapeHtml(m.ai_summary)}
      </div>
      <div class="user-card__block">
        <span class="user-card__label">マッチ理由</span>
        ${escapeHtml(m.reason)}
      </div>
    `;

    function toggle() {
      const id = m.line_id;
      const row = appState.matchByLineId.get(id);
      if (!row) return;
      const idx = appState.selectedUsers.findIndex((u) => u.line_id === id);
      if (idx === -1) {
        appState.selectedUsers.push({ line_id: row.line_id, name: row.name });
        card.classList.add("is-selected");
        card.setAttribute("aria-pressed", "true");
      } else {
        appState.selectedUsers.splice(idx, 1);
        card.classList.remove("is-selected");
        card.setAttribute("aria-pressed", "false");
      }
      updateCta();
    }

    card.setAttribute("aria-pressed", "false");
    card.addEventListener("click", (e) => {
      if (e.target.closest("a")) return;
      toggle();
    });
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    });

    dom.grid.appendChild(card);
  });

  updateCta();
}

function updateCta() {
  const n = appState.selectedUsers.length;
  dom.selectionHint.textContent = `${n} 名を選択中`;
  if (appState.submissionSucceeded) {
    dom.cta.disabled = true;
    return;
  }
  dom.cta.disabled = n === 0;
  dom.ctaStatus.classList.add("hidden");
  dom.ctaStatus.textContent = "";
  dom.ctaStatus.classList.remove("is-success", "is-error");
}

function resetSuccessView() {
  appState.submissionSucceeded = false;
  if (dom.app) {
    dom.app.style.display = "";
    dom.app.classList.remove("app--exiting");
  }
  if (dom.success) {
    dom.success.classList.add("hidden");
    dom.success.classList.remove("success-screen--visible");
    dom.success.setAttribute("aria-hidden", "true");
  }
}

/**
 * Fade out selection UI, then show full success screen (after webhook OK).
 */
function showSuccessView() {
  appState.submissionSucceeded = true;
  const appEl = dom.app;
  const successEl = dom.success;
  if (!appEl || !successEl) return;

  appEl.classList.add("app--exiting");
  window.setTimeout(() => {
    appEl.style.display = "none";
    appEl.classList.remove("app--exiting");
    successEl.classList.remove("hidden");
    successEl.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => {
      successEl.classList.add("success-screen--visible");
      const title = successEl.querySelector(".success-screen__title");
      if (title instanceof HTMLElement) {
        title.setAttribute("tabindex", "-1");
        title.focus({ preventScroll: true });
      }
    });
  }, 400);
}

function buildSubmitUrl() {
  const me = appState.me;
  if (!me) return null;

  const params = new URLSearchParams();
  params.append("me_name", queryParamName(me.name));
  params.append("me_line_id", me.line_id || "");

  appState.selectedUsers.slice(0, 10).forEach((user, index) => {
    const n = index + 1;
    params.append(`user_${n}_name`, queryParamName(user.name));
    params.append(`user_${n}_line_id`, user.line_id || "");
  });

  return `${SUBMIT_WEBHOOK_URL}?${params.toString()}`;
}

async function submitSelection() {
  if (appState.submitInFlight || appState.submissionSucceeded) return;
  if (appState.selectedUsers.length === 0 || !appState.me) return;

  const url = buildSubmitUrl();
  if (!url) return;

  appState.submitInFlight = true;
  const prev = dom.cta.textContent;
  dom.cta.disabled = true;
  dom.cta.classList.add("is-loading");
  dom.cta.textContent = "送信中…";

  try {
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) throw new Error(`送信に失敗しました（${res.status}）`);
    dom.cta.classList.remove("is-loading");
    dom.cta.textContent = prev || "選択したユーザーに交流会参加リクエストを送る";
    showSuccessView();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "送信に失敗しました";
    dom.ctaStatus.textContent = msg;
    dom.ctaStatus.classList.remove("hidden", "is-success");
    dom.ctaStatus.classList.add("is-error");
    dom.cta.classList.remove("is-loading");
    dom.cta.textContent = prev || "選択したユーザーに交流会参加リクエストを送る";
    updateCta();
  } finally {
    appState.submitInFlight = false;
  }
}

async function bootstrap() {
  resetSuccessView();

  dom.error.classList.add("hidden");
  dom.main.classList.add("hidden");
  dom.main.classList.remove("is-visible");

  const lineId = getLineIdFromUrl();
  if (!lineId) {
    dom.loading.classList.add("hidden", "is-done");
    dom.loading.setAttribute("aria-busy", "false");
    dom.errorMessage.textContent =
      "URL に line_id がありません。例: ページURLに ?line_id=あなたのID を付けて開いてください。";
    dom.error.classList.remove("hidden");
    return;
  }

  dom.loading.classList.remove("hidden", "is-done");
  dom.loading.setAttribute("aria-busy", "true");

  let currentStep = 1;
  dom.loadingStep.textContent = `分析ステップ: ${currentStep} / 10`;
  if (dom.loadingCountdown) dom.loadingCountdown.textContent = "残り約 20 秒";
  if (dom.progressAria) dom.progressAria.setAttribute("aria-valuenow", "0");

  const stopFx = runLoadingFx(
    (step) => {
      currentStep = step;
      dom.loadingStep.textContent = `分析ステップ: ${step} / 10`;
    },
    (s) => {
      dom.loadingStream.textContent = s;
    },
    (secondsLeft) => {
      if (dom.loadingCountdown) {
        dom.loadingCountdown.textContent =
          secondsLeft > 0 ? `残り約 ${secondsLeft} 秒` : "分析を仕上げています…";
      }
      if (dom.progressAria) {
        const elapsed = 20 - Math.max(0, secondsLeft);
        const pct = Math.min(100, Math.round((elapsed / 20) * 100));
        dom.progressAria.setAttribute("aria-valuenow", String(pct));
      }
    }
  );

  const loadStartedAt = Date.now();
  let data;
  try {
    const json = await loadPayload(lineId);
    const elapsed = Date.now() - loadStartedAt;
    if (elapsed < MIN_LOADING_MS) {
      await wait(MIN_LOADING_MS - elapsed);
    }
    data = parsePayload(json);
  } catch (e) {
    stopFx();
    dom.loading.classList.add("is-done");
    const msg = e instanceof Error ? e.message : "エラーが発生しました";
    dom.errorMessage.textContent = msg;
    dom.error.classList.remove("hidden");
    dom.loading.setAttribute("aria-busy", "false");
    return;
  }

  stopFx();

  /** @type {MeUser} */
  const me = { ...data.me };
  if (!me.line_id) me.line_id = lineId;
  appState.me = me;

  renderMe(me);
  renderGrid(data.matches);

  dom.loading.classList.add("is-done");
  dom.loading.setAttribute("aria-busy", "false");
  dom.main.classList.remove("hidden");
  dom.main.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => {
    dom.main.classList.add("is-visible");
  });
}

function init() {
  dom.retry?.addEventListener("click", () => bootstrap());
  dom.cta?.addEventListener("click", () => submitSelection());
  dom.successCloseBtn?.addEventListener("click", () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.close();
    }
  });
  bootstrap();
}

init();
