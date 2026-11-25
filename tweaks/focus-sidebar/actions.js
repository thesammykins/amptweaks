// User actions: archive (with the void animation), undo, snooze, mark done, archive all done, toasts.
import { markRead, markUnread, navigate, snoozeThread, unsnoozeThread } from "./amp/actions.js";
import { EASE, TAG, reduceMotion } from "./config.js";
import { closeTray } from "./input.js";
import { recompute, refresh } from "./live.js";
import { esc } from "./render/dom-util.js";
import { activeIdSet, collapse, ensureRoot, isShown, render, swipe } from "./render/list.js";
import { S } from "./state.js";
import { cache } from "./store.js";

// ---------- actions ----------
// Per-thread results: { ok, done: [ids that succeeded], failed: [{ id, error }] }.
export async function archive(ids, undo = false) {
  try {
    const q = ids.map(encodeURIComponent).join(",");
    const res = await fetch(`/__amp-tweaks/act/archive?id=${q}${undo ? "&undo=1" : ""}`, { method: "POST" });
    const r = await res.json();
    const done = r.done ?? (r.ok ? ids : []);
    const failed = r.failed ?? [];
    if (failed.length) console.warn(TAG, undo ? "unarchive" : "archive", `${failed.length}/${ids.length} failed`, failed);
    else console.info(TAG, undo ? "unarchived" : "archived", ids.length);
    return { ok: !failed.length && done.length === ids.length, done, failed };
  } catch (e) {
    console.warn(TAG, undo ? "unarchive failed" : "archive failed", ids, e.message);
    return { ok: false, done: [], failed: ids.map(id => ({ id, error: e.message })) };
  }
}

export const familyIds = id => [...S.rows].filter(([, r]) => r.root === id).map(([k]) => k);

// Archived ids stay hidden until they've actually left both Amp's list and the CLI list.
export const dismissed = new Map();

export const findItem = id => document.querySelector(`[data-amp-focus-item][data-thread-id="${CSS.escape(id)}"]`);

export const findChild = id => document.querySelector(`[data-amp-focus-child][data-thread-id="${CSS.escape(id)}"]`);

export const findAny = id => findItem(id) ?? findChild(id);

export const hrefOf = id => S.model.flatMap(i => [i, ...(i.children ?? [])]).find(i => i.id === id)?.href ?? `/threads/${id}`;

export const titleOf = id => cache.get(id)?.d?.title ?? S.rows.get(id)?.title ?? "thread";

// "Sucked into the void": the row accelerates into the archive point, shrinking and blurring, then the gap closes.
export async function suck(el, point) {
  el.removeAttribute("data-thread-id");
  el.setAttribute("data-leaving", "");
  el.style.pointerEvents = "none";
  if (reduceMotion.matches) return el.remove();
  const r = el.getBoundingClientRect();
  const px = point?.x ?? r.right - 20;
  const py = point?.y ?? r.top + 14;
  el.style.transformOrigin = `${px - r.left}px ${py - r.top}px`;
  const list = el.closest("[data-amp-focus-list]");
  if (list) {
    const lr = list.getBoundingClientRect();
    const hole = document.createElement("span");
    hole.setAttribute("data-amp-void", "");
    hole.style.left = `${px - lr.left}px`;
    hole.style.top = `${py - lr.top + list.scrollTop}px`;
    list.appendChild(hole);
    hole.animate([
      { transform: "translate(-50%, -50%) scale(0.2)", opacity: 0 },
      { transform: "translate(-50%, -50%) scale(1)", opacity: 1, offset: 0.55 },
      { transform: "translate(-50%, -50%) scale(0)", opacity: 0 },
    ], { duration: 560, easing: EASE }).finished.catch(() => {}).then(() => hole.remove());
  }
  await el.animate([
    { transform: "scale(1)", opacity: 1, filter: "blur(0px)" },
    { transform: "scale(0.96)", opacity: 1, filter: "blur(0px)", offset: 0.18 },
    { transform: "scale(0.03) rotate(-8deg)", opacity: 0, filter: "blur(3px)" },
  ], { duration: 440, easing: "cubic-bezier(0.55, 0, 0.8, 0.2)", fill: "forwards" }).finished.catch(() => {});
  await collapse(el, 220);
}

// Undo is a stack: every archive/snooze can be undone in order (toast button or ⌘Z).
export const undoStack = [];

export function archiveItems(entries, labelText) {
  const ids = [...new Set(entries.flatMap(({ id }) => [id, ...familyIds(id)]))];
  ids.forEach(i => dismissed.set(i, Date.now()));
  swipe.active = false;
  const gone = new Set(ids);
  S.model = S.model.filter(i => !gone.has(i.id)).map(i => ({ ...i, children: (i.children ?? []).filter(c => !gone.has(c.id)) }));
  entries.forEach(({ el, point }, n) => el && setTimeout(() => suck(el, point), n * 70));
  const extra = ids.length - entries.length;
  const plural = n => `${n} thread${n === 1 ? "" : "s"}`;
  // The archive runs now; Undo waits for it to settle, then unarchives exactly what was archived (no race).
  const op = archive(ids);
  // Undo is sent at once; the proxy orders it behind the still-running archive per thread (reload-safe).
  const undo = async () => {
    toast(`Restoring ${plural(ids.length)}…`, 0, null, 0);
    const u = await archive(ids, true);
    ids.forEach(i => dismissed.delete(i));
    toast(u.ok ? `Restored ${plural(ids.length)}` : `Restored ${u.done.length} of ${ids.length}. ${plural(u.failed.length)} couldn't be restored.`, 0, null);
    refresh(true);
  };
  pushUndo(labelText ?? `Archived ${titleOf(entries[0].id)}`, extra, undo);
  setTimeout(() => render(true), entries.length * 70 + 700);
  op.then(r => {
    if (r.ok || undoInFlight(undo)) return;
    // Only what failed comes back; what succeeded stays archived and stays undoable.
    r.failed.forEach(f => dismissed.delete(f.id));
    if (!r.done.length) {
      dropUndo(undo);
      toast("Couldn't archive. Restored it.", 0, null);
    } else {
      toast(`Archived ${r.done.length} of ${ids.length}. ${plural(r.failed.length)} couldn't be archived.`, 0, () => { dropUndo(undo); undo(); });
    }
    refresh(true);
  });
}

// True once the user has pressed Undo for this archive (its entry has left the stack).
export const undoInFlight = fn => !undoStack.some(u => u.fn === fn);

// Snooze and mark done are Amp's own: "Snooze Until I'm Needed" (Amp wakes it on a new message or an approval) and
// Mark as Read, so Amp's list and your other devices agree. A snoozed root takes its family with it.
// Mark done: a finished, unread thread is marked read; anything else (an Ask, a failure) snoozes until it's needed.
// Threads marked read stay hidden until Amp's row drops its unread dot (or 20s pass).
S.readHold = new Map();

export function markDone(el, id) {
  const it = S.model.flatMap(i => [i, ...(i.children ?? [])]).find(i => i.id === id);
  if (it?.kind !== "review") return snoozeItem(el, id, true);
  S.readHold.set(id, Date.now() + 20_000);
  leaveRow(el, id, true);
  const op = markRead([id]);
  pushUndo(`Marked ${titleOf(id)} read`, 0, async () => {
    S.readHold.delete(id);
    await op.catch(() => {});
    await markUnread(id).catch(e => toast(`Couldn't mark ${titleOf(id)} unread: ${e.message}`, 0, null));
    recompute(true);
  });
  op.then(done => { if (!done.includes(id)) throw new Error("Amp didn't mark it read"); })
    .catch(e => { S.readHold.delete(id); console.warn(TAG, "mark read failed", id, e.message); toast(`Couldn't mark ${titleOf(id)} read`, 0, null); recompute(true); });
}

export function snoozeItem(el, id, done = false) {
  if (!id) return closeTray(el);
  S.ampSnoozed.add(id);
  leaveRow(el, id, done);
  const op = snoozeThread(id);
  pushUndo(`${done ? "Marked done" : "Snoozed"} ${titleOf(id)}`, 0, async () => {
    S.ampSnoozed.delete(id);
    recompute(true);
    const previous = await op.catch(() => undefined);
    await unsnoozeThread(id, previous).catch(e => toast(`Couldn't unsnooze ${titleOf(id)}: ${e.message}`, 0, null));
  });
  op.catch(e => { S.ampSnoozed.delete(id); console.warn(TAG, "snooze failed", id, e.message); toast(`Couldn't snooze ${titleOf(id)}`, 0, null); recompute(true); });
}


function leaveRow(el, id, done) {
  S.model = S.model.filter(i => i.id !== id).map(i => ({ ...i, children: (i.children ?? []).filter(c => c.id !== id) }));
  el.removeAttribute("data-thread-id");
  el.setAttribute("data-leaving", "");
  swipe.active = false;
  const gone = reduceMotion.matches ? Promise.resolve() : el.animate(done
    ? [{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(0.97)" }]
    : [{ opacity: 1, transform: "translateX(0)" }, { opacity: 0, transform: "translateX(40%)" }], { duration: done ? 200 : 260, easing: EASE, fill: "forwards" }).finished.catch(() => {});
  gone.then(() => collapse(el, 220)).then(() => render(true));
}

export function pushUndo(text, extra, fn) {
  undoStack.push({ fn, at: Date.now() });
  if (undoStack.length > 20) undoStack.shift();
  toast(text, extra, () => { dropUndo(fn); fn(); });
}

export function dropUndo(fn) {
  const i = undoStack.findIndex(u => u.fn === fn);
  if (i !== -1) undoStack.splice(i, 1);
}

export function undoLast() {
  const u = undoStack.pop();
  if (!u || Date.now() - u.at > 10 * 60_000) return false;
  hideToast();
  u.fn();
  return true;
}

// Moving on: everything finished and unread leaves together, staggered.
export function doneEntries() {
  const done = [];
  for (const it of S.model) {
    if (it.kind === "review" && !(it.children ?? []).some(c => c.kind !== "review")) done.push({ id: it.id, el: findItem(it.id) });
    else for (const c of it.children ?? []) if (c.kind === "review") done.push({ id: c.id, el: findChild(c.id) });
  }
  return done;
}

export function archiveAllDone() {
  const done = doneEntries();
  if (done.length) archiveItems(done, `Archived ${done.length} done thread${done.length === 1 ? "" : "s"}`);
}

// ⌃⌘A: archive the open thread and open the next one in the list (Mail's shortcut).
export function visibleOrder() {
  return [...document.querySelectorAll("[data-amp-focus-root] [data-thread-id] > [data-amp-focus-row]")]
    .filter(isShown)
    .map(r => r.parentElement.dataset.threadId);
}

export function archiveAndAdvance() {
  const open = activeIdSet();
  const order = visibleOrder();
  const cur = order.find(id => open.has(id));
  if (!cur) return false;
  const i = order.indexOf(cur);
  const next = order.slice(i + 1).find(id => !familyIds(cur).includes(id)) ?? order.slice(0, i).reverse()[0];
  const el = findAny(cur);
  const r = el?.getBoundingClientRect();
  archiveItems([{ el, id: cur, point: r ? { x: r.right - 20, y: r.top + 14 } : undefined }]);
  if (next) navigate(next, hrefOf(next), {});
  return true;
}

S.toastTimer = 0;

export function hideToast() {
  const t = document.querySelector("[data-amp-focus-toast]");
  if (!t) return;
  t.removeAttribute("data-show");
  setTimeout(() => { if (!t.hasAttribute("data-show")) t.hidden = true; }, 280);
}

export function toast(text, extra, onUndo, duration = 6000) {
  const root = ensureRoot();
  if (!root) return;
  const t = root.querySelector("[data-amp-focus-toast]");
  t.innerHTML = `<span data-toast-text>${esc(text)}${extra ? ` <span data-toast-extra>and ${extra} sub-thread${extra === 1 ? "" : "s"}</span>` : ""}</span>${onUndo ? `<button type="button" data-undo>Undo</button>` : ""}`;
  t.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => t.setAttribute("data-show", "")));
  clearTimeout(S.toastTimer);
  if (duration) S.toastTimer = setTimeout(hideToast, duration);
  t.querySelector("[data-undo]")?.addEventListener("click", () => { clearTimeout(S.toastTimer); hideToast(); onUndo(); }, { once: true });
}
