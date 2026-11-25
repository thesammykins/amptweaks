// Per-viewer storage (localStorage): prefs, per-view filters, display options, the thread detail cache.
import { MODES, RECENT_MS } from "./config.js";
import { S } from "./state.js";

// ---------- per-viewer storage ----------
export const store = {
  get(k, d) { try { const v = localStorage.getItem(`amp-tweaks:${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`amp-tweaks:${k}`, JSON.stringify(v)); } catch {} },
};

// Nothing persisted outlives the age window: entries for threads that were archived or deleted age out.
const fresh = (entries, at) => entries.filter(([, v]) => at(v) > Date.now() - RECENT_MS);

// Remembered open families, newest last; capped so ids of long-gone threads don't build up.
const MAX_IDS = 200;
export const saveIds = (k, set) => store.set(k, [...set].slice(-MAX_IDS));

export const prefs = {
  focus: store.get("focus.on", true),
  mode: MODES[store.get("focus.mode", "status")] ? store.get("focus.mode", "status") : "status",
  expanded: new Set(store.get("focus.expanded", [])),
  finishedOpen: new Set(store.get("focus.finishedOpen", [])), // families whose finished sub-threads are listed
  finishedShown: new Map(), // per family: how many finished rows are listed (grows with "Show more")
  kidsAll: new Set(), // families showing all active sub-threads (this session)
  subCollapsed: new Set(store.get("focus.subCollapsed", [])), // sub-threads whose own sub-threads are folded away
};

// Filters are per view: each of Status / Project / Day keeps its own.
export const BASE_FILTERS = { kinds: { approve: true, asking: true, failed: true, stalled: true, review: true, working: true }, scope: "mine", age: 14, hidden: [], nest: true };

export const DEFAULT_FILTERS = { status: BASE_FILTERS, project: BASE_FILTERS, day: { ...BASE_FILTERS, age: 7 } };

export const freshFilters = mode => JSON.parse(JSON.stringify(DEFAULT_FILTERS[mode]));

export const loadFilters = () => {
  const saved = store.get("focus.filtersByView", {});
  return Object.fromEntries(Object.keys(MODES).map(m => {
    const f = saved[m] ?? {};
    const d = freshFilters(m);
    return [m, { ...d, ...f, kinds: { ...d.kinds, ...(f.kinds ?? {}) }, hidden: f.hidden ?? [] }];
  }));
};

prefs.filtersByView = loadFilters();

export const F = () => prefs.filtersByView[prefs.mode];

export const filtersAreDefault = () => JSON.stringify(F()) === JSON.stringify(DEFAULT_FILTERS[prefs.mode]);

// Row details: what each row shows (global). Expressed as data attributes on the sidebar root + Amp tokens.
export const DEFAULT_DISPLAY = { context: true, tree: true, model: true, time: true, badge: true, family: true, density: "comfortable", fit: "fade" };

prefs.display = { ...DEFAULT_DISPLAY, ...store.get("focus.display", {}) };

export const applyMode = () => (document.documentElement.dataset.ampFocus = prefs.focus ? "on" : "off");

// Snoozes are Amp's (amp/list.js); clear the per-Mac list earlier versions kept.
localStorage.removeItem("amp-tweaks:focus.snoozed");

// ---------- detail cache (slim, persisted so reloads don't refetch everything) ----------
export const cache = new Map(fresh(Object.entries(store.get("focus.cache.v3", {})), v => v.fetchedAt ?? 0));

export const saveCache = () => {
  clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(() => {
    store.set("focus.cache.v3", Object.fromEntries(fresh([...cache], v => v.fetchedAt ?? 0).filter(([, v]) => v.d)));
  }, 3000);
};

// "Tachi.local" / "rocciemac.sammyk.in" → "Tachi" / "rocciemac": the machine, not its network name.
export const machineName = host => (host ? host.split(".")[0] || null : null);

export function slim(d) {
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
