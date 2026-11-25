// A stand-in for Amp's sidebar, filled with made-up threads, that runs the real focus sidebar on top.
// Serve tweaks/focus-sidebar and open /_demo/ (?tweak=off shows Amp's own list, ?mode=project|day picks the view).
// _demo/shoot.mjs uses it to make the README screenshots, so nothing personal ever ends up in them.
import { flatten, unflatten } from "../amp/remote.js";
import { SPACES, THREADS } from "./threads.js";

const params = new URLSearchParams(location.search);
const MIN = 60_000;
const iso = ago => new Date(Date.now() - ago * MIN).toISOString();
const esc = s => String(s).replace(/[&<>"]/g, c => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot" }[c]};`);

// ---------- prefs: start every load from the same state ----------
for (const k of Object.keys(localStorage)) if (k.startsWith("amp-tweaks:")) localStorage.removeItem(k);
const pref = (k, v) => localStorage.setItem(`amp-tweaks:${k}`, JSON.stringify(v));
pref("focus.mode", params.get("mode") ?? "status");
pref("focus.expanded", (params.get("expand") ?? "T-billing").split(",").filter(Boolean));
pref("amp.menuClasses", { menu: "amp-menu", item: "amp-menu-item", sep: "amp-menu-sep" });

// ---------- Amp's sidebar DOM (the attributes the tweak reads) ----------
const HUES = ["#8b7cf6", "#5fa8d3", "#e0739a", "#59c08a", "#d6a038", "#7aa2f7", "#c08bd9", "#e58a5b"];
const hue = id => HUES[[...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % HUES.length];
const orb = c => `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.6"><circle cx="12" cy="12" r="8.5"/><ellipse cx="12" cy="12" rx="3.6" ry="8.5"/><path d="M3.8 9.5h16.4M3.8 14.5h16.4"/></svg>`;
const space = c => `<span data-thread-row-space-icon data-space-color="${c}"><svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.75" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3"/></svg></span>`;
const unreadStates = new Set(["done", "asking", "approve"]);

function row(t, depth = 0) {
  const isSpace = t.id.startsWith("S-");
  const icon = isSpace ? space(t.color) : orb(hue(t.id));
  // Amp marks a running or failed thread by wrapping its icon.
  const mark = t.state === "working" ? "data-thread-row-running-icon" : t.state === "error" ? "data-thread-row-error" : "";
  const status = t.state === "error" ? t.error : t.status;
  const kids = isSpace || t.kids?.length;
  const blocked = t.offline ? `<span data-thread-row-waiting-for-runner></span>` : t.unsent ? `<span data-thread-row-unsent></span>` : "";
  return `<a href="/threads/${t.id}" data-sidebar-thread-id="${t.id}" data-active="${!!t.active}" data-depth="${depth}" ${t.pinned ? "data-thread-row-pinned" : ""}>
    <div data-thread-row-icon>${mark ? `<span ${mark}>${icon}</span>` : icon}<span data-thread-row-unread-badge class="${unreadStates.has(t.state) ? "" : "opacity-0"}"></span></div>${blocked}
    <div data-amp-text><span data-title-text>${esc(t.title)}</span>${status ? `<span data-thread-row-status-line>${esc(status)}</span>` : ""}</div>
    ${kids ? `<button type="button" data-sidebar-subthreads-toggle class="amp-toggle" aria-expanded="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m18 15-6-6-6 6"/></svg></button>` : ""}
  </a>`;
}
// Like Amp, the DOM nests every descendant directly under the root (one level).
const descendants = t => (t.kids ?? []).flatMap(k => [k, ...descendants(k)]);
const family = t => row(t) + (t.kids?.length ? `<div data-sidebar-subthreads-of="${t.id}">${descendants(t).map(k => row(k, 1)).join("")}</div>` : "");

const FILTER = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M3 6h18M7 12h10M10 18h4"/></svg>`;
const needYou = [...SPACES.flatMap(s => s.kids), ...THREADS.flatMap(t => [t, ...(t.kids ?? [])])].filter(t => ["asking", "approve", "error", "done"].includes(t.state)).length;
const running = [...SPACES.flatMap(s => s.kids), ...THREADS.flatMap(t => [t, ...(t.kids ?? [])])].filter(t => t.state === "working").length;

document.body.innerHTML = `<div data-demo-window>
  <div data-slot="sidebar">
    <div data-amp-top><div class="thread-scrollable-tabs-container"><div class="thread-scrollable-tabs-scroll amp-tabs">
      <button type="button" class="amp-chip" data-sidebar-activity-filter-needs><span data-chip-fill class="amp-chip-fill"></span><span class="relative">${needYou} Need You</span><i data-dot></i></button>
      <button type="button" class="amp-chip" data-sidebar-activity-filter-running><span data-chip-fill class="amp-chip-fill"></span><span class="relative">${running} Running</span></button>
    </div><button type="button" class="amp-icon-btn" data-sidebar-filter-menu aria-label="Filter">${FILTER}</button></div></div>
    <div data-sidebar="group"><div data-testid="sidebar-thread-list">
      <div data-testid="sidebar-list-search" data-open="false"><input data-testid="sidebar-list-search-input"></div>
      <div data-amp-heading>Spaces</div>
      ${SPACES.map(s => family(s)).join("")}
      <div data-amp-heading>Threads</div>
      ${THREADS.map(t => family(t)).join("")}
    </div></div>
  </div>
</div>`;

// Links in a demo go nowhere.
document.addEventListener("click", e => { if (e.target.closest("a[href]")) e.preventDefault(); }, true);

// ---------- Amp's API and the proxy, answered from the made-up threads ----------
const all = [...SPACES, ...THREADS].flatMap(t => [t, ...descendants(t)]);
// Amp's lineage (nearest ancestor first), from the real nesting and apiParent.
const lineage = new Map();
const walk = (t, chain) => { lineage.set(t.id, t.apiParent ? [t.apiParent] : chain); for (const k of t.kids ?? []) walk(k, [t.id, ...chain]); };
for (const t of [...SPACES, ...THREADS]) walk(t, []);
const byId = new Map(all.map(t => [t.id, t]));
const STATE = { working: "working", stalled: "working", approve: "awaiting_approval", error: "error" };

function detail(t) {
  const at = iso(t.ago);
  return {
    id: t.id, title: t.title, creatorUserID: "U-demo", updatedAt: at,
    meta: {
      lastKnownAgentState: { state: STATE[t.state] ?? "idle", updatedAt: at, ...(t.error ? { error: { message: t.error } } : {}) },
      statusMessage: t.status ? { text: t.status, waitingOnInput: t.state === "asking", updatedAt: at } : undefined,
      lastUserMessageAt: at,
      threadModel: t.model ? { model: t.model, reasoningEffort: t.effort } : undefined,
    },
    env: { initial: { trees: t.repo ? [{ repository: { url: `https://github.com/acme/${t.repo}.git`, ref: `refs/heads/${t.branch ?? "main"}` } }] : [] } },
  };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// Amp's remote functions (/_app/remote/<hash>/<name>), in Amp's wire format.
const snoozes = new Set();
let revision = 1;
const remoteResult = result => json({ type: "result", data: flatten({ _: result }) });
const argOf = async init => {
  const { payload } = JSON.parse(init.body);
  return unflatten(JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0)))));
};
const setUnread = (id, on) => {
  document.querySelector(`a[data-sidebar-thread-id="${id}"] [data-thread-row-unread-badge]`)?.classList.toggle("opacity-0", !on);
  revision++;
};
const REMOTE = {
  listSidebarRecentThreads: () => ({ recentThreads: all.filter(t => !snoozes.has(t.id)).map(t => ({ id: t.id, title: t.title, ...(lineage.get(t.id).length ? { origin: { kind: "thread", sourceThreadID: lineage.get(t.id)[0] } } : {}) })),
    sourceThreadAncestors: Object.fromEntries([...lineage].filter(([, c]) => c.length)) }),
  listSidebarSnoozes: () => ({ snoozedThreads: [...snoozes].map(id => ({ threadID: id, archived: false, listed: false, mode: "next_message", snoozedUntil: null })) }),
  getSidebarResourceRevisions: () => ({ threads: revision }),
  snoozeThreadCommand: a => {
    if (a.choice === "off" || a.restore !== undefined) snoozes.delete(a.threadID); else snoozes.add(a.threadID);
    revision++;
    return { previous: { liftedAt: null } };
  },
  markThreadsReadCommand: a => { a.threadIDs.forEach(id => setUnread(id, false)); return { updatedThreadIDs: a.threadIDs }; },
  markThreadUnreadCommand: a => { setUnread(a.threadID, true); return {}; },
};
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input.url, location.href);
  if (url.pathname === "/__amp-tweaks/data/threads.json") return json(all.map(t => ({ id: t.id, updated: iso(t.ago) })));
  if (url.pathname.startsWith("/__amp-tweaks/")) return new Response(null, { status: 204 });
  const r = url.pathname.match(/^\/_app\/remote\/[^/]+\/([A-Za-z]+)$/);
  if (r && REMOTE[r[1]]) {
    const arg = init?.body ? await argOf(init) : undefined;
    // Like Amp: a thread waiting on your input can't be snoozed.
    if (r[1] === "snoozeThreadCommand" && arg.choice !== "off" && byId.get(arg.threadID)?.state === "asking") return json({ type: "error", error: { status: 500, message: "Internal Error" } });
    return remoteResult(REMOTE[r[1]](arg));
  }
  const m = url.pathname.match(/^\/api\/threads\/([^/]+)$/);
  if (m) return byId.has(m[1]) ? json(detail(byId.get(m[1]))) : json({ error: "not found" }, 404);
  return realFetch(input, init);
};

if (params.get("tweak") !== "off") await import("../index.js");
document.documentElement.dataset.demoReady = "";
