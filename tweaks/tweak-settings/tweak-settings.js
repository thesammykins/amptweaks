// A Tweaks button in Amp's left rail, above your profile. Its menu turns each tweak on or off (the same
// ~/.amp-tweaks/disabled file as `amp-tweaks tweaks disable`), grouped by what a tweak needs: Amp alone, or this
// Mac (the proxy or the amp CLI). "What's new" opens the changelog as a card like Amp's own news card.
// Style-only tweaks switch in place; a tweak with a script makes Amp reload, as the loader always does for JS.
(() => {
  const TAG = "[tweak-settings]";
  const SELF = "tweak-settings";
  const SEEN_KEY = "amp-tweaks:changes-seen";
  const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M10 5H3"/><path d="M12 19H3"/><path d="M14 3v4"/><path d="M16 17v4"/><path d="M21 12h-9"/><path d="M21 19h-5"/><path d="M21 5h-7"/><path d="M8 10v4"/><path d="M8 12H3"/></svg>';
  const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
  const CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  // Where a tweak works: Amp's web app alone, or something on this Mac (the proxy or the amp CLI).
  const NEEDS = {
    amp: { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/></svg>', text: "Works in Amp" },
    "this-mac": { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/></svg>', text: "Uses this Mac" },
  };
  const needsOf = t => (t?.needs === "this-mac" ? "this-mac" : "amp");
  const label = t => t.title ?? t.name.replace(/\.(js|css)$/, "").replace(/[-_]+/g, " ").replace(/^\w/, c => c.toUpperCase());

  let menu = null;
  let card = null;
  let changes = [];
  let queued = false;

  // ---------- seen changes (per browser; losing them only means the card shows again) ----------
  const seen = () => { try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]")); } catch { return new Set(); } };
  const markSeen = ids => { try { localStorage.setItem(SEEN_KEY, JSON.stringify([...new Set([...seen(), ...ids])])); } catch {} };
  const unseen = () => { const s = seen(); return changes.filter(c => !s.has(c.id)); };

  async function loadChanges() {
    try {
      const res = await fetch("/__amp-tweaks/changes.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      changes = await res.json();
    } catch (e) {
      console.warn(TAG, "couldn't load what's new", e.message);
    }
    mount();
    if (unseen().length) showCard(changes.indexOf(unseen()[0]));
  }

  async function listTweaks() {
    const res = await fetch("/__amp-tweaks/tweaks.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function loadSettings() {
    const res = await fetch("/__amp-tweaks/settings.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // A tweak with options in its tweak.json gets a small switch under its name; the change is saved through the
  // proxy (~/.amp-tweaks/settings.json) and announced on window as "amp-tweaks:settings" so the tweak applies it now.
  function optionRows(t, values) {
    return Object.entries(t.options ?? {}).map(([key, opt]) => {
      const row = document.createElement("div");
      row.dataset.option = key;
      row.setAttribute("role", "radiogroup");
      row.setAttribute("aria-label", `${label(t)} ${opt.label ?? key}`);
      for (const [value, text] of opt.choices ?? []) {
        const b = document.createElement("button");
        b.type = "button";
        b.setAttribute("role", "radio");
        b.setAttribute("aria-checked", String(values?.[key] === value));
        b.textContent = text;
        b.addEventListener("click", async () => {
          try {
            const res = await fetch(`/__amp-tweaks/act/setting?tweak=${encodeURIComponent(t.name)}&key=${encodeURIComponent(key)}&value=${encodeURIComponent(value)}`, { method: "POST" });
            if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
            for (const x of row.children) x.setAttribute("aria-checked", String(x === b));
            dispatchEvent(new CustomEvent("amp-tweaks:settings", { detail: await res.json() }));
          } catch (e) { console.warn(TAG, "couldn't save", t.name, key, e.message); }
        });
        row.append(b);
      }
      return row;
    });
  }

  async function setTweak(name, on) {
    const res = await fetch(`/__amp-tweaks/act/tweak?name=${encodeURIComponent(name)}&on=${on ? 1 : 0}`, { method: "POST" });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }

  // ---------- the rail button ----------
  function mount() {
    queued = false;
    const list = document.querySelector('[data-primary-navigation-rail] [data-rail-footer] > [data-sidebar="menu"]');
    const more = document.querySelector("[data-primary-navigation-rail] [data-rail-more-trigger]");
    let li = list?.querySelector("[data-amp-tweaks-settings]");
    if (list && more && !li) {
      li = document.createElement("li");
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
      holder.innerHTML = `${ICON}<span data-dot></span>`;
      const ref = more.querySelector("svg");
      for (const a of ["class", "width", "height", "stroke-width"]) if (ref?.hasAttribute(a)) holder.firstElementChild.setAttribute(a, ref.getAttribute(a));
      b.append(holder);
      b.addEventListener("click", () => (menu ? closeMenu() : openMenu(b)));
      li.append(b);
      list.append(li);
    }
    li?.toggleAttribute("data-unread", unseen().length > 0);
  }

  // ---------- the menu ----------
  async function openMenu(button) {
    let tweaks, settings = {};
    try {
      [tweaks, settings] = await Promise.all([listTweaks().then(l => l.filter(t => t.name !== SELF)), loadSettings().catch(() => ({}))]);
    } catch (e) {
      console.warn(TAG, "couldn't list tweaks", e.message);
      return;
    }
    closeMenu();
    closeCard();
    menu = document.createElement("div");
    menu.dataset.ampTweaksSettingsMenu = "";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Tweaks");
    if (changes.length) {
      const news = item("menuitem", "What's new");
      news.dataset.news = "";
      news.toggleAttribute("data-unread", unseen().length > 0);
      news.addEventListener("click", () => { closeMenu(); showCard(Math.max(0, changes.indexOf(unseen()[0] ?? changes[0]))); });
      const sep = document.createElement("div");
      sep.setAttribute("role", "separator");
      menu.append(news, sep);
    }
    for (const [needs, { icon, text }] of Object.entries(NEEDS)) {
      const group = tweaks.filter(t => needsOf(t) === needs);
      if (!group.length) continue;
      const h = document.createElement("div");
      h.dataset.heading = "";
      h.innerHTML = `<span data-needs>${icon}</span><span></span>`;
      h.lastChild.textContent = text;
      menu.append(h);
      for (const t of group) {
        const it = item("menuitemcheckbox", label(t));
        it.dataset.name = t.name;
        it.title = [t.summary, t.why].filter(Boolean).join(" ");
        setChecked(it, t.on);
        it.addEventListener("click", () => toggle(it));
        menu.append(it);
        if (t.on) menu.append(...optionRows(t, settings[t.name]));
      }
    }
    const r = button.getBoundingClientRect();
    menu.style.left = `${r.right + 8}px`;
    menu.style.bottom = `${innerHeight - r.bottom}px`;
    document.body.append(menu);
    button.setAttribute("aria-expanded", "true");
    menu.querySelector("button")?.focus({ preventScroll: true });
  }

  function item(role, text) {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", role);
    b.innerHTML = `<span data-check></span><span data-label></span>`;
    b.querySelector("[data-label]").textContent = text;
    return b;
  }

  function setChecked(it, on) {
    it.setAttribute("aria-checked", String(on));
    it.querySelector("[data-check]").innerHTML = on ? CHECK : "";
  }

  async function toggle(it) {
    const on = it.getAttribute("aria-checked") !== "true";
    setChecked(it, on);
    try {
      await setTweak(it.dataset.name, on);
    } catch (e) {
      console.warn(TAG, "couldn't switch", it.dataset.name, e.message);
      setChecked(it, !on);
    }
  }

  function closeMenu() {
    if (!menu) return;
    const el = menu;
    menu = null;
    document.querySelector("[data-amp-tweaks-settings] button")?.setAttribute("aria-expanded", "false");
    el.dataset.leaving = "";
    setTimeout(() => el.remove(), 150);
  }

  // ---------- what's new: one change at a time, like Amp's news card ----------
  async function showCard(i) {
    const c = changes[i];
    if (!c) return;
    const tweaks = c.tweak ? await listTweaks().catch(() => []) : [];
    const t = tweaks.find(x => x.name === c.tweak);
    const rail = document.querySelector("[data-primary-navigation-rail]")?.getBoundingClientRect();
    if (!card) {
      card = document.createElement("section");
      card.dataset.ampTweaksNews = "";
      card.setAttribute("aria-label", "What's new in Amp Tweaks");
      card.innerHTML = `<header><span data-eyebrow></span><span data-needs></span><button type="button" data-close aria-label="Close">${CLOSE}</button></header><h3 data-title></h3><p data-body></p><footer><button type="button" data-state></button><span data-nav><button type="button" data-prev aria-label="Newer">‹</button><span data-count></span><button type="button" data-next aria-label="Older">›</button></span></footer>`;
      card.querySelector("[data-close]").addEventListener("click", closeCard);
      card.querySelector("[data-prev]").addEventListener("click", () => showCard(+card.dataset.i - 1));
      card.querySelector("[data-next]").addEventListener("click", () => showCard(+card.dataset.i + 1));
      document.body.append(card);
    }
    card.dataset.i = i;
    card.style.left = `${(rail?.right ?? 56) + 10}px`;
    const date = new Date(`${c.date}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
    card.querySelector("[data-eyebrow]").textContent = `Amp Tweaks · ${date}`;
    card.querySelector("[data-title]").textContent = c.title;
    card.querySelector("[data-body]").textContent = c.body;
    card.querySelector("[data-count]").textContent = `${i + 1} of ${changes.length}`;
    card.querySelector("[data-prev]").disabled = i === 0;
    card.querySelector("[data-next]").disabled = i === changes.length - 1;
    const needs = card.querySelector("[data-needs]");
    const where = NEEDS[needsOf(t)];
    needs.innerHTML = where.icon;
    needs.title = [where.text, t?.why].filter(Boolean).join(". ");
    needs.setAttribute("aria-label", needs.title);
    // The button slot keeps its space when empty, so the arrows never move.
    const state = card.querySelector("[data-state]");
    state.toggleAttribute("data-empty", !t || c.tweak === SELF);
    if (t) {
      state.textContent = t.on ? "On" : `Turn on ${label(t)}`;
      state.disabled = t.on;
      state.onclick = async () => {
        state.disabled = true;
        try { await setTweak(t.name, true); state.textContent = "On"; } catch (e) { console.warn(TAG, e.message); state.disabled = false; }
      };
    }
    markSeen([c.id]);
    mount();
  }

  function closeCard() {
    if (!card) return;
    const el = card;
    card = null;
    markSeen(changes.map(c => c.id));
    mount();
    el.dataset.leaving = "";
    setTimeout(() => el.remove(), 240);
  }

  addEventListener("pointerdown", e => {
    if (menu && !e.target.closest?.("[data-amp-tweaks-settings-menu], [data-amp-tweaks-settings]")) closeMenu();
  }, true);
  addEventListener("keydown", e => {
    if (e.key === "Escape") { if (menu) return closeMenu(); if (card) return closeCard(); }
    if (!menu || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
    const items = [...menu.querySelectorAll("button")];
    const i = items.indexOf(document.activeElement);
    items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    e.preventDefault();
  });

  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(mount);
  }).observe(document.documentElement, { subtree: true, childList: true });
  loadChanges();
})();
