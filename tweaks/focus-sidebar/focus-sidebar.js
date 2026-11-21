// Focus sidebar v6 — only threads that need you, then threads still working; sub-threads nest under their root.
//
// Data
//   Amp sidebar DOM      → thread set, families, unread/running/error signals (live), hrefs, navigation, context menu
//   threads.json (CLI)   → recent threads + `updated` (change detector, excludes archived)
//   /api/threads/:id     → state, status message, model, working tree (cached across reloads)
// Behaviour stays Amp's: clicks, the right-click menu and component styling all come from Amp's own rows.
(() => {
  const TAG = "[amp-tweaks:focus]";
  const WORKING = new Set(["compacting", "working", "streaming", "tool_use", "running_tools"]);
  // Working first (what's in motion), then what needs you, most blocking first.
  const KIND_ORDER = ["working", "approve", "asking", "failed", "stalled", "review", "quiet", "parent"];
  const NEEDS = new Set(["approve", "asking", "failed", "stalled", "review"]);
  const OLDEST_FIRST = new Set(["approve", "asking", "stalled"]); // longest-waiting blockers first
  const STALL_MS = 10 * 60_000;
  const RECENT_MS = 14 * 864e5;
  const MODES = { status: "Status", project: "Project", day: "Day" };
  const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

  // ---------- per-viewer storage ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(`amp-tweaks:${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(`amp-tweaks:${k}`, JSON.stringify(v)); } catch {} },
  };
  const prefs = {
    focus: store.get("focus.on", true),
    mode: MODES[store.get("focus.mode", "status")] ? store.get("focus.mode", "status") : "status",
    expanded: new Set(store.get("focus.expanded", [])),
    finishedOpen: new Set(store.get("focus.finishedOpen", [])), // families whose finished sub-threads are listed
    finishedShown: new Map(), // per family: how many finished rows are listed (grows with "Show more")
    kidsAll: new Set(), // families showing all active sub-threads (this session)
  };
  // Filters are per view: each of Status / Project / Day keeps its own.
  const BASE_FILTERS = { kinds: { approve: true, asking: true, failed: true, stalled: true, review: true, working: true }, scope: "mine", age: 14, hidden: [], nest: true };
  const DEFAULT_FILTERS = { status: BASE_FILTERS, project: BASE_FILTERS, day: { ...BASE_FILTERS, age: 7 } };
  const freshFilters = mode => JSON.parse(JSON.stringify(DEFAULT_FILTERS[mode]));
  const loadFilters = () => {
    const saved = store.get("focus.filtersByView", {});
    return Object.fromEntries(Object.keys(MODES).map(m => {
      const f = saved[m] ?? {};
      const d = freshFilters(m);
      return [m, { ...d, ...f, kinds: { ...d.kinds, ...(f.kinds ?? {}) }, hidden: f.hidden ?? [] }];
    }));
  };
  prefs.filtersByView = loadFilters();
  const F = () => prefs.filtersByView[prefs.mode];
  const filtersAreDefault = () => JSON.stringify(F()) === JSON.stringify(DEFAULT_FILTERS[prefs.mode]);

  // Row details: what each row shows (global). Expressed as data attributes on the sidebar root + Amp tokens.
  const DEFAULT_DISPLAY = { context: true, tree: true, model: true, time: true, badge: true, family: true, density: "comfortable", fit: "fade" };
  prefs.display = { ...DEFAULT_DISPLAY, ...store.get("focus.display", {}) };
  const applyMode = () => (document.documentElement.dataset.ampFocus = prefs.focus ? "on" : "off");

  // Snoozed threads stay hidden until something in them changes (Amp's row signals or the thread's updatedAt).
  const snoozed = new Map(Object.entries(store.get("focus.snoozed", {})));
  const saveSnoozed = () => store.set("focus.snoozed", Object.fromEntries(snoozed));

  // ---------- detail cache (slim, persisted so reloads don't refetch everything) ----------
  const cache = new Map(Object.entries(store.get("focus.cache.v3", {})));
  let saveTimer;
  const saveCache = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const cutoff = Date.now() - RECENT_MS;
      store.set("focus.cache.v3", Object.fromEntries([...cache].filter(([, v]) => v.fetchedAt > cutoff && v.d)));
    }, 3000);
  };

  // "Tachi.local" / "rocciemac.sammyk.in" → "Tachi" / "rocciemac": the machine, not its network name.
  const machineName = host => (host ? host.split(".")[0] || null : null);

  function slim(d) {
    const m = d.meta ?? {};
    const agent = m.lastKnownAgentState ?? {};
    const tree = d.env?.initial?.trees?.[0];
    const tm = m.threadModel ?? (m.agentMode?.includes("/") ? { model: m.agentMode } : null);
    return {
      title: d.title, creator: d.creatorUserID, deleted: !!m.deleted,
      state: agent.state, error: agent.error?.message, agentAt: agent.updatedAt,
      status: m.statusMessage?.text, asking: !!m.statusMessage?.waitingOnInput, statusAt: m.statusMessage?.updatedAt,
      lastUserAt: m.lastUserMessageAt, updatedAt: d.updatedAt,
      model: tm?.model, effort: tm?.reasoningEffort,
      repo: tree?.repository?.url?.replace(/\.git$/, "").split("/").pop() ?? (tree?.displayName && tree.displayName !== "workspace" ? tree.displayName : null),
      branch: tree?.repository?.ref?.replace(/^refs\/heads\//, ""),
      // Runner threads: the machine's own hostname (e.g. "Tachi"). Orb threads have no runner and show nothing.
      runner: d.env?.initial?.runnerID ? machineName(d.env.initial.hostname) : null,
      worktree: !!d.env?.initial?.runnerWorktree || /worktree/i.test(tree?.uri ?? ""),
    };
  }

  // ---------- network: changes-only, immediate for threads Amp says just changed ----------
  let cli = [];
  let me = store.get("focus.me", null);
  let backoffUntil = 0;
  const inflight = new Set();

  async function loadCli() {
    if (document.hidden) return;
    try {
      cli = await (await fetch("/__amp-tweaks/data/threads.json", { cache: "no-store" })).json();
    } catch (e) {
      console.warn(TAG, "threads.json failed", e);
    }
  }

  // Idle threads are only refetched when something says they changed (CLI `updated` or Amp's live row).
  function due(id, updated) {
    const c = cache.get(id);
    if (!c?.d) return !c || Date.now() - c.fetchedAt > 2 * 60_000;
    if (updated && Date.parse(updated) > c.fetchedAt) return true;
    if (WORKING.has(c.d.state) || c.d.state === "awaiting_approval") {
      // Stuck "working" threads (no agent update for 10+ min) back off to every 3 minutes.
      const quiet = Date.now() - (Date.parse(c.d.agentAt) || 0) > STALL_MS;
      return Date.now() - c.fetchedAt > (quiet ? 180_000 : 15_000);
    }
    return false;
  }

  const refetch = new Set(); // changes that landed while a fetch for the same thread was in flight
  async function fetchOne(id) {
    if (Date.now() < backoffUntil) return;
    if (inflight.has(id)) { refetch.add(id); return; }
    inflight.add(id);
    try {
      perf.fetches++;
      const res = await fetch(`/api/threads/${id}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (res.status === 401 || res.status === 429 || res.status >= 500) {
        backoffUntil = Date.now() + (res.status >= 500 ? 20_000 : 60_000);
        console.warn(TAG, `HTTP ${res.status}; backing off`);
        cache.set(id, { ...cache.get(id), fetchedAt: Date.now() });
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      cache.set(id, { d: slim(await res.json()), fetchedAt: Date.now() });
    } catch (e) {
      console.warn(TAG, "thread fetch failed", id, e.message);
      cache.set(id, { ...cache.get(id), fetchedAt: Date.now() });
    } finally {
      inflight.delete(id);
      if (refetch.delete(id)) await fetchOne(id);
    }
  }

  async function fetchMany(ids) {
    const queue = ids.slice(0, 40);
    const worker = async () => { for (let id; (id = queue.shift()); ) await fetchOne(id); };
    await Promise.all([worker(), worker()]);
    saveCache();
  }

  // "Me" = the most common creator among your CLI threads (not just the newest one).
  function computeMe() {
    const counts = new Map();
    for (const t of cli.slice(0, 40)) {
      const c = cache.get(t.id)?.d?.creator;
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    let best = null;
    let n = 0;
    for (const [k, v] of counts) if (v > n) { best = k; n = v; }
    return best;
  }

  // ---------- Amp DOM: rows, families, live signals, icons ----------
  const ampRow = id => document.querySelector(`a[data-sidebar-thread-id="${CSS.escape(id)}"]`);
  const parentOf = a => a.parentElement?.closest("[data-sidebar-subthreads-of]")?.dataset.sidebarSubthreadsOf ?? null;

  // Amp's own thread icon, captured once per thread. Running threads show a WebGL canvas, so keep the static one.
  const iconMemo = new Map();
  function captureIcon(id, a) {
    if (iconMemo.has(id)) return;
    const src = a.querySelector("[data-thread-row-icon]");
    if (!src || src.querySelector("canvas")) return;
    const clone = src.cloneNode(true);
    clone.querySelectorAll("[data-thread-row-unread-badge], [data-thread-row-origin-badge]").forEach(n => n.remove());
    clone.querySelectorAll("[data-tooltip-trigger]").forEach(n => n.removeAttribute("data-tooltip-trigger"));
    iconMemo.set(id, clone.innerHTML);
  }

  function readRow(a) {
    const id = a.dataset.sidebarThreadId;
    const badge = a.querySelector("[data-thread-row-unread-badge]");
    const unread = !!badge && !badge.classList.contains("opacity-0");
    const running = !!a.querySelector("[data-thread-row-running-icon]");
    const error = !!a.querySelector("[data-thread-row-error]");
    const status = a.querySelector("[data-thread-row-status-line]")?.textContent.trim() ?? "";
    captureIcon(id, a);
    return {
      href: a.getAttribute("href"),
      title: a.querySelector("[data-title-text]")?.textContent.trim() ?? "",
      unread, running, error, status,
      space: !!a.querySelector("[data-thread-row-space-icon]"),
      spaceColor: a.querySelector("[data-space-color]")?.dataset.spaceColor ?? null,
      // Spawned by another thread (orchestrated sub-thread): its finished result is reviewed via the parent.
      spawned: a.querySelector("[data-thread-row-origin-badge]")?.dataset.threadRowOriginBadge === "thread",
      parent: parentOf(a),
      pinned: a.hasAttribute("data-thread-row-pinned"),
      flags: `${unread}|${running}|${error}`, // state changes → refetch detail
      sig: `${unread}|${running}|${error}|${status}|${a.hasAttribute("data-thread-row-pinned")}`, // any visible change → re-render
    };
  }

  function readAmp() {
    const rows = new Map();
    for (const a of document.querySelectorAll("a[data-sidebar-thread-id]")) {
      rows.set(a.dataset.sidebarThreadId, readRow(a));
    }
    for (const [id, r] of rows) {
      let root = r.parent;
      for (let hops = 0; root && rows.get(root)?.parent && hops < 6; hops++) root = rows.get(root).parent;
      r.root = root && root !== id ? root : null;
    }
    return rows;
  }

  // Amp component classes, read from Amp's live (hidden) elements so styling, tokens and text scaling track Amp.
  function ampClasses() {
    const chip = document.querySelector("[data-sidebar-activity-filter-running]");
    const toggle = document.querySelector("[data-sidebar-subthreads-toggle]");
    return {
      chip: chip?.className ?? "",
      chipFill: chip?.querySelector("[data-chip-fill]")?.className ?? "",
      tabs: chip?.closest(".thread-scrollable-tabs-scroll")?.className ?? "",
      toggle: toggle?.className ?? "",
    };
  }

  // ---------- classification ----------
  const iso = t => (t ? new Date(t).toISOString() : null);

  function classify(d, row) {
    // No detail yet (cold cache, back-off): Amp's live row still tells us enough to show it.
    if (!d) {
      if (!row) return null;
      if (row.running) return { kind: "working", context: row.status || "Working", since: null };
      if (row.error) return { kind: "failed", verb: "Failed", context: row.status, since: null };
      if (row.unread && !row.spawned) return { kind: "review", verb: "Done", context: row.status, since: null };
      return null;
    }
    const mine = F().scope === "all" || !me || d.creator === me;
    if (WORKING.has(d.state) || row?.running) {
      const last = Math.max(Date.parse(d.agentAt) || 0, Date.parse(d.statusAt) || 0);
      if (!row?.running && last && Date.now() - last > STALL_MS && mine) {
        return { kind: "stalled", verb: "Stalled", context: `No update for ${ago(iso(last))}${d.status ? ` · ${d.status}` : ""}`, since: iso(last) };
      }
      return { kind: "working", context: (row?.running && row.status) || d.status || label(d.state) || "Working", since: d.lastUserAt ?? d.agentAt };
    }
    if (!mine) return null;
    if (d.state === "awaiting_approval") return { kind: "approve", verb: "Approve", context: d.status, since: d.agentAt };
    if (d.state === "error" || row?.error) return { kind: "failed", verb: "Failed", context: humanError(d.error), since: d.agentAt };
    if (d.asking) return { kind: "asking", verb: "Asks", context: d.status, since: d.statusAt };
    if (row?.unread && !row.spawned) return { kind: "review", verb: "Done", context: d.status, since: d.agentAt ?? d.updatedAt };
    return null;
  }

  const label = s => (s ?? "").replace(/_/g, " ").replace(/^./, c => c.toUpperCase());
  const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");

  function humanError(message) {
    if (!message) return "Stopped with an error";
    const json = message.indexOf("{");
    if (json !== -1) {
      try {
        const inner = JSON.parse(message.slice(json));
        const e = inner.error ?? inner;
        if (e.message) return humanError(e.message);
        if (e.type) return label(e.type);
      } catch {}
    }
    const [head, ...rest] = message.split(":");
    if (/^[a-z0-9_]+$/.test(head) && rest.length) return label(head);
    return message.split(/(?<=\.)\s/)[0].slice(0, 140);
  }

  function modelLabel(d) {
    if (!d?.model) return "";
    const id = d.model.split("/").pop();
    let m, name;
    if ((m = id.match(/^claude-([a-z]+)-(\d+)-(\d+)/))) name = `${cap(m[1])} ${m[2]}.${m[3]}`;
    else if ((m = id.match(/^gpt-([\d.]+)-?(.*)$/))) name = `GPT-${m[1]}${m[2] ? " " + m[2].split("-").map(cap).join(" ") : ""}`;
    else name = id.split("-").map(cap).join(" ");
    return d.effort ? `${name} · ${cap(d.effort)}` : name;
  }

  function ago(when) {
    const t = Date.parse(when);
    if (!t) return "";
    const s = (Date.now() - t) / 1000;
    if (s < 60) return "now";
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    return `${Math.floor(s / 86400)}d`;
  }

  function dayOf(when) {
    const t = new Date(Date.parse(when) || Date.now());
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = Math.round((today - new Date(t.getFullYear(), t.getMonth(), t.getDate())) / 864e5);
    if (diff <= 0) return { order: 0, title: "Today" };
    if (diff === 1) return { order: 1, title: "Yesterday" };
    if (diff < 7) return { order: diff, title: t.toLocaleDateString(undefined, { weekday: "long" }) };
    return { order: 7, title: "Earlier" };
  }

  const rank = k => KIND_ORDER.indexOf(k);
  const ts = when => Date.parse(when) || Date.now();
  // Blockers (approve/asks/stalled): oldest first, since they've waited longest. Everything else: newest first.
  const byTime = (kind, a, b) => (OLDEST_FIRST.has(kind) ? ts(a) - ts(b) : ts(b) - ts(a));
  const byUrgency = (a, b) => rank(a.lead) - rank(b.lead) || byTime(a.lead, a.leadSince, b.leadSince);

  // ---------- model ----------
  let allRepos = [];
  let loading = false;

  // Snoozed until its state changes (a different kind or a new "since"), or a day passes.
  const quiet = (d, row) => ({ kind: "quiet", context: row?.status || d?.status || "", since: d?.agentAt ?? d?.updatedAt ?? null });

  function snoozedStill(id, c) {
    const s = snoozed.get(id);
    if (!s) return false;
    if (s.kind === "parent") return Date.now() - s.at < 864e5; // a container: its family is filtered above
    const same = c && c.kind === s.kind && (c.since ?? null) === (s.since ?? null) && (s.done || Date.now() - s.at < 864e5);
    if (!same) { snoozed.delete(id); saveSnoozed(); }
    return same;
  }

  function buildItems(rows, ids) {
    const f = F();
    const maxAge = f.age ? f.age * 864e5 : Infinity;
    const activeIds = activeIdSet();
    const prev = new Map(model.flatMap(i => [i, ...(i.children ?? [])]).map(i => [i.id, i]));
    const repos = new Set();
    const active = new Map();
    loading = false;
    for (const id of ids) {
      const d0 = cache.get(id)?.d;
      if (d0?.deleted) continue;
      const row = rows.get(id);
      if (!cache.has(id) && row) loading = true;
      if (f.nest && row?.root && snoozed.has(row.root)) continue; // snoozed root takes its family with it
      let c = classify(d0, row);
      if (!c && row?.pinned) c = quiet(d0, row);
      if (snoozedStill(id, c)) continue;
      const d = d0 ?? { title: row?.title || "Thread" };
      // The thread you have open keeps its place (e.g. a Done you're reading) until you move on.
      if (!c && activeIds.has(id) && prev.has(id)) {
        const p = prev.get(id);
        c = { kind: p.kind === "parent" ? "parent" : p.kind, verb: p.verb, context: p.context, since: p.since, held: true };
      }
      if (c && d.repo) repos.add(d.repo);
      const shown = c && (c.held || (f.kinds[c.kind] !== false && !(d.repo && f.hidden.includes(d.repo))
        && (c.kind === "working" || c.kind === "quiet" || Date.now() - ts(c.since) <= maxAge)));
      if (shown && c.kind !== "parent") active.set(id, { id, d, href: row?.href ?? `/threads/${id}`, inAmp: !!row, space: !!row?.space, spaceColor: row?.spaceColor, pinned: !!row?.pinned, ...c });
    }
    const top = new Map();
    const ensureRoot = rootId => {
      if (top.has(rootId)) return top.get(rootId);
      if (snoozed.has(rootId) && snoozed.get(rootId).kind === "parent") return null;
      const r = rows.get(rootId);
      const d = cache.get(rootId)?.d ?? { title: r?.title || "Thread" };
      const item = active.get(rootId) ?? { id: rootId, d, href: r?.href ?? `/threads/${rootId}`, inAmp: !!r, space: !!r?.space, spaceColor: r?.spaceColor, pinned: !!r?.pinned, kind: "parent", since: d.updatedAt };
      item.children = item.children ?? [];
      top.set(rootId, item);
      return item;
    };
    allRepos = [...repos].sort((a, b) => a.localeCompare(b));
    for (const item of active.values()) {
      const root = f.nest ? rows.get(item.id)?.root : null;
      if (root) ensureRoot(root)?.children.push(item);
      else ensureRoot(item.id);
    }
    const familySizes = new Map();
    if (f.nest) for (const r of rows.values()) if (r.root) familySizes.set(r.root, (familySizes.get(r.root) ?? 0) + 1);
    for (const item of top.values()) {
      item.children.sort((a, b) => rank(a.kind) - rank(b.kind) || byTime(a.kind, a.since, b.since));
      const lead = [item, ...item.children].reduce((best, i) => (rank(i.kind) < rank(best.kind) ? i : best), item);
      item.lead = lead.kind;
      item.leadSince = lead.since;
      if (item.kind === "parent") item.since = item.children.map(c => c.since).sort((a, b) => ts(b) - ts(a))[0];
      const familySize = familySizes.get(item.id) ?? 0;
      item.finished = Math.max(0, familySize - item.children.length);
      item.total = familySize;
    }
    return [...top.values()];
  }

  function group(list, mode) {
    const groups = new Map();
    const add = (key, title, order, item) => {
      if (!groups.has(key)) groups.set(key, { key: String(key), title, order, items: [] });
      groups.get(key).items.push(item);
    };
    if (searching) return list.length ? [{ key: "results", title: "Results", order: 0, items: list }] : [];
    for (const it of list) {
      if (mode === "status" && it.pinned) add("pinned", "Pinned", -2, it);
      else if (mode === "status" && it.space) add("spaces", "Spaces", -1, it);
      else if (mode === "status") {
        const needs = it.kind !== "working" && [it, ...(it.children ?? [])].some(i => NEEDS.has(i.kind));
        add(needs ? "needs" : "working", needs ? "Needs you" : "Working", needs ? 1 : 0, it);
      } else if (mode === "project") add(`p:${it.d.repo ?? "~"}`, it.d.repo ?? "No project", it.d.repo ? 0 : 1, it);
      else {
        const day = dayOf(it.since);
        add(`d:${day.order}`, day.title, day.order, it);
      }
    }
    const out = [...groups.values()];
    for (const g of out) g.items.sort(byUrgency);
    return out.sort((a, b) => a.order - b.order || (mode === "day" ? 0 : byUrgency(a.items[0], b.items[0])) || a.title.localeCompare(b.title));
  }

  // ---------- rows: persistent parts, patched individually (never rebuilt under the pointer) ----------
  const GLYPH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="8.5"/></svg>';
  const ICON = {
    more: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="5.5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18.5" cy="12" r="1.6"/></svg>',
    archive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9"/><path d="M10 13h4"/></svg>',
    snooze: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2"/><path d="M5 3 2 6"/><path d="m19 3 3 3"/></svg>',
    branch: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="7" r="2"/><path d="M6 7v10"/><path d="M18 9a6 6 0 0 1-6 6H6"/></svg>',
    runner: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/></svg>',
    worktree: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h7l2 2h7v10H4z"/><path d="M9 13h6"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>',
    unpin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89"/><path d="m2 2 20 20"/><path d="M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11"/></svg>',
    done: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="m8.5 12.25 2.5 2.5 4.75-5"/></svg>',
    retry: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v4.5h-4.5"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  };
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const setText = (el, t) => { if (el.textContent !== t) el.textContent = t; };
  const setHTML = (el, h) => { if (el._h !== h) { el.innerHTML = h; el._h = h; } };

  function parts(row) {
    if (row._p) return row._p;
    row.innerHTML = `<span data-icon><span data-icon-art></span><span data-badge></span></span><span data-title></span><span data-trail><span data-time></span><span data-row-actions></span></span><span data-context hidden></span><span data-meta hidden></span>`;
    const q = s => row.querySelector(s);
    row._p = { icon: q("[data-icon]"), art: q("[data-icon-art]"), title: q("[data-title]"), trail: q("[data-trail]"), time: q("[data-time]"), actions: q("[data-row-actions]"), context: q("[data-context]"), meta: q("[data-meta]"), toggle: null };
    return row._p;
  }

  function metaHTML(it, opts, family) {
    const { d } = it;
    const show = prefs.display;
    // Branch/worktree/runner only draw attention when they differ from the usual (default branch, Orb).
    const featureBranch = d.branch && !/^(main|master|trunk|develop)$/.test(d.branch);
    const branch = d.branch ? (featureBranch ? `<span data-branch>${ICON.branch}${esc(d.branch)}</span>` : opts.child ? "" : esc(d.branch)) : "";
    const list = [
      ["tree", !show.tree || opts.mode === "project" || opts.child ? "" : esc(d.repo ?? "")],
      ["space", it.space && it.total ? `${it.total} thread${it.total === 1 ? "" : "s"}` : ""],
      ["tree", show.tree ? branch : ""],
      ["tree", show.tree && d.worktree ? `<span data-branch>${ICON.worktree}worktree</span>` : ""],
      ["runner", show.tree && d.runner ? `<span data-branch>${ICON.runner}${esc(d.runner)}</span>` : ""],
    ].filter(([, h]) => h);
    // Model always last: it's the first thing to go when the sidebar narrows.
    if (family && it.kind !== "parent") list.push(["family", esc(family)]);
    if (!it.space && show.model && modelLabel(d)) list.push(["model", esc(modelLabel(d))]);
    return list.map(([k, h]) => `<span data-mi="${k}">${h}</span>`).join("");
  }

  function applyRow(row, it, opts) {
    const p = parts(row);
    if (row.dataset.kind !== it.kind) row.dataset.kind = it.kind;
    row.toggleAttribute("data-space", !!it.space);
    row.toggleAttribute("data-held", !!it.held);
    row.dataset.href = it.href;
    if (it.spaceColor) row.style.setProperty("--space-color", it.spaceColor);
    else row.style.removeProperty("--space-color");

    const icon = iconMemo.get(it.id);
    p.icon.toggleAttribute("data-fallback", !icon);
    setHTML(p.art, icon ?? GLYPH);
    setText(p.title, it.d.title || "Untitled");

    const show = prefs.display;
    const kids = it.children ?? [];
    const running = kids.filter(c => c.kind === "working").length;
    const needing = kids.filter(c => NEEDS.has(c.kind)).length;
    const family = kids.length && show.family ? [needing && `${needing} need${needing === 1 ? "s" : ""} you`, running && `${running} running`].filter(Boolean).join(" · ") : "";

    // Family toggle: one persistent button; attributes patched, aria-expanded owned by the expand state.
    if ((kids.length || it.finished) && !opts.child) {
      if (!p.toggle) {
        p.toggle = document.createElement("button");
        p.toggle.type = "button";
        p.toggle.tabIndex = -1; // →/← expand and collapse from the row
        p.toggle.setAttribute("data-family-toggle", "");
        p.toggle.innerHTML = ICON.chevron;
        p.trail.insertBefore(p.toggle, p.time);
      }
      if (p.toggle.className !== opts.cls.toggle) p.toggle.className = opts.cls.toggle;
      const noun = it.space ? "thread" : "sub-thread";
      const lbl = kids.length ? `${kids.length} ${noun}${kids.length === 1 ? "" : "s"}` : `${it.finished} finished`;
      if (p.toggle.getAttribute("aria-label") !== lbl) p.toggle.setAttribute("aria-label", lbl);
      const tone = needing ? "needs" : running ? "working" : "";
      if ((p.toggle.dataset.tone ?? "") !== tone) tone ? (p.toggle.dataset.tone = tone) : delete p.toggle.dataset.tone;
      const exp = String(prefs.expanded.has(it.id));
      if (p.toggle.getAttribute("aria-expanded") !== exp) p.toggle.setAttribute("aria-expanded", exp);
    } else if (p.toggle) {
      p.toggle.remove();
      p.toggle = null;
    }

    // Failed: a small "Retry" at the end of the line, shown on hover; it retries through Amp's own thread view.
    const retryLabel = it.kind === "failed" ? ` <button type="button" tabindex="-1" data-act="retry" data-retry-label>Retry</button>` : "";
    const context = !show.context ? "" : it.kind === "parent" ? esc(family) : it.context ? `${it.verb ? `<b>${esc(it.verb)}</b> ` : ""}${esc(it.context)}${retryLabel}` : "";
    setHTML(p.context, context);
    p.context.hidden = !context;
    const meta = metaHTML(it, opts, family);
    setHTML(p.meta, meta);
    p.meta.hidden = !meta;
    setText(p.time, ago(it.since));
    // Hover actions live in the row's trail: they open to the right of the toggle and push it left.
    const acts = [
      it.kind === "failed" ? ["retry", "Retry", ICON.retry] : null,
      it.kind === "asking" ? ["done", "Mark done", ICON.done] : null,
      it.inAmp ? ["pin", it.pinned ? "Unpin" : "Pin", it.pinned ? ICON.unpin : ICON.pin] : null,
      it.inAmp ? ["more", "More", ICON.more] : null,
      ["archive", "Archive", ICON.archive],
    ].filter(Boolean);
    setHTML(p.actions, acts.map(([a, l, i]) => `<button type="button" tabindex="-1" data-act="${a}" aria-label="${l}" title="${l}">${i}</button>`).join(""));
    if (row.dataset.acts !== String(acts.length)) row.dataset.acts = acts.length;
    // The toggle slides left by (actions width - time width); measure the time text without a layout read.
    const tw = `${timeWidth(p.time.textContent)}px`;
    if (row._tw !== tw) { row.style.setProperty("--time-w", tw); row._tw = tw; }
  }

  let timeFont = null;
  const timeCanvas = document.createElement("canvas").getContext("2d");
  const timeWidths = new Map();
  function timeWidth(text) {
    if (!text) return 0;
    if (!timeFont) {
      const probe = document.querySelector("[data-amp-focus-row] [data-time]");
      if (!probe) return 16;
      const cs = getComputedStyle(probe);
      timeFont = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      timeCanvas.font = timeFont;
      timeCanvas.fontVariantNumeric = "tabular-nums";
    }
    let w = timeWidths.get(text);
    if (w === undefined) { w = Math.ceil(timeCanvas.measureText(text).width); timeWidths.set(text, w); }
    return w;
  }

  function createItem(id) {
    const el = document.createElement("div");
    el.setAttribute("data-amp-focus-item", "");
    el.dataset.threadId = id;
    el.innerHTML = `<div data-amp-focus-snooze aria-hidden="true">${ICON.snooze}</div>`
      + `<div data-amp-focus-actions><button type="button" tabindex="-1" data-act="retry" aria-label="Retry" title="Retry">${ICON.retry}</button><button type="button" tabindex="-1" data-act="more" aria-label="More" title="More">${ICON.more}</button><button type="button" tabindex="-1" data-act="archive" aria-label="Archive" title="Archive">${ICON.archive}</button></div>`
      + `<div data-amp-focus-row role="link" tabindex="-1"></div><div data-family hidden><div data-family-inner></div></div>`;
    return el;
  }

  function createChild(id) {
    const el = document.createElement("div");
    el.setAttribute("data-amp-focus-child", "");
    el.dataset.threadId = id;
    el.innerHTML = `<span data-tree aria-hidden="true"></span><div data-amp-focus-row role="link" tabindex="-1"></div>`;
    return el;
  }

  // ---------- family tree ----------
  const MAX_KIDS = 8; // active sub-threads shown before "Show N more"
  const MAX_DEPTH = 3; // indentation stops here so deep trees don't run off a narrow sidebar

  // Order the family as a tree: each shown sub-thread hangs off its nearest shown ancestor (or the root),
  // siblings keep their urgency order. rails[j] = whether the ancestor line at level j+1 continues past this row.
  // `tail`: a "Show more" / "N finished" branch follows, so the root's last child isn't the last branch.
  function treeOrder(rootId, kids, tail = false) {
    const shown = new Set(kids.map(k => k.id));
    const displayParent = id => {
      let p = rows.get(id)?.parent;
      for (let hops = 0; p && p !== rootId && !shown.has(p) && hops < 8; hops++) p = rows.get(p)?.parent;
      return p && shown.has(p) ? p : rootId;
    };
    const byParent = new Map();
    for (const k of kids) {
      const pid = displayParent(k.id);
      if (!byParent.has(pid)) byParent.set(pid, []);
      byParent.get(pid).push(k);
    }
    const out = [];
    const walk = (pid, depth, rails) => {
      const list = byParent.get(pid) ?? [];
      list.forEach((k, i) => {
        const last = i === list.length - 1 && !(depth === 1 && tail);
        out.push({ k, depth, last, rails });
        if (depth < 12) walk(k.id, depth + 1, [...rails, !last]);
      });
    };
    walk(rootId, 1, []);
    return out;
  }

  // Guide lines for one tree row: ancestor rails, then this row's branch (a smooth elbow if it's the last one).
  function applyTree(holder, depth, last, rails) {
    const d = Math.min(depth, MAX_DEPTH);
    holder.style.setProperty("--d", String(d));
    holder.toggleAttribute("data-last", last);
    const ancestors = d > 1 ? rails.slice(-(d - 1)) : [];
    const html = ancestors.map((on, j) => (on ? `<span data-rail style="--up:${d - 1 - j}"></span>` : "")).join("")
      + (last ? `<span data-elbow></span>` : `<span data-tail></span><span data-stub></span>`);
    setHTML(holder.querySelector(":scope > [data-tree]"), html);
  }

  function applyItem(el, it, cls, animate, isNew = false) {
    el.dataset.kind = it.kind;
    const expanded = prefs.expanded.has(it.id);
    el.toggleAttribute("data-expanded", expanded);
    el.querySelector(':scope > [data-amp-focus-actions] [data-act="more"]').hidden = !it.inAmp;
    el.querySelector(':scope > [data-amp-focus-actions] [data-act="retry"]').hidden = it.kind !== "failed";
    if (it.spaceColor) el.style.setProperty("--space-color", it.spaceColor);
    else el.style.removeProperty("--space-color");
    applyRow(el.querySelector(":scope > [data-amp-focus-row]"), it, { cls, mode: prefs.mode });

    // Children: drawn as a tree (real parent/child structure within the family), keyed by their live elements.
    const kids = it.children ?? [];
    const family = el.querySelector(":scope > [data-family]");
    family.hidden = !kids.length && !it.finished;
    const inner = family.firstElementChild;
    const showAll = prefs.kidsAll.has(it.id);
    const truncated = !showAll && kids.length > MAX_KIDS;
    const all = treeOrder(it.id, kids, truncated || !!it.finished);
    const visible = truncated ? all.slice(0, MAX_KIDS) : all;
    const hiddenCount = all.length - visible.length;
    // Guide lines only when there's more than one branch to show; a single sub-thread just indents.
    el.toggleAttribute("data-tree-on", visible.length + (hiddenCount ? 1 : 0) + (it.finished ? 1 : 0) > 1);
    const existing = new Map([...inner.querySelectorAll(":scope > [data-amp-focus-child][data-thread-id]")].map(c => [c.dataset.threadId, c]));
    let prev = null;
    visible.forEach((node, i) => {
      const c = node.k;
      let ch = existing.get(c.id);
      if (ch) existing.delete(c.id);
      else {
        ch = createChild(c.id);
        if (animate && expanded && !isNew) requestAnimationFrame(() => ch.animate([{ opacity: 0, transform: "translateY(-3px)" }, { opacity: 1, transform: "none" }], { duration: 220, easing: EASE }));
      }
      applyTree(ch, node.depth, node.last, node.rails);
      applyRow(ch.querySelector(":scope > [data-amp-focus-row]"), c, { child: true, cls, mode: prefs.mode });
      let want = prev ? prev.nextElementSibling : inner.firstElementChild;
      while (want?.hasAttribute("data-leaving")) want = want.nextElementSibling;
      if (ch !== want) inner.insertBefore(ch, want);
      prev = ch;
    });
    for (const ch of existing.values()) leave(ch, animate && expanded);

    // Large families: past MAX_KIDS active sub-threads, the rest sit behind a branch of their own.
    let more = inner.querySelector(":scope > [data-kids-more]");
    if (hiddenCount) {
      if (!more) {
        more = document.createElement("button");
        more.type = "button";
        more.tabIndex = -1;
        more.setAttribute("data-kids-more", "");
        more.innerHTML = `<span data-tree aria-hidden="true"></span><span data-label></span>`;
      }
      applyTree(more, 1, !it.finished, []);
      setText(more.querySelector("[data-label]"), `Show ${hiddenCount} more`);
      const want = prev ? prev.nextElementSibling : inner.firstElementChild;
      if (more !== want) inner.insertBefore(more, want);
    } else more?.remove();
    applyFinished(inner, it, cls, kids);
  }

  // "N finished" is a disclosure: finished sub-threads listed newest first, 10 at a time, each a real row
  // (opens through Amp, right-click / long-press for Amp's menu). Built only while open.
  const FINISHED_PAGE = 10;
  function finishedItems(rootId, activeIds) {
    const updated = new Map(cli.map(t => [t.id, t.updated]));
    const out = [];
    for (const [id, r] of rows) {
      if (r.root !== rootId || activeIds.has(id) || dismissed.has(id)) continue;
      const d = cache.get(id)?.d;
      // When the agent last did something; archive/unarchive bump updatedAt, so it's only a fallback.
      out.push({ id, d: d ?? { title: r.title || "Thread" }, kind: "finished", context: r.status || d?.status || "", since: d?.agentAt ?? d?.updatedAt ?? updated.get(id) ?? null, href: r.href, inAmp: true });
    }
    return out.sort((a, b) => (Date.parse(b.since) || 0) - (Date.parse(a.since) || 0));
  }

  function applyFinished(inner, it, cls, kids) {
    let box = inner.querySelector(":scope > [data-finished]");
    if (!it.finished) { box?.remove(); return; }
    if (!box) {
      box = document.createElement("div");
      box.setAttribute("data-finished", "");
      box.innerHTML = `<span data-tree aria-hidden="true"></span><button type="button" tabindex="-1" data-finished-toggle aria-expanded="false">${ICON.chevron}<span></span></button><div data-finished-body><div data-finished-list></div></div>`;
    }
    if (inner.lastElementChild !== box) inner.appendChild(box);
    applyTree(box, 1, true, []);
    const open = prefs.finishedOpen.has(it.id);
    box.toggleAttribute("data-open", open);
    const toggle = box.querySelector(":scope > [data-finished-toggle]");
    toggle.setAttribute("aria-expanded", String(open));
    setText(toggle.lastElementChild, `${it.finished} finished`);
    const list = box.querySelector("[data-finished-list]");
    if (!open) { if (list.childElementCount) list.replaceChildren(); return; }

    const all = finishedItems(it.id, new Set(kids.map(c => c.id)));
    const shown = all.slice(0, prefs.finishedShown.get(it.id) ?? FINISHED_PAGE);
    const existing = new Map([...list.querySelectorAll(":scope > [data-amp-focus-finished][data-thread-id]")].map(c => [c.dataset.threadId, c]));
    let prev = null;
    const rest = all.length - shown.length;
    // The finished list continues the family tree from the "N finished" chevron (lines when 2+ branches).
    box.toggleAttribute("data-sub-tree", shown.length + (rest > 0 ? 1 : 0) > 1);
    for (const [n, f] of shown.entries()) {
      let el = existing.get(f.id);
      if (el) existing.delete(f.id);
      else {
        el = document.createElement("div");
        el.setAttribute("data-amp-focus-finished", "");
        el.dataset.threadId = f.id;
        el.innerHTML = `<span data-tree aria-hidden="true"></span><div data-amp-focus-row role="link" tabindex="-1"></div>`;
      }
      applyRow(el.querySelector(":scope > [data-amp-focus-row]"), f, { child: true, cls, mode: prefs.mode });
      applyTree(el, 1, n === shown.length - 1 && rest <= 0, []);
      const want = prev ? prev.nextElementSibling : list.firstElementChild;
      if (el !== want) list.insertBefore(el, want);
      prev = el;
    }
    for (const el of existing.values()) el.remove();
    let more = list.querySelector(":scope > [data-finished-more]");
    if (rest > 0) {
      if (!more) {
        more = document.createElement("button");
        more.type = "button";
        more.tabIndex = -1;
        more.setAttribute("data-finished-more", "");
        more.innerHTML = `<span data-tree aria-hidden="true"></span><span data-label></span>`;
      }
      applyTree(more, 1, true, []);
      setText(more.querySelector("[data-label]"), `Show ${Math.min(rest, 20)} more`);
      if (list.lastElementChild !== more) list.appendChild(more);
    } else more?.remove();
  }

  function setFinishedOpen(id, open) {
    open ? prefs.finishedOpen.add(id) : prefs.finishedOpen.delete(id);
    store.set("focus.finishedOpen", [...prefs.finishedOpen]);
    render(true);
  }

  // ---------- rendering: persistent keyed rows; FLIP only when the order changes ----------
  let model = [];
  let pending = false;
  let lastMouseMove = 0;
  let holdTimer = 0;

  // Rows a person can actually see (collapsed families are visibility:hidden, not just 0-height).
  const isShown = r => (r.checkVisibility ? r.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true }) : r.offsetParent !== null);

  // One Tab stop for the list (roving tabindex); arrows move between rows. Tray buttons are reached by E / ⇧F10.
  function syncTabStops(list) {
    const rowsAll = [...list.querySelectorAll("[data-thread-id] > [data-amp-focus-row]")];
    const current = rowsAll.find(r => r === document.activeElement) ?? rowsAll.find(r => r.hasAttribute("data-active") && isShown(r)) ?? rowsAll.find(isShown);
    for (const r of rowsAll) { const t = r === current ? "0" : "-1"; if (r.getAttribute("tabindex") !== t) r.setAttribute("tabindex", t); }
  }
  let failed = 0; // timestamp of the last render failure
  let recoveries = 0;
  const swipe = { active: false, item: null, x: 0, raw: 0, w: 0, timer: 0 };

  function activeIdSet() {
    const s = new Set(location.pathname.match(/T-[0-9a-f-]{36}/g) ?? []);
    document.querySelectorAll('a[data-sidebar-thread-id][data-active="true"]').forEach(a => s.add(a.dataset.sidebarThreadId));
    return s;
  }

  // Cheap: toggles one attribute per row. Runs on navigation instead of a re-render.
  function syncActive() {
    const ids = activeIdSet();
    document.querySelectorAll("[data-amp-focus-root] [data-thread-id] > [data-amp-focus-row]").forEach(row => {
      row.toggleAttribute("data-active", ids.has(row.parentElement.dataset.threadId));
    });
  }

  function render(force = false) {
    if (failed) return;
    try {
      renderUnsafe(force);
    } catch (e) {
      // Fail open: never leave a blank sidebar. Amp's own list comes back, the error is reported, and we retry.
      failed = Date.now();
      console.error(TAG, "render failed; showing Amp's list", e);
      document.documentElement.dataset.ampFocus = "off";
      fetch("/__amp-tweaks/report?name=focus-error", { method: "POST", body: JSON.stringify({ message: String(e), stack: e?.stack, url: location.href }) });
      // Retry a few times on our own; after that, wait for the Focus toggle.
      if (recoveries < 3) setTimeout(() => { if (failed) { recoveries++; recover(); } }, 10_000);
    }
  }

  function recover() {
    failed = 0;
    const list = document.querySelector("[data-amp-focus-list]");
    if (list) { list.replaceChildren(); list._layout = ""; }
    applyMode();
    render(true);
  }

  // Self-timing (cheap): read via the "focus-perf" report to see what the sidebar costs during real use.
  const perf = { renders: 0, renderMs: 0, renderMax: 0, moves: 0, live: 0, fetches: 0, since: Date.now() };
  function renderUnsafe(force) {
    const t0 = performance.now();
    try { return renderBody(force); } finally {
      const ms = performance.now() - t0;
      perf.renders++; perf.renderMs += ms; perf.renderMax = Math.max(perf.renderMax, ms);
    }
  }

  function renderBody(force) {
    const root = ensureRoot();
    if (!root) return;
    const list = root.querySelector("[data-amp-focus-list]");
    syncHeader(root);
    root.querySelector("[data-toggle]").textContent = prefs.focus ? "All threads" : "Focus";
    if (!prefs.focus) return;
    if (!force && swipe.active) { pending = true; return; }

    const cls = ampClasses();
    const groups = group(model, prefs.mode);
    const layout = groups.map(g => `${g.key}:${g.items.map(i => i.id).join(",")}`).join("|");
    // Layout memory lives on the list element: if Amp re-renders and our container is recreated, it starts empty.
    let moved = layout !== list._layout;
    // Don't reorder rows under a moving mouse: patch in place now, reorder ~1.5s after the mouse settles.
    // (Touch never holds: :hover sticks after a tap.)
    const hold = moved && !force && list._layout && performance.now() - lastMouseMove < 1500;
    if (hold) {
      pending = true;
      moved = false;
      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => { if (pending) render(); }, 1600);
    } else { pending = false; list._layout = layout; }
    const focused = list.contains(document.activeElement) ? document.activeElement : null;
    const animate = !reduceMotion.matches && list.childElementCount > 0;
    if (moved) perf.moves++;

    const before = new Map();
    if (moved && animate) list.querySelectorAll("[data-amp-focus-item][data-thread-id], [data-amp-focus-heading]").forEach(el => before.set(el, el.getBoundingClientRect().top));

    const seenSections = new Set();
    const seenItems = new Set();
    const entering = [];
    let anchor = null;
    for (const g of groups) {
      let section = list.querySelector(`:scope > [data-amp-focus-group][data-key="${CSS.escape(g.key)}"]:not([data-leaving])`);
      if (!section) {
        if (!moved) continue;
        section = document.createElement("section");
        section.setAttribute("data-amp-focus-group", "");
        section.dataset.key = g.key;
        section.innerHTML = `<div data-amp-focus-heading><span data-heading-title></span><span data-count></span></div>`;
        entering.push(section.firstElementChild); // only the heading fades in; moved rows glide via FLIP
      }
      setText(section.querySelector("[data-heading-title]"), g.title);
      setText(section.querySelector("[data-count]"), String(g.items.length));
      if (moved) list.insertBefore(section, anchor ? anchor.nextSibling : list.firstChild);
      anchor = section;
      seenSections.add(section);

      let prev = section.firstElementChild;
      for (const it of g.items) {
        let el = list.querySelector(`[data-amp-focus-item][data-thread-id="${CSS.escape(it.id)}"]`);
        const isNew = !el;
        if (!el) {
          if (!moved) continue;
          el = createItem(it.id);
          entering.push(el);
        }
        applyItem(el, it, cls, animate, isNew);
        if (moved && el.previousElementSibling !== prev) section.insertBefore(el, prev.nextSibling);
        prev = el;
        seenItems.add(el);
      }
    }

    if (moved) {
      // Sections that leave take their rows with them; rows leaving a surviving section drift out individually.
      list.querySelectorAll(":scope > [data-amp-focus-group]:not([data-leaving])").forEach(s => { if (!seenSections.has(s)) leave(s, animate); });
      list.querySelectorAll("[data-amp-focus-item][data-thread-id]").forEach(el => {
        if (!seenItems.has(el) && !el.closest("[data-leaving]")) leave(el, animate);
      });
    }
    const empty = root.querySelector("[data-amp-focus-empty]");
    setText(empty, searching ? "No matching threads" : "Nothing needs you");
    empty.hidden = groups.length > 0 || (loading && !searching);
    syncActive();
    if (focused && focused.isConnected && document.activeElement !== focused) focused.focus({ preventScroll: true });
    syncTabStops(list);

    if (!moved || !animate) return;
    for (const [el, top] of before) {
      if (!el.isConnected || el.closest("[data-leaving]")) continue;
      const dy = top - el.getBoundingClientRect().top;
      if (Math.abs(dy) > 0.5) el.animate([{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }], { duration: 320, easing: EASE });
    }
    for (const el of entering) el.animate([{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: 240, easing: EASE });
  }

  // A thread that stops needing you (read, answered, finished) drifts off to the right, then the gap closes.
  async function leave(el, animate) {
    if (el.hasAttribute("data-leaving")) return;
    el.setAttribute("data-leaving", "");
    el.removeAttribute("data-thread-id");
    if (!animate) return el.remove();
    await el.animate([{ opacity: 1, transform: "translateX(0)" }, { opacity: 0, transform: "translateX(0.75rem)" }],
      { duration: 200, easing: EASE, fill: "forwards" }).finished.catch(() => {});
    await collapse(el, 220);
  }

  async function collapse(el, duration) {
    if (!el.isConnected) return;
    const h = el.getBoundingClientRect().height;
    el.style.overflow = "hidden";
    await el.animate([{ height: `${h}px` }, { height: "0px" }], { duration, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "forwards" })
      .finished.catch(() => {});
    el.remove();
  }

  function syncHeader(root) {
    const header = root.querySelector("[data-amp-focus-modes]");
    const cls = ampClasses();
    const filterBtn = root.querySelector("[data-filter-btn]");
    const ampFilter = document.querySelector("[data-sidebar-filter-menu]");
    if (ampFilter && filterBtn.dataset.cls !== ampFilter.className) {
      filterBtn.dataset.cls = ampFilter.className;
      filterBtn.className = ampFilter.className;
      filterBtn.innerHTML = ampFilter.querySelector("svg")?.outerHTML ?? "";
    }
    filterBtn.toggleAttribute("data-filtered", !filtersAreDefault());
    root.toggleAttribute("data-hide-time", !prefs.display.time);
    root.toggleAttribute("data-hide-badge", !prefs.display.badge);
    root.dataset.density = prefs.display.density;
    root.dataset.fit = prefs.display.fit;
    root.querySelector("[data-amp-focus-header]").hidden = !prefs.focus;
    if (header.dataset.cls !== cls.chip) {
      header.dataset.cls = cls.chip;
      header.className = cls.tabs;
      header.innerHTML = Object.entries(MODES).map(([m, labelText]) =>
        `<button type="button" role="tab" data-mode="${m}" class="${esc(cls.chip)}"><span class="${esc(cls.chipFill)}" data-chip-fill></span><span class="relative" data-chip-label>${labelText}</span></button>`).join("");
    }
    header.hidden = !prefs.focus;
    header.querySelectorAll("[data-mode]").forEach(b => {
      const on = b.dataset.mode === prefs.mode;
      if (b.dataset.active !== String(on)) b.dataset.active = String(on);
      b.setAttribute("aria-selected", String(on));
    });
  }

  function ensureRoot() {
    const ampList = document.querySelector('[data-slot="sidebar"] [data-testid="sidebar-thread-list"]');
    const group = ampList?.closest('[data-sidebar="group"]');
    if (!group) return null;
    let root = group.parentElement.querySelector(":scope > [data-amp-focus-root]");
    if (!root) {
      root = document.createElement("div");
      root.setAttribute("data-amp-focus-root", "");
      root.innerHTML = `<div data-amp-focus-header><div data-amp-focus-modes role="tablist" aria-label="Group threads by"></div><button type="button" data-filter-btn aria-label="Filter threads" aria-haspopup="menu" aria-expanded="false"></button></div>
        <div data-amp-focus-menu role="menu" aria-label="Filter threads" hidden></div>
        <div data-amp-focus-list></div>
        <div data-amp-focus-empty hidden>Nothing needs you</div>
        <div data-amp-focus-toast role="status" hidden></div>
        <div data-amp-focus-footer><button type="button" data-toggle></button></div>`;
      wireRoot(root);
      group.after(root);
    }
    return root;
  }

  // ---------- actions ----------
  // Per-thread results: { ok, done: [ids that succeeded], failed: [{ id, error }] }.
  async function archive(ids, undo = false) {
    try {
      const q = ids.map(encodeURIComponent).join(",");
      const res = await fetch(`/__amp-tweaks/act/archive?id=${q}${undo ? "&undo=1" : ""}`, { method: "POST" });
      const r = await res.json();
      const done = r.done ?? (r.ok ? ids : []);
      const failed = r.failed ?? [];
      if (failed.length) console.warn(TAG, undo ? "unarchive" : "archive", `${failed.length}/${ids.length} failed`, failed);
      else console.info(TAG, undo ? "unarchived" : "archived", ids.length);
      return { ok: !failed.length && done.length === ids.length, done, failed };
    } catch (e) {
      console.warn(TAG, undo ? "unarchive failed" : "archive failed", ids, e.message);
      return { ok: false, done: [], failed: ids.map(id => ({ id, error: e.message })) };
    }
  }

  const familyIds = id => [...rows].filter(([, r]) => r.root === id).map(([k]) => k);
  // Archived ids stay hidden until they've actually left both Amp's list and the CLI list.
  const dismissed = new Map();
  const findItem = id => document.querySelector(`[data-amp-focus-item][data-thread-id="${CSS.escape(id)}"]`);
  const findChild = id => document.querySelector(`[data-amp-focus-child][data-thread-id="${CSS.escape(id)}"]`);
  const findAny = id => findItem(id) ?? findChild(id);
  const hrefOf = id => model.flatMap(i => [i, ...(i.children ?? [])]).find(i => i.id === id)?.href ?? `/threads/${id}`;
  const titleOf = id => cache.get(id)?.d?.title ?? rows.get(id)?.title ?? "thread";

  // "Sucked into the void": the row accelerates into the archive point, shrinking and blurring, then the gap closes.
  async function suck(el, point) {
    el.removeAttribute("data-thread-id");
    el.setAttribute("data-leaving", "");
    el.style.pointerEvents = "none";
    if (reduceMotion.matches) return el.remove();
    const r = el.getBoundingClientRect();
    const px = point?.x ?? r.right - 20;
    const py = point?.y ?? r.top + 14;
    el.style.transformOrigin = `${px - r.left}px ${py - r.top}px`;
    const list = el.closest("[data-amp-focus-list]");
    if (list) {
      const lr = list.getBoundingClientRect();
      const hole = document.createElement("span");
      hole.setAttribute("data-amp-void", "");
      hole.style.left = `${px - lr.left}px`;
      hole.style.top = `${py - lr.top + list.scrollTop}px`;
      list.appendChild(hole);
      hole.animate([
        { transform: "translate(-50%, -50%) scale(0.2)", opacity: 0 },
        { transform: "translate(-50%, -50%) scale(1)", opacity: 1, offset: 0.55 },
        { transform: "translate(-50%, -50%) scale(0)", opacity: 0 },
      ], { duration: 560, easing: EASE }).finished.catch(() => {}).then(() => hole.remove());
    }
    await el.animate([
      { transform: "scale(1)", opacity: 1, filter: "blur(0px)" },
      { transform: "scale(0.96)", opacity: 1, filter: "blur(0px)", offset: 0.18 },
      { transform: "scale(0.03) rotate(-8deg)", opacity: 0, filter: "blur(3px)" },
    ], { duration: 440, easing: "cubic-bezier(0.55, 0, 0.8, 0.2)", fill: "forwards" }).finished.catch(() => {});
    await collapse(el, 220);
  }

  // Undo is a stack: every archive/snooze can be undone in order (toast button or ⌘Z).
  const undoStack = [];

  function archiveItems(entries, labelText) {
    const ids = [...new Set(entries.flatMap(({ id }) => [id, ...familyIds(id)]))];
    ids.forEach(i => dismissed.set(i, Date.now()));
    swipe.active = false;
    const gone = new Set(ids);
    model = model.filter(i => !gone.has(i.id)).map(i => ({ ...i, children: (i.children ?? []).filter(c => !gone.has(c.id)) }));
    entries.forEach(({ el, point }, n) => el && setTimeout(() => suck(el, point), n * 70));
    const extra = ids.length - entries.length;
    const plural = n => `${n} thread${n === 1 ? "" : "s"}`;
    // The archive runs now; Undo waits for it to settle, then unarchives exactly what was archived (no race).
    const op = archive(ids);
    // Undo is sent at once; the proxy orders it behind the still-running archive per thread (reload-safe).
    const undo = async () => {
      toast(`Restoring ${plural(ids.length)}…`, 0, null, 0);
      const u = await archive(ids, true);
      ids.forEach(i => dismissed.delete(i));
      toast(u.ok ? `Restored ${plural(ids.length)}` : `Restored ${u.done.length} of ${ids.length}. ${plural(u.failed.length)} couldn't be restored.`, 0, null);
      refresh(true);
    };
    pushUndo(labelText ?? `Archived ${titleOf(entries[0].id)}`, extra, undo);
    setTimeout(() => render(true), entries.length * 70 + 700);
    op.then(r => {
      if (r.ok || undoInFlight(undo)) return;
      // Only what failed comes back; what succeeded stays archived and stays undoable.
      r.failed.forEach(f => dismissed.delete(f.id));
      if (!r.done.length) {
        dropUndo(undo);
        toast("Couldn't archive. Restored it.", 0, null);
      } else {
        toast(`Archived ${r.done.length} of ${ids.length}. ${plural(r.failed.length)} couldn't be archived.`, 0, () => { dropUndo(undo); undo(); });
      }
      refresh(true);
    });
  }

  // True once the user has pressed Undo for this archive (its entry has left the stack).
  const undoInFlight = fn => !undoStack.some(u => u.fn === fn);

  // Mark done: Amp has no "read" state for an Ask (it's the agent's last message waiting on input), so this is ours:
  // the row stays hidden until the thread changes (a new message or state), with no time limit.
  const markDone = (el, id) => snoozeItem(el, id, true);

  function snoozeItem(el, id, done = false) {
    if (!id) return closeTray(el);
    const it = model.flatMap(i => [i, ...(i.children ?? [])]).find(i => i.id === id);
    snoozed.set(id, { kind: it?.kind ?? null, since: it?.since ?? null, at: Date.now(), ...(done ? { done: true } : {}) });
    saveSnoozed();
    model = model.filter(i => i.id !== id);
    el.removeAttribute("data-thread-id");
    el.setAttribute("data-leaving", "");
    swipe.active = false;
    const gone = reduceMotion.matches ? Promise.resolve() : el.animate(done
      ? [{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(0.97)" }]
      : [{ opacity: 1, transform: "translateX(0)" }, { opacity: 0, transform: "translateX(40%)" }], { duration: done ? 200 : 260, easing: EASE, fill: "forwards" }).finished.catch(() => {});
    gone.then(() => collapse(el, 220)).then(() => render(true));
    pushUndo(`${done ? "Marked done" : "Snoozed"} ${titleOf(id)}`, 0, () => { snoozed.delete(id); saveSnoozed(); recompute(true); });
  }

  function pushUndo(text, extra, fn) {
    undoStack.push({ fn, at: Date.now() });
    if (undoStack.length > 20) undoStack.shift();
    toast(text, extra, () => { dropUndo(fn); fn(); });
  }
  function dropUndo(fn) {
    const i = undoStack.findIndex(u => u.fn === fn);
    if (i !== -1) undoStack.splice(i, 1);
  }
  function undoLast() {
    const u = undoStack.pop();
    if (!u || Date.now() - u.at > 10 * 60_000) return false;
    hideToast();
    u.fn();
    return true;
  }

  // Moving on: everything finished and unread leaves together, staggered.
  function doneEntries() {
    const done = [];
    for (const it of model) {
      if (it.kind === "review" && !(it.children ?? []).some(c => c.kind !== "review")) done.push({ id: it.id, el: findItem(it.id) });
      else for (const c of it.children ?? []) if (c.kind === "review") done.push({ id: c.id, el: findChild(c.id) });
    }
    return done;
  }
  function archiveAllDone() {
    const done = doneEntries();
    if (done.length) archiveItems(done, `Archived ${done.length} done thread${done.length === 1 ? "" : "s"}`);
  }

  // ⌃⌘A: archive the open thread and open the next one in the list (Mail's shortcut).
  function visibleOrder() {
    return [...document.querySelectorAll("[data-amp-focus-root] [data-thread-id] > [data-amp-focus-row]")]
      .filter(isShown)
      .map(r => r.parentElement.dataset.threadId);
  }
  function archiveAndAdvance() {
    const open = activeIdSet();
    const order = visibleOrder();
    const cur = order.find(id => open.has(id));
    if (!cur) return false;
    const i = order.indexOf(cur);
    const next = order.slice(i + 1).find(id => !familyIds(cur).includes(id)) ?? order.slice(0, i).reverse()[0];
    const el = findAny(cur);
    const r = el?.getBoundingClientRect();
    archiveItems([{ el, id: cur, point: r ? { x: r.right - 20, y: r.top + 14 } : undefined }]);
    if (next) navigate(next, hrefOf(next), {});
    return true;
  }

  let toastTimer = 0;
  function hideToast() {
    const t = document.querySelector("[data-amp-focus-toast]");
    if (!t) return;
    t.removeAttribute("data-show");
    setTimeout(() => { if (!t.hasAttribute("data-show")) t.hidden = true; }, 280);
  }
  function toast(text, extra, onUndo, duration = 6000) {
    const root = ensureRoot();
    if (!root) return;
    const t = root.querySelector("[data-amp-focus-toast]");
    t.innerHTML = `<span data-toast-text>${esc(text)}${extra ? ` <span data-toast-extra>and ${extra} sub-thread${extra === 1 ? "" : "s"}</span>` : ""}</span>${onUndo ? `<button type="button" data-undo>Undo</button>` : ""}`;
    t.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => t.setAttribute("data-show", "")));
    clearTimeout(toastTimer);
    if (duration) toastTimer = setTimeout(hideToast, duration);
    t.querySelector("[data-undo]")?.addEventListener("click", () => { clearTimeout(toastTimer); hideToast(); onUndo(); }, { once: true });
  }

  // ---------- filter menu (Amp's filter button; Amp's menu classes once seen, tokens until then) ----------
  const MENU_KEY = "amp.menuClasses";
  let menuCls = store.get(MENU_KEY, null);
  function learnMenuClasses(node) {
    const menu = node.matches?.('[role="menu"]') ? node : node.querySelector?.('[role="menu"]');
    if (!menu || menu.closest("[data-amp-focus-root]")) return;
    const item = menu.querySelector('[role="menuitem"]');
    const sep = menu.querySelector('[role="separator"]');
    if (!item) return;
    menuCls = { menu: menu.className, item: item.className, sep: sep?.className ?? "" };
    store.set(MENU_KEY, menuCls);
  }

  const KIND_LABEL = { approve: "Approvals", asking: "Questions", failed: "Failures", stalled: "Stalled", review: "Done, unread", working: "Working" };
  const AGES = [[1, "Last 24 hours"], [7, "Last 7 days"], [14, "Last 14 days"], [0, "Any time"]];
  const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
  const VIEW_LEAD = { status: ["kinds", "age", "projects"], project: ["projects", "kinds", "age"], day: ["age", "kinds", "projects"] };
  const DETAILS = { context: "What it needs", tree: "Repo and branch", model: "Model", time: "Time", badge: "State badge", family: "Sub-thread summary" };

  function menuHTML() {
    const f = F();
    const check = (key, on, text, extra = "") =>
      `<button type="button" role="menuitemcheckbox" aria-checked="${on}" data-f="${esc(key)}" class="${esc(menuCls?.item ?? "")}"><span data-check>${on ? CHECK : ""}</span><span data-label>${esc(text)}</span>${extra}</button>`;
    const seg = (pairs, current, prefix) => `<div data-seg role="radiogroup">${pairs.map(([v, t]) =>
      `<button type="button" role="menuitemradio" aria-checked="${current === v}" data-f="${prefix}${v}">${esc(t)}</button>`).join("")}</div>`;
    const action = (key, text, hint = "") => `<button type="button" role="menuitem" data-f="${key}" class="${esc(menuCls?.item ?? "")}"><span data-label>${esc(text)}</span>${hint ? `<span data-hint>${hint}</span>` : ""}</button>`;
    const section = (title, body, cls = "") => `<section data-menu-section${cls ? ` data-${cls}` : ""}><div data-menu-heading>${esc(title)}</div>${body}</section>`;
    const doneCount = doneEntries().length;

    const show = section("Show", `<div data-grid>${Object.keys(KIND_LABEL).map(k => check(`kind:${k}`, f.kinds[k], KIND_LABEL[k])).join("")}</div>`);
    const updated = section("Updated", seg([[1, "24h"], [7, "7d"], [14, "14d"], [0, "Any"]], f.age, "age:"));
    const projects = allRepos.length ? section("Projects", `<div data-grid data-scroll>${allRepos.map(r => check(`repo:${r}`, !f.hidden.includes(r), r)).join("")}</div>`) : "";
    const threads = section("Threads", `<div data-grid>${check("nest", f.nest, "Nest sub-threads")}${check("scope", f.scope === "all", "Shared threads")}</div>`);
    const lead = { status: [show, updated, projects], project: [projects, show, updated], day: [updated, show, projects] }[prefs.mode].filter(Boolean);
    const details = section("Row details", `<div data-grid>${Object.entries(DETAILS).map(([k, t]) => check(`show:${k}`, prefs.display[k], t)).join("")}</div>`
      + `<div data-seg-row><span>Density</span>${seg([["comfortable", "Comfortable"], ["compact", "Compact"]], prefs.display.density, "density:")}</div>`
      + `<div data-seg-row><span>When narrow</span>${seg([["fade", "Fade details"], ["all", "Wrap"]], prefs.display.fit, "fit:")}</div>`);
    const footer = `<div data-menu-footer>${snoozed.size ? action("unsnooze", "Show snoozed and done", String(snoozed.size)) : ""}${action("archive-done", "Archive all done", doneCount ? String(doneCount) : "")}</div>`;
    return `<div data-menu-top><span data-menu-title>${esc(MODES[prefs.mode])} view</span>${filtersAreDefault() ? "" : `<button type="button" data-f="reset" data-menu-reset>Reset</button>`}</div>`
      + `<div data-menu-body>${[...lead, threads].join("")}${details}</div>` + footer;
  }

  function applyFilter(key) {
    const f = F();
    if (key.startsWith("show:")) { const k = key.slice(5); prefs.display[k] = !prefs.display[k]; }
    else if (key.startsWith("fit:")) prefs.display.fit = key.slice(4);
    else if (key.startsWith("density:")) prefs.display.density = key.slice(8);
    else if (key.startsWith("kind:")) { const k = key.slice(5); f.kinds[k] = !f.kinds[k]; }
    else if (key === "scope") f.scope = f.scope === "all" ? "mine" : "all";
    else if (key === "nest") f.nest = !f.nest;
    else if (key.startsWith("age:")) f.age = Number(key.slice(4));
    else if (key.startsWith("repo:")) { const r = key.slice(5); f.hidden = f.hidden.includes(r) ? f.hidden.filter(x => x !== r) : [...f.hidden, r]; }
    else if (key === "reset") prefs.filtersByView[prefs.mode] = freshFilters(prefs.mode);
    else if (key === "unsnooze") { snoozed.clear(); saveSnoozed(); }
    store.set("focus.filtersByView", prefs.filtersByView);
    store.set("focus.display", prefs.display);
    recompute(true);
  }

  function openMenu(root, open) {
    const menu = root.querySelector("[data-amp-focus-menu]");
    const btn = root.querySelector("[data-filter-btn]");
    if (open) {
      menu.className = menuCls?.menu ?? "";
      menu.innerHTML = menuHTML();
      menu.hidden = false;
      requestAnimationFrame(() => menu.setAttribute("data-show", ""));
    } else {
      menu.removeAttribute("data-show");
      setTimeout(() => { if (!menu.hasAttribute("data-show")) menu.hidden = true; }, 160);
    }
    btn.setAttribute("aria-expanded", String(open));
    btn.dataset.active = String(open);
  }

  // Navigation goes through Amp's own row so Space threads open in their Space (their href alone 500s).
  // Threads outside Amp's list go through a throwaway link so SvelteKit's router still handles them.
  function navigate(id, href, e) {
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

  // Pin = Amp's own per-row pin button (it ignores .click(), so send the pointer sequence Amp listens for).
  function pressAmp(b) {
    const r = b.getBoundingClientRect(), o = { bubbles: true, cancelable: true, composed: true, clientX: r.left + 4, clientY: r.top + 4, button: 0 };
    b.dispatchEvent(new PointerEvent("pointerdown", { ...o, pointerType: "mouse", isPrimary: true }));
    b.dispatchEvent(new MouseEvent("mousedown", o));
    b.dispatchEvent(new PointerEvent("pointerup", { ...o, pointerType: "mouse", isPrimary: true }));
    b.dispatchEvent(new MouseEvent("mouseup", o));
    b.dispatchEvent(new MouseEvent("click", o));
  }
  function pinThread(id) {
    const a = document.querySelector(`a[data-sidebar-thread-id="${CSS.escape(id)}"]`);
    const b = a?.querySelector("[data-thread-row-pin]");
    if (!b) { toast(`Couldn't pin ${titleOf(id)}: Amp's pin button wasn't found`, 0, null); return; }
    const was = a.hasAttribute("data-thread-row-pinned");
    pressAmp(b);
    toast(`${was ? "Unpinned" : "Pinned"} ${titleOf(id)}`, 0, null);
  }

  // Retry = Amp's own Retry in the thread view (it re-runs the failed turn); we open the thread and press it.
  async function retryThread(id, href) {
    navigate(id, href, {});
    const title = titleOf(id);
    const isRetry = b => !b.closest('[data-slot="sidebar"], [data-amp-focus-root]') && b.offsetParent !== null
      && /^(retry|try again)$/i.test((b.getAttribute("aria-label") || b.textContent || "").trim());
    const t0 = Date.now();
    while (Date.now() - t0 < 6000) {
      await new Promise(r => setTimeout(r, 250));
      const btn = [...document.querySelectorAll("main button, main [role=button]")].find(isRetry);
      if (btn && location.pathname.includes(id)) {
        btn.click();
        toast(`Retrying ${title}`, 0, null);
        return true;
      }
    }
    toast(`Opened ${title}. Amp didn't show a Retry here.`, 0, null);
    return false;
  }

  async function openAmpMenu(id, x, y) {
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

  // ---------- trackpad swipe (Mail-style): left = archive tray / full archive, right = snooze ----------
  const coarse = matchMedia("(pointer: coarse)");
  let TRAY = coarse.matches ? 96 : 76; // two tray tiles + gap: 2×2.125rem (fine) / 2×2.75rem (touch)
  coarse.addEventListener?.("change", () => { TRAY = coarse.matches ? 96 : 76; });
  let trayTimer = 0;
  function setOffset(item, x, settle) {
    const row = item.querySelector(":scope > [data-amp-focus-row]");
    item.toggleAttribute("data-swiping", !settle);
    row.style.transform = x ? `translateX(${x}px)` : "";
    item.style.setProperty("--reveal", Math.min(1, Math.max(0, -x / TRAY)).toFixed(3));
    item.style.setProperty("--snooze", Math.min(1, Math.max(0, x / TRAY)).toFixed(3));
    item.toggleAttribute("data-open", settle && x <= -TRAY);
    item.toggleAttribute("data-commit", !settle && x < -swipe.w * 0.55);
    item.toggleAttribute("data-snooze-commit", !settle && x > swipe.w * 0.4);
    if (settle && x <= -TRAY) {
      // An open tray never freezes the list: it closes itself if left alone.
      clearTimeout(trayTimer);
      trayTimer = setTimeout(() => { if (item.isConnected && !item.matches(":hover")) closeTray(item); }, 4000);
    }
  }
  function closeTray(item) {
    setOffset(item, 0, true);
    if (pending) render();
  }

  function endSwipe() {
    const { item, x } = swipe;
    swipe.active = false;
    swipe.item = null;
    if (!item) return;
    if (!item.dataset.threadId) return closeTray(item);
    if (x < -swipe.w * 0.55) {
      const r = item.getBoundingClientRect();
      return archiveItems([{ el: item, id: item.dataset.threadId, point: { x: r.right - 16, y: r.top + 14 } }]);
    }
    if (x > swipe.w * 0.4) return snoozeItem(item, item.dataset.threadId);
    setOffset(item, x < -TRAY * 0.6 ? -TRAY : 0, true);
    if (pending && x >= -TRAY * 0.6) render();
  }

  // Arrow order: rows, plus the "N finished" disclosure and "Show more" where visible.
  const navOrder = root => [...root.querySelectorAll("[data-thread-id] > [data-amp-focus-row], [data-kids-more], [data-finished-toggle], [data-finished-more]")].filter(isShown);
  function focusNav(root, el) {
    root.querySelectorAll('[tabindex="0"]').forEach(r => r.setAttribute("tabindex", "-1"));
    el.setAttribute("tabindex", "0");
    el.focus();
    el.scrollIntoView({ block: "nearest" });
  }
  function onDisclosureKey(e, el, root) {
    const order = navOrder(root);
    const i = order.indexOf(el);
    const id = el.closest("[data-amp-focus-item]").dataset.threadId;
    let handled = true;
    if (e.key === "ArrowDown") order[i + 1] && focusNav(root, order[i + 1]);
    else if (e.key === "ArrowUp") order[i - 1] && focusNav(root, order[i - 1]);
    else if (el.matches("[data-finished-toggle]") && (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ")) {
      if (e.key === "ArrowRight" && prefs.finishedOpen.has(id)) handled = false;
      else setFinishedOpen(id, e.key === "ArrowRight" ? true : !prefs.finishedOpen.has(id));
      requestAnimationFrame(() => el.isConnected && el.focus());
    }
    else if (el.matches("[data-finished-toggle]") && e.key === "ArrowLeft") {
      if (prefs.finishedOpen.has(id)) setFinishedOpen(id, false);
      else focusNav(root, el.closest("[data-amp-focus-item]").querySelector(":scope > [data-amp-focus-row]"));
    }
    else if (el.matches("[data-finished-more], [data-kids-more]") && (e.key === "Enter" || e.key === " ")) el.click();
    else handled = false;
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  }

  // Keyboard on our rows runs in the capture phase so Amp's own sidebar key bindings don't swallow it.
    // Keyboard: arrows move between rows; →/← expand/collapse a family; Enter opens; E archives; S snoozes;
    // ⇧F10 / context-menu key opens Amp's menu. Same keys Amp uses where it has them (E = Archive).
  function onRowKey(e) {
      const row = e.target.closest?.("[data-amp-focus-row], [data-kids-more], [data-finished-toggle], [data-finished-more]");
      if (!row || e.target !== row || e.metaKey || e.ctrlKey || e.altKey) return;
      const root = row.closest("[data-amp-focus-root]");
      if (!root) return;
      if (!row.matches("[data-amp-focus-row]")) return onDisclosureKey(e, row, root);
      const holder = row.parentElement;
      const id = holder.dataset.threadId;
      const item = holder.closest("[data-amp-focus-item]");
      const rowsInOrder = () => navOrder(root);
      const move = step => {
        const list = rowsInOrder();
        const next = list[list.indexOf(row) + step];
        if (next) focusNav(root, next);
      };
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      // Letter shortcuts only when the row was reached by keyboard (a click focuses it too; typing must not archive).
      if ((key === "e" || key === "s" || key === "d" || key === "p") && !row.matches(":focus-visible")) return;
      const expand = open => {
        if (!item || holder !== item || !item.querySelector(":scope > [data-family]:not([hidden])")) return false;
        if (prefs.expanded.has(id) === open) return false;
        open ? prefs.expanded.add(id) : prefs.expanded.delete(id);
        store.set("focus.expanded", [...prefs.expanded]);
        item.toggleAttribute("data-expanded", open);
        item.querySelector("[data-family-toggle]")?.setAttribute("aria-expanded", String(open));
        return true;
      };
      let handled = true;
      if (key === "ArrowDown") move(1);
      else if (key === "ArrowUp") move(-1);
      else if (key === "ArrowRight") { if (!expand(true)) handled = false; }
      else if (key === "ArrowLeft") { if (!expand(false) && holder !== item) item.querySelector(":scope > [data-amp-focus-row]").focus(); }
      else if (key === "Enter" || key === " ") navigate(id, row.dataset.href, e);
      else if (key === "e") {
        const fam = new Set(holder === item ? familyIds(id) : []);
        const list = rowsInOrder().filter(r => !fam.has(r.parentElement.dataset.threadId));
        const next = list[list.indexOf(row) + 1] ?? list[list.indexOf(row) - 1];
        const r = row.getBoundingClientRect();
        archiveItems([{ el: holder, id, point: { x: r.right - 20, y: r.top + 14 } }]);
        next?.focus();
      }
      else if (key === "s" && holder === item) snoozeItem(item, id);
      else if (key === "d" && row.dataset.kind === "asking") markDone(holder, id);
      else if (key === "p") pinThread(id);
      else if (key === "ContextMenu" || (key === "F10" && e.shiftKey)) { const r = row.getBoundingClientRect(); openAmpMenu(id, r.left + 24, r.bottom); }
      else handled = false;
      if (handled) { e.preventDefault(); e.stopPropagation(); }
    }

  let lastMenuAt = 0;
  // Per-root listeners (the root can be recreated; these die with it).
  function wireRoot(root) {
    let suppressUntil = 0; // a drag/long-press must not also click; expires so it can't eat the next real tap
    root.addEventListener("click", e => {
      if (performance.now() < suppressUntil) { e.preventDefault(); return; }
      if (e.target.closest("[data-filter-btn]")) return openMenu(root, root.querySelector("[data-amp-focus-menu]").hidden);
      const fItem = e.target.closest("[data-amp-focus-menu] [data-f]");
      if (fItem) {
        const key = fItem.dataset.f;
        if (key === "archive-done") { openMenu(root, false); return archiveAllDone(); }
        applyFilter(key);
        root.querySelector("[data-amp-focus-menu]").innerHTML = menuHTML();
        return;
      }
      const modeBtn = e.target.closest("[data-mode]");
      if (modeBtn) {
        prefs.mode = modeBtn.dataset.mode;
        store.set("focus.mode", prefs.mode);
        if (!root.querySelector("[data-amp-focus-menu]").hidden) root.querySelector("[data-amp-focus-menu]").innerHTML = menuHTML();
        return recompute(true);
      }
      if (e.target.closest("[data-toggle]")) {
        prefs.focus = !prefs.focus;
        store.set("focus.on", prefs.focus);
        if (failed) { recoveries = 0; return recover(); }
        applyMode();
        return render(true);
      }
      const finToggle = e.target.closest("[data-finished-toggle]");
      if (finToggle) {
        e.preventDefault();
        const id = finToggle.closest("[data-amp-focus-item]").dataset.threadId;
        return setFinishedOpen(id, !prefs.finishedOpen.has(id));
      }
      const kidsMore = e.target.closest("[data-kids-more]");
      if (kidsMore) {
        e.preventDefault();
        prefs.kidsAll.add(kidsMore.closest("[data-amp-focus-item]").dataset.threadId);
        return render(true);
      }
      const finMore = e.target.closest("[data-finished-more]");
      if (finMore) {
        e.preventDefault();
        const id = finMore.closest("[data-amp-focus-item]").dataset.threadId;
        prefs.finishedShown.set(id, (prefs.finishedShown.get(id) ?? FINISHED_PAGE) + 20);
        return render(true);
      }
      const toggle = e.target.closest("[data-family-toggle]");
      if (toggle) {
        e.preventDefault();
        const item = toggle.closest("[data-amp-focus-item]");
        const id = item.dataset.threadId;
        prefs.expanded.has(id) ? prefs.expanded.delete(id) : prefs.expanded.add(id);
        store.set("focus.expanded", [...prefs.expanded]);
        item.toggleAttribute("data-expanded", prefs.expanded.has(id));
        toggle.setAttribute("aria-expanded", String(prefs.expanded.has(id)));
        return;
      }
      const actBtn = e.target.closest("[data-act]");
      if (actBtn) {
        e.preventDefault();
        e.stopPropagation();
        // The row the action belongs to: a sub-thread row inside a family, or the item itself.
        const holder = actBtn.closest("[data-amp-focus-child], [data-amp-focus-finished]") ?? actBtn.closest("[data-amp-focus-item]");
        const id = holder.dataset.threadId;
        const r = actBtn.getBoundingClientRect();
        if (actBtn.dataset.act === "archive") archiveItems([{ el: holder, id, point: { x: r.left + r.width / 2, y: r.top + r.height / 2 } }]);
        else if (actBtn.dataset.act === "done") markDone(holder, id);
        else if (actBtn.dataset.act === "pin") pinThread(id);
        else if (actBtn.dataset.act === "retry") retryThread(id, holder.querySelector(":scope > [data-amp-focus-row]")?.dataset.href ?? hrefOf(id));
        else openAmpMenu(id, r.left, r.bottom + 4);
        return;
      }
      const open = e.target.closest("[data-amp-focus-item][data-open]");
      if (open) { e.preventDefault(); closeTray(open); return; }
      const row = e.target.closest("[data-amp-focus-row]");
      if (row) navigate(row.closest("[data-thread-id]").dataset.threadId, row.dataset.href, e);
    });

    root.addEventListener("contextmenu", e => {
      const holder = e.target.closest("[data-thread-id]");
      if (!holder) return;
      e.preventDefault();
      if (performance.now() - lastMenuAt < 800) return; // long-press already opened it
      openAmpMenu(holder.dataset.threadId, e.clientX, e.clientY);
    });

    root.addEventListener("wheel", e => {
      const item = e.target.closest("[data-amp-focus-item]");
      if (!item || e.target.closest("[data-family]") || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      if (swipe.item !== item) {
        if (swipe.item) setOffset(swipe.item, 0, true);
        const t = getComputedStyle(item.querySelector(":scope > [data-amp-focus-row]")).transform;
        const x = t && t !== "none" ? new DOMMatrixReadOnly(t).m41 : 0;
        Object.assign(swipe, { item, x, raw: x, w: item.offsetWidth });
      }
      swipe.active = true;
      swipe.raw -= e.deltaX;
      // Left follows the finger up to a full swipe; right follows with resistance (snooze).
      swipe.x = swipe.raw > 0 ? Math.min(swipe.w * 0.6, swipe.raw * 0.75) : Math.max(swipe.raw, -swipe.w);
      setOffset(item, swipe.x, false);
      clearTimeout(swipe.timer);
      swipe.timer = setTimeout(endSwipe, 140);
    }, { passive: false });

    // Touch / pen: drag a row sideways (vertical stays native scroll via touch-action: pan-y); long-press → Amp's menu.
    let touch = null;
    root.addEventListener("pointerdown", e => {
      if (e.pointerType === "mouse" || !e.isPrimary) return;
      if (touch) clearTimeout(touch.holdTimer);
      const item = e.target.closest("[data-amp-focus-item]");
      if (!item || e.target.closest("[data-family], [data-act], [data-family-toggle]")) return;
      const holdTimer = setTimeout(() => {
        if (!touch || touch.dragging) return;
        touch.held = true;
        lastMenuAt = performance.now();
        openAmpMenu(item.dataset.threadId, e.clientX, e.clientY);
      }, 500);
      touch = { item, id: e.pointerId, x0: e.clientX, y0: e.clientY, last: e.clientX, dragging: false, held: false, holdTimer };
    });
    root.addEventListener("pointermove", e => {
      if (!touch || e.pointerId !== touch.id) return;
      const dx = e.clientX - touch.x0;
      const dy = e.clientY - touch.y0;
      if (!touch.dragging) {
        if (Math.abs(dy) > 10) { clearTimeout(touch.holdTimer); touch = null; return; } // a scroll, not a swipe
        if (Math.abs(dx) < 8) return;
        touch.dragging = true;
        clearTimeout(touch.holdTimer);
        touch.item.setPointerCapture?.(e.pointerId);
        const t = getComputedStyle(touch.item.querySelector(":scope > [data-amp-focus-row]")).transform;
        const x = t && t !== "none" ? new DOMMatrixReadOnly(t).m41 : 0;
        Object.assign(swipe, { item: touch.item, x, raw: x, w: touch.item.offsetWidth, active: true });
      }
      swipe.raw += e.clientX - touch.last;
      touch.last = e.clientX;
      swipe.x = swipe.raw > 0 ? Math.min(swipe.w * 0.6, swipe.raw * 0.75) : Math.max(swipe.raw, -swipe.w);
      setOffset(touch.item, swipe.x, false);
    });
    const endTouch = (e, cancelled) => {
      if (!touch || e.pointerId !== touch.id) return;
      clearTimeout(touch.holdTimer);
      const { dragging, held, item } = touch;
      touch = null;
      if (dragging || held) suppressUntil = performance.now() + 350;
      if (!dragging) return;
      if (cancelled) { swipe.active = false; swipe.item = null; closeTray(item); } // a system-cancelled gesture never commits
      else endSwipe();
    };
    root.addEventListener("pointerup", e => endTouch(e, false));
    root.addEventListener("pointercancel", e => endTouch(e, true));
    root.addEventListener("pointermove", e => { if (e.pointerType === "mouse") lastMouseMove = performance.now(); }, { passive: true });

    root.addEventListener("pointerleave", () => {
      if (swipe.active) return;
      root.querySelectorAll("[data-amp-focus-item][data-open]").forEach(closeTray);
      if (pending) render();
    });
  }

  // ---------- loop ----------
  let rows = new Map();
  const cliRecent = () => cli.filter(t => Date.now() - Date.parse(t.updated) < RECENT_MS).map(t => t.id);
  const currentIds = () => [...new Set([...rows.keys(), ...cliRecent()])].filter(id => !dismissed.has(id));

  function sweepDismissed() {
    const cliIds = new Set(cli.map(t => t.id));
    for (const [id, at] of dismissed) {
      const goneEverywhere = !rows.has(id) && !cliIds.has(id);
      if (goneEverywhere && Date.now() - at > 10_000) dismissed.delete(id);
    }
  }

  // Skip renders when nothing visible changed (the 5s refresh usually finds nothing new).
  let lastModelSig = "";
  const modelSig = () => JSON.stringify([prefs.mode, prefs.focus, model.map(i => [i.id, i.kind, i.lead, i.context, i.since, i.d.title, i.held, i.finished, i.total, (i.children ?? []).map(c => [c.id, c.kind, c.context, c.since])])]);
  let searching = false;
  const ampSearch = () => {
    const box = document.querySelector('[data-testid="sidebar-list-search"]');
    const q = box?.querySelector('[data-testid="sidebar-list-search-input"]')?.value.trim();
    return box?.dataset.open === "true" && !!q;
  };
  function searchItems() {
    return [...rows].map(([id, row]) => {
      const d0 = cache.get(id)?.d;
      const c = classify(d0, row) ?? quiet(d0, row);
      return { id, d: d0 ?? { title: row.title || "Thread" }, href: row.href, inAmp: true, space: row.space, spaceColor: row.spaceColor, pinned: row.pinned,
        ...c, children: [], lead: c.kind, leadSince: c.since, finished: 0, total: 0 };
    });
  }

  function recompute(force = false) {
    const was = searching;
    searching = ampSearch();
    if (was !== searching) { force = true; document.querySelector("[data-amp-focus-root]")?.toggleAttribute("data-searching", searching); }
    model = searching ? searchItems() : buildItems(rows, currentIds());
    const sig = modelSig();
    if (!force && !pending && sig === lastModelSig && document.querySelector("[data-amp-focus-root]")?.isConnected) return;
    lastModelSig = sig;
    render(force);
  }
  // Relative times ("3m", "2h") tick in place once a minute, without a render.
  setInterval(() => {
    if (document.hidden) return;
    const byId = new Map(model.flatMap(i => [i, ...(i.children ?? [])]).map(i => [i.id, i]));
    document.querySelectorAll("[data-amp-focus-root] [data-thread-id] > [data-amp-focus-row] [data-time]").forEach(t => {
      const it = byId.get(t.closest("[data-thread-id]").dataset.threadId);
      if (it) setText(t, ago(it.since));
    });
  }, 60_000);

  let busy = false;
  let lastFullRead = 0;
  async function refresh(forceRender = false) {
    if (busy || document.hidden) return;
    busy = true;
    try {
      // The live observer keeps `rows` current; a full re-read is a once-a-minute safety net.
      if (!rows.size || Date.now() - lastFullRead > 60_000) { rows = readAmp(); lastFullRead = Date.now(); }
      sweepDismissed();
      const updatedById = new Map(cli.map(t => [t.id, t.updated]));
      if (!me) {
        const seed = cliRecent().slice(0, 5).filter(id => !cache.get(id)?.d);
        if (seed.length) await fetchMany(seed);
      }
      const m = computeMe();
      if (m && m !== me) { me = m; store.set("focus.me", me); }
      await fetchMany(currentIds().filter(id => due(id, updatedById.get(id))));
      // Rebuild from the ids as they are *now* (an archive may have happened during the fetch).
      recompute(forceRender);
    } finally {
      busy = false;
    }
  }

  // Live: render from Amp's row signals immediately, then refine once the changed threads are refetched.
  let lastSigs = new Map();
  let liveTimer = 0;
  let liveFirst = 0;
  const ours = m => (m.target.nodeType === 1 ? m.target : m.target.parentElement)?.closest?.("[data-amp-focus-root]");

  let touched = new Set();
  let structuralChange = false;
  function onSidebarMutation(muts) {
    if (!document.querySelector("[data-amp-focus-root]")?.isConnected) { rows = readAmp(); render(true); }
    if (muts.every(ours)) return;
    for (const m of muts) {
      if (ours(m)) continue;
      const el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      if (m.attributeName === "data-open") { structuralChange = true; searchFlip = true; continue; }
      const a = el?.closest?.("a[data-sidebar-thread-id]");
      if (a) touched.add(a);
      else if (m.type === "childList") structuralChange = true;
    }
    const now = performance.now();
    if (!liveFirst) liveFirst = now;
    clearTimeout(liveTimer);
    // 150ms trailing debounce, but never more than 500ms behind a burst (streaming status lines).
    liveTimer = setTimeout(liveTick, Math.max(0, Math.min(150, 500 - (now - liveFirst))));
  }

  // Hover intent for rows with a sub-thread toggle: the toggle only slides aside once the pointer has rested on the row
  // away from it, so you can reach and click the toggle where it is. Once revealed, it stays until the pointer leaves the row.
  const REVEAL_MS = 260;
  let revealRow = null, revealTimer = 0;
  const clearReveal = () => { clearTimeout(revealTimer); revealTimer = 0; revealRow?.removeAttribute("data-reveal"); revealRow = null; };
  document.addEventListener("pointermove", e => {
    if (e.pointerType !== "mouse") return;
    const row = e.target.closest?.("[data-amp-focus-root] [data-amp-focus-row]");
    if (row !== revealRow) { clearReveal(); revealRow = row; }
    if (!row || row.hasAttribute("data-reveal") || !row.querySelector("[data-family-toggle]")) return;
    if (e.target.closest("[data-trail]")) { clearTimeout(revealTimer); revealTimer = 0; return; }
    if (!revealTimer) revealTimer = setTimeout(() => { revealTimer = 0; if (revealRow === row && row.matches(":hover")) row.setAttribute("data-reveal", ""); }, REVEAL_MS);
  }, { passive: true });
  document.addEventListener("pointerleave", clearReveal);

  let searchFlip = false;
  // Typing in Amp's search box: Amp swaps its rows, the observer picks that up; this covers a query that leaves the same rows.
  document.addEventListener("input", e => { if (e.target.matches?.('[data-testid="sidebar-list-search-input"]')) { clearTimeout(liveTimer); liveTimer = setTimeout(liveTick, 120); } }, true);

  async function liveTick() {
    liveFirst = 0;
    perf.live++;
    // Re-read only the Amp rows the mutations touched, unless the list's structure changed.
    const full = structuralChange || touched.size > 40;
    const touchedNow = touched;
    touched = new Set();
    structuralChange = false;
    let now;
    if (full) now = readAmp();
    else {
      now = new Map(rows);
      for (const a of touchedNow) if (a.isConnected) { const r = readRow(a); r.root = rows.get(a.dataset.sidebarThreadId)?.root ?? null; now.set(a.dataset.sidebarThreadId, r); }
    }
    const changed = [];
    const flipped = [];
    for (const [id, r] of now) {
      const prev = lastSigs.get(id);
      if (prev?.sig !== r.sig) changed.push(id);
      if (prev && prev.flags !== r.flags) flipped.push(id);
    }
    const structural = now.size !== lastSigs.size;
    lastSigs = new Map([...now].map(([id, r]) => [id, { sig: r.sig, flags: r.flags }]));
    rows = now;
    syncActive();
    const holding = model.some(i => i.held || (i.children ?? []).some(c => c.held));
    const flip = searchFlip;
    searchFlip = false;
    if (!changed.length && !structural && !holding && !flip && !searching) return;
    recompute(flip || searching);
    // Detail only when state flags flip (not for every streamed status line); the 15s poll covers the rest.
    const toFetch = flipped.slice(0, 20);
    if (!toFetch.length) return;
    await Promise.all(toFetch.map(id => fetchOne(id)));
    saveCache();
    recompute();
  }

  function start() {
    applyMode();
    rows = readAmp();
    lastSigs = new Map([...rows].map(([id, r]) => [id, { sig: r.sig, flags: r.flags }]));
    // Observe the whole sidebar so a recreated Amp list (or our recreated container) is noticed.
    const sidebar = document.querySelector('[data-slot="sidebar"]');
    new MutationObserver(onSidebarMutation).observe(sidebar, { subtree: true, childList: true, attributes: true, characterData: true, attributeFilter: ["class", "data-active", "data-thread-row-pinned", "data-open"] });

    // Navigation: SvelteKit uses pushState/replaceState. Move the highlight, and release any held (opened) row.
    let lastPath = location.pathname;
    const onNavigate = () => {
      if (location.pathname === lastPath) return;
      lastPath = location.pathname;
      requestAnimationFrame(() => { syncActive(); recompute(); });
    };
    for (const fn of ["pushState", "replaceState"]) {
      const orig = history[fn];
      history[fn] = function (...args) { const r = orig.apply(this, args); onNavigate(); return r; };
    }
    addEventListener("popstate", onNavigate);
    // Learn Amp's menu classes from its portals (body's direct children only — cheap).
    new MutationObserver(muts => { for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) learnMenuClasses(n); })
      .observe(document.body, { childList: true, subtree: false });

    // Document-level listeners: bound once.
    document.addEventListener("pointerdown", e => {
      const menu = document.querySelector("[data-amp-focus-menu]");
      if (menu && !menu.hidden && !e.target.closest("[data-amp-focus-menu], [data-filter-btn]")) openMenu(menu.closest("[data-amp-focus-root]"), false);
    }, true);
    document.addEventListener("keydown", onRowKey, true);
    document.addEventListener("keydown", e => {
      const menu = document.querySelector("[data-amp-focus-menu]");
      if (e.key === "Escape" && menu && !menu.hidden) { e.stopPropagation(); openMenu(menu.closest("[data-amp-focus-root]"), false); return; }
      if (!prefs.focus) return;
      if (e.ctrlKey && e.metaKey && !e.altKey && e.key.toLowerCase() === "a") {
        if (archiveAndAdvance()) e.preventDefault();
        return;
      }
      // ⌘Z undoes our last archive/snooze only when you're not typing somewhere.
      const typing = e.target.closest?.("input, textarea, [contenteditable=''], [contenteditable='true']");
      if (e.metaKey && !e.shiftKey && e.key.toLowerCase() === "z" && !typing && undoStack.length) {
        if (undoLast()) e.preventDefault();
      }
    }, true);

    const archiveById = id => {
      const el = findItem(id);
      const btn = el?.querySelector('[data-act="archive"]');
      if (!el || !btn) return false;
      const r = btn.getBoundingClientRect();
      archiveItems([{ el, id, point: { x: r.left + r.width / 2, y: r.top + r.height / 2 } }]);
      return true;
    };
    setInterval(() => {
      if (document.hidden || !store.get("focus.perfReport", false)) return;
      const secs = (Date.now() - perf.since) / 1000;
      fetch("/__amp-tweaks/report?name=focus-perf", { method: "POST", body: JSON.stringify({ secs: Math.round(secs), ...perf, renderAvgMs: +(perf.renderMs / Math.max(1, perf.renders)).toFixed(2), renderMax: +perf.renderMax.toFixed(1), renderMs: Math.round(perf.renderMs) }) });
    }, 30_000);
    window.__ampFocus = { perf, archive, archiveById, archiveAllDone, archiveAndAdvance, undoLast, refresh, openAmpMenu, navigate, get model() { return model; }, setMode(m) { prefs.mode = m; recompute(true); } };

    (async () => {
      await loadCli();
      await refresh(true);
      setInterval(loadCli, 30_000);
      setInterval(refresh, 5_000);
      setTimeout(() => {
        const r = sel => { const e = document.querySelector(sel); return e ? Math.round(e.getBoundingClientRect().left) : null; };
        const report = {
          url: location.href, me: !!me, cached: cache.size, mode: prefs.mode, loading,
          top: model.length,
          counts: model.reduce((m, i) => ((m[i.kind] = (m[i.kind] ?? 0) + 1), m), {}),
          families: model.filter(i => i.children.length).map(i => ({ title: i.d.title?.slice(0, 40), space: !!i.space, lead: i.lead, children: i.children.map(c => c.kind), finished: i.finished })),
          rendered: { items: document.querySelectorAll("[data-amp-focus-item][data-thread-id]").length, children: document.querySelectorAll("[data-amp-focus-child][data-thread-id]").length, sections: document.querySelectorAll("[data-amp-focus-group]:not([data-leaving])").length },
          align: { heading: r("[data-heading-title]"), icon: r("[data-amp-focus-row] [data-icon]"), title: r("[data-amp-focus-row] [data-title]"), footer: r("[data-amp-focus-footer] button") },
        };
        fetch("/__amp-tweaks/report?name=focus-sidebar", { method: "POST", body: JSON.stringify(report, null, 1) });
      }, 4000);
    })();
  }

  // Only the main window has the thread sidebar (Puck and other aux windows don't): wait for it, else stay idle.
  const t0 = Date.now();
  (function waitForSidebar() {
    if (document.querySelector('[data-slot="sidebar"] [data-testid="sidebar-thread-list"]')) return start();
    if (Date.now() - t0 < 15_000) setTimeout(waitForSidebar, 250);
  })();
})();

