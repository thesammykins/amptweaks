// Puck on the message box. Amp's own Call Puck button in each thread's composer shows your Puck instead of an
// outline icon (clicking it is still Amp's call). Hovering it shows Puck's latest update and "Ask about this
// thread", which opens Puck with this thread's link in its message box (the way Amp's "Insert Current Thread"
// hands a thread to Puck), so Puck has the context and you type the question.
import { currentPuck, draftToPuck, hasUnread } from "./amp.js";
import { lookAt, puckFace, puckName, wake } from "./face.js";

const CALL = '[data-testid="puck-realtime-voice-control"]';
const STATUS_TTL = 20_000;
let status = { at: 0, data: null };
let card = null;
let hovered = null;
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

const threadId = () => location.pathname.match(/\/threads\/(T-[0-9a-f-]{36})/)?.[1] ?? null;

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
    call.addEventListener("pointerleave", () => later(close));
  }
  document.querySelectorAll("[data-amp-tweaks-puck-call]").forEach(c => c.toggleAttribute("data-unread", hasUnread()));
}

async function refresh() {
  if (Date.now() - status.at < STATUS_TTL) return status.data;
  try { status = { at: Date.now(), data: await currentPuck() }; } catch (e) { console.warn("[puck]", e.message); }
  return status.data;
}

async function open(call) {
  clearTimeout(closeTimer);
  hovered = call;
  wake(call.querySelector("[data-amp-tweaks-puck-face]"), true);
  if (!card) {
    card = document.createElement("div");
    card.dataset.ampTweaksPuckCard = "";
    card.innerHTML = `<div data-who><span data-name></span><span data-when></span></div><div data-msg></div><button type="button" data-ask>Ask about this thread</button><div data-keys><span>Click to call</span><kbd>⌃⇧/</kbd></div>`;
    card.querySelector("[data-name]").textContent = puckName();
    card.addEventListener("pointerenter", () => clearTimeout(closeTimer));
    card.addEventListener("pointerleave", () => later(close));
    card.querySelector("[data-ask]").addEventListener("click", askAboutThread);
    document.body.append(card);
  }
  const r = call.getBoundingClientRect();
  card.style.right = `${Math.max(12, innerWidth - r.right - 8)}px`;
  card.style.bottom = `${innerHeight - r.top + 8}px`;
  card.dataset.open = "";
  card.querySelector("[data-ask]").hidden = !threadId();
  const d = await refresh();
  card.querySelector("[data-msg]").textContent = d?.working ? "Working…" : d?.status ?? `Ask ${puckName()} anything.`;
  card.querySelector("[data-when]").textContent = d?.at && !d.working ? ago(d.at) : "";
}

function close() {
  wake(hovered?.querySelector("[data-amp-tweaks-puck-face]"), false);
  if (card) delete card.dataset.open;
}

function later(fn) {
  clearTimeout(closeTimer);
  closeTimer = setTimeout(fn, 200);
}

async function askAboutThread() {
  const id = threadId();
  if (!id) return;
  close();
  await draftToPuck(`${location.origin}/threads/${id} `);
}

function ago(iso) {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? "now" : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
}
