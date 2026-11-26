// Experimental split: a second thread beside the one you're in. Amp only splits threads inside a Space, so this frames
// Amp inside Amp (same origin; the proxy lets Amp frame itself, and only tweaks.json "frames" tweaks run in it).
// The frame is a whole second Amp, so it costs memory: it's off unless the "split" setting is on.
import { navigate } from "../focus-sidebar/amp/nav.js";
import { hrefOf, onPageChange, TAG, threadIn } from "./amp.js";

const KEY = "amp-tweaks:tabs.split"; // { id, w } of this window's split
const MIN = 320;
let on = false;
let host = null;

export async function startSplit() {
  try {
    const res = await fetch("/__amp-tweaks/settings.json", { cache: "no-store" });
    if (res.ok) on = (await res.json())["thread-tabs"]?.split === "on";
  } catch (e) {
    console.warn(TAG, "settings unavailable; split stays off", e.message);
  }
  addEventListener("amp-tweaks:settings", e => {
    on = e.detail?.["thread-tabs"]?.split === "on";
    if (!on) closeSplit();
  });
  addEventListener("message", e => {
    if (e.origin !== location.origin || !host || e.source !== host.querySelector("iframe").contentWindow) return;
    const { ampTweaksSplit: what, id } = e.data ?? {};
    if (what === "at" && id) save({ id });
    else if (what === "close") closeSplit();
    else if (what === "promote" && id) { closeSplit(); navigate(id, hrefOf(id), {}); }
  });
  const saved = read();
  if (on && saved?.id) openSplit(saved.id);
}

/** Opens `id` in the split (replacing what's there). False when the split is off, so the caller opens a tab instead. */
export function openSplit(id) {
  if (!on || id === threadIn()) return false;
  host ??= makeHost();
  const frame = host.querySelector("iframe");
  if (threadIn(new URL(frame.src || "/", location.href).pathname) !== id) frame.src = hrefOf(id);
  save({ id });
  setWidth(read()?.w ?? Math.round(inset().width * 0.45));
  document.documentElement.setAttribute("data-tt-split-open", "");
  return true;
}

export function closeSplit() {
  document.documentElement.removeAttribute("data-tt-split-open");
  host?.remove();
  host = null;
  sessionStorage.removeItem(KEY);
}

function makeHost() {
  const el = document.createElement("div");
  el.dataset.ttSplit = "";
  el.innerHTML = `<div data-tt-split-handle role="separator" aria-orientation="vertical" aria-label="Resize split"></div><iframe title="Split thread"></iframe>`;
  const handle = el.querySelector("[data-tt-split-handle]");
  handle.addEventListener("pointerdown", e => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    el.setAttribute("data-dragging", "");
    const move = m => setWidth(innerWidth - m.clientX);
    const up = () => {
      el.removeAttribute("data-dragging");
      handle.removeEventListener("pointermove", move);
      save({ w: parseInt(getComputedStyle(document.documentElement).getPropertyValue("--tt-split-w")) });
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("lostpointercapture", up, { once: true });
  });
  document.body.append(el);
  return el;
}

const inset = () => (document.querySelector('[data-slot="sidebar-inset"]') ?? document.body).getBoundingClientRect();

function setWidth(w) {
  const max = Math.max(MIN, inset().width - MIN);
  document.documentElement.style.setProperty("--tt-split-w", `${Math.round(Math.min(max, Math.max(MIN, w)))}px`);
}

function read() {
  try { return JSON.parse(sessionStorage.getItem(KEY)); } catch { return null; }
}

function save(patch) {
  sessionStorage.setItem(KEY, JSON.stringify({ ...read(), ...patch }));
}

// ---------- inside the frame ----------
// The framed Amp hides its sidebar (CSS), tells the window around it which thread it shows, and adds Open here and
// Close to its own tab row.
export function startInFrame() {
  const tell = msg => parent.postMessage({ ampTweaksSplit: msg, id: threadIn() }, location.origin);
  let at = null;
  const sync = () => {
    if (threadIn() !== at) { at = threadIn(); tell("at"); }
    const strip = document.querySelector("[data-agent-pane] [data-pane-tab-strip]") ?? document.querySelector("[data-pane-tab-strip]");
    if (!strip || strip.querySelector(":scope > [data-tt-frame-controls]")) return;
    const c = document.createElement("div");
    c.dataset.ttFrameControls = "";
    c.innerHTML = `<button type="button" data-act="promote" aria-label="Open here" title="Open here"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg></button><button type="button" data-act="close" aria-label="Close split" title="Close split"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>`;
    c.addEventListener("click", e => { const b = e.target.closest("button[data-act]"); if (b) tell(b.dataset.act); });
    strip.append(c);
  };
  onPageChange(sync);
}
