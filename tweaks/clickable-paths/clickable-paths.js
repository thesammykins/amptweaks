// File paths and commit hashes in Amp's replies become links. A path opens in your editor (⌥-click shows it in
// Finder); a commit opens on GitHub. Only paths that exist on this Mac are marked, so threads that ran in an orb
// or on another machine stay as they are. The proxy does the opening (/__amp-tweaks/act/open).
(() => {
  const TAG = "[clickable-paths]";
  const PATH = /^(~\/|\/|\.{1,2}\/)?[\w@.+-]+(\/[\w@.+-]+)*\/?$/;
  const SUFFIX = /(:\d+(:\d+)?|#L\d+(-L?\d+)?)$/;
  const SHA = /^[0-9a-f]{7,40}$/;
  const roots = new Map(); // thread id -> Promise<{ root, repo }>
  let queued = false;

  const threadOf = el => el.closest("[data-thread-transcript-scroll]")?.dataset.threadId ?? null;

  function threadInfo(id) {
    if (!roots.has(id)) roots.set(id, (async () => {
      try {
        const res = await fetch(`/api/threads/${id}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const env = (await res.json()).env?.initial ?? {};
        const tree = env.trees?.[0] ?? {};
        const uri = tree.uri ?? env.workingDirectory ?? "";
        const repo = tree.repository?.url?.match(/github\.com[/:]([\w.-]+\/[\w.-]+?)(\.git)?$/)?.[1] ?? null;
        return { root: uri.startsWith("file://") ? decodeURIComponent(uri.slice(7)) : null, repo };
      } catch (e) {
        console.warn(TAG, "thread info unavailable", id, e.message);
        roots.delete(id);
        return { root: null, repo: null };
      }
    })());
    return roots.get(id);
  }

  const candidate = text => {
    const t = text.trim().replace(SUFFIX, "");
    if (SHA.test(t) && /\d/.test(t) && /[a-f]/.test(t)) return { kind: "commit", value: t };
    if (t.length < 3 || t.length > 300 || /^\d[\d.]*$/.test(t) || !PATH.test(t)) return null;
    if (!t.includes("/") && !/\.\w{1,10}$/.test(t)) return null;
    return { kind: "path", value: t };
  };

  // Each inline code is checked once per text, so a path still streaming in is checked again when it's complete.
  function scan() {
    queued = false;
    const byThread = new Map();
    for (const code of document.querySelectorAll("[data-transcript-markdown] code")) {
      if (code.dataset.ampTweaksRefSeen === code.textContent) continue;
      code.dataset.ampTweaksRefSeen = code.textContent;
      if (code.closest("pre, a, button")) continue;
      const c = candidate(code.textContent);
      const id = c && threadOf(code);
      if (!id) continue;
      if (!byThread.has(id)) byThread.set(id, []);
      byThread.get(id).push({ code, ...c });
    }
    for (const [id, refs] of byThread) mark(id, refs);
  }

  async function mark(id, refs) {
    const { root, repo } = await threadInfo(id);
    for (const r of refs) if (r.kind === "commit" && repo) {
      r.code.dataset.ampTweaksRef = "commit";
      r.code.dataset.ampTweaksUrl = `https://github.com/${repo}/commit/${r.value}`;
      r.code.title = "Open commit on GitHub";
    }
    const paths = [...new Set(refs.filter(r => r.kind === "path").map(r => r.value))];
    if (!paths.length) return;
    try {
      const res = await fetch("/__amp-tweaks/act/refs", { method: "POST", body: JSON.stringify({ root, paths }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const found = await res.json();
      for (const r of refs) {
        const hit = r.kind === "path" && found[r.value];
        if (!hit) continue;
        r.code.dataset.ampTweaksRef = hit.dir ? "dir" : "file";
        r.code.dataset.ampTweaksPath = hit.path;
        r.code.title = hit.dir ? "Show in Finder" : "Open in editor · ⌥-click to show in Finder";
      }
    } catch (e) {
      console.warn(TAG, "couldn't check paths", e.message);
    }
  }

  async function open(code, reveal) {
    const q = code.dataset.ampTweaksUrl
      ? `url=${encodeURIComponent(code.dataset.ampTweaksUrl)}`
      : `path=${encodeURIComponent(code.dataset.ampTweaksPath)}${reveal ? "&reveal=1" : ""}`;
    code.dataset.ampTweaksOpening = "";
    try {
      const res = await fetch(`/__amp-tweaks/act/open?${q}`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    } catch (e) {
      console.warn(TAG, "open failed", e.message);
    } finally {
      setTimeout(() => delete code.dataset.ampTweaksOpening, 300);
    }
  }

  // Capture phase, so Amp's own handlers on the message don't also act on the click.
  addEventListener("click", e => {
    const code = e.target.closest?.("[data-amp-tweaks-ref]");
    if (!code || e.button !== 0 || !getSelection().isCollapsed) return;
    e.preventDefault();
    e.stopPropagation();
    open(code, e.altKey);
  }, true);

  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    setTimeout(scan, 300);
  }).observe(document.documentElement, { subtree: true, childList: true });
  scan();
})();
