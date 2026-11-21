// Amp adapter (read side): everything that reads Amp's sidebar DOM. When Amp changes its markup, fix it here.
// ---------- Amp DOM: rows, families, live signals, icons ----------
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
  captureIcon(id, a);
  return {
    href: a.getAttribute("href"),
    title: a.querySelector("[data-title-text]")?.textContent.trim() ?? "",
    unread, running, error, status,
    space: !!a.querySelector("[data-thread-row-space-icon]"),
    spaceColor: a.querySelector("[data-space-color]")?.dataset.spaceColor ?? null,
    // Spawned by another thread (orchestrated sub-thread): its finished result is reviewed via the parent.
    spawned: a.querySelector("[data-thread-row-origin-badge]")?.dataset.threadRowOriginBadge === "thread",
    parent: parentOf(a),
    pinned: a.hasAttribute("data-thread-row-pinned"),
    flags: `${unread}|${running}|${error}`, // state changes → refetch detail
    sig: `${unread}|${running}|${error}|${status}|${a.hasAttribute("data-thread-row-pinned")}`, // any visible change → re-render
  };
}

export function readAmp() {
  const rows = new Map();
  for (const a of document.querySelectorAll("a[data-sidebar-thread-id]")) {
    rows.set(a.dataset.sidebarThreadId, readRow(a));
  }
  for (const [id, r] of rows) {
    let root = r.parent;
    for (let hops = 0; root && rows.get(root)?.parent && hops < 6; hops++) root = rows.get(root).parent;
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
