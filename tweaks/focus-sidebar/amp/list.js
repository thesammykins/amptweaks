// Amp adapter (read side, API): the lineage and snoozes behind Amp's sidebar, from the same queries Amp's sidebar uses.
// Amp's DOM flattens nested sub-threads under the root and sometimes doesn't nest a thread at all, so families come
// from here when it answers, and from the DOM when it doesn't.
import { TAG } from "../config.js";
import { S } from "../state.js";
import { query } from "./remote.js";

S.lineage = new Map(); // id → ancestor ids, nearest first (Amp's own order)
S.ampSnoozed = new Set(); // ids Amp has snoozed (it wakes them itself)
S.listAt = 0;

let revs = "";

export async function loadLineage() {
  const [list, snoozes] = await Promise.all([query("listSidebarRecentThreads"), query("listSidebarSnoozes")]);
  const ancestors = list?.sourceThreadAncestors ?? {};
  S.lineage = new Map((list?.recentThreads ?? []).map(t => [t.id, chainOf(t, ancestors)]));
  for (const [id, chain] of Object.entries(ancestors)) if (!S.lineage.has(id)) S.lineage.set(id, chain);
  S.ampSnoozed = new Set((snoozes?.snoozedThreads ?? []).filter(s => !s.archived).map(s => s.threadID));
  S.listAt = Date.now();
}

// Cheap check (a few numbers) before the full list: true when Amp's threads changed since the last look.
export async function lineageStale() {
  if (Date.now() - S.listAt > 120_000) return true;
  const r = await query("getSidebarResourceRevisions");
  const next = JSON.stringify(r ?? null);
  const changed = next !== revs;
  revs = next;
  return changed;
}

export async function refreshLineage(force = false) {
  try {
    if (!force && !(await lineageStale())) return false;
    await loadLineage();
    return true;
  } catch (e) {
    console.warn(TAG, "Amp's thread list didn't answer; families come from the sidebar DOM", e.message);
    return false;
  }
}

// Amp's rule: a parent set by hand wins; otherwise the source thread's ancestors, else the source thread.
function chainOf(t, ancestors) {
  const src = t.parentSetByUser ? [] : ancestors[t.id] ?? (t.origin?.sourceThreadID ? [t.origin.sourceThreadID] : []);
  return t.parentThreadID ? [t.parentThreadID, ...src.filter(id => id !== t.parentThreadID)] : [...src];
}
