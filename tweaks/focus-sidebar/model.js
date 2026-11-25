// Model: classify each thread (working / needs you / done…), build families, group by Status/Project/Day, search results.
import { KIND_ORDER, NEEDS, OLDEST_FIRST, STALL_MS, WORKING } from "./config.js";
import { activeIdSet } from "./render/list.js";
import { S } from "./state.js";
import { F, cache } from "./store.js";

// ---------- classification ----------
export const iso = t => (t ? new Date(t).toISOString() : null);

// Blocked outside the agent (Amp's row says so): its runner dropped off, or your messages never reached it.
function blocked(d, row) {
  const status = row?.status || d?.status || "";
  if (row?.unsent) return { kind: "stalled", verb: "Not sent", context: status, since: d?.lastUserAt ?? null };
  if (row?.offline) return { kind: "stalled", verb: "Offline", context: d?.runner ? `${d.runner}${status ? ` · ${status}` : ""}` : status, since: d?.agentAt ?? null };
  return null;
}

export function classify(d, row) {
  const b = blocked(d, row);
  if (b) return b;
  // No detail yet (cold cache, back-off): Amp's live row still tells us enough to show it.
  if (!d) {
    if (!row) return null;
    if (row.running) return { kind: "working", context: row.status || "Working", since: null };
    if (row.error) return { kind: "failed", verb: "Failed", context: row.status, since: null };
    if (row.unread && !row.spawned) return { kind: "review", verb: "Done", context: row.status, since: null };
    return null;
  }
  const mine = F().scope === "all" || !S.me || d.creator === S.me;
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

export const label = s => (s ?? "").replace(/_/g, " ").replace(/^./, c => c.toUpperCase());

export const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");

export function humanError(message) {
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

export function modelLabel(d) {
  if (!d?.model) return "";
  const id = d.model.split("/").pop();
  let m, name;
  if ((m = id.match(/^claude-([a-z]+)-(\d+)-(\d+)/))) name = `${cap(m[1])} ${m[2]}.${m[3]}`;
  else if ((m = id.match(/^gpt-([\d.]+)-?(.*)$/))) name = `GPT-${m[1]}${m[2] ? " " + m[2].split("-").map(cap).join(" ") : ""}`;
  else name = id.split("-").map(cap).join(" ");
  return d.effort ? `${name} · ${cap(d.effort)}` : name;
}

export function ago(when) {
  const t = Date.parse(when);
  if (!t) return "";
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function dayOf(when) {
  const t = new Date(Date.parse(when) || Date.now());
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today - new Date(t.getFullYear(), t.getMonth(), t.getDate())) / 864e5);
  if (diff <= 0) return { order: 0, title: "Today" };
  if (diff === 1) return { order: 1, title: "Yesterday" };
  if (diff < 7) return { order: diff, title: t.toLocaleDateString(undefined, { weekday: "long" }) };
  return { order: 7, title: "Earlier" };
}

export const rank = k => KIND_ORDER.indexOf(k);

export const ts = when => Date.parse(when) || Date.now();

// Blockers (approve/asks/stalled): oldest first, since they've waited longest. Everything else: newest first.
export const byTime = (kind, a, b) => (OLDEST_FIRST.has(kind) ? ts(a) - ts(b) : ts(b) - ts(a));

export const byUrgency = (a, b) => rank(a.lead) - rank(b.lead) || byTime(a.lead, a.leadSince, b.leadSince);

// ---------- model ----------
S.allRepos = [];

S.loading = false;

export const quiet = (d, row) => ({ kind: "quiet", context: row?.status || d?.status || "", since: d?.agentAt ?? d?.updatedAt ?? null });

export function buildItems(rows, ids) {
  const f = F();
  const maxAge = f.age ? f.age * 864e5 : Infinity;
  const activeIds = activeIdSet();
  const prev = new Map(S.model.flatMap(i => [i, ...(i.children ?? [])]).map(i => [i.id, i]));
  const repos = new Set();
  const active = new Map();
  S.loading = false;
  for (const id of ids) {
    const d0 = cache.get(id)?.d;
    if (d0?.deleted) continue;
    const row = rows.get(id);
    if (!cache.has(id) && row) S.loading = true;
    // Snoozed in Amp (it wakes them itself); a snoozed root takes its family with it.
    if (S.ampSnoozed.has(id) || (f.nest && row?.root && S.ampSnoozed.has(row.root))) continue;
    if (S.readHold.has(id)) { if (S.readHold.get(id) > Date.now() && row?.unread !== false) continue; S.readHold.delete(id); }
    let c = classify(d0, row);
    if (!c && row?.pinned) c = quiet(d0, row);
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
    const r = rows.get(rootId);
    const d = cache.get(rootId)?.d ?? { title: r?.title || "Thread" };
    const item = active.get(rootId) ?? { id: rootId, d, href: r?.href ?? `/threads/${rootId}`, inAmp: !!r, space: !!r?.space, spaceColor: r?.spaceColor, pinned: !!r?.pinned, kind: "parent", since: d.updatedAt };
    item.children = item.children ?? [];
    top.set(rootId, item);
    return item;
  };
  S.allRepos = [...repos].sort((a, b) => a.localeCompare(b));
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

export function group(list, mode) {
  const groups = new Map();
  const add = (key, title, order, item) => {
    if (!groups.has(key)) groups.set(key, { key: String(key), title, order, items: [] });
    groups.get(key).items.push(item);
  };
  if (S.searching) return list.length ? [{ key: "results", title: "Results", order: 0, items: list }] : [];
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

export function searchItems() {
  return [...S.rows].map(([id, row]) => {
    const d0 = cache.get(id)?.d;
    const c = classify(d0, row) ?? quiet(d0, row);
    return { id, d: d0 ?? { title: row.title || "Thread" }, href: row.href, inAmp: true, space: row.space, spaceColor: row.spaceColor, pinned: row.pinned,
      ...c, children: [], lead: c.kind, leadSince: c.since, finished: 0, total: 0 };
  });
}
