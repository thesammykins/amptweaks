// The list: sections, keyed items, FLIP moves, fail-open rendering, the header and root container.
import { ampClasses } from "../amp/dom.js";
import { EASE, MODES, TAG, reduceMotion } from "../config.js";
import { wireRoot } from "../input.js";
import { group } from "../model.js";
import { esc, setText } from "./dom-util.js";
import { createItem } from "./rows.js";
import { applyItem } from "./tree.js";
import { S } from "../state.js";
import { applyMode, filtersAreDefault, prefs } from "../store.js";

// ---------- rendering: persistent keyed rows; FLIP only when the order changes ----------
S.model = [];

S.pending = false;

S.lastMouseMove = 0;

S.holdTimer = 0;

// Rows a person can actually see (collapsed families are visibility:hidden, not just 0-height).
export const isShown = r => (r.checkVisibility ? r.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true }) : r.offsetParent !== null);

// One Tab stop for the list (roving tabindex); arrows move between rows. Tray buttons are reached by E / ⇧F10.
export function syncTabStops(list) {
  const rowsAll = [...list.querySelectorAll("[data-thread-id] > [data-amp-focus-row]")];
  const current = rowsAll.find(r => r === document.activeElement) ?? rowsAll.find(r => r.hasAttribute("data-active") && isShown(r)) ?? rowsAll.find(isShown);
  for (const r of rowsAll) { const t = r === current ? "0" : "-1"; if (r.getAttribute("tabindex") !== t) r.setAttribute("tabindex", t); }
}

S.failed = 0;

 // timestamp of the last render failure
S.recoveries = 0;

export const swipe = { active: false, item: null, x: 0, raw: 0, w: 0, timer: 0 };

export function activeIdSet() {
  const s = new Set(location.pathname.match(/T-[0-9a-f-]{36}/g) ?? []);
  document.querySelectorAll('a[data-sidebar-thread-id][data-active="true"]').forEach(a => s.add(a.dataset.sidebarThreadId));
  return s;
}

// Cheap: toggles one attribute per row. Runs on navigation instead of a re-render.
export function syncActive() {
  const ids = activeIdSet();
  document.querySelectorAll("[data-amp-focus-root] [data-thread-id] > [data-amp-focus-row]").forEach(row => {
    row.toggleAttribute("data-active", ids.has(row.parentElement.dataset.threadId));
  });
}

export function render(force = false) {
  if (S.failed) return;
  try {
    renderUnsafe(force);
  } catch (e) {
    // Fail open: never leave a blank sidebar. Amp's own list comes back, the error is reported, and we retry.
    S.failed = Date.now();
    console.error(TAG, "render failed; showing Amp's list", e);
    document.documentElement.dataset.ampFocus = "off";
    fetch("/__amp-tweaks/report?name=focus-error", { method: "POST", body: JSON.stringify({ message: String(e), stack: e?.stack, url: location.href }) });
    // Retry a few times on our own; after that, wait for the Focus toggle.
    if (S.recoveries < 3) setTimeout(() => { if (S.failed) { S.recoveries++; recover(); } }, 10_000);
  }
}

export function recover() {
  S.failed = 0;
  const list = document.querySelector("[data-amp-focus-list]");
  if (list) { list.replaceChildren(); list._layout = ""; }
  applyMode();
  render(true);
}

// Self-timing (cheap): read via the "focus-perf" report to see what the sidebar costs during real use.
export const perf = { renders: 0, renderMs: 0, renderMax: 0, moves: 0, live: 0, fetches: 0, since: Date.now() };

export function renderUnsafe(force) {
  const t0 = performance.now();
  try { return renderBody(force); } finally {
    const ms = performance.now() - t0;
    perf.renders++; perf.renderMs += ms; perf.renderMax = Math.max(perf.renderMax, ms);
  }
}

export function renderBody(force) {
  const root = ensureRoot();
  if (!root) return;
  const list = root.querySelector("[data-amp-focus-list]");
  syncHeader(root);
  root.querySelector("[data-toggle]").textContent = prefs.focus ? "All threads" : "Focus";
  if (!prefs.focus) return;
  if (!force && swipe.active) { S.pending = true; return; }

  const cls = ampClasses();
  const groups = group(S.model, prefs.mode);
  const layout = groups.map(g => `${g.key}:${g.items.map(i => i.id).join(",")}`).join("|");
  // Layout memory lives on the list element: if Amp re-renders and our container is recreated, it starts empty.
  let moved = layout !== list._layout;
  // Don't reorder rows under a moving mouse: patch in place now, reorder ~1.5s after the mouse settles.
  // (Touch never holds: :hover sticks after a tap.)
  const hold = moved && !force && list._layout && performance.now() - S.lastMouseMove < 1500;
  if (hold) {
    S.pending = true;
    moved = false;
    clearTimeout(S.holdTimer);
    S.holdTimer = setTimeout(() => { if (S.pending) render(); }, 1600);
  } else { S.pending = false; list._layout = layout; }
  const focused = list.contains(document.activeElement) ? document.activeElement : null;
  const animate = !reduceMotion.matches && list.childElementCount > 0;
  if (moved) perf.moves++;

  const before = new Map();
  if (moved && animate) list.querySelectorAll("[data-amp-focus-item][data-thread-id], [data-amp-focus-heading]").forEach(el => before.set(el, el.getBoundingClientRect().top));

  const seenSections = new Set();
  const seenItems = new Set();
  const entering = [];
  let anchor = null;
  for (const g of groups) {
    let section = list.querySelector(`:scope > [data-amp-focus-group][data-key="${CSS.escape(g.key)}"]:not([data-leaving])`);
    if (!section) {
      if (!moved) continue;
      section = document.createElement("section");
      section.setAttribute("data-amp-focus-group", "");
      section.dataset.key = g.key;
      section.innerHTML = `<div data-amp-focus-heading><span data-heading-title></span><span data-count></span></div>`;
      entering.push(section.firstElementChild); // only the heading fades in; moved rows glide via FLIP
    }
    setText(section.querySelector("[data-heading-title]"), g.title);
    setText(section.querySelector("[data-count]"), String(g.items.length));
    if (moved) list.insertBefore(section, anchor ? anchor.nextSibling : list.firstChild);
    anchor = section;
    seenSections.add(section);

    let prev = section.firstElementChild;
    for (const it of g.items) {
      let el = list.querySelector(`[data-amp-focus-item][data-thread-id="${CSS.escape(it.id)}"]`);
      const isNew = !el;
      if (!el) {
        if (!moved) continue;
        el = createItem(it.id);
        entering.push(el);
      }
      applyItem(el, it, cls, animate, isNew);
      if (moved && el.previousElementSibling !== prev) section.insertBefore(el, prev.nextSibling);
      prev = el;
      seenItems.add(el);
    }
  }

  if (moved) {
    // Sections that leave take their rows with them; rows leaving a surviving section drift out individually.
    list.querySelectorAll(":scope > [data-amp-focus-group]:not([data-leaving])").forEach(s => { if (!seenSections.has(s)) leave(s, animate); });
    list.querySelectorAll("[data-amp-focus-item][data-thread-id]").forEach(el => {
      if (!seenItems.has(el) && !el.closest("[data-leaving]")) leave(el, animate);
    });
  }
  const empty = root.querySelector("[data-amp-focus-empty]");
  setText(empty, S.searching ? "No matching threads" : "Nothing needs you");
  empty.hidden = groups.length > 0 || (S.loading && !S.searching);
  syncActive();
  if (focused && focused.isConnected && document.activeElement !== focused) focused.focus({ preventScroll: true });
  syncTabStops(list);

  if (!moved || !animate) return;
  for (const [el, top] of before) {
    if (!el.isConnected || el.closest("[data-leaving]")) continue;
    const dy = top - el.getBoundingClientRect().top;
    if (Math.abs(dy) > 0.5) el.animate([{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }], { duration: 320, easing: EASE });
  }
  for (const el of entering) el.animate([{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: 240, easing: EASE });
}

// A thread that stops needing you (read, answered, finished) drifts off to the right, then the gap closes.
export async function leave(el, animate) {
  if (el.hasAttribute("data-leaving")) return;
  el.setAttribute("data-leaving", "");
  el.removeAttribute("data-thread-id");
  if (!animate) return el.remove();
  await el.animate([{ opacity: 1, transform: "translateX(0)" }, { opacity: 0, transform: "translateX(0.75rem)" }],
    { duration: 200, easing: EASE, fill: "forwards" }).finished.catch(() => {});
  await collapse(el, 220);
}

export async function collapse(el, duration) {
  if (!el.isConnected) return;
  const h = el.getBoundingClientRect().height;
  el.style.overflow = "hidden";
  await el.animate([{ height: `${h}px` }, { height: "0px" }], { duration, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "forwards" })
    .finished.catch(() => {});
  el.remove();
}

export function syncHeader(root) {
  const header = root.querySelector("[data-amp-focus-modes]");
  const cls = ampClasses();
  const filterBtn = root.querySelector("[data-filter-btn]");
  const ampFilter = document.querySelector("[data-sidebar-filter-menu]");
  if (ampFilter && filterBtn.dataset.cls !== ampFilter.className) {
    filterBtn.dataset.cls = ampFilter.className;
    filterBtn.className = ampFilter.className;
    filterBtn.innerHTML = ampFilter.querySelector("svg")?.outerHTML ?? "";
  }
  filterBtn.toggleAttribute("data-filtered", !filtersAreDefault());
  root.toggleAttribute("data-hide-time", !prefs.display.time);
  root.toggleAttribute("data-hide-badge", !prefs.display.badge);
  root.dataset.density = prefs.display.density;
  root.dataset.fit = prefs.display.fit;
  root.querySelector("[data-amp-focus-header]").hidden = !prefs.focus;
  if (header.dataset.cls !== cls.chip) {
    header.dataset.cls = cls.chip;
    header.className = cls.tabs;
    header.innerHTML = Object.entries(MODES).map(([m, labelText]) =>
      `<button type="button" role="tab" data-mode="${m}" class="${esc(cls.chip)}"><span class="${esc(cls.chipFill)}" data-chip-fill></span><span class="relative" data-chip-label>${labelText}</span></button>`).join("");
  }
  header.hidden = !prefs.focus;
  header.querySelectorAll("[data-mode]").forEach(b => {
    const on = b.dataset.mode === prefs.mode;
    if (b.dataset.active !== String(on)) b.dataset.active = String(on);
    b.setAttribute("aria-selected", String(on));
  });
}

export function ensureRoot() {
  const ampList = document.querySelector('[data-slot="sidebar"] [data-testid="sidebar-thread-list"]');
  const group = ampList?.closest('[data-sidebar="group"]');
  if (!group) return null;
  let root = group.parentElement.querySelector(":scope > [data-amp-focus-root]");
  if (!root) {
    root = document.createElement("div");
    root.setAttribute("data-amp-focus-root", "");
    root.innerHTML = `<div data-amp-focus-header><div data-amp-focus-modes role="tablist" aria-label="Group threads by"></div><button type="button" data-filter-btn aria-label="Filter threads" aria-haspopup="menu" aria-expanded="false"></button></div>
      <div data-amp-focus-menu role="menu" aria-label="Filter threads" hidden></div>
      <div data-amp-focus-list></div>
      <div data-amp-focus-empty hidden>Nothing needs you</div>
      <div data-amp-focus-toast role="status" hidden></div>
      <div data-amp-focus-footer><button type="button" data-toggle></button></div>`;
    wireRoot(root);
    group.after(root);
  }
  return root;
}
