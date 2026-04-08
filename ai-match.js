/**
 * AI matching UI — vanilla JS
 * Configure endpoints below.
 */

/** GET: returns JSON (see parsePayload). Leave empty to use window.__AI_MATCH_PAYLOAD__ */
const FETCH_MATCHES_URL = "";

/** POST: selected users webhook */
const SEND_WEBHOOK_URL = "";

/** Minimum time to show the “AI analyzing” screen (ms) — ~10s per spec */
const MIN_LOADING_MS = 10000;

/** Step counter ticks (1→10) during loading */
const LOADING_STEP_INTERVAL_MS = 1000;

// ——— State ———

const appState = {
  /** @type {string[]} */
  selectedLineIds: [],
  /** @type {Map<string, string>} line_id -> reason */
  reasonByLineId: new Map(),
};

// ——— DOM ———

const dom = {
  loading: document.getElementById("screen-loading"),
  loadingStep: document.getElementById("loading-step"),
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

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
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

/**
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

  if (Array.isArray(raw)) {
    const arr = /** @type {unknown[]} */ (raw);
    if (arr.length === 0) return { me: emptyMe, matches: [] };
    const first = arr[0];
    if (!first || typeof first !== "object") return { me: emptyMe, matches: [] };
    const meObj = /** @type {Record<string, unknown>} */ (first);
    const me = {
      line_id: pickStr(meObj, ["line_id", "lineId"], ""),
      name: pickStr(meObj, ["name"], "—"),
      target: pickStr(
        meObj,
        ["target", "協力して欲しいこと", "cooperation", "cooperation_wanted"],
        "—"
      ),
      ng: pickStr(meObj, ["ng", "関わりたくない人", "ng_people", "avoid"], "—"),
      ai_summary: pickStr(meObj, ["ai_summary", "aiSummary"], "—"),
      tags: normalizeTags(meObj.tags ?? meObj.tag),
    };
    const rest = arr.slice(1);
    const matches = rest
      .filter((x) => x && typeof x === "object")
      .map((x) => {
        const o = /** @type {Record<string, unknown>} */ (x);
        return {
          line_id: pickStr(o, ["line_id", "lineId"], ""),
          name: pickStr(o, ["name"], "—"),
          ai_summary: pickStr(o, ["ai_summary", "aiSummary"], "—"),
          reason: pickStr(o, ["reason", "matching_reason"], "—"),
        };
      })
      .filter((m) => m.line_id);
    return { me, matches: matches.slice(0, 10) };
  }

  if (raw && typeof raw === "object") {
    const o = /** @type {Record<string, unknown>} */ (raw);
    const meBlock = o.me ?? o.self ?? o.user ?? o.current_user ?? o["(me)"];
    let me = emptyMe;
    if (meBlock && typeof meBlock === "object") {
      const m = /** @type {Record<string, unknown>} */ (meBlock);
      me = {
        line_id: pickStr(m, ["line_id", "lineId"], ""),
        name: pickStr(m, ["name"], "—"),
        target: pickStr(
          m,
          ["target", "協力して欲しいこと", "cooperation", "cooperation_wanted"],
          "—"
        ),
        ng: pickStr(m, ["ng", "関わりたくない人", "ng_people", "avoid"], "—"),
        ai_summary: pickStr(m, ["ai_summary", "aiSummary"], "—"),
        tags: normalizeTags(m.tags ?? m.tag),
      };
    }
    let list = o.matches ?? o.users ?? o.matched_users ?? o.participants;
    if (!Array.isArray(list)) list = [];
    const matches = list
      .filter((x) => x && typeof x === "object")
      .map((x) => {
        const u = /** @type {Record<string, unknown>} */ (x);
        return {
          line_id: pickStr(u, ["line_id", "lineId"], ""),
          name: pickStr(u, ["name"], "—"),
          ai_summary: pickStr(u, ["ai_summary", "aiSummary"], "—"),
          reason: pickStr(u, ["reason", "matching_reason"], "—"),
        };
      })
      .filter((m) => m.line_id);
    return { me, matches: matches.slice(0, 10) };
  }

  return { me: emptyMe, matches: [] };
}

async function loadPayload() {
  if (typeof window.__AI_MATCH_PAYLOAD__ !== "undefined" && window.__AI_MATCH_PAYLOAD__ !== null) {
    return window.__AI_MATCH_PAYLOAD__;
  }
  if (!FETCH_MATCHES_URL || !String(FETCH_MATCHES_URL).trim()) {
    throw new Error(
      "データURLが未設定です。ai-match.js の FETCH_MATCHES_URL を設定するか、window.__AI_MATCH_PAYLOAD__ にJSONを渡してください。"
    );
  }
  const res = await fetch(FETCH_MATCHES_URL, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`取得に失敗しました（${res.status}）`);
  return res.json();
}

function runLoadingFx(stepCallback, streamCallback) {
  let step = 1;
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
    window.clearInterval(stepId);
    window.clearInterval(streamId);
  };
}

function wait(ms) {
  return new Promise((r) => window.setTimeout(r, ms));
}

function renderMe(me) {
  dom.meName.textContent = me.name;
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
  appState.reasonByLineId.clear();
  appState.selectedLineIds = [];

  matches.forEach((m) => {
    appState.reasonByLineId.set(m.line_id, m.reason);

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
      const idx = appState.selectedLineIds.indexOf(id);
      if (idx === -1) {
        appState.selectedLineIds.push(id);
        card.classList.add("is-selected");
        card.setAttribute("aria-pressed", "true");
      } else {
        appState.selectedLineIds.splice(idx, 1);
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
  const n = appState.selectedLineIds.length;
  dom.selectionHint.textContent = `${n} 名を選択中`;
  dom.cta.disabled = n === 0;
  dom.ctaStatus.classList.add("hidden");
  dom.ctaStatus.textContent = "";
  dom.ctaStatus.classList.remove("is-success", "is-error");
}

async function submitSelection() {
  if (!SEND_WEBHOOK_URL || !String(SEND_WEBHOOK_URL).trim()) {
    dom.ctaStatus.textContent = "送信先（SEND_WEBHOOK_URL）が未設定です。";
    dom.ctaStatus.classList.remove("hidden", "is-success");
    dom.ctaStatus.classList.add("is-error");
    return;
  }

  const selected_users = appState.selectedLineIds.map((line_id) => ({
    line_id,
    reason: appState.reasonByLineId.get(line_id) || "",
  }));

  const prev = dom.cta.textContent;
  dom.cta.disabled = true;
  dom.cta.textContent = "送信中…";

  try {
    const res = await fetch(SEND_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ selected_users }),
    });
    if (!res.ok) throw new Error(`送信に失敗しました（${res.status}）`);
    dom.ctaStatus.textContent = "リクエストを送信しました。";
    dom.ctaStatus.classList.remove("hidden", "is-error");
    dom.ctaStatus.classList.add("is-success");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "送信に失敗しました";
    dom.ctaStatus.textContent = msg;
    dom.ctaStatus.classList.remove("hidden", "is-success");
    dom.ctaStatus.classList.add("is-error");
  } finally {
    dom.cta.textContent = prev || "選択したユーザーに交流会参加リクエストを送る";
    updateCta();
  }
}

async function bootstrap() {
  dom.error.classList.add("hidden");
  dom.main.classList.add("hidden");
  dom.main.classList.remove("is-visible");
  dom.loading.classList.remove("is-done");
  dom.loading.setAttribute("aria-busy", "true");

  let currentStep = 1;
  dom.loadingStep.textContent = `分析ステップ: ${currentStep} / 10`;
  if (dom.progressAria) dom.progressAria.setAttribute("aria-valuenow", "0");

  const stopFx = runLoadingFx(
    (step) => {
      currentStep = step;
      dom.loadingStep.textContent = `分析ステップ: ${step} / 10`;
      if (dom.progressAria) dom.progressAria.setAttribute("aria-valuenow", String(step * 10));
    },
    (s) => {
      dom.loadingStream.textContent = s;
    }
  );

  let data;
  try {
    const p = loadPayload();
    const minWait = wait(MIN_LOADING_MS);
    const [, json] = await Promise.all([minWait, p]);
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

  renderMe(data.me);
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
  bootstrap();
}

init();
