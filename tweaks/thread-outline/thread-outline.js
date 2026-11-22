// A slim outline to the right of long threads: each thing you asked, and the headings of each answer.
// Clicking scrolls there; the part you're reading is highlighted. Shows only when the thread is long and
// there's room beside Amp's transcript column.
(() => {
  const MIN_ITEMS = 4;
  const WIDTH = 13.5; // rem, matches thread-outline.css
  const outlines = new Map(); // scroller -> { nav, items, sig, raf }
  let queued = false;

  const rem = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const oneLine = s => s.replace(/\s+/g, " ").trim();

  function read(scroller) {
    const items = [];
    for (const entry of scroller.querySelectorAll("[data-transcript-scroll-anchor-key]")) {
      const key = entry.dataset.transcriptScrollAnchorKey;
      if (key.endsWith(":user")) {
        const text = oneLine(entry.querySelector("[data-transcript-user-message-content]")?.textContent ?? "");
        if (text) items.push({ el: entry, kind: "ask", text });
      } else if (key.endsWith(":assistant")) {
        for (const h of entry.querySelectorAll("[data-transcript-markdown] :is(h1, h2, h3)")) {
          const text = oneLine(h.textContent);
          if (text) items.push({ el: h, kind: "head", text });
        }
      }
    }
    return items;
  }

  // The pane that holds the transcript and Amp's bottom overlay; the outline is positioned inside it.
  function host(scroller) {
    let n = scroller;
    for (let i = 0; n && i < 5; i++, n = n.parentElement) if (n.querySelector("[data-transcript-bottom-overlay]")) return n;
    return scroller.parentElement;
  }

  function fits(scroller) {
    const w = scroller.clientWidth;
    const column = (parseFloat(getComputedStyle(scroller).getPropertyValue("--thread-column-max-width")) || 42) * rem();
    return (w - Math.min(w, column)) / 2 >= (WIDTH + 1.5) * rem();
  }

  function update(scroller) {
    let o = outlines.get(scroller);
    const items = read(scroller);
    const show = items.filter(i => i.kind === "ask").length >= 2 && items.length >= MIN_ITEMS && fits(scroller);
    if (!show) {
      if (o) o.nav.dataset.hidden = "";
      return;
    }
    if (!o || !o.nav.isConnected) {
      o?.nav.remove();
      o?.rail.remove();
      const nav = document.createElement("nav");
      nav.dataset.ampTweaksOutline = "";
      nav.setAttribute("aria-label", "Thread outline");
      nav.addEventListener("click", e => {
        const btn = e.target.closest("[data-i]");
        const item = btn && outlines.get(scroller)?.items[+btn.dataset.i];
        if (!item?.el.isConnected) return;
        item.el.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      });
      // While an image is level with the outline it tucks away to the right; this strip along the edge
      // (wider than the line it shows) brings it back on hover.
      const rail = document.createElement("div");
      rail.dataset.ampTweaksOutlineRail = "";
      rail.setAttribute("aria-hidden", "true");
      host(scroller).append(nav, rail);
      o = { nav, rail, items: [], sig: "", raf: 0, closeTimer: 0 };
      peekOn(o, rail);
      peekOn(o, nav);
      outlines.set(scroller, o);
      scroller.addEventListener("scroll", () => {
        if (o.raf) return;
        o.raf = requestAnimationFrame(() => { o.raf = 0; mark(scroller); });
      }, { passive: true });
    }
    delete o.nav.dataset.hidden;
    const sig = items.map(i => `${i.kind}:${i.text}`).join("\n");
    o.items = items;
    if (sig !== o.sig) {
      o.sig = sig;
      // One section per ask; its answer's headings sit in a fold that opens while you're reading that section.
      const sections = [];
      items.forEach((item, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.dataset.i = i;
        b.dataset.kind = item.kind;
        b.textContent = item.text;
        b.title = item.text;
        if (item.kind === "ask" || !sections.length) {
          const sec = document.createElement("div");
          sec.dataset.section = "";
          const fold = document.createElement("div");
          fold.dataset.fold = "";
          fold.append(document.createElement("div"));
          sec.append(fold);
          sections.push(sec);
        }
        const sec = sections.at(-1);
        if (item.kind === "ask") sec.prepend(b);
        else sec.querySelector("[data-fold] > div").append(b);
      });
      o.nav.replaceChildren(...sections);
    }
    mark(scroller);
  }

  // Steps aside while an image or gallery is level with it, so it never competes with a picture.
  function covered(scroller, nav) {
    const r = nav.getBoundingClientRect();
    for (const m of scroller.querySelectorAll("[data-transcript-gallery], [data-transcript-markdown] img, [data-transcript-message-content] img")) {
      const b = m.getBoundingClientRect();
      if (b.width && b.bottom > r.top && b.top < r.bottom) return true;
    }
    return false;
  }

  // Hovering the rail or the peeking outline keeps it out; leaving both tucks it away after a short grace
  // period, so moving from the rail onto the outline as it slides out doesn't snap it shut.
  function peekOn(o, el) {
    el.addEventListener("pointerenter", () => {
      clearTimeout(o.closeTimer);
      if (o.nav.hasAttribute("data-covered")) o.nav.dataset.peek = "";
    });
    el.addEventListener("pointerleave", () => {
      clearTimeout(o.closeTimer);
      o.closeTimer = setTimeout(() => delete o.nav.dataset.peek, 260);
    });
  }

  // The last item whose top has scrolled past a quarter of the way down the transcript.
  function mark(scroller) {
    const o = outlines.get(scroller);
    if (!o || o.nav.dataset.hidden !== undefined) return;
    const isCovered = covered(scroller, o.nav);
    o.nav.toggleAttribute("data-covered", isCovered);
    o.rail.toggleAttribute("data-show", isCovered);
    if (!isCovered) delete o.nav.dataset.peek;
    o.rail.style.top = `${o.nav.offsetTop}px`;
    o.rail.style.height = `${o.nav.offsetHeight}px`;
    const box = scroller.getBoundingClientRect();
    const line = box.top + box.height * 0.25;
    let active = 0;
    o.items.forEach((item, i) => { if (item.el.isConnected && item.el.getBoundingClientRect().top <= line) active = i; });
    const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4;
    if (atEnd) active = o.items.length - 1;
    let current = null;
    for (const b of o.nav.querySelectorAll("button")) {
      const on = +b.dataset.i === active;
      b.toggleAttribute("data-active", on);
      if (on) current = b.closest("[data-section]");
    }
    for (const sec of o.nav.children) sec.toggleAttribute("data-open", sec === current);
    const head = current?.firstElementChild;
    if (head && (head.offsetTop < o.nav.scrollTop || head.offsetTop + head.offsetHeight > o.nav.scrollTop + o.nav.clientHeight)) {
      o.nav.scrollTo({ top: head.offsetTop - o.nav.clientHeight / 3, behavior: "smooth" });
    }
  }

  function sweep() {
    queued = false;
    for (const [scroller, o] of outlines) if (!scroller.isConnected) { o.nav.remove(); o.rail.remove(); outlines.delete(scroller); }
    for (const scroller of document.querySelectorAll("[data-thread-transcript-scroll]")) update(scroller);
  }

  const schedule = () => {
    if (queued) return;
    queued = true;
    setTimeout(() => requestAnimationFrame(sweep), 400);
  };
  new MutationObserver(schedule).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  addEventListener("resize", schedule);
  schedule();
})();
