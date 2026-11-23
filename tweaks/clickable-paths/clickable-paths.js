// In threads that ran on a runner on this Mac, file paths and commits in Amp's replies open locally:
// - a path Amp left as plain code opens in your editor (⌥-click shows it in Finder); a commit opens on GitHub
// - Amp's own file and commit links keep Amp's click; ⌥-click shows the file in Finder or opens the commit on GitHub
// Orb threads and other machines' threads are left alone: Amp opens their files in its own tabs.
// The proxy decides whether the thread ran here and which paths exist (/__amp-tweaks/act/refs) and opens them (act/open).
(() => {
  const TAG = "[clickable-paths]";
  const PATH = /^(~\/|\/|\.{1,2}\/)?[\w@.+-]+(\/[\w@.+-]+)*\/?$/;
  const SUFFIX = /(:\d+(:\d+)?|#L\d+(-L?\d+)?)$/;
  const SHA = /^[0-9a-f]{7,40}$/;
  const roots = new Map(); // thread id -> Promise<{ root, repo, runner }>
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
        // Orb threads have no runner; runner threads name the machine they ran on.
        const runner = env.runnerID || env.hostname ? { id: env.runnerID ?? null, hostname: env.hostname ?? null } : null;
        return { root: uri.startsWith("file://") ? decodeURIComponent(uri.slice(7)) : null, repo, runner };
      } catch (e) {
        console.warn(TAG, "thread info unavailable", id, e.message);
        roots.delete(id);
        return { root: null, repo: null, runner: null };
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

  const ampLink = a => a.getAttribute("href")?.startsWith("file://") ? "file" : /\/commit\/[0-9a-f]{7,40}$/.test(a.getAttribute("href") ?? "") ? "commit" : null;

  // Each element is checked once per text (or link), so a path still streaming in is checked again when complete.
  function scan() {
    queued = false;
    const byThread = new Map();
    const add = (el, ref) => {
      const id = threadOf(el);
      if (!id) return;
      if (!byThread.has(id)) byThread.set(id, []);
      byThread.get(id).push({ el, ...ref });
    };
    for (const code of document.querySelectorAll("[data-transcript-markdown] code")) {
      if (code.dataset.ampTweaksRefSeen === code.textContent) continue;
      code.dataset.ampTweaksRefSeen = code.textContent;
      if (code.closest("pre, a, button")) continue;
      const c = candidate(code.textContent);
      if (c) add(code, c);
    }
    for (const a of document.querySelectorAll('[data-transcript-markdown] a[href^="file://"], [data-transcript-markdown] a[href*="/commit/"]')) {
      const href = a.getAttribute("href");
      if (a.dataset.ampTweaksRefSeen === href) continue;
      a.dataset.ampTweaksRefSeen = href;
      const kind = ampLink(a);
      if (kind === "file") add(a, { kind: "amp-file", value: decodeURIComponent(new URL(href).pathname) });
      if (kind === "commit") add(a, { kind: "amp-commit", value: href.split("/").pop() });
    }
    for (const [id, refs] of byThread) mark(id, refs);
  }

  async function mark(id, refs) {
    const { root, repo, runner } = await threadInfo(id);
    if (!runner) return; // an orb thread: nothing here is on this Mac
    const paths = [...new Set(refs.filter(r => r.kind === "path" || r.kind === "amp-file").map(r => r.value))];
    let verdict;
    try {
      const res = await fetch("/__amp-tweaks/act/refs", { method: "POST", body: JSON.stringify({ root, runner, paths }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      verdict = await res.json();
    } catch (e) {
      console.warn(TAG, "couldn't check paths", e.message);
      return;
    }
    if (!verdict.local) return; // ran on another machine
    const commitUrl = sha => repo && `https://github.com/${repo}/commit/${sha}`;
    for (const r of refs) {
      const hit = verdict.paths[r.value];
      if (r.kind === "path" && hit) {
        r.el.dataset.ampTweaksRef = hit.dir ? "dir" : "file";
        r.el.dataset.ampTweaksPath = hit.path;
        r.el.title = hit.dir ? "Show in Finder" : "Open in editor · ⌥-click to show in Finder";
      } else if (r.kind === "commit" && repo) {
        r.el.dataset.ampTweaksRef = "commit";
        r.el.dataset.ampTweaksUrl = commitUrl(r.value);
        r.el.title = "Open commit on GitHub";
      } else if (r.kind === "amp-file" && hit) {
        r.el.dataset.ampTweaksAlt = "file";
        r.el.dataset.ampTweaksPath = hit.path;
        r.el.title = "⌥-click to show in Finder";
      } else if (r.kind === "amp-commit" && repo) {
        r.el.dataset.ampTweaksAlt = "commit";
        r.el.dataset.ampTweaksUrl = commitUrl(r.value);
        r.el.title = "⌥-click to open on GitHub";
      }
    }
  }

  async function open(el, reveal) {
    const q = el.dataset.ampTweaksUrl
      ? `url=${encodeURIComponent(el.dataset.ampTweaksUrl)}`
      : `path=${encodeURIComponent(el.dataset.ampTweaksPath)}${reveal ? "&reveal=1" : ""}`;
    el.dataset.ampTweaksOpening = "";
    try {
      const res = await fetch(`/__amp-tweaks/act/open?${q}`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    } catch (e) {
      console.warn(TAG, "open failed", e.message);
    } finally {
      setTimeout(() => delete el.dataset.ampTweaksOpening, 300);
    }
  }

  // Capture phase, so Amp's own handlers on the message don't also act on the click. Amp's own links only
  // change on ⌥-click; a plain click is still Amp's.
  addEventListener("click", e => {
    if (e.button !== 0 || !getSelection().isCollapsed) return;
    const ours = e.target.closest?.("[data-amp-tweaks-ref]");
    const amps = e.altKey && e.target.closest?.("[data-amp-tweaks-alt]");
    const el = ours || amps;
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    open(el, e.altKey);
  }, true);

  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    setTimeout(scan, 300);
  }).observe(document.documentElement, { subtree: true, childList: true });
  scan();
})();
