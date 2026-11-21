// Network: the proxy's thread list (amp CLI) and /api/threads/:id detail, fetched only when something changed.
import { STALL_MS, TAG, WORKING } from "./config.js";
import { perf } from "./render/list.js";
import { S } from "./state.js";
import { cache, saveCache, slim, store } from "./store.js";

// ---------- network: changes-only, immediate for threads Amp says just changed ----------
S.cli = [];

S.me = store.get("focus.me", null);

S.backoffUntil = 0;

export const inflight = new Set();

export async function loadCli() {
  if (document.hidden) return;
  try {
    S.cli = await (await fetch("/__amp-tweaks/data/threads.json", { cache: "no-store" })).json();
  } catch (e) {
    console.warn(TAG, "threads.json failed", e);
  }
}

// Idle threads are only refetched when something says they changed (CLI `updated` or Amp's live row).
export function due(id, updated) {
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

export const refetch = new Set();

 // changes that landed while a fetch for the same thread was in flight
export async function fetchOne(id) {
  if (Date.now() < S.backoffUntil) return;
  if (inflight.has(id)) { refetch.add(id); return; }
  inflight.add(id);
  try {
    perf.fetches++;
    const res = await fetch(`/api/threads/${id}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (res.status === 401 || res.status === 429 || res.status >= 500) {
      S.backoffUntil = Date.now() + (res.status >= 500 ? 20_000 : 60_000);
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

export async function fetchMany(ids) {
  const queue = ids.slice(0, 40);
  const worker = async () => { for (let id; (id = queue.shift()); ) await fetchOne(id); };
  await Promise.all([worker(), worker()]);
  saveCache();
}

// "Me" = the most common creator among your CLI threads (not just the newest one).
export function computeMe() {
  const counts = new Map();
  for (const t of S.cli.slice(0, 40)) {
    const c = cache.get(t.id)?.d?.creator;
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  let best = null;
  let n = 0;
  for (const [k, v] of counts) if (v > n) { best = k; n = v; }
  return best;
}
