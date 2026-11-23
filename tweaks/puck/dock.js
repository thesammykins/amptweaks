// Your Puck in the bottom-right corner of every screen. It watches the pointer, shows Amp's unread dot, previews
// Puck's latest one-line status on hover, and opens Puck on click. Hidden while you're in Puck's own chat.
import { currentPuck, hasUnread, openPuck } from "./amp.js";
import { lookAt, puckFace, puckName, wake } from "./face.js";

const PEEK_TTL = 20_000;
let dock = null;
let face = null;
let peekCache = { at: 0, data: null };
let closeTimer = 0;
let queued = false;

export function startDock() {
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(sync);
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
  addEventListener("pointermove", e => { if (dock && !dock.hidden) lookAt(face, e.clientX, e.clientY); }, { passive: true });
  sync();
}

function sync() {
  queued = false;
  if (!dock) mount();
  if (!dock) return;
  dock.toggleAttribute("data-unread", hasUnread());
  hideInPuck();
}

function mount() {
  face = puckFace(30);
  if (!face) return; // Amp's rail isn't there yet (or has no Puck): try again on the next change
  dock = document.createElement("div");
  dock.dataset.ampTweaksPuckDock = "";
  dock.innerHTML = `<div data-peek role="status"><div data-who><span data-name></span><span data-when></span><kbd title="Amp's shortcut for Puck">⌃/</kbd></div><div data-msg></div></div><button type="button" data-btn><span data-dot></span></button>`;
  dock.querySelector("[data-name]").textContent = puckName();
  const btn = dock.querySelector("[data-btn]");
  btn.setAttribute("aria-label", `Open ${puckName()}`);
  btn.prepend(face);
  btn.addEventListener("click", () => { close(); openPuck(); });
  dock.addEventListener("pointerenter", open);
  dock.addEventListener("pointerleave", () => { clearTimeout(closeTimer); closeTimer = setTimeout(close, 220); });
  document.body.append(dock);
  refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, PEEK_TTL);
}

// Puck's status takes a second to fetch, so it's fetched ahead of a hover and kept for a short while.
async function refresh() {
  if (Date.now() - peekCache.at < PEEK_TTL) return peekCache.data;
  try { peekCache = { at: Date.now(), data: await currentPuck() }; } catch (e) { console.warn("[puck]", e.message); }
  return peekCache.data;
}

async function open() {
  clearTimeout(closeTimer);
  wake(face, true);
  dock.dataset.open = "";
  const d = await refresh();
  dock.querySelector("[data-msg]").textContent = d?.working ? "Working…" : d?.status ?? `Ask ${puckName()} anything.`;
  dock.querySelector("[data-when]").textContent = d?.at && !d.working ? ago(d.at) : "";
}

function close() {
  wake(face, false);
  delete dock?.dataset.open;
}

// While Puck's chat is on screen (as a page or Amp's side panel) the dock would only point at where you are.
function hideInPuck() {
  const id = peekCache.data?.id;
  dock.hidden = !!id && !!document.querySelector(`[data-thread-transcript-scroll][data-thread-id="${CSS.escape(id)}"]`)?.offsetParent;
}

function ago(iso) {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? "now" : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
}
