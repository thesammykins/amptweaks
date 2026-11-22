// A Tweaks button in Amp's left rail, above your profile. It opens a menu that turns each tweak on or off,
// writing the same ~/.amp-tweaks/disabled file as `amp-tweaks tweaks disable` (via /__amp-tweaks/act/tweak).
// Style-only tweaks switch in place; a tweak with a script makes Amp reload, as the loader always does for JS.
(() => {
  const TAG = "[tweak-settings]";
  const SELF = "tweak-settings";
  const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M10 5H3"/><path d="M12 19H3"/><path d="M14 3v4"/><path d="M16 17v4"/><path d="M21 12h-9"/><path d="M21 19h-5"/><path d="M21 5h-7"/><path d="M8 10v4"/><path d="M8 12H3"/></svg>';
  const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
  const label = name => name.replace(/\.(js|css)$/, "").replace(/[-_]+/g, " ").replace(/^\w/, c => c.toUpperCase());

  let menu = null;
  let queued = false;

  // ---------- the rail button ----------
  function mount() {
    queued = false;
    const list = document.querySelector('[data-primary-navigation-rail] [data-rail-footer] > [data-sidebar="menu"]');
    const more = document.querySelector("[data-primary-navigation-rail] [data-rail-more-trigger]");
    if (!list || !more || list.querySelector("[data-amp-tweaks-settings]")) return;
    const li = document.createElement("li");
    li.className = more.closest("li")?.className ?? "";
    li.dataset.ampTweaksSettings = "";
    const b = document.createElement("button");
    b.type = "button";
    b.className = more.className; // Amp's own rail button
    b.setAttribute("aria-label", "Tweaks");
    b.setAttribute("aria-haspopup", "menu");
    b.title = "Tweaks";
    const holder = document.createElement("span");
    holder.className = more.firstElementChild?.className ?? "";
    holder.innerHTML = ICON;
    const ref = more.querySelector("svg");
    for (const a of ["class", "width", "height", "stroke-width"]) if (ref?.hasAttribute(a)) holder.firstElementChild.setAttribute(a, ref.getAttribute(a));
    b.append(holder);
    b.addEventListener("click", () => (menu ? close() : open(b)));
    li.append(b);
    list.append(li);
  }

  // ---------- the menu ----------
  async function open(button) {
    let tweaks;
    try {
      const res = await fetch("/__amp-tweaks/tweaks.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      tweaks = (await res.json()).filter(t => t.name !== SELF);
    } catch (e) {
      console.warn(TAG, "couldn't list tweaks", e.message);
      return;
    }
    close();
    menu = document.createElement("div");
    menu.dataset.ampTweaksSettingsMenu = "";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Tweaks");
    menu.innerHTML = `<div data-heading>Tweaks</div>`;
    for (const t of tweaks) {
      const item = document.createElement("button");
      item.type = "button";
      item.setAttribute("role", "menuitemcheckbox");
      item.dataset.name = t.name;
      item.innerHTML = `<span data-check></span><span data-label></span>`;
      item.querySelector("[data-label]").textContent = label(t.name);
      setChecked(item, t.on);
      item.addEventListener("click", () => toggle(item));
      menu.append(item);
    }
    const r = button.getBoundingClientRect();
    menu.style.left = `${r.right + 8}px`;
    menu.style.bottom = `${innerHeight - r.bottom}px`;
    document.body.append(menu);
    button.setAttribute("aria-expanded", "true");
    menu.querySelector("[role=menuitemcheckbox]")?.focus({ preventScroll: true });
  }

  function setChecked(item, on) {
    item.setAttribute("aria-checked", String(on));
    item.querySelector("[data-check]").innerHTML = on ? CHECK : "";
  }

  async function toggle(item) {
    const on = item.getAttribute("aria-checked") !== "true";
    setChecked(item, on);
    try {
      const res = await fetch(`/__amp-tweaks/act/tweak?name=${encodeURIComponent(item.dataset.name)}&on=${on ? 1 : 0}`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    } catch (e) {
      console.warn(TAG, "couldn't switch", item.dataset.name, e.message);
      setChecked(item, !on);
    }
  }

  function close() {
    if (!menu) return;
    const el = menu;
    menu = null;
    document.querySelector("[data-amp-tweaks-settings] button")?.setAttribute("aria-expanded", "false");
    el.dataset.leaving = "";
    setTimeout(() => el.remove(), 150);
  }

  addEventListener("pointerdown", e => {
    if (menu && !e.target.closest?.("[data-amp-tweaks-settings-menu], [data-amp-tweaks-settings]")) close();
  }, true);
  addEventListener("keydown", e => {
    if (!menu) return;
    if (e.key === "Escape") return close();
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = [...menu.querySelectorAll("[role=menuitemcheckbox]")];
    const i = items.indexOf(document.activeElement);
    items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    e.preventDefault();
  });

  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(mount);
  }).observe(document.documentElement, { subtree: true, childList: true });
  mount();
})();
