// Amp adapter (read side): everything that reads Amp's sidebar DOM. When Amp changes its markup, fix it here.
// The parts of Amp's sidebar this tweak depends on. The sidebar report lists any that are missing, so
// `amp-tweaks status` can say when an Amp update moved them.
export const AMP_HOOKS = {
  list: '[data-slot="sidebar"] [data-testid="sidebar-thread-list"]',
  rows: "a[data-sidebar-thread-id]",
  titles: "a[data-sidebar-thread-id] [data-title-text]",
  icons: "a[data-sidebar-thread-id] [data-thread-row-icon]",
  chips: "[data-sidebar-activity-filter-running]",
  filter: "[data-sidebar-filter-menu]",
  search: '[data-testid="sidebar-list-search"]',
};
export const missingHooks = () => Object.entries(AMP_HOOKS).filter(([, sel]) => !document.querySelector(sel)).map(([name]) => name);

// ---------- Amp DOM: rows, families, live signals, icons ----------
import { S } from "../state.js";

export const ampRow = id => document.querySelector(`a[data-sidebar-thread-id="${CSS.escape(id)}"]`);

export const parentOf = a => a.parentElement?.closest("[data-sidebar-subthreads-of]")?.dataset.sidebarSubthreadsOf ?? null;

// Amp's own thread icon, captured once per thread. Running threads show a WebGL canvas, so keep the static one.
export const iconMemo = new Map();

export function captureIcon(id, a) {
  if (iconMemo.has(id)) return;
  const src = a.querySelector("[data-thread-row-icon]");
  if (!src || src.querySelector("canvas")) return;
  const clone = src.cloneNode(true);
  clone.querySelectorAll("[data-thread-row-unread-badge], [data-thread-row-origin-badge]").forEach(n => n.remove());
  clone.querySelectorAll("[data-tooltip-trigger]").forEach(n => n.removeAttribute("data-tooltip-trigger"));
  iconMemo.set(id, clone.innerHTML);
}

export function readRow(a) {
  const id = a.dataset.sidebarThreadId;
  const badge = a.querySelector("[data-thread-row-unread-badge]");
  const unread = !!badge && !badge.classList.contains("opacity-0");
  const running = !!a.querySelector("[data-thread-row-running-icon]");
  const error = !!a.querySelector("[data-thread-row-error]");
  const status = a.querySelector("[data-thread-row-status-line]")?.textContent.trim() ?? "";
  // Blocked on something outside the agent: its runner dropped off, or your messages haven't reached it.
  const offline = !!a.querySelector("[data-thread-row-waiting-for-runner]");
  const unsent = !!a.querySelector("[data-thread-row-unsent]");
  captureIcon(id, a);
  return {
    href: a.getAttribute("href"),
    title: a.querySelector("[data-title-text]")?.textContent.trim() ?? "",
    unread, running, error, status, offline, unsent,
    space: !!a.querySelector("[data-thread-row-space-icon]"),
    spaceColor: a.querySelector("[data-space-color]")?.dataset.spaceColor ?? null,
    // Spawned by another thread (orchestrated sub-thread): its finished result is reviewed via the parent.
    spawned: a.querySelector("[data-thread-row-origin-badge]")?.dataset.threadRowOriginBadge === "thread",
    domParent: parentOf(a),
    parent: null,
    root: null,
    pinned: a.hasAttribute("data-thread-row-pinned"),
    flags: `${unread}|${running}|${error}`, // state changes → refetch detail
    sig: `${unread}|${running}|${error}|${offline}|${unsent}|${status}|${a.hasAttribute("data-thread-row-pinned")}`, // any visible change → re-render
  };
}

export function readAmp() {
  const rows = new Map();
  for (const a of document.querySelectorAll("a[data-sidebar-thread-id]")) {
    rows.set(a.dataset.sidebarThreadId, readRow(a));
  }
  return linkFamilies(rows);
}

// Parent = the nearest ancestor Amp lists (from Amp's lineage, which keeps nesting the DOM flattens), else the DOM's.
// Root = the top of that chain. Run again whenever the rows or the lineage change.
export function linkFamilies(rows) {
  for (const [id, r] of rows) {
    const chain = S.lineage?.get(id);
    const p = chain?.find(x => x !== id && rows.has(x));
    r.parent = p ?? r.domParent ?? null;
    if (r.parent === id) r.parent = null;
  }
  for (const [id, r] of rows) {
    let root = r.parent;
    const seen = new Set([id]);
    while (root && rows.get(root)?.parent && !seen.has(root)) { seen.add(root); root = rows.get(root).parent; }
    r.root = root && root !== id ? root : null;
  }
  return rows;
}

// Amp component classes, read from Amp's live (hidden) elements so styling, tokens and text scaling track Amp.
export function ampClasses() {
  const chip = document.querySelector("[data-sidebar-activity-filter-running]");
  const toggle = document.querySelector("[data-sidebar-subthreads-toggle]");
  return {
    chip: chip?.className ?? "",
    chipFill: chip?.querySelector("[data-chip-fill]")?.className ?? "",
    tabs: chip?.closest(".thread-scrollable-tabs-scroll")?.className ?? "",
    toggle: toggle?.className ?? "",
  };
}

export const ampSearch = () => {
  const box = document.querySelector('[data-testid="sidebar-list-search"]');
  const q = box?.querySelector('[data-testid="sidebar-list-search-input"]')?.value.trim();
  return box?.dataset.open === "true" && !!q;
};
