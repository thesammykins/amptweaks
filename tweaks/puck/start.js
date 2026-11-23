// Puck first in Amp's new-thread popup (⌘N), from Present up: a Puck · Thread switch in its top bar. On Puck, the prompt asks what
// you're working on, the thread pickers step aside (Puck decides where work runs), and ↵ or Create hands your
// text to Puck as a draft in its chat. On Thread, the popup is Amp's own. The choice is remembered.
import { draftToPuck, pressAmp, setValue } from "./amp.js";
import { puckFace, puckName, wake } from "./face.js";
import { atLeast } from "./settings.js";

const MODE_KEY = "amp-tweaks:puck:start-mode";
const PALETTE = "[data-command-palette-content]";
let queued = false;

const savedMode = () => { try { return localStorage.getItem(MODE_KEY) ?? "puck"; } catch { return "puck"; } };
const saveMode = m => { try { localStorage.setItem(MODE_KEY, m); } catch {} };

export function startPalette() {
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(attach);
  }).observe(document.documentElement, { subtree: true, childList: true });
  // Capture phase, ahead of Amp's own handlers, and only while the popup is in Puck mode.
  addEventListener("keydown", onKey, true);
  addEventListener("click", onCreate, true);
}

// Only the new-thread popup has thread pickers; the command palette shares the same frame.
const newThreadPopup = () => [...document.querySelectorAll(PALETTE)].find(p => p.querySelector("[data-create-thread-picker-toggle]"));

function attach() {
  queued = false;
  const popup = newThreadPopup();
  if (!popup || popup.querySelector("[data-amp-tweaks-puck-switch]") || !atLeast("present")) return; // Quiet: Amp's own popup
  const bar = popup.querySelector("[data-dialog-drag-region]");
  const face = puckFace(14);
  if (!bar || !face) return;
  const sw = document.createElement("div");
  sw.dataset.ampTweaksPuckSwitch = "";
  sw.setAttribute("role", "radiogroup");
  sw.setAttribute("aria-label", "Start with");
  sw.innerHTML = `<span data-thumb></span><button type="button" role="radio" data-mode="puck"><span data-name></span></button><button type="button" role="radio" data-mode="thread">Thread</button>`;
  sw.querySelector("[data-name]").textContent = puckName();
  sw.querySelector('[data-mode="puck"]').prepend(face);
  sw.addEventListener("click", e => { const b = e.target.closest("[data-mode]"); if (b) setMode(popup, b.dataset.mode, true); });
  const dismiss = bar.querySelector("[data-palette-dismiss-button]");
  (dismiss?.parentElement ?? bar).insertBefore(sw, dismiss?.nextSibling ?? bar.firstChild);
  setMode(popup, savedMode(), false);
}

function setMode(popup, mode, chosen) {
  const sw = popup.querySelector("[data-amp-tweaks-puck-switch]");
  for (const b of sw.querySelectorAll("[data-mode]")) b.setAttribute("aria-checked", String(b.dataset.mode === mode));
  const on = sw.querySelector(`[data-mode="${mode}"]`);
  const thumb = sw.querySelector("[data-thumb]");
  thumb.style.left = `${on.offsetLeft}px`;
  thumb.style.width = `${on.offsetWidth}px`;
  popup.toggleAttribute("data-amp-tweaks-puck-mode", mode === "puck");
  const box = popup.querySelector("textarea[data-amp-prompt-input]");
  if (box) {
    box.dataset.ampTweaksPlaceholder ??= box.placeholder;
    box.placeholder = mode === "puck" ? "What are we working on?" : box.dataset.ampTweaksPlaceholder;
    if (chosen) box.focus();
  }
  if (chosen) {
    saveMode(mode);
    if (mode === "puck") { const f = sw.querySelector("[data-amp-tweaks-puck-face]"); wake(f, true); setTimeout(() => wake(f, false), 650); }
  }
}

function inPuckMode(target) {
  const popup = target?.closest?.(PALETTE);
  return popup?.hasAttribute("data-amp-tweaks-puck-mode") ? popup : null;
}

function onKey(e) {
  if (e.key !== "Enter" || e.shiftKey || e.isComposing || !e.target.matches?.("textarea[data-amp-prompt-input]")) return;
  const popup = inPuckMode(e.target);
  if (!popup) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  handOff(popup);
}

function onCreate(e) {
  const create = e.target.closest?.('[aria-label="Create Thread"]');
  const popup = create && inPuckMode(create);
  if (!popup) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  handOff(popup);
}

// Close Amp's popup with its own Close button, then draft to Puck.
async function handOff(popup) {
  const box = popup.querySelector("textarea[data-amp-prompt-input]");
  const text = box?.value.trim();
  if (!text) return;
  setValue(box, "");
  pressAmp(popup.querySelector("[data-palette-dismiss-button]"));
  await draftToPuck(text);
}

