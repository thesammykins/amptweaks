// Your Puck, copied from Amp's own rail icon, so a custom character (and its eyes) shows exactly as Amp draws it.
// Amp's own classes on the copy keep Amp's styles: is-awake gives its 320ms spring pop.
let n = 0;

/** A copy of Amp's Puck face at `size` px, or null if Amp's rail has none to copy. */
export function puckFace(size) {
  const src = document.querySelector("[data-primary-navigation-rail] [data-puck-trigger] .puck-icon");
  if (!src) return null;
  const face = src.cloneNode(true);
  // SVG ids must stay unique or the copy's clip and gradient point at the rail's.
  const suffix = `-amp-tweaks-${n++}`;
  for (const el of face.querySelectorAll("[id]")) {
    const id = el.id;
    el.id = id + suffix;
    for (const ref of face.querySelectorAll("*")) for (const a of ["clip-path", "fill", "href"]) {
      const v = ref.getAttribute(a);
      if (v?.includes(`#${id})`)) ref.setAttribute(a, v.replace(`#${id})`, `#${id + suffix})`));
    }
  }
  face.removeAttribute("aria-label");
  face.setAttribute("aria-hidden", "true");
  const wrap = document.createElement("span");
  wrap.dataset.ampTweaksPuckFace = "";
  wrap.style.width = wrap.style.height = `${size}px`;
  wrap.append(face);
  return wrap;
}

/** Amp's wake pop on or off. */
export const wake = (wrap, on) => wrap?.querySelector(".puck-icon")?.classList.toggle("is-awake", on);

/** Pupils toward a point on screen, like Amp's rail icon does (a few percent of the face). */
export function lookAt(wrap, x, y) {
  const pupils = wrap?.querySelector(".puck-icon-pupils");
  if (!pupils) return;
  const r = wrap.getBoundingClientRect();
  const dx = x - (r.left + r.width / 2), dy = y - (r.top + r.height * 0.43);
  const d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 160) * 6;
  pupils.style.transform = `translate(${((dx / d) * k).toFixed(2)}%, ${((dy / d) * k).toFixed(2)}%)`;
}

/** The name Amp gives Puck in its rail ("Puck" unless you renamed it). */
export const puckName = () => document.querySelector("[data-puck-trigger]")?.getAttribute("aria-label") || "Puck";
