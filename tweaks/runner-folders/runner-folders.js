// When Amp can't resume a thread because this Mac's runner doesn't serve its folder ("Runner does not serve
// directory /Users/…/Development (runner-id)"), adds a button under Amp's message that serves that folder
// (`amp runner dirs add`, through /__amp-tweaks/act/serve). Only for runners on this Mac and folders they don't
// already serve; for anything else Amp's message stands as it is.
(() => {
  const TAG = "[runner-folders]";
  const PHRASE = "does not serve directory";
  const MISSING = /Runner does not serve directory (\/\S+) \(([\w.-]+)\)/;
  let local = null; // { runner id: [folders] }, from the proxy
  let queued = false;

  async function runners() {
    if (local) return local;
    try {
      const res = await fetch("/__amp-tweaks/runners.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      local = await res.json();
    } catch (e) {
      console.warn(TAG, "couldn't list this Mac's runners", e.message);
      local = {};
    }
    return local;
  }

  const home = p => p.replace(/^\/Users\/[^/]+/, "~");

  async function scan() {
    queued = false;
    // The element holding Amp's message (found through its text node), so the button sits right under it.
    const hits = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: n => (n.data.includes(PHRASE) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP) });
    for (let n; (n = walk.nextNode());) if (n.parentElement && MISSING.test(n.parentElement.textContent)) hits.push(n.parentElement);
    if (!hits.length) return;
    const served = await runners();
    for (const msg of hits) {
      const [, dir, runner] = msg.textContent.match(MISSING);
      if (!served[runner] || served[runner].includes(dir) || msg.parentElement.querySelector("[data-amp-tweaks-serve]")) continue;
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.ampTweaksServe = "";
      b.textContent = `Serve ${home(dir)} on this Mac`;
      b.addEventListener("click", () => serve(b, runner, dir));
      msg.after(b);
    }
  }

  async function serve(b, runner, dir) {
    b.disabled = true;
    try {
      const res = await fetch(`/__amp-tweaks/act/serve?runner=${encodeURIComponent(runner)}&dir=${encodeURIComponent(dir)}`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      local = null;
      b.textContent = `Now serving ${home(dir)}`;
    } catch (e) {
      console.warn(TAG, "couldn't serve", dir, e.message);
      b.textContent = `Couldn't serve ${home(dir)}: ${e.message}`;
      b.disabled = false;
    }
  }

  // Only look again when a change brings Amp's message in; Amp streams a lot of other text.
  const mentions = n => (n.nodeType === Node.TEXT_NODE ? n.data : n.textContent ?? "").includes(PHRASE);
  new MutationObserver(records => {
    if (queued || !records.some(r => (r.type === "characterData" ? mentions(r.target) : [...r.addedNodes].some(mentions)))) return;
    queued = true;
    setTimeout(scan, 300);
  }).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  scan();
})();
