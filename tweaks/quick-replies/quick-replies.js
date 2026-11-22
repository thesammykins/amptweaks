// Amp's suggested replies fold into one chip in its quick-action row ("3 replies"). Hovering or clicking the chip
// opens them in full in a menu above it. The replies in that list are Amp's own buttons, moved there by the CSS, so picking
// one is a real click on Amp's button. When the agent is waiting on you, the chip turns amber and the list
// starts with its question; clicking the question scrolls to where it was asked.
(() => {
  const TAG = "[quick-replies]";
  const FULL = /^Reply “([\s\S]+)”$/;
  const CLOSE_MS = 180;

  const threadId = () => location.pathname.match(/\/threads\/(T-[0-9a-f-]{36})/)?.[1] ?? null;
  let ask = null; // { id, text } while the open thread is waiting on you
  let sig = "";
  let statusTimer = 0;
  let closeTimer = 0;
  let queued = false;

  // ---------- the chip and list ----------
  function apply() {
    queued = false;
    for (const scroller of document.querySelectorAll("[data-thread-quick-action-scroller]")) build(scroller);
    watchThread();
  }

  function build(scroller) {
    const row = scroller.closest("[data-thread-quick-action-row]");
    const replies = [...scroller.querySelectorAll("[data-suggested-quick-action]")]
      .map(b => ({ b, text: b.getAttribute("aria-label")?.match(FULL)?.[1] }))
      .filter(r => r.text);
    let chip = scroller.querySelector(":scope > [data-amp-tweaks-qr-chip]");
    let list = row?.querySelector(":scope > [data-amp-tweaks-qr-list]");
    if (!row || !replies.length) {
      chip?.remove();
      list?.remove();
      if (row) delete row.dataset.ampTweaksQr;
      return;
    }
    if (!chip) {
      chip = document.createElement("button");
      chip.type = "button";
      chip.dataset.ampTweaksQrChip = "";
      chip.addEventListener("click", () => setOpen(row, row.dataset.ampTweaksQrOpen === undefined ? "pinned" : null));
      hoverOpens(chip, row);
      scroller.prepend(chip);
    }
    if (!list) {
      list = document.createElement("div");
      list.dataset.ampTweaksQrList = "";
      list.innerHTML = '<button type="button" data-ask><span data-verb>Asks</span><span data-text></span></button>';
      list.querySelector("[data-ask]").addEventListener("click", () => { setOpen(row, null); jump(); });
      hoverOpens(list, row);
      row.append(list);
    }

    // Same classes as Amp's own reply chips, so the chip is one of them to look at.
    const ampChip = replies[0].b.className;
    if (chip.className !== ampChip) chip.className = ampChip;
    const asking = !!ask && ask.id === threadId() && !answered(ask.id);
    const label = `${replies.length} ${replies.length === 1 ? "reply" : "replies"}`;
    if (chip.dataset.label !== label || chip.dataset.asking !== String(asking)) {
      chip.dataset.label = label;
      chip.dataset.asking = String(asking);
      chip.innerHTML = `<span data-icon aria-hidden="true">${asking ? "?" : "↩"}</span><span>${label}</span>`;
      chip.setAttribute("aria-label", asking ? `The agent is asking: ${ask.text}. ${label}` : `Suggested ${label}`);
    }
    list.toggleAttribute("data-asking", asking);
    if (asking) list.querySelector("[data-text]").textContent = ask.text;
    list.style.height = `calc(2 * var(--qr-pad) + ${replies.length + (asking ? 1 : 0)} * var(--qr-row))`;

    row.dataset.ampTweaksQr = "";
    replies.forEach(({ b, text }, i) => {
      if (b.dataset.ampTweaksFull !== text) b.dataset.ampTweaksFull = text;
      const wrap = [...scroller.children].find(c => c.contains(b));
      const slot = String(replies.length - 1 - i); // from the bottom of the list
      if (wrap && wrap.dataset.ampTweaksQrSlot !== slot) wrap.dataset.ampTweaksQrSlot = slot;
      if (b.dataset.ampTweaksQrHover === undefined) { b.dataset.ampTweaksQrHover = ""; hoverOpens(b, row); b.addEventListener("click", () => setOpen(row, null)); }
    });
    document.documentElement.dataset.ampTweaksQuickReplies = "";
  }

  function hoverOpens(el, row) {
    el.addEventListener("pointerenter", () => { clearTimeout(closeTimer); if (row.dataset.ampTweaksQrOpen === undefined) setOpen(row, "hover"); });
    el.addEventListener("pointerleave", () => {
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => { if (row.dataset.ampTweaksQrOpen === "hover") setOpen(row, null); }, CLOSE_MS);
    });
  }

  function setOpen(row, how) {
    if (how) row.dataset.ampTweaksQrOpen = how;
    else delete row.dataset.ampTweaksQrOpen;
  }

  addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    for (const row of document.querySelectorAll("[data-amp-tweaks-qr-open]")) setOpen(row, null);
  });
  addEventListener("pointerdown", e => {
    if (e.target.closest?.("[data-amp-tweaks-qr-chip], [data-amp-tweaks-qr-list], [data-amp-tweaks-qr-slot]")) return;
    for (const row of document.querySelectorAll('[data-amp-tweaks-qr-open="pinned"]')) setOpen(row, null);
  }, true);

  // ---------- is the agent waiting on you? (Amp's thread status) ----------
  const scrollerFor = id => id && document.querySelector(`[data-thread-transcript-scroll][data-thread-id="${CSS.escape(id)}"]`);

  function watchThread() {
    const id = threadId();
    const entries = scrollerFor(id)?.querySelectorAll("[data-transcript-scroll-anchor-key]");
    const last = entries?.[entries.length - 1]?.dataset.transcriptScrollAnchorKey ?? "";
    const next = `${id}|${last}|${!!document.querySelector("[data-transcript-working-indicator]")}`;
    if (next === sig) return;
    const threadChanged = next.split("|")[0] !== sig.split("|")[0];
    sig = next;
    if (threadChanged) ask = null;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(checkStatus, threadChanged ? 300 : 1200);
  }

  async function checkStatus() {
    const id = threadId();
    if (!id) return;
    try {
      const res = await fetch(`/api/threads/${id}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const s = (await res.json()).meta?.statusMessage;
      if (id !== threadId()) return;
      ask = s?.waitingOnInput && s.text ? { id, text: s.text.trim() } : null;
      schedule();
    } catch (e) {
      console.warn(TAG, "thread status unavailable", e.message);
    }
  }

  // You've already answered when your message is the newest thing in the transcript.
  function answered(id) {
    const entries = scrollerFor(id)?.querySelectorAll("[data-transcript-scroll-anchor-key]");
    return !!entries?.[entries.length - 1]?.dataset.transcriptScrollAnchorKey.endsWith(":user");
  }

  // To the last paragraph of the agent's last reply that asks something, briefly marked.
  function jump() {
    const replies = scrollerFor(threadId())?.querySelectorAll('[data-transcript-message-role="assistant"][data-transcript-message-content]');
    const last = replies?.[replies.length - 1];
    if (!last) return;
    const blocks = [...last.querySelectorAll("[data-transcript-markdown] :is(p, li, h1, h2, h3, h4)")];
    const target = blocks.findLast(b => b.textContent.includes("?")) ?? blocks.at(-1) ?? last;
    target.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    target.dataset.ampTweaksQrFlash = "";
    setTimeout(() => delete target.dataset.ampTweaksQrFlash, 1600);
  }

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(apply);
  }
  new MutationObserver(schedule).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-label"] });
  setInterval(() => { if (!document.hidden && threadId()) checkStatus(); }, 60_000);
  schedule();
})();
