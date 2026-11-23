// This tweak's options from the Tweaks menu (tweak.json "options", saved in ~/.amp-tweaks/settings.json).
// presence: quiet (Puck on the message box only), present (+ Puck first in New Thread, and Puck says when it has
// something new), everywhere (+ a once-a-day hello when Amp opens).
const LEVELS = ["quiet", "present", "everywhere"];
let presence = "present";
const listeners = new Set();

export async function loadSettings() {
  try {
    const res = await fetch("/__amp-tweaks/settings.json", { cache: "no-store" });
    if (res.ok) presence = (await res.json()).puck?.presence ?? presence;
  } catch (e) {
    console.warn("[puck] settings unavailable, using Present", e.message);
  }
  addEventListener("amp-tweaks:settings", e => {
    const next = e.detail?.puck?.presence;
    if (next && next !== presence) { presence = next; listeners.forEach(fn => fn(presence)); }
  });
}

/** True when the chosen presence is at least `level`. */
export const atLeast = level => LEVELS.indexOf(presence) >= LEVELS.indexOf(level);
export const onPresenceChange = fn => listeners.add(fn);
