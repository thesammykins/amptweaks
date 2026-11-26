// Amp adapter (navigation): opening a thread the way Amp's own sidebar row does, warming it first, and its menu.
// No other imports, so other tweaks (thread-tabs) can use it without loading the focus sidebar.

export const ampRow = id => document.querySelector(`a[data-sidebar-thread-id="${CSS.escape(id)}"]`);

// Navigation goes through Amp's own row so Space threads open in their Space (their href alone 500s).
// Threads outside Amp's list go through a throwaway link so SvelteKit's router still handles them.
export function navigate(id, href, e) {
  const mods = { metaKey: !!e.metaKey, ctrlKey: !!e.ctrlKey, shiftKey: !!e.shiftKey, altKey: !!e.altKey };
  let a = ampRow(id);
  let temp = null;
  if (!a) {
    temp = a = Object.assign(document.createElement("a"), { href });
    a.hidden = true;
    document.body.appendChild(a);
  }
  a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window, button: 0, ...mods }));
  temp?.remove();
}

// Amp's sidebar fetches a thread's data while you hover it (SvelteKit's hover preload), so the click only renders.
// Our rows aren't links, so hand the hover to Amp's row: SvelteKit preloads 20ms after a mouseover on a link
// (and skips rows Amp marks data-sveltekit-preload-data="false").
export function preload(id) {
  ampRow(id)?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, view: window }));
}

// Amp's own menu for a thread (archive, rename, share…): the right-click on its sidebar row, at (x, y).
export async function openAmpMenu(id, x, y) {
  const row = ampRow(id);
  const target = row?.querySelector("[data-title-text]") ?? row;
  if (!target) return false;
  const o = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, screenX: x, screenY: y, button: 2, buttons: 2 };
  target.dispatchEvent(new PointerEvent("pointerdown", { ...o, pointerType: "mouse", pointerId: 1, isPrimary: true }));
  await new Promise(r => requestAnimationFrame(r));
  target.dispatchEvent(new MouseEvent("mousedown", o));
  target.dispatchEvent(new MouseEvent("contextmenu", o));
  return !!document.querySelector('[role="menu"]');
}
