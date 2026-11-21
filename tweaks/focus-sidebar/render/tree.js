// Families: sub-thread order, guide lines (rails, branches, elbows, state colours) and the "N finished" list.
import { dismissed } from "../actions.js";
import { EASE, FINISHED_PAGE, ICON, MAX_DEPTH, MAX_KIDS } from "../config.js";
import { setHTML, setText } from "./dom-util.js";
import { leave, render } from "./list.js";
import { applyRow, createChild } from "./rows.js";
import { S } from "../state.js";
import { cache, prefs, saveIds } from "../store.js";

 // indentation stops here so deep trees don't run off a narrow sidebar

// Order the family as a tree: each shown sub-thread hangs off its nearest shown ancestor (or the root),
// siblings keep their urgency order. rails[j] = whether the ancestor line at level j+1 continues past this row.
// `tail`: a "Show more" / "N finished" branch follows, so the root's last child isn't the last branch.
export function treeOrder(rootId, kids, tail = false) {
  const shown = new Set(kids.map(k => k.id));
  const displayParent = id => {
    let p = S.rows.get(id)?.parent;
    for (let hops = 0; p && p !== rootId && !shown.has(p) && hops < 8; hops++) p = S.rows.get(p)?.parent;
    return p && shown.has(p) ? p : rootId;
  };
  const byParent = new Map();
  for (const k of kids) {
    const pid = displayParent(k.id);
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid).push(k);
  }
  const out = [];
  const walk = (pid, depth, rails) => {
    const list = byParent.get(pid) ?? [];
    list.forEach((k, i) => {
      const last = i === list.length - 1 && !(depth === 1 && tail);
      out.push({ k, depth, last, rails });
      if (depth < 12) walk(k.id, depth + 1, [...rails, !last]);
    });
  };
  walk(rootId, 1, []);
  return out;
}

// Guide lines for one tree row: ancestor rails, then this row's branch (a smooth elbow if it's the last one).
export function applyTree(holder, depth, last, rails) {
  const d = Math.min(depth, MAX_DEPTH);
  holder.style.setProperty("--d", String(d));
  holder.toggleAttribute("data-last", last);
  const ancestors = d > 1 ? rails.slice(-(d - 1)) : [];
  const html = ancestors.map((on, j) => (on ? `<span data-rail style="--up:${d - 1 - j}"></span>` : "")).join("")
    + (last ? `<span data-elbow></span>` : `<span data-tail></span><span data-tail-down></span><span data-stub></span>`);
  setHTML(holder.querySelector(":scope > [data-tree]"), html);
}

export function applyItem(el, it, cls, animate, isNew = false) {
  el.dataset.kind = it.kind;
  const expanded = prefs.expanded.has(it.id);
  el.toggleAttribute("data-expanded", expanded);
  el.querySelector(':scope > [data-amp-focus-actions] [data-act="more"]').hidden = !it.inAmp;
  el.querySelector(':scope > [data-amp-focus-actions] [data-act="retry"]').hidden = it.kind !== "failed";
  if (it.spaceColor) el.style.setProperty("--space-color", it.spaceColor);
  else el.style.removeProperty("--space-color");
  applyRow(el.querySelector(":scope > [data-amp-focus-row]"), it, { cls, mode: prefs.mode });

  // Children: drawn as a tree (real parent/child structure within the family), keyed by their live elements.
  const kids = it.children ?? [];
  const family = el.querySelector(":scope > [data-family]");
  family.hidden = !kids.length && !it.finished;
  const inner = family.firstElementChild;
  const showAll = prefs.kidsAll.has(it.id);
  const truncated = !showAll && kids.length > MAX_KIDS;
  const all = treeOrder(it.id, kids, truncated || !!it.finished);
  const visible = truncated ? all.slice(0, MAX_KIDS) : all;
  const hiddenCount = all.length - visible.length;
  // Guide lines only when there's more than one branch to show; a single sub-thread just indents.
  el.toggleAttribute("data-tree-on", visible.length + (hiddenCount ? 1 : 0) + (it.finished ? 1 : 0) > 1);
  const existing = new Map([...inner.querySelectorAll(":scope > [data-amp-focus-child][data-thread-id]")].map(c => [c.dataset.threadId, c]));
  let prev = null;
  // Line colours: the run down to each sub-thread (and its branch) takes that thread's state; the run on past it
  // takes the next sibling's. The parent's connector takes the first sub-thread's.
  const nextKind = i => {
    const d = visible[i].depth;
    for (let j = i + 1; j < visible.length; j++) { if (visible[j].depth < d) break; if (visible[j].depth === d) return visible[j].k.kind; }
    return "";
  };
  el.dataset.firstBranch = visible[0]?.k.kind ?? "";
  visible.forEach((node, i) => {
    const c = node.k;
    let ch = existing.get(c.id);
    if (ch) existing.delete(c.id);
    else {
      ch = createChild(c.id);
      if (animate && expanded && !isNew) requestAnimationFrame(() => ch.animate([{ opacity: 0, transform: "translateY(-3px)" }, { opacity: 1, transform: "none" }], { duration: 220, easing: EASE }));
    }
    applyTree(ch, node.depth, node.last, node.rails);
    if (ch.dataset.branch !== c.kind) ch.dataset.branch = c.kind;
    const nk = nextKind(i);
    if (ch.dataset.next !== nk) ch.dataset.next = nk;
    applyRow(ch.querySelector(":scope > [data-amp-focus-row]"), c, { child: true, cls, mode: prefs.mode });
    let want = prev ? prev.nextElementSibling : inner.firstElementChild;
    while (want?.hasAttribute("data-leaving")) want = want.nextElementSibling;
    if (ch !== want) inner.insertBefore(ch, want);
    prev = ch;
  });
  for (const ch of existing.values()) leave(ch, animate && expanded);

  // Large families: past MAX_KIDS active sub-threads, the rest sit behind a branch of their own.
  let more = inner.querySelector(":scope > [data-kids-more]");
  if (hiddenCount) {
    if (!more) {
      more = document.createElement("button");
      more.type = "button";
      more.tabIndex = -1;
      more.setAttribute("data-kids-more", "");
      more.innerHTML = `<span data-tree aria-hidden="true"></span><span data-label></span>`;
    }
    applyTree(more, 1, !it.finished, []);
    setText(more.querySelector("[data-label]"), `Show ${hiddenCount} more`);
    const want = prev ? prev.nextElementSibling : inner.firstElementChild;
    if (more !== want) inner.insertBefore(more, want);
  } else more?.remove();
  applyFinished(inner, it, cls, kids);
}

export function finishedItems(rootId, activeIds) {
  const updated = new Map(S.cli.map(t => [t.id, t.updated]));
  const out = [];
  for (const [id, r] of S.rows) {
    if (r.root !== rootId || activeIds.has(id) || dismissed.has(id)) continue;
    const d = cache.get(id)?.d;
    // When the agent last did something; archive/unarchive bump updatedAt, so it's only a fallback.
    out.push({ id, d: d ?? { title: r.title || "Thread" }, kind: "finished", context: r.status || d?.status || "", since: d?.agentAt ?? d?.updatedAt ?? updated.get(id) ?? null, href: r.href, inAmp: true });
  }
  return out.sort((a, b) => (Date.parse(b.since) || 0) - (Date.parse(a.since) || 0));
}

export function applyFinished(inner, it, cls, kids) {
  let box = inner.querySelector(":scope > [data-finished]");
  if (!it.finished) { box?.remove(); return; }
  if (!box) {
    box = document.createElement("div");
    box.setAttribute("data-finished", "");
    box.innerHTML = `<span data-tree aria-hidden="true"></span><button type="button" tabindex="-1" data-finished-toggle aria-expanded="false">${ICON.chevron}<span></span></button><div data-finished-body><div data-finished-list></div></div>`;
  }
  if (inner.lastElementChild !== box) inner.appendChild(box);
  applyTree(box, 1, true, []);
  const open = prefs.finishedOpen.has(it.id);
  box.toggleAttribute("data-open", open);
  const toggle = box.querySelector(":scope > [data-finished-toggle]");
  toggle.setAttribute("aria-expanded", String(open));
  setText(toggle.lastElementChild, `${it.finished} finished`);
  const list = box.querySelector("[data-finished-list]");
  if (!open) { if (list.childElementCount) list.replaceChildren(); return; }

  const all = finishedItems(it.id, new Set(kids.map(c => c.id)));
  const shown = all.slice(0, prefs.finishedShown.get(it.id) ?? FINISHED_PAGE);
  const existing = new Map([...list.querySelectorAll(":scope > [data-amp-focus-finished][data-thread-id]")].map(c => [c.dataset.threadId, c]));
  let prev = null;
  const rest = all.length - shown.length;
  // The finished list continues the family tree from the "N finished" chevron (lines when 2+ branches).
  box.toggleAttribute("data-sub-tree", shown.length + (rest > 0 ? 1 : 0) > 1);
  for (const [n, f] of shown.entries()) {
    let el = existing.get(f.id);
    if (el) existing.delete(f.id);
    else {
      el = document.createElement("div");
      el.setAttribute("data-amp-focus-finished", "");
      el.dataset.threadId = f.id;
      el.innerHTML = `<span data-tree aria-hidden="true"></span><div data-amp-focus-row role="link" tabindex="-1"></div>`;
    }
    applyRow(el.querySelector(":scope > [data-amp-focus-row]"), f, { child: true, cls, mode: prefs.mode });
    applyTree(el, 1, n === shown.length - 1 && rest <= 0, []);
    const want = prev ? prev.nextElementSibling : list.firstElementChild;
    if (el !== want) list.insertBefore(el, want);
    prev = el;
  }
  for (const el of existing.values()) el.remove();
  let more = list.querySelector(":scope > [data-finished-more]");
  if (rest > 0) {
    if (!more) {
      more = document.createElement("button");
      more.type = "button";
      more.tabIndex = -1;
      more.setAttribute("data-finished-more", "");
      more.innerHTML = `<span data-tree aria-hidden="true"></span><span data-label></span>`;
    }
    applyTree(more, 1, true, []);
    setText(more.querySelector("[data-label]"), `Show ${Math.min(rest, 20)} more`);
    if (list.lastElementChild !== more) list.appendChild(more);
  } else more?.remove();
}

export function setFinishedOpen(id, open) {
  open ? prefs.finishedOpen.add(id) : prefs.finishedOpen.delete(id);
  saveIds("focus.finishedOpen", prefs.finishedOpen);
  render(true);
}
