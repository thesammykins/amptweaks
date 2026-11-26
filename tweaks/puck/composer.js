// Puck on the message box. Amp's own Call Puck button in each thread's composer shows your Puck instead of an
// outline icon (clicking it is still Amp's call), with Amp's unread dot. Hovering it shows Puck's latest line, with
// Talk (Amp's call) and Open Puck (its window, where calls leave their transcript).
import { currentPuck, go, hasUnread, openPuckWindow, pressAmp } from "./amp.js";
import { lookAt, puckFace, puckName, wake } from "./face.js";

const CALL = '[data-testid="puck-realtime-voice-control"]';
const STATUS_TTL = 20_000;
let status = { at: 0, data: null };
let card = null;
let anchor = null;
let closeTimer = 0;
let queued = false;

export function startComposer() {
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(sync);
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
  addEventListener("pointermove", e => { for (const f of document.querySelectorAll("[data-amp-tweaks-puck-call] [data-amp-tweaks-puck-face]")) lookAt(f, e.clientX, e.clientY); }, { passive: true });
  refresh().then(sync);
}


function sync() {
  queued = false;
  for (const call of document.querySelectorAll(CALL)) {
    if (call.closest("[data-amp-tweaks-puck-call]")) continue;
    // Only thread composers: in Puck's own chat the button already is Puck.
    const scroller = call.closest("[data-thread-main-pane], [data-pane-id]")?.querySelector("[data-thread-transcript-scroll]");
    if (status.data && scroller?.dataset.threadId === status.data.id) continue;
    const face = puckFace(18);
    if (!face) return;
    call.dataset.ampTweaksPuckCall = "";
    call.prepend(face);
    call.addEventListener("pointerenter", () => open(call));
    call.addEventListener("pointerleave", () => later(close, 200));
  }
  const unread = hasUnread();
  document.querySelectorAll("[data-amp-tweaks-puck-call]").forEach(c => c.toggleAttribute("data-unread", unread));
}

async function refresh(force = false) {
  if (!force && Date.now() - status.at < STATUS_TTL) return status.data;
  try { status = { at: Date.now(), data: await currentPuck() }; } catch (e) { console.warn("[puck]", e.message); }
  return status.data;
}

// ---------- the card ----------
function build() {
  card = document.createElement("div");
  card.dataset.ampTweaksPuckCard = "";
  card.innerHTML = `<div data-who><span data-name></span><span data-when></span></div><div data-msg></div>
    <div data-acts><button type="button" data-talk>Talk <kbd>⌃⇧/</kbd></button><button type="button" data-open></button></div>`;
  card.querySelector("[data-name]").textContent = puckName();
  card.querySelector("[data-open]").textContent = `Open ${puckName()}`;
  card.addEventListener("pointerenter", () => clearTimeout(closeTimer));
  card.addEventListener("pointerleave", () => later(close, 200));
  card.querySelector("[data-talk]").addEventListener("click", () => { close(); pressAmp(document.querySelector(CALL)); });
  card.querySelector("[data-open]").addEventListener("click", () => { close(); if (!openPuckWindow()) go("/puck"); });
  document.body.append(card);
}

async function open(call) {
  clearTimeout(closeTimer);
  if (!card) build();
  anchor = call ?? null;
  wake(anchor?.querySelector("[data-amp-tweaks-puck-face]"), true);
  place();
  card.dataset.open = "";
  card.querySelector("[data-talk]").hidden = !document.querySelector(CALL);
  show(status.data); // what's known now, then the fresh update when it arrives
  show(await refresh());
}

function show(d) {
  card.querySelector("[data-msg]").textContent = d?.working ? "Working…" : d?.status ?? `Ask ${puckName()} anything.`;
  card.querySelector("[data-when]").textContent = d?.at && !d.working ? ago(d.at) : "";
}

// Above your Puck on the message box, or in the bottom-right corner on screens without one.
function place() {
  const r = anchor?.getBoundingClientRect();
  card.style.right = r ? `${Math.max(12, innerWidth - r.right - 8)}px` : "20px";
  card.style.bottom = r ? `${innerHeight - r.top + 8}px` : "20px";
}

function close() {
  wake(anchor?.querySelector("[data-amp-tweaks-puck-face]"), false);
  if (card) delete card.dataset.open;
}

function later(fn, ms) {
  clearTimeout(closeTimer);
  closeTimer = setTimeout(fn, ms);
}

function ago(iso) {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? "now" : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
}
