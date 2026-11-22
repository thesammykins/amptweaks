// When the agent is waiting on you and its question has scrolled out of view, shows the question just above the
// composer. Clicking it scrolls back to where it was asked. Reads Amp's own thread status (/api/threads/:id).
(() => {
  const TAG = "[ask-pin]";
  const threadId = () => location.pathname.match(/\/threads\/(T-[0-9a-f-]{36})/)?.[1] ?? null;
  const scrollerFor = id => id && document.querySelector(`[data-thread-transcript-scroll][data-thread-id="${CSS.escape(id)}"]`);

  let ask = null; // { id, text } while the open thread is waiting on you
  let bar = null;
  let target = null; // the paragraph that asks, in the transcript
  let targetVisible = false;
  let sig = "";
  let timer = 0;
  let queued = false;
  const seen = new IntersectionObserver(entries => {
    for (const e of entries) if (e.target === target) targetVisible = e.isIntersecting;
    render();
  }, { threshold: 0.9 });

  async function check() {
    const id = threadId();
    if (!id) return set(null);
    try {
      const res = await fetch(`/api/threads/${id}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      if (id !== threadId()) return;
      const s = d.meta?.statusMessage;
      set(s?.waitingOnInput && s.text ? { id, text: s.text.trim() } : null);
    } catch (e) {
      console.warn(TAG, "thread status unavailable", e.message);
    }
  }

  function set(next) {
    if (next?.id === ask?.id && next?.text === ask?.text) return render();
    ask = next;
    findTarget();
    render();
  }

  // The last paragraph or list item of the agent's last reply that asks something; else the end of that reply.
  function findTarget() {
    const scroller = ask && scrollerFor(ask.id);
    const replies = scroller?.querySelectorAll('[data-transcript-message-role="assistant"][data-transcript-message-content]');
    const last = replies?.[replies.length - 1];
    const blocks = last ? [...last.querySelectorAll("[data-transcript-markdown] :is(p, li, h1, h2, h3, h4)")] : [];
    const next = blocks.findLast(b => b.textContent.includes("?")) ?? blocks.at(-1) ?? last ?? null;
    if (next === target) return;
    if (target) seen.unobserve(target);
    target = next;
    targetVisible = false;
    if (target) seen.observe(target);
  }

  // You've already answered when your message is the newest thing in the transcript.
  function answered(id) {
    const entries = scrollerFor(id)?.querySelectorAll("[data-transcript-scroll-anchor-key]");
    return !!entries?.[entries.length - 1]?.dataset.transcriptScrollAnchorKey.endsWith(":user");
  }

  function render() {
    const show = !!ask && !targetVisible && threadId() === ask.id && !answered(ask.id);
    if (!show) return hide();
    const overlay = overlayFor(ask.id);
    if (!overlay) return hide();
    if (!bar || !bar.isConnected || bar.parentElement !== overlay) {
      bar?.remove();
      bar = document.createElement("div");
      bar.dataset.ampTweaksAsk = "";
      // floating-control is Amp's own chip surface (the suggested replies use it), so the pill matches them.
      bar.innerHTML = '<button type="button" class="floating-control"><span data-verb>Asks</span><span data-text></span></button>';
      bar.firstChild.addEventListener("click", jump);
      overlay.prepend(bar);
    }
    bar.querySelector("[data-text]").textContent = ask.text;
    bar.firstChild.title = ask.text;
    delete bar.dataset.leaving;
  }

  function hide() {
    if (!bar || bar.dataset.leaving !== undefined) return;
    const el = bar;
    el.dataset.leaving = "";
    const done = () => {
      if (el.dataset.leaving === undefined) return; // shown again before the fade finished
      el.remove();
      if (bar === el) bar = null;
    };
    el.addEventListener("transitionend", done, { once: true });
    setTimeout(done, 400);
  }

  // Amp's floating layer above the composer (suggested replies live there), in the same pane as the transcript.
  function overlayFor(id) {
    let n = scrollerFor(id);
    for (let i = 0; n && i < 5; i++, n = n.parentElement) {
      const o = n.querySelector("[data-transcript-bottom-overlay]");
      if (o) return o;
    }
    return null;
  }

  function jump() {
    if (!target?.isConnected) findTarget();
    if (!target) return;
    target.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    target.dataset.ampTweaksAskFlash = "";
    setTimeout(() => delete target?.dataset.ampTweaksAskFlash, 1600);
  }

  // Re-check Amp's status when the thread, its last message or its working state changes.
  function signature() {
    const id = threadId();
    const scroller = scrollerFor(id);
    const entries = scroller?.querySelectorAll("[data-transcript-scroll-anchor-key]");
    const last = entries?.[entries.length - 1]?.dataset.transcriptScrollAnchorKey ?? "";
    const working = !!document.querySelector("[data-transcript-working-indicator]");
    return `${id}|${last}|${working}`;
  }

  function onChange() {
    queued = false;
    const next = signature();
    if (ask && !target?.isConnected) { findTarget(); render(); }
    else if (ask && bar && !bar.isConnected) render();
    if (next === sig) return;
    const threadChanged = next.split("|")[0] !== sig.split("|")[0];
    sig = next;
    if (threadChanged) set(null);
    clearTimeout(timer);
    timer = setTimeout(check, threadChanged ? 300 : 1200);
  }

  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(onChange);
  }).observe(document.documentElement, { subtree: true, childList: true });
  setInterval(() => { if (!document.hidden && threadId()) check(); }, 60_000);
  onChange();
})();
