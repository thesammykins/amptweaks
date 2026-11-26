// How this tweak reaches Amp's Puck. When Amp changes, fix it here.
/** Your current Puck chat: /puck redirects to it. Its status line is Puck's latest one-line summary. */
export async function currentPuck() {
  const res = await fetch("/puck", { redirect: "follow", cache: "no-store" });
  const id = res.url.match(/T-[0-9a-f-]{36}/)?.[0];
  if (!id) throw new Error("couldn't find your Puck chat");
  const d = await (await fetch(`/api/threads/${id}`, { cache: "no-store" })).json();
  return {
    id,
    status: d.meta?.statusMessage?.text ?? null,
    at: d.meta?.statusMessage?.updatedAt ?? d.updatedAt ?? null,
    working: d.meta?.lastKnownAgentState?.state === "running",
  };
}

/** Amp's own unread dot on its rail Puck icon. */
export const hasUnread = () => { const b = document.querySelector("[data-puck-unread-badge]"); return !!b && !b.classList.contains("opacity-0"); };

/** Opens a page through SvelteKit's router (a link click it handles), so the page doesn't reload. */
export function go(href) {
  const a = Object.assign(document.createElement("a"), { href, hidden: true });
  document.body.append(a);
  a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window, button: 0 }));
  a.remove();
}

const native = name => window.webkit?.messageHandlers?.[name] ?? null;

/** Amp's own Puck window (macOS app). False where there's no native window to open. */
export function openPuckWindow() {
  const h = native("ampNativeOpenPuckWindow");
  if (!h) return false;
  h.postMessage({});
  return true;
}

/** Presses one of Amp's buttons: they ignore a bare .click() and answer the full pointer sequence. */
export function pressAmp(b) {
  if (!b) return;
  const r = b.getBoundingClientRect(), o = { bubbles: true, cancelable: true, composed: true, clientX: r.left + 4, clientY: r.top + 4, button: 0 };
  b.dispatchEvent(new PointerEvent("pointerdown", { ...o, pointerType: "mouse", isPrimary: true }));
  b.dispatchEvent(new MouseEvent("mousedown", o));
  b.dispatchEvent(new PointerEvent("pointerup", { ...o, pointerType: "mouse", isPrimary: true }));
  b.dispatchEvent(new MouseEvent("mouseup", o));
  b.dispatchEvent(new MouseEvent("click", o));
}
