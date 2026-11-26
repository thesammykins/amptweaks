// Amp adapter (act side): pin and retry through Amp's own (hidden) controls;
// snooze and read state through Amp's own commands.
import { titleOf, toast } from "../actions.js";
import { S } from "../state.js";
import { navigate } from "./nav.js";
import { command } from "./remote.js";

// Pin = Amp's own per-row pin button (it ignores .click(), so send the pointer sequence Amp listens for).
export function pressAmp(b) {
  const r = b.getBoundingClientRect(), o = { bubbles: true, cancelable: true, composed: true, clientX: r.left + 4, clientY: r.top + 4, button: 0 };
  b.dispatchEvent(new PointerEvent("pointerdown", { ...o, pointerType: "mouse", isPrimary: true }));
  b.dispatchEvent(new MouseEvent("mousedown", o));
  b.dispatchEvent(new PointerEvent("pointerup", { ...o, pointerType: "mouse", isPrimary: true }));
  b.dispatchEvent(new MouseEvent("mouseup", o));
  b.dispatchEvent(new MouseEvent("click", o));
}

export function pinThread(id) {
  const a = document.querySelector(`a[data-sidebar-thread-id="${CSS.escape(id)}"]`);
  const b = a?.querySelector("[data-thread-row-pin]");
  if (!b) { toast(`Couldn't pin ${titleOf(id)}: Amp's pin button wasn't found`, 0, null); return; }
  const was = a.hasAttribute("data-thread-row-pinned");
  pressAmp(b);
  toast(`${was ? "Unpinned" : "Pinned"} ${titleOf(id)}`, 0, null);
}

// Retry = Amp's own Retry in the thread view (it re-runs the failed turn); we open the thread and press it.
export async function retryThread(id, href) {
  navigate(id, href, {});
  const title = titleOf(id);
  const isRetry = b => !b.closest('[data-slot="sidebar"], [data-amp-focus-root]') && b.offsetParent !== null
    && /^(retry|try again)$/i.test((b.getAttribute("aria-label") || b.textContent || "").trim());
  const t0 = Date.now();
  while (Date.now() - t0 < 6000) {
    await new Promise(r => setTimeout(r, 250));
    const btn = [...document.querySelectorAll("main button, main [role=button]")].find(isRetry);
    if (btn && location.pathname.includes(id)) {
      btn.click();
      toast(`Retrying ${title}`, 0, null);
      return true;
    }
  }
  toast(`Opened ${title}. Amp didn't show a Retry here.`, 0, null);
  return false;
}


// ---------- Amp's own snooze and read state (synced: Amp's list, other windows and devices agree) ----------
// "Until I'm needed": Amp wakes it on a new message or an approval. Returns what to restore for Undo.
export async function snoozeThread(id) {
  const r = await command("snoozeThreadCommand", { threadID: id, choice: "next_message" });
  S.ampSnoozed.add(id);
  return r?.previous ?? null;
}

export async function unsnoozeThread(id, previous) {
  // Amp's Undo restores the snooze it replaced; with nothing to restore, it's just switched off.
  await command("snoozeThreadCommand", previous == null ? { threadID: id, choice: "off" } : { threadID: id, restore: previous });
  S.ampSnoozed.delete(id);
}

export async function markRead(ids) {
  const r = await command("markThreadsReadCommand", { threadIDs: ids });
  return r?.updatedThreadIDs ?? [];
}

export const markUnread = id => command("markThreadUnreadCommand", { threadID: id });
