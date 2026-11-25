// The filter menu (per-view filters and row details), styled with Amp's own menu classes once seen.
import { doneEntries } from "./actions.js";
import { CHECK, DETAILS, KIND_LABEL, MENU_KEY, MODES } from "./config.js";
import { recompute } from "./live.js";
import { esc } from "./render/dom-util.js";
import { S } from "./state.js";
import { F, filtersAreDefault, freshFilters, prefs, store } from "./store.js";

S.menuCls = store.get(MENU_KEY, null);

export function learnMenuClasses(node) {
  const menu = node.matches?.('[role="menu"]') ? node : node.querySelector?.('[role="menu"]');
  if (!menu || menu.closest("[data-amp-focus-root]")) return;
  const item = menu.querySelector('[role="menuitem"]');
  const sep = menu.querySelector('[role="separator"]');
  if (!item) return;
  S.menuCls = { menu: menu.className, item: item.className, sep: sep?.className ?? "" };
  store.set(MENU_KEY, S.menuCls);
}

export function menuHTML() {
  const f = F();
  const check = (key, on, text, extra = "") =>
    `<button type="button" role="menuitemcheckbox" aria-checked="${on}" data-f="${esc(key)}" class="${esc(S.menuCls?.item ?? "")}"><span data-check>${on ? CHECK : ""}</span><span data-label>${esc(text)}</span>${extra}</button>`;
  const seg = (pairs, current, prefix) => `<div data-seg role="radiogroup">${pairs.map(([v, t]) =>
    `<button type="button" role="menuitemradio" aria-checked="${current === v}" data-f="${prefix}${v}">${esc(t)}</button>`).join("")}</div>`;
  const action = (key, text, hint = "") => `<button type="button" role="menuitem" data-f="${key}" class="${esc(S.menuCls?.item ?? "")}"><span data-label>${esc(text)}</span>${hint ? `<span data-hint>${hint}</span>` : ""}</button>`;
  const section = (title, body, cls = "") => `<section data-menu-section${cls ? ` data-${cls}` : ""}><div data-menu-heading>${esc(title)}</div>${body}</section>`;
  const doneCount = doneEntries().length;

  const show = section("Show", `<div data-grid>${Object.keys(KIND_LABEL).map(k => check(`kind:${k}`, f.kinds[k], KIND_LABEL[k])).join("")}</div>`);
  const updated = section("Updated", seg([[1, "24h"], [7, "7d"], [14, "14d"], [0, "Any"]], f.age, "age:"));
  const projects = S.allRepos.length ? section("Projects", `<div data-grid data-scroll>${S.allRepos.map(r => check(`repo:${r}`, !f.hidden.includes(r), r)).join("")}</div>`) : "";
  const threads = section("Threads", `<div data-grid>${check("nest", f.nest, "Nest sub-threads")}${check("scope", f.scope === "all", "Shared threads")}</div>`);
  const lead = { status: [show, updated, projects], project: [projects, show, updated], day: [updated, show, projects] }[prefs.mode].filter(Boolean);
  const details = section("Row details", `<div data-grid>${Object.entries(DETAILS).map(([k, t]) => check(`show:${k}`, prefs.display[k], t)).join("")}</div>`
    + `<div data-seg-row><span>Density</span>${seg([["comfortable", "Comfortable"], ["compact", "Compact"]], prefs.display.density, "density:")}</div>`
    + `<div data-seg-row><span>When narrow</span>${seg([["fade", "Fade details"], ["all", "Wrap"]], prefs.display.fit, "fit:")}</div>`);
  const footer = `<div data-menu-footer>${action("archive-done", "Archive all done", doneCount ? String(doneCount) : "")}</div>`;
  return `<div data-menu-top><span data-menu-title>${esc(MODES[prefs.mode])} view</span>${filtersAreDefault() ? "" : `<button type="button" data-f="reset" data-menu-reset>Reset</button>`}</div>`
    + `<div data-menu-body>${[...lead, threads].join("")}${details}</div>` + footer;
}

export function applyFilter(key) {
  const f = F();
  if (key.startsWith("show:")) { const k = key.slice(5); prefs.display[k] = !prefs.display[k]; }
  else if (key.startsWith("fit:")) prefs.display.fit = key.slice(4);
  else if (key.startsWith("density:")) prefs.display.density = key.slice(8);
  else if (key.startsWith("kind:")) { const k = key.slice(5); f.kinds[k] = !f.kinds[k]; }
  else if (key === "scope") f.scope = f.scope === "all" ? "mine" : "all";
  else if (key === "nest") f.nest = !f.nest;
  else if (key.startsWith("age:")) f.age = Number(key.slice(4));
  else if (key.startsWith("repo:")) { const r = key.slice(5); f.hidden = f.hidden.includes(r) ? f.hidden.filter(x => x !== r) : [...f.hidden, r]; }
  else if (key === "reset") prefs.filtersByView[prefs.mode] = freshFilters(prefs.mode);
  store.set("focus.filtersByView", prefs.filtersByView);
  store.set("focus.display", prefs.display);
  recompute(true);
}

export function openMenu(root, open) {
  const menu = root.querySelector("[data-amp-focus-menu]");
  const btn = root.querySelector("[data-filter-btn]");
  if (open) {
    menu.className = S.menuCls?.menu ?? "";
    menu.innerHTML = menuHTML();
    menu.hidden = false;
    requestAnimationFrame(() => menu.setAttribute("data-show", ""));
  } else {
    menu.removeAttribute("data-show");
    setTimeout(() => { if (!menu.hasAttribute("data-show")) menu.hidden = true; }, 160);
  }
  btn.setAttribute("aria-expanded", String(open));
  btn.dataset.active = String(open);
}
