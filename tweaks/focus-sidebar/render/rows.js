// One row: icon, title, context and meta lines, hover actions. Persistent parts patched in place.
import { iconMemo } from "../amp/dom.js";
import { GLYPH, ICON, NEEDS } from "../config.js";
import { ago, modelLabel } from "../model.js";
import { esc, setHTML, setText } from "./dom-util.js";
import { S } from "../state.js";
import { prefs } from "../store.js";

export function parts(row) {
  if (row._p) return row._p;
  row.innerHTML = `<span data-icon><span data-icon-art></span><span data-badge></span></span><span data-title></span><span data-trail><span data-time></span><span data-row-actions></span></span><span data-context hidden></span><span data-meta hidden></span>`;
  const q = s => row.querySelector(s);
  row._p = { icon: q("[data-icon]"), art: q("[data-icon-art]"), title: q("[data-title]"), trail: q("[data-trail]"), time: q("[data-time]"), actions: q("[data-row-actions]"), context: q("[data-context]"), meta: q("[data-meta]"), toggle: null };
  return row._p;
}

export function metaHTML(it, opts, family) {
  const { d } = it;
  const show = prefs.display;
  // Branch/worktree/runner only draw attention when they differ from the usual (default branch, Orb).
  const featureBranch = d.branch && !/^(main|master|trunk|develop)$/.test(d.branch);
  const branch = d.branch ? (featureBranch ? `<span data-branch>${ICON.branch}${esc(d.branch)}</span>` : opts.child ? "" : esc(d.branch)) : "";
  const list = [
    ["tree", !show.tree || opts.mode === "project" || opts.child ? "" : esc(d.repo ?? "")],
    ["space", it.space && it.total ? `${it.total} thread${it.total === 1 ? "" : "s"}` : ""],
    ["tree", show.tree ? branch : ""],
    ["tree", show.tree && d.worktree ? `<span data-branch>${ICON.worktree}worktree</span>` : ""],
    ["runner", show.tree && d.runner ? `<span data-branch>${ICON.runner}${esc(d.runner)}</span>` : ""],
  ].filter(([, h]) => h);
  // Model always last: it's the first thing to go when the sidebar narrows.
  if (family && it.kind !== "parent") list.push(["family", esc(family)]);
  if (!it.space && show.model && modelLabel(d)) list.push(["model", esc(modelLabel(d))]);
  return list.map(([k, h]) => `<span data-mi="${k}">${h}</span>`).join("");
}

export function applyRow(row, it, opts) {
  const p = parts(row);
  if (row.dataset.kind !== it.kind) row.dataset.kind = it.kind;
  row.toggleAttribute("data-space", !!it.space);
  row.toggleAttribute("data-held", !!it.held);
  row.dataset.href = it.href;
  if (it.spaceColor) row.style.setProperty("--space-color", it.spaceColor);
  else row.style.removeProperty("--space-color");

  const icon = iconMemo.get(it.id);
  p.icon.toggleAttribute("data-fallback", !icon);
  setHTML(p.art, icon ?? GLYPH);
  setText(p.title, it.d.title || "Untitled");

  const show = prefs.display;
  const kids = it.children ?? [];
  const running = kids.filter(c => c.kind === "working").length;
  const needing = kids.filter(c => NEEDS.has(c.kind)).length;
  const family = kids.length && show.family ? [needing && `${needing} need${needing === 1 ? "s" : ""} you`, running && `${running} running`].filter(Boolean).join(" · ") : "";

  // Family toggle: one persistent button; attributes patched, aria-expanded owned by the expand state.
  if ((kids.length || it.finished) && !opts.child) {
    if (!p.toggle) {
      p.toggle = document.createElement("button");
      p.toggle.type = "button";
      p.toggle.tabIndex = -1; // →/← expand and collapse from the row
      p.toggle.setAttribute("data-family-toggle", "");
      p.toggle.innerHTML = ICON.chevron;
      p.trail.insertBefore(p.toggle, p.time);
    }
    if (p.toggle.className !== opts.cls.toggle) p.toggle.className = opts.cls.toggle;
    const noun = it.space ? "thread" : "sub-thread";
    const lbl = kids.length ? `${kids.length} ${noun}${kids.length === 1 ? "" : "s"}` : `${it.finished} finished`;
    if (p.toggle.getAttribute("aria-label") !== lbl) p.toggle.setAttribute("aria-label", lbl);
    const tone = needing ? "needs" : running ? "working" : "";
    if ((p.toggle.dataset.tone ?? "") !== tone) tone ? (p.toggle.dataset.tone = tone) : delete p.toggle.dataset.tone;
    const exp = String(prefs.expanded.has(it.id));
    if (p.toggle.getAttribute("aria-expanded") !== exp) p.toggle.setAttribute("aria-expanded", exp);
  } else if (p.toggle) {
    p.toggle.remove();
    p.toggle = null;
  }

  // Failed: a small "Retry" at the end of the line, shown on hover; it retries through Amp's own thread view.
  const retryLabel = it.kind === "failed" ? ` <button type="button" tabindex="-1" data-act="retry" data-retry-label>Retry</button>` : "";
  const context = !show.context ? "" : it.kind === "parent" ? esc(family) : it.context ? `${it.verb ? `<b>${esc(it.verb)}</b> ` : ""}${esc(it.context)}${retryLabel}` : "";
  setHTML(p.context, context);
  p.context.hidden = !context;
  const meta = metaHTML(it, opts, family);
  setHTML(p.meta, meta);
  p.meta.hidden = !meta;
  setText(p.time, ago(it.since));
  // Hover actions live in the row's trail: they open to the right of the toggle and push it left.
  const acts = [
    it.kind === "failed" ? ["retry", "Retry", ICON.retry] : null,
    it.kind === "asking" ? ["done", "Mark done", ICON.done] : null,
    it.inAmp ? ["pin", it.pinned ? "Unpin" : "Pin", it.pinned ? ICON.unpin : ICON.pin] : null,
    it.inAmp ? ["more", "More", ICON.more] : null,
    ["archive", "Archive", ICON.archive],
  ].filter(Boolean);
  setHTML(p.actions, acts.map(([a, l, i]) => `<button type="button" tabindex="-1" data-act="${a}" aria-label="${l}" title="${l}">${i}</button>`).join(""));
  if (row.dataset.acts !== String(acts.length)) row.dataset.acts = acts.length;
  // The toggle slides left by (actions width - time width); measure the time text without a layout read.
  const tw = `${timeWidth(p.time.textContent)}px`;
  if (row._tw !== tw) {
    row.style.setProperty("--time-w", tw);
    row._tw = tw;
  }
  // Same as CSS --shift (actions width + 4px gap - time width - the trail's 5px gap), in px for the hover-zone check.
  const actsPx = acts.length * 24 - 2;
  const shiftPx = `${Math.max(0, actsPx - 1 - parseFloat(tw))}px`;
  if (row._sp !== shiftPx) { row.style.setProperty("--shift-px", shiftPx); row._sp = shiftPx; }
}

S.timeFont = null;

export const timeCanvas = document.createElement("canvas").getContext("2d");

export const timeWidths = new Map();

export function timeWidth(text) {
  if (!text) return 0;
  if (!S.timeFont) {
    const probe = document.querySelector("[data-amp-focus-row] [data-time]");
    if (!probe) return 16;
    const cs = getComputedStyle(probe);
    S.timeFont = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    timeCanvas.font = S.timeFont;
    timeCanvas.fontVariantNumeric = "tabular-nums";
  }
  let w = timeWidths.get(text);
  if (w === undefined) { w = Math.ceil(timeCanvas.measureText(text).width); timeWidths.set(text, w); }
  return w;
}

export function createItem(id) {
  const el = document.createElement("div");
  el.setAttribute("data-amp-focus-item", "");
  el.dataset.threadId = id;
  el.innerHTML = `<div data-amp-focus-snooze aria-hidden="true">${ICON.snooze}</div>`
    + `<div data-amp-focus-actions><button type="button" tabindex="-1" data-act="retry" aria-label="Retry" title="Retry">${ICON.retry}</button><button type="button" tabindex="-1" data-act="more" aria-label="More" title="More">${ICON.more}</button><button type="button" tabindex="-1" data-act="archive" aria-label="Archive" title="Archive">${ICON.archive}</button></div>`
    + `<div data-amp-focus-row role="link" tabindex="-1"></div><div data-family hidden><div data-family-inner></div></div>`;
  return el;
}

export function createChild(id) {
  const el = document.createElement("div");
  el.setAttribute("data-amp-focus-child", "");
  el.dataset.threadId = id;
  el.innerHTML = `<span data-tree aria-hidden="true"></span><div data-amp-focus-row role="link" tabindex="-1"></div>`;
  return el;
}
