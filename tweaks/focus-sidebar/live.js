// The loop: watch Amp's sidebar for changes, refresh on a timer, recompute the model, render; start().
import { archive, archiveAllDone, archiveAndAdvance, archiveItems, dismissed, findItem, undoLast, undoStack } from "./actions.js";
import { navigate, openAmpMenu } from "./amp/actions.js";
import { ampSearch, missingHooks, readAmp, readRow } from "./amp/dom.js";
import { RECENT_MS } from "./config.js";
import { computeMe, due, fetchMany, fetchOne, loadCli } from "./data.js";
import { onRowKey } from "./input.js";
import { learnMenuClasses, openMenu } from "./menu.js";
import { ago, buildItems, searchItems } from "./model.js";
import { setText } from "./render/dom-util.js";
import { perf, render, syncActive } from "./render/list.js";
import { S } from "./state.js";
import { applyMode, cache, prefs, saveCache, store } from "./store.js";

// ---------- loop ----------
S.rows = new Map();

export const cliRecent = () => S.cli.filter(t => Date.now() - Date.parse(t.updated) < RECENT_MS).map(t => t.id);

export const currentIds = () => [...new Set([...S.rows.keys(), ...cliRecent()])].filter(id => !dismissed.has(id));

export function sweepDismissed() {
  const cliIds = new Set(S.cli.map(t => t.id));
  for (const [id, at] of dismissed) {
    const goneEverywhere = !S.rows.has(id) && !cliIds.has(id);
    if (goneEverywhere && Date.now() - at > 10_000) dismissed.delete(id);
  }
}

// Skip renders when nothing visible changed (the 5s refresh usually finds nothing new).
S.lastModelSig = "";

export const modelSig = () => JSON.stringify([prefs.mode, prefs.focus, S.model.map(i => [i.id, i.kind, i.lead, i.context, i.since, i.d.title, i.held, i.finished, i.total, (i.children ?? []).map(c => [c.id, c.kind, c.context, c.since])])]);

S.searching = false;

export function recompute(force = false) {
  const was = S.searching;
  S.searching = ampSearch();
  if (was !== S.searching) { force = true; document.querySelector("[data-amp-focus-root]")?.toggleAttribute("data-searching", S.searching); }
  S.model = S.searching ? searchItems() : buildItems(S.rows, currentIds());
  const sig = modelSig();
  if (!force && !S.pending && sig === S.lastModelSig && document.querySelector("[data-amp-focus-root]")?.isConnected) return;
  S.lastModelSig = sig;
  render(force);
}

// Relative times ("3m", "2h") tick in place once a minute, without a render.
setInterval(() => {
  if (document.hidden) return;
  const byId = new Map(S.model.flatMap(i => [i, ...(i.children ?? [])]).map(i => [i.id, i]));
  document.querySelectorAll("[data-amp-focus-root] [data-thread-id] > [data-amp-focus-row] [data-time]").forEach(t => {
    const it = byId.get(t.closest("[data-thread-id]").dataset.threadId);
    if (it) setText(t, ago(it.since));
  });
}, 60_000);

S.busy = false;

S.lastFullRead = 0;

export async function refresh(forceRender = false) {
  if (S.busy || document.hidden) return;
  S.busy = true;
  try {
    // The live observer keeps `rows` current; a full re-read is a once-a-minute safety net.
    if (!S.rows.size || Date.now() - S.lastFullRead > 60_000) { S.rows = readAmp(); S.lastFullRead = Date.now(); }
    sweepDismissed();
    const updatedById = new Map(S.cli.map(t => [t.id, t.updated]));
    if (!S.me) {
      const seed = cliRecent().slice(0, 5).filter(id => !cache.get(id)?.d);
      if (seed.length) await fetchMany(seed);
    }
    const m = computeMe();
    if (m && m !== S.me) { S.me = m; store.set("focus.me", S.me); }
    await fetchMany(currentIds().filter(id => due(id, updatedById.get(id))));
    // Rebuild from the ids as they are *now* (an archive may have happened during the fetch).
    recompute(forceRender);
  } finally {
    S.busy = false;
  }
}

// Live: render from Amp's row signals immediately, then refine once the changed threads are refetched.
S.lastSigs = new Map();

S.liveTimer = 0;

S.liveFirst = 0;

export const ours = m => (m.target.nodeType === 1 ? m.target : m.target.parentElement)?.closest?.("[data-amp-focus-root]");

S.touched = new Set();

S.structuralChange = false;

export function onSidebarMutation(muts) {
  if (!document.querySelector("[data-amp-focus-root]")?.isConnected) { S.rows = readAmp(); render(true); }
  if (muts.every(ours)) return;
  for (const m of muts) {
    if (ours(m)) continue;
    const el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
    if (m.attributeName === "data-open") { S.structuralChange = true; S.searchFlip = true; continue; }
    const a = el?.closest?.("a[data-sidebar-thread-id]");
    if (a) S.touched.add(a);
    else if (m.type === "childList") S.structuralChange = true;
  }
  const now = performance.now();
  if (!S.liveFirst) S.liveFirst = now;
  clearTimeout(S.liveTimer);
  // 150ms trailing debounce, but never more than 500ms behind a burst (streaming status lines).
  S.liveTimer = setTimeout(liveTick, Math.max(0, Math.min(150, 500 - (now - S.liveFirst))));
}

S.searchFlip = false;

// Typing in Amp's search box: Amp swaps its rows, the observer picks that up; this covers a query that leaves the same rows.
document.addEventListener("input", e => { if (e.target.matches?.('[data-testid="sidebar-list-search-input"]')) { clearTimeout(S.liveTimer); S.liveTimer = setTimeout(liveTick, 120); } }, true);

export async function liveTick() {
  S.liveFirst = 0;
  perf.live++;
  // Re-read only the Amp rows the mutations touched, unless the list's structure changed.
  const full = S.structuralChange || S.touched.size > 40;
  const touchedNow = S.touched;
  S.touched = new Set();
  S.structuralChange = false;
  let now;
  if (full) now = readAmp();
  else {
    now = new Map(S.rows);
    for (const a of touchedNow) if (a.isConnected) { const r = readRow(a); r.root = S.rows.get(a.dataset.sidebarThreadId)?.root ?? null; now.set(a.dataset.sidebarThreadId, r); }
  }
  const changed = [];
  const flipped = [];
  for (const [id, r] of now) {
    const prev = S.lastSigs.get(id);
    if (prev?.sig !== r.sig) changed.push(id);
    if (prev && prev.flags !== r.flags) flipped.push(id);
  }
  const structural = now.size !== S.lastSigs.size;
  S.lastSigs = new Map([...now].map(([id, r]) => [id, { sig: r.sig, flags: r.flags }]));
  S.rows = now;
  syncActive();
  const holding = S.model.some(i => i.held || (i.children ?? []).some(c => c.held));
  const flip = S.searchFlip;
  S.searchFlip = false;
  if (!changed.length && !structural && !holding && !flip && !S.searching) return;
  recompute(flip || S.searching);
  // Detail only when state flags flip (not for every streamed status line); the 15s poll covers the rest.
  const toFetch = flipped.slice(0, 20);
  if (!toFetch.length) return;
  await Promise.all(toFetch.map(id => fetchOne(id)));
  saveCache();
  recompute();
}

export function start() {
  applyMode();
  S.rows = readAmp();
  S.lastSigs = new Map([...S.rows].map(([id, r]) => [id, { sig: r.sig, flags: r.flags }]));
  // Observe the whole sidebar so a recreated Amp list (or our recreated container) is noticed.
  const sidebar = document.querySelector('[data-slot="sidebar"]');
  new MutationObserver(onSidebarMutation).observe(sidebar, { subtree: true, childList: true, attributes: true, characterData: true, attributeFilter: ["class", "data-active", "data-thread-row-pinned", "data-open"] });

  // Navigation: SvelteKit uses pushState/replaceState. Move the highlight, and release any held (opened) row.
  let lastPath = location.pathname;
  const onNavigate = () => {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    requestAnimationFrame(() => { syncActive(); recompute(); });
  };
  for (const fn of ["pushState", "replaceState"]) {
    const orig = history[fn];
    history[fn] = function (...args) { const r = orig.apply(this, args); onNavigate(); return r; };
  }
  addEventListener("popstate", onNavigate);
  // Learn Amp's menu classes from its portals (body's direct children only — cheap).
  new MutationObserver(muts => { for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) learnMenuClasses(n); })
    .observe(document.body, { childList: true, subtree: false });

  // Document-level listeners: bound once.
  document.addEventListener("pointerdown", e => {
    const menu = document.querySelector("[data-amp-focus-menu]");
    if (menu && !menu.hidden && !e.target.closest("[data-amp-focus-menu], [data-filter-btn]")) openMenu(menu.closest("[data-amp-focus-root]"), false);
  }, true);
  document.addEventListener("keydown", onRowKey, true);
  document.addEventListener("keydown", e => {
    const menu = document.querySelector("[data-amp-focus-menu]");
    if (e.key === "Escape" && menu && !menu.hidden) { e.stopPropagation(); openMenu(menu.closest("[data-amp-focus-root]"), false); return; }
    if (!prefs.focus) return;
    if (e.ctrlKey && e.metaKey && !e.altKey && e.key.toLowerCase() === "a") {
      if (archiveAndAdvance()) e.preventDefault();
      return;
    }
    // ⌘Z undoes our last archive/snooze only when you're not typing somewhere.
    const typing = e.target.closest?.("input, textarea, [contenteditable=''], [contenteditable='true']");
    if (e.metaKey && !e.shiftKey && e.key.toLowerCase() === "z" && !typing && undoStack.length) {
      if (undoLast()) e.preventDefault();
    }
  }, true);

  const archiveById = id => {
    const el = findItem(id);
    const btn = el?.querySelector('[data-act="archive"]');
    if (!el || !btn) return false;
    const r = btn.getBoundingClientRect();
    archiveItems([{ el, id, point: { x: r.left + r.width / 2, y: r.top + r.height / 2 } }]);
    return true;
  };
  setInterval(() => {
    if (document.hidden || !store.get("focus.perfReport", false)) return;
    const secs = (Date.now() - perf.since) / 1000;
    fetch("/__amp-tweaks/report?name=focus-perf", { method: "POST", body: JSON.stringify({ secs: Math.round(secs), ...perf, renderAvgMs: +(perf.renderMs / Math.max(1, perf.renders)).toFixed(2), renderMax: +perf.renderMax.toFixed(1), renderMs: Math.round(perf.renderMs) }) });
  }, 30_000);
  window.__ampFocus = { perf, archive, archiveById, archiveAllDone, archiveAndAdvance, undoLast, refresh, openAmpMenu, navigate, get model() { return S.model; }, setMode(m) { prefs.mode = m; recompute(true); } };

  (async () => {
    await loadCli();
    await refresh(true);
    setInterval(loadCli, 30_000);
    setInterval(refresh, 5_000);
    setTimeout(() => {
      const r = sel => { const e = document.querySelector(sel); return e ? Math.round(e.getBoundingClientRect().left) : null; };
      const report = {
        url: location.href, missing: missingHooks(), me: !!S.me, cached: cache.size, mode: prefs.mode, loading: S.loading,
        top: S.model.length,
        counts: S.model.reduce((m, i) => ((m[i.kind] = (m[i.kind] ?? 0) + 1), m), {}),
        families: S.model.filter(i => i.children.length).map(i => ({ title: i.d.title?.slice(0, 40), space: !!i.space, lead: i.lead, children: i.children.map(c => c.kind), finished: i.finished })),
        rendered: { items: document.querySelectorAll("[data-amp-focus-item][data-thread-id]").length, children: document.querySelectorAll("[data-amp-focus-child][data-thread-id]").length, sections: document.querySelectorAll("[data-amp-focus-group]:not([data-leaving])").length },
        align: { heading: r("[data-heading-title]"), icon: r("[data-amp-focus-row] [data-icon]"), title: r("[data-amp-focus-row] [data-title]"), footer: r("[data-amp-focus-footer] button") },
      };
      fetch("/__amp-tweaks/report?name=focus-sidebar", { method: "POST", body: JSON.stringify(report, null, 1) });
    }, 4000);
  })();
}
