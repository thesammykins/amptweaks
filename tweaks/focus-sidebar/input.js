// Input: pointer/touch swipes, keyboard navigation, click wiring for the root, warming the thread you're about to open.
import { clearAmpFilters } from "./amp/view-state.js";
import { archiveAllDone, archiveItems, familyIds, hrefOf, markDone, snoozeItem } from "./actions.js";
import { navigate, openAmpMenu, pinThread, preload, retryThread } from "./amp/actions.js";
import { FINISHED_PAGE } from "./config.js";
import { recompute } from "./live.js";
import { applyFilter, menuHTML, openMenu } from "./menu.js";
import { isShown, recover, render, swipe } from "./render/list.js";
import { setFinishedOpen, setSubOpen } from "./render/tree.js";
import { S } from "./state.js";
import { applyMode, prefs, saveIds, store } from "./store.js";

// ---------- trackpad swipe (Mail-style): left = archive tray / full archive, right = snooze ----------
export const coarse = matchMedia("(pointer: coarse)");

S.TRAY = coarse.matches ? 96 : 76;

 // two tray tiles + gap: 2×2.125rem (fine) / 2×2.75rem (touch)
coarse.addEventListener?.("change", () => { S.TRAY = coarse.matches ? 96 : 76; });

S.trayTimer = 0;

export function setOffset(item, x, settle) {
  const row = item.querySelector(":scope > [data-amp-focus-row]");
  item.toggleAttribute("data-swiping", !settle);
  row.style.transform = x ? `translateX(${x}px)` : "";
  item.style.setProperty("--reveal", Math.min(1, Math.max(0, -x / S.TRAY)).toFixed(3));
  item.style.setProperty("--snooze", Math.min(1, Math.max(0, x / S.TRAY)).toFixed(3));
  item.toggleAttribute("data-open", settle && x <= -S.TRAY);
  item.toggleAttribute("data-commit", !settle && x < -swipe.w * 0.55);
  item.toggleAttribute("data-snooze-commit", !settle && x > swipe.w * 0.4);
  if (settle && x <= -S.TRAY) {
    // An open tray never freezes the list: it closes itself if left alone.
    clearTimeout(S.trayTimer);
    S.trayTimer = setTimeout(() => { if (item.isConnected && !item.matches(":hover")) closeTray(item); }, 4000);
  }
}

export function closeTray(item) {
  setOffset(item, 0, true);
  if (S.pending) render();
}

export function endSwipe() {
  const { item, x } = swipe;
  swipe.active = false;
  swipe.item = null;
  if (!item) return;
  if (!item.dataset.threadId) return closeTray(item);
  if (x < -swipe.w * 0.55) {
    const r = item.getBoundingClientRect();
    return archiveItems([{ el: item, id: item.dataset.threadId, point: { x: r.right - 16, y: r.top + 14 } }]);
  }
  if (x > swipe.w * 0.4) return snoozeItem(item, item.dataset.threadId);
  setOffset(item, x < -S.TRAY * 0.6 ? -S.TRAY : 0, true);
  if (S.pending && x >= -S.TRAY * 0.6) render();
}

// Arrow order: rows, plus the "N finished" disclosure and "Show more" where visible.
export const navOrder = root => [...root.querySelectorAll("[data-thread-id] > [data-amp-focus-row], [data-sub-toggle], [data-kids-more], [data-finished-toggle], [data-finished-more]")].filter(isShown);

export function focusNav(root, el) {
  root.querySelectorAll('[tabindex="0"]').forEach(r => r.setAttribute("tabindex", "-1"));
  el.setAttribute("tabindex", "0");
  el.focus();
  el.scrollIntoView({ block: "nearest" });
}

export function onDisclosureKey(e, el, root) {
  const order = navOrder(root);
  const i = order.indexOf(el);
  const id = el.closest("[data-amp-focus-item]").dataset.threadId;
  let handled = true;
  if (e.key === "ArrowDown") order[i + 1] && focusNav(root, order[i + 1]);
  else if (e.key === "ArrowUp") order[i - 1] && focusNav(root, order[i - 1]);
  else if (el.matches("[data-sub-toggle]") && ["ArrowRight", "ArrowLeft", "Enter", " "].includes(e.key)) {
    const of = el.dataset.of;
    const open = e.key === "ArrowRight" ? true : e.key === "ArrowLeft" ? false : prefs.subCollapsed.has(of);
    if (!setSubOpen(of, open) && e.key === "ArrowLeft") focusNav(root, el.closest("[data-amp-focus-item]").querySelector(`[data-thread-id="${CSS.escape(of)}"] > [data-amp-focus-row]`));
    requestAnimationFrame(() => el.isConnected && el.focus());
  }
  else if (el.matches("[data-finished-toggle]") && (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ")) {
    if (e.key === "ArrowRight" && prefs.finishedOpen.has(id)) handled = false;
    else setFinishedOpen(id, e.key === "ArrowRight" ? true : !prefs.finishedOpen.has(id));
    requestAnimationFrame(() => el.isConnected && el.focus());
  }
  else if (el.matches("[data-finished-toggle]") && e.key === "ArrowLeft") {
    if (prefs.finishedOpen.has(id)) setFinishedOpen(id, false);
    else focusNav(root, el.closest("[data-amp-focus-item]").querySelector(":scope > [data-amp-focus-row]"));
  }
  else if (el.matches("[data-finished-more], [data-kids-more]") && (e.key === "Enter" || e.key === " ")) el.click();
  else handled = false;
  if (handled) { e.preventDefault(); e.stopPropagation(); }
}

// Keyboard on our rows runs in the capture phase so Amp's own sidebar key bindings don't swallow it.
  // Keyboard: arrows move between rows; →/← expand/collapse a family (or a sub-thread's own); Enter opens; E archives; S snoozes;
  // ⇧F10 / context-menu key opens Amp's menu. Same keys Amp uses where it has them (E = Archive).
export function onRowKey(e) {
    const row = e.target.closest?.("[data-amp-focus-row], [data-sub-toggle], [data-kids-more], [data-finished-toggle], [data-finished-more]");
    if (!row || e.target !== row || e.metaKey || e.ctrlKey || e.altKey) return;
    const root = row.closest("[data-amp-focus-root]");
    if (!root) return;
    if (!row.matches("[data-amp-focus-row]")) return onDisclosureKey(e, row, root);
    const holder = row.parentElement;
    const id = holder.dataset.threadId;
    const item = holder.closest("[data-amp-focus-item]");
    const rowsInOrder = () => navOrder(root);
    const move = step => {
      const list = rowsInOrder();
      const next = list[list.indexOf(row) + step];
      if (next) focusNav(root, next);
    };
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    // Letter shortcuts only when the row was reached by keyboard (a click focuses it too; typing must not archive).
    if ((key === "e" || key === "s" || key === "d" || key === "p") && !row.matches(":focus-visible")) return;
    const expand = open => {
      if (item && holder !== item) return !!item.querySelector(`[data-sub-toggle][data-of="${CSS.escape(id)}"]`) && setSubOpen(id, open);
      if (!item || holder !== item || !item.querySelector(":scope > [data-family]:not([hidden])")) return false;
      if (prefs.expanded.has(id) === open) return false;
      open ? prefs.expanded.add(id) : prefs.expanded.delete(id);
      saveIds("focus.expanded", prefs.expanded);
      item.toggleAttribute("data-expanded", open);
      item.querySelector("[data-family-toggle]")?.setAttribute("aria-expanded", String(open));
      return true;
    };
    let handled = true;
    if (key === "ArrowDown") move(1);
    else if (key === "ArrowUp") move(-1);
    else if (key === "ArrowRight") { if (!expand(true)) handled = false; }
    else if (key === "ArrowLeft") { if (!expand(false) && holder !== item) item.querySelector(":scope > [data-amp-focus-row]").focus(); }
    else if (key === "Enter" || key === " ") navigate(id, row.dataset.href, e);
    else if (key === "e") {
      const fam = new Set(holder === item ? familyIds(id) : []);
      const list = rowsInOrder().filter(r => !fam.has(r.parentElement.dataset.threadId));
      const next = list[list.indexOf(row) + 1] ?? list[list.indexOf(row) - 1];
      const r = row.getBoundingClientRect();
      archiveItems([{ el: holder, id, point: { x: r.right - 20, y: r.top + 14 } }]);
      next?.focus();
    }
    else if (key === "s" && holder === item) snoozeItem(item, id);
    else if (key === "d" && (row.dataset.kind === "asking" || row.dataset.kind === "review")) markDone(holder, id);
    else if (key === "p") pinThread(id);
    else if (key === "ContextMenu" || (key === "F10" && e.shiftKey)) { const r = row.getBoundingClientRect(); openAmpMenu(id, r.left + 24, r.bottom); }
    else handled = false;
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  }

S.lastMenuAt = 0;

// Per-root listeners (the root can be recreated; these die with it).
export function wireRoot(root) {
  let suppressUntil = 0; // a drag/long-press must not also click; expires so it can't eat the next real tap
  root.addEventListener("click", e => {
    if (performance.now() < suppressUntil) { e.preventDefault(); return; }
    if (e.target.closest("[data-filter-btn]")) return openMenu(root, root.querySelector("[data-amp-focus-menu]").hidden);
    const fItem = e.target.closest("[data-amp-focus-menu] [data-f]");
    if (fItem) {
      const key = fItem.dataset.f;
      if (key === "archive-done") { openMenu(root, false); return archiveAllDone(); }
      applyFilter(key);
      root.querySelector("[data-amp-focus-menu]").innerHTML = menuHTML();
      return;
    }
    const modeBtn = e.target.closest("[data-mode]");
    if (modeBtn) {
      prefs.mode = modeBtn.dataset.mode;
      store.set("focus.mode", prefs.mode);
      if (!root.querySelector("[data-amp-focus-menu]").hidden) root.querySelector("[data-amp-focus-menu]").innerHTML = menuHTML();
      return recompute(true);
    }
    if (e.target.closest("[data-toggle]")) {
      prefs.focus = !prefs.focus;
      store.set("focus.on", prefs.focus);
      if (prefs.focus) clearAmpFilters();
      if (S.failed) { S.recoveries = 0; return recover(); }
      applyMode();
      return render(true);
    }
    const finToggle = e.target.closest("[data-finished-toggle]");
    if (finToggle) {
      e.preventDefault();
      const id = finToggle.closest("[data-amp-focus-item]").dataset.threadId;
      return setFinishedOpen(id, !prefs.finishedOpen.has(id));
    }
    const subToggle = e.target.closest("[data-sub-toggle]");
    if (subToggle) {
      e.preventDefault();
      return setSubOpen(subToggle.dataset.of, prefs.subCollapsed.has(subToggle.dataset.of));
    }
    const kidsMore = e.target.closest("[data-kids-more]");
    if (kidsMore) {
      e.preventDefault();
      prefs.kidsAll.add(kidsMore.closest("[data-amp-focus-item]").dataset.threadId);
      return render(true);
    }
    const finMore = e.target.closest("[data-finished-more]");
    if (finMore) {
      e.preventDefault();
      const id = finMore.closest("[data-amp-focus-item]").dataset.threadId;
      prefs.finishedShown.set(id, (prefs.finishedShown.get(id) ?? FINISHED_PAGE) + 20);
      return render(true);
    }
    const toggle = e.target.closest("[data-family-toggle]");
    if (toggle) {
      e.preventDefault();
      const item = toggle.closest("[data-amp-focus-item]");
      const id = item.dataset.threadId;
      prefs.expanded.has(id) ? prefs.expanded.delete(id) : prefs.expanded.add(id);
      saveIds("focus.expanded", prefs.expanded);
      item.toggleAttribute("data-expanded", prefs.expanded.has(id));
      toggle.setAttribute("aria-expanded", String(prefs.expanded.has(id)));
      return;
    }
    const actBtn = e.target.closest("[data-act]");
    if (actBtn) {
      e.preventDefault();
      e.stopPropagation();
      // The row the action belongs to: a sub-thread row inside a family, or the item itself.
      const holder = actBtn.closest("[data-amp-focus-child], [data-amp-focus-finished]") ?? actBtn.closest("[data-amp-focus-item]");
      const id = holder.dataset.threadId;
      const r = actBtn.getBoundingClientRect();
      if (actBtn.dataset.act === "archive") archiveItems([{ el: holder, id, point: { x: r.left + r.width / 2, y: r.top + r.height / 2 } }]);
      else if (actBtn.dataset.act === "done") markDone(holder, id);
      else if (actBtn.dataset.act === "pin") pinThread(id);
      else if (actBtn.dataset.act === "retry") retryThread(id, holder.querySelector(":scope > [data-amp-focus-row]")?.dataset.href ?? hrefOf(id));
      else openAmpMenu(id, r.left, r.bottom + 4);
      return;
    }
    const open = e.target.closest("[data-amp-focus-item][data-open]");
    if (open) { e.preventDefault(); closeTray(open); return; }
    const row = e.target.closest("[data-amp-focus-row]");
    if (row) navigate(row.closest("[data-thread-id]").dataset.threadId, row.dataset.href, e);
  });

  root.addEventListener("contextmenu", e => {
    const holder = e.target.closest("[data-thread-id]");
    if (!holder) return;
    e.preventDefault();
    if (performance.now() - S.lastMenuAt < 800) return; // long-press already opened it
    openAmpMenu(holder.dataset.threadId, e.clientX, e.clientY);
  });

  root.addEventListener("wheel", e => {
    const item = e.target.closest("[data-amp-focus-item]");
    if (!item || e.target.closest("[data-family]") || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    if (swipe.item !== item) {
      if (swipe.item) setOffset(swipe.item, 0, true);
      const t = getComputedStyle(item.querySelector(":scope > [data-amp-focus-row]")).transform;
      const x = t && t !== "none" ? new DOMMatrixReadOnly(t).m41 : 0;
      Object.assign(swipe, { item, x, raw: x, w: item.offsetWidth });
    }
    swipe.active = true;
    swipe.raw -= e.deltaX;
    // Left follows the finger up to a full swipe; right follows with resistance (snooze).
    swipe.x = swipe.raw > 0 ? Math.min(swipe.w * 0.6, swipe.raw * 0.75) : Math.max(swipe.raw, -swipe.w);
    setOffset(item, swipe.x, false);
    clearTimeout(swipe.timer);
    swipe.timer = setTimeout(endSwipe, 140);
  }, { passive: false });

  // Touch / pen: drag a row sideways (vertical stays native scroll via touch-action: pan-y); long-press → Amp's menu.
  let touch = null;
  root.addEventListener("pointerdown", e => {
    if (e.pointerType === "mouse" || !e.isPrimary) return;
    if (touch) clearTimeout(touch.holdTimer);
    const item = e.target.closest("[data-amp-focus-item]");
    if (!item || e.target.closest("[data-family], [data-act], [data-family-toggle]")) return;
    const holdTimer = setTimeout(() => {
      if (!touch || touch.dragging) return;
      touch.held = true;
      S.lastMenuAt = performance.now();
      openAmpMenu(item.dataset.threadId, e.clientX, e.clientY);
    }, 500);
    touch = { item, id: e.pointerId, x0: e.clientX, y0: e.clientY, last: e.clientX, dragging: false, held: false, holdTimer };
  });
  root.addEventListener("pointermove", e => {
    if (!touch || e.pointerId !== touch.id) return;
    const dx = e.clientX - touch.x0;
    const dy = e.clientY - touch.y0;
    if (!touch.dragging) {
      if (Math.abs(dy) > 10) { clearTimeout(touch.holdTimer); touch = null; return; } // a scroll, not a swipe
      if (Math.abs(dx) < 8) return;
      touch.dragging = true;
      clearTimeout(touch.holdTimer);
      touch.item.setPointerCapture?.(e.pointerId);
      const t = getComputedStyle(touch.item.querySelector(":scope > [data-amp-focus-row]")).transform;
      const x = t && t !== "none" ? new DOMMatrixReadOnly(t).m41 : 0;
      Object.assign(swipe, { item: touch.item, x, raw: x, w: touch.item.offsetWidth, active: true });
    }
    swipe.raw += e.clientX - touch.last;
    touch.last = e.clientX;
    swipe.x = swipe.raw > 0 ? Math.min(swipe.w * 0.6, swipe.raw * 0.75) : Math.max(swipe.raw, -swipe.w);
    setOffset(touch.item, swipe.x, false);
  });
  const endTouch = (e, cancelled) => {
    if (!touch || e.pointerId !== touch.id) return;
    clearTimeout(touch.holdTimer);
    const { dragging, held, item } = touch;
    touch = null;
    if (dragging || held) suppressUntil = performance.now() + 350;
    if (!dragging) return;
    if (cancelled) { swipe.active = false; swipe.item = null; closeTray(item); } // a system-cancelled gesture never commits
    else endSwipe();
  };
  root.addEventListener("pointerup", e => endTouch(e, false));
  root.addEventListener("pointercancel", e => endTouch(e, true));
  root.addEventListener("pointermove", e => { if (e.pointerType === "mouse") S.lastMouseMove = performance.now(); }, { passive: true });

  // Warm the thread a pointer rests on (or a key moves to) so opening it doesn't wait on Amp's server.
  // No dedupe needed: SvelteKit ignores a repeat preload of the link it already holds.
  let warmTimer = 0;
  const warm = (row, ms) => {
    clearTimeout(warmTimer);
    const id = row?.closest("[data-thread-id]")?.dataset.threadId;
    if (id) warmTimer = setTimeout(() => preload(id), ms);
  };
  root.addEventListener("pointerover", e => { if (e.pointerType === "mouse") warm(e.target.closest("[data-amp-focus-row]"), 60); });
  root.addEventListener("pointerdown", e => warm(e.target.closest("[data-amp-focus-row]"), 0));
  root.addEventListener("focusin", e => { if (e.target.matches("[data-amp-focus-row]:focus-visible")) warm(e.target, 150); });

  root.addEventListener("pointerleave", () => {
    clearTimeout(warmTimer);
    if (swipe.active) return;
    root.querySelectorAll("[data-amp-focus-item][data-open]").forEach(closeTray);
    if (S.pending) render();
  });
}

