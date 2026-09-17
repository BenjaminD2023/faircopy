const PACE_KEY = "faircopy.paceSeconds";
const PROGRESS_KEY = "faircopy.progress";
const DEFAULT_PACE = 40;

const app = document.getElementById("app");

const state = {
  units: [],
  pace: loadPace(),
  view: "home",
  unitId: null,
  index: 0,
  flipped: false,
  startedAt: 0,
  baseElapsed: 0,
  finishedMs: 0,
  tick: null,
  persistTick: null,
  clickTimer: null,
};

function loadPace() {
  const raw = localStorage.getItem(PACE_KEY);
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_PACE;
}

function savePace(n) {
  state.pace = n;
  localStorage.setItem(PACE_KEY, String(n));
}

function loadProgress() {
  try {
    const all = JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}");
    if (all["membrane-transport"]) {
      delete all["membrane-transport"];
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
    }
    return all;
  } catch {
    return {};
  }
}

function saveProgress(unitId, payload) {
  const all = loadProgress();
  if (!payload) delete all[unitId];
  else all[unitId] = payload;
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
}

function canonicalUnitId(id) {
  return id === "membrane-transport" ? "cell-structure" : id;
}

function unitById(id) {
  return state.units.find((u) => u.id === canonicalUnitId(id)) ?? null;
}

function fmtClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtEta(seconds) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} sec`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h} hr ${rem} min` : `${h} hr`;
}

function fmtAvg(ms) {
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)} sec / card`;
  const m = Math.floor(sec / 60);
  const r = Math.round(sec % 60);
  return `${m} min ${r} sec / card`;
}

function durationColor(seconds) {
  const t = Math.min(1, Math.max(0, (seconds - 10 * 60) / (40 * 60)));
  const h = 128 - t * 128;
  const s = 54 + t * 28;
  const l = 60 - t * 8;
  return `hsl(${h} ${s}% ${l}%)`;
}

function elapsedNow() {
  if (!state.startedAt) return state.baseElapsed;
  return state.baseElapsed + (Date.now() - state.startedAt);
}

function stopTick() {
  if (state.tick) {
    clearInterval(state.tick);
    state.tick = null;
  }
  if (state.persistTick) {
    clearInterval(state.persistTick);
    state.persistTick = null;
  }
}

function startTick() {
  stopTick();
  const paint = () => {
    const el = document.getElementById("live-timer");
    if (el) el.textContent = fmtClock(elapsedNow());
  };
  paint();
  state.tick = setInterval(paint, 200);
  state.persistTick = setInterval(() => persistStudy(), 2000);
}

function persistStudy() {
  if (!state.unitId || state.view !== "study") return;
  saveProgress(state.unitId, {
    index: state.index,
    elapsedMs: elapsedNow(),
    updatedAt: Date.now(),
  });
}

function parseHash() {
  const raw = location.hash.replace(/^#/, "") || "/";
  const parts = raw.split("/").filter(Boolean);
  if (parts[0] === "u" && parts[1]) {
    return {
      view: parts[2] === "done" ? "done" : "study",
      unitId: canonicalUnitId(parts[1]),
    };
  }
  return { view: "home", unitId: null };
}

function go(hash) {
  const next = hash.startsWith("#") ? hash : `#${hash}`;
  if (location.hash === next) {
    route();
    return;
  }
  location.hash = next;
}

function percent(index, total) {
  if (!total) return 0;
  return Math.floor((index / total) * 100);
}

function paintEstimates() {
  const maxEta = Math.max(
    ...state.units.map((u) => u.cards.length * state.pace),
    1
  );
  app.querySelectorAll("[data-unit]").forEach((row) => {
    const id = row.getAttribute("data-unit");
    const unit = unitById(id);
    if (!unit) return;
    const eta = unit.cards.length * state.pace;
    const color = durationColor(eta);
    const width = Math.max(8, (eta / maxEta) * 100);
    const etaEl = row.querySelector(".eta");
    const fill = row.querySelector(".eta-fill");
    if (etaEl) {
      etaEl.textContent = fmtEta(eta);
      etaEl.style.color = color;
    }
    if (fill) {
      fill.style.width = `${width}%`;
      fill.style.background = color;
    }
  });
}

function renderHome() {
  stopTick();
  const progress = loadProgress();
  const maxEta = Math.max(
    ...state.units.map((u) => u.cards.length * state.pace),
    1
  );

  app.innerHTML = `
    <main class="shell">
      <header class="mast">
        <div>
          <h1 class="wordmark">Faircopy</h1>
          <p class="lede">Copy each stack in listed order. Pace is yours; the desk keeps time.</p>
        </div>
        <div class="pace">
          <label>
            Your pace
            <input id="pace" type="number" min="1" max="600" step="1" value="${state.pace}" />
          </label>
          <span class="unit">sec / word</span>
        </div>
      </header>
      <ul class="ledger">
        ${state.units
          .map((u) => {
            const eta = u.cards.length * state.pace;
            const color = durationColor(eta);
            const width = Math.max(8, (eta / maxEta) * 100);
            const saved = progress[u.id];
            return `
              <li class="unit-item">
                <button class="unit-row" data-unit="${u.id}" type="button">
                  <div>
                    <h2 class="unit-title">${escapeHtml(u.title)}</h2>
                    <p class="unit-meta">${u.cards.length} words</p>
                  </div>
                  <span class="count">${u.cards.length}</span>
                  <span class="eta-wrap">
                    <span class="eta" style="color:${color}">${fmtEta(eta)}</span>
                    <span class="eta-track" aria-hidden="true">
                      <span class="eta-fill" style="width:${width}%;background:${color}"></span>
                    </span>
                  </span>
                </button>
                <button class="reset-link" data-reset="${u.id}" type="button"${saved ? "" : " disabled"}>Reset</button>
              </li>`;
          })
          .join("")}
      </ul>
      <div class="desk-foot" id="reset-all-mount"></div>
    </main>
  `;

  const pace = document.getElementById("pace");
  pace.addEventListener("input", () => {
    const n = Number(pace.value);
    if (!Number.isFinite(n) || n <= 0) return;
    savePace(Math.min(600, Math.round(n)));
    paintEstimates();
  });

  app.querySelectorAll("[data-unit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-unit");
      beginUnit(id);
    });
  });
  app.querySelectorAll("[data-reset]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (btn.disabled) return;
      resetUnitProgress(btn.getAttribute("data-reset"));
    });
  });
  bindResetAll();
}

function bindResetAll() {
  const mount = document.getElementById("reset-all-mount");
  if (!mount) return;
  const showIdle = () => {
    mount.innerHTML = `<button class="reset-link" id="reset-all" type="button">Reset all progress</button>`;
    document.getElementById("reset-all").addEventListener("click", showConfirm);
  };
  const showConfirm = () => {
    mount.innerHTML = `
      <div class="confirm-all" role="alertdialog" aria-labelledby="confirm-all-copy">
        <p id="confirm-all-copy">Clear saved progress for every unit?</p>
        <button class="done-btn" id="confirm-reset-all" type="button">Reset all</button>
        <button class="reset-link" id="cancel-reset-all" type="button">Keep it</button>
      </div>`;
    document.getElementById("confirm-reset-all").addEventListener("click", clearAllProgress);
    document.getElementById("cancel-reset-all").addEventListener("click", showIdle);
  };
  showIdle();
}

function clearAllProgress() {
  localStorage.removeItem(PROGRESS_KEY);
  state.index = 0;
  state.flipped = false;
  state.baseElapsed = 0;
  state.startedAt = 0;
  renderHome();
}

function beginUnit(id, { reset = false } = {}) {
  id = canonicalUnitId(id);
  const unit = unitById(id);
  if (!unit) return;
  if (reset) saveProgress(id, null);
  const saved = reset ? null : loadProgress()[id];
  state.unitId = id;
  state.index = saved ? Math.min(saved.index, unit.cards.length - 1) : 0;
  state.flipped = false;
  state.baseElapsed = saved ? saved.elapsedMs : 0;
  state.startedAt = Date.now();
  go(`#/u/${id}`);
}

function resetUnitProgress(id) {
  saveProgress(id, null);
  if (state.unitId === id) {
    state.index = 0;
    state.flipped = false;
    state.baseElapsed = 0;
    state.startedAt = 0;
  }
  renderHome();
}

function resetStudy() {
  if (!state.unitId) return;
  saveProgress(state.unitId, null);
  state.index = 0;
  state.flipped = false;
  state.baseElapsed = 0;
  state.startedAt = Date.now();
  renderStudy();
}

function renderStudy() {
  const unit = unitById(state.unitId);
  if (!unit) {
    go("#/");
    return;
  }
  const card = unit.cards[state.index];
  const pct = percent(state.index, unit.cards.length);
  const flipped = state.flipped ? " is-flipped" : "";

  app.innerHTML = `
    <div class="study">
      <header class="study-top">
        <div class="chrome-left">
          <a class="desk-link" href="#/" id="desk-link">Desk</a>
          <button class="reset-link" id="reset-study" type="button">Reset</button>
        </div>
        <h1 class="study-title">${escapeHtml(unit.title)}</h1>
        <div class="hud">
          <span class="pct" id="live-pct">${pct}%</span>
          <span class="live-timer" id="live-timer">${fmtClock(elapsedNow())}</span>
        </div>
      </header>
      <div class="stage-wrap">
        <p class="card-count">${state.index + 1} of ${unit.cards.length}</p>
        <div class="stage">
          <div class="card${flipped}" id="flashcard" role="button" tabindex="0" aria-label="Flashcard. Click to flip. Double-click for the next card.">
            <div class="face face-front">
              <p class="side-label">Word</p>
              <p class="term">${escapeHtml(card.term)}</p>
            </div>
            <div class="face face-back">
              <p class="side-label">Definition</p>
              <p class="definition">${escapeHtml(card.definition)}</p>
            </div>
          </div>
        </div>
        <p class="hint">Click the card to flip. Next, or double-click, copies you forward.</p>
        <button class="next-btn" id="next-btn" type="button">${state.index >= unit.cards.length - 1 ? "Finish" : "Next"}</button>
      </div>
    </div>
  `;

  const cardEl = document.getElementById("flashcard");
  bindCard(cardEl);
  document.getElementById("next-btn").addEventListener("click", () => nextCard());
  document.getElementById("reset-study").addEventListener("click", () => resetStudy());
  document.getElementById("desk-link").addEventListener("click", (e) => {
    e.preventDefault();
    persistStudy();
    stopTick();
    state.startedAt = 0;
    go("#/");
  });
  startTick();
  persistStudy();
}

function bindCard(el) {
  if (state.clickTimer) {
    clearTimeout(state.clickTimer);
    state.clickTimer = null;
  }

  el.addEventListener("click", (e) => {
    if (e.detail > 1) return;
    state.clickTimer = setTimeout(() => {
      state.clickTimer = null;
      flipCard();
    }, 240);
  });

  el.addEventListener("dblclick", (e) => {
    e.preventDefault();
    if (state.clickTimer) {
      clearTimeout(state.clickTimer);
      state.clickTimer = null;
    }
    nextCard();
  });

  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      flipCard();
    }
  });
}

function flipCard() {
  state.flipped = !state.flipped;
  document.getElementById("flashcard")?.classList.toggle("is-flipped", state.flipped);
}

function nextCard() {
  const unit = unitById(state.unitId);
  if (!unit) return;
  if (state.index >= unit.cards.length - 1) {
    finishUnit();
    return;
  }
  state.index += 1;
  state.flipped = false;
  persistStudy();
  renderStudy();
}

function finishUnit() {
  const total = elapsedNow();
  state.finishedMs = total;
  stopTick();
  state.startedAt = 0;
  state.baseElapsed = total;
  saveProgress(state.unitId, null);
  go(`#/u/${state.unitId}/done`);
}

function renderDone() {
  stopTick();
  const unit = unitById(state.unitId);
  if (!unit) {
    go("#/");
    return;
  }
  const total = state.finishedMs || state.baseElapsed;
  const avg = unit.cards.length ? total / unit.cards.length : 0;

  app.innerHTML = `
    <main class="done">
      <h1>Stack copied.</h1>
      <p class="unit-done">${escapeHtml(unit.title)} · ${unit.cards.length} cards</p>
      <div class="stats">
        <div>
          <p class="stat-label">Total time</p>
          <p class="stat-value">${fmtClock(total)}</p>
        </div>
        <div>
          <p class="stat-label">Average per flashcard</p>
          <p class="stat-value avg">${fmtAvg(avg)}</p>
        </div>
      </div>
      <div class="done-actions">
        <button class="done-btn" id="copy-again" type="button">Copy again</button>
        <button class="reset-link" id="back-desk" type="button">Back to the desk</button>
      </div>
    </main>
  `;
  document.getElementById("copy-again").addEventListener("click", () => {
    beginUnit(state.unitId, { reset: true });
  });
  document.getElementById("back-desk").addEventListener("click", () => go("#/"));
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function route() {
  const { view, unitId } = parseHash();
  state.view = view;
  if (unitId) state.unitId = unitId;

  if (view === "home") {
    renderHome();
    return;
  }
  if (view === "study") {
    if (!state.startedAt) {
      const saved = loadProgress()[state.unitId];
      state.index = saved ? saved.index : 0;
      state.baseElapsed = saved ? saved.elapsedMs : 0;
      state.startedAt = Date.now();
      state.flipped = false;
    }
    renderStudy();
    return;
  }
  if (view === "done") {
    renderDone();
  }
}

window.addEventListener("hashchange", route);
window.addEventListener("beforeunload", () => {
  if (state.view === "study") persistStudy();
});
window.addEventListener("pagehide", () => {
  if (state.view === "study") persistStudy();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && state.view === "study") persistStudy();
});

try {
  const res = await fetch("vocab.json");
  if (!res.ok) throw new Error(`Could not load vocab.json (${res.status})`);
  state.units = await res.json();
  route();
} catch (err) {
  app.innerHTML = `<p class="err">${escapeHtml(err.message)}</p>`;
}
