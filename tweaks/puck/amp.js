// How this tweak reaches Amp's Puck. When Amp changes, fix it here.
const TAG = "[puck]";

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
export const unreadBadge = () => document.querySelector("[data-puck-unread-badge]");
export const hasUnread = () => { const b = unreadBadge(); return !!b && !b.classList.contains("opacity-0"); };

/** Opens Puck through SvelteKit's router (a link click it handles), so the page doesn't reload. */
export function openPuck() {
  const a = Object.assign(document.createElement("a"), { href: "/puck" });
  a.hidden = true;
  document.body.append(a);
  a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window, button: 0 }));
  a.remove();
}

const PENDING = "amp-tweaks:puck:pending-draft";

/** Puts text in Puck's message box as a draft (Amp's own state picks it up) and focuses it. Never sends.
 *  Puck opens as a page or as Amp's side panel; either way its box is found by its chat's id. If Amp doesn't
 *  open it, /puck is loaded and the text waits in session storage until the page is back. */
export async function draftToPuck(text) {
  const { id } = await currentPuck();
  if (!puckBox(id)) openPuck();
  for (const end = Date.now() + 1500; Date.now() < end; await sleep(100)) if (fill(puckBox(id), text)) return true;
  try { sessionStorage.setItem(PENDING, text); } catch {}
  location.assign("/puck");
  return false;
}

/** After a reload to /puck: put the waiting text in Puck's box. */
export async function resumePendingDraft() {
  let text = null;
  try { text = sessionStorage.getItem(PENDING); } catch {}
  if (!text) return;
  const { id } = await currentPuck();
  for (const end = Date.now() + 10000; Date.now() < end; await sleep(150)) {
    if (fill(puckBox(id), text)) { try { sessionStorage.removeItem(PENDING); } catch {} return; }
  }
  console.warn(TAG, "Puck's message box didn't appear; the text waits for the next load");
}

// The message box in the pane that shows Puck's chat.
function puckBox(id) {
  let n = document.querySelector(`[data-thread-transcript-scroll][data-thread-id="${CSS.escape(id)}"]`);
  for (let i = 0; n && i < 8; i++, n = n.parentElement) {
    const box = n.querySelector("textarea[data-amp-prompt-input]");
    if (box) return box;
  }
  return null;
}

function fill(box, text) {
  if (!box) return false;
  const value = box.value ? `${box.value}\n\n${text}` : text;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(box, value);
  box.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  box.focus();
  box.setSelectionRange(value.length, value.length);
  return true;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
