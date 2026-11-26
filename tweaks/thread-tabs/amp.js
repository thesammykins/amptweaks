// Amp adapter for thread tabs: the thread you're in, Amp's sidebar rows and tab row, and which threads are a Space's.
import { ampRow } from "../focus-sidebar/amp/nav.js";
import { query } from "../focus-sidebar/amp/remote.js";

export const TAG = "[amp-tweaks:tabs]";

/** Runs fn once now and then at most once per frame after Amp changes the page (it re-renders its tab row often). */
export function onPageChange(fn) {
  let queued = false;
  const run = () => { queued = false; fn(); };
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(run); } }).observe(document.body, { childList: true, subtree: true });
  fn();
}

export const threadIn = (path = location.pathname) => path.match(/^\/threads\/(T-[0-9a-f-]{36})/)?.[1] ?? null;
export const hrefOf = id => `/threads/${id}`;
export const titleOf = id => ampRow(id)?.querySelector("[data-title-text]")?.textContent.trim() || null;
export const unreadIn = id => {
  const badge = ampRow(id)?.querySelector("[data-thread-row-unread-badge]");
  return !!badge && !badge.classList.contains("opacity-0");
};
export const rowThread = el => el.closest?.("a[data-sidebar-thread-id]")?.dataset.sidebarThreadId ?? null;

// Amp's own tab for the conversation, in the thread's main pane. Thread tabs go in the same scrolling row.
export const agentTab = () => document.querySelector('[data-agent-pane] [data-card-tab="agent"]') ?? document.querySelector('[data-card-tab="agent"]');

// A Space's threads open as tabs in the Space's own view, so those stay Amp's. Amp's sidebar list marks them
// with joinedSpaceThreadID; if it doesn't answer, every thread counts as ordinary.
let spaceThreads = new Set();
let spaceAt = 0;
export async function inSpace(id) {
  if (Date.now() - spaceAt > 60_000) {
    spaceAt = Date.now();
    try {
      const list = await query("listSidebarRecentThreads");
      spaceThreads = new Set((list?.recentThreads ?? []).filter(t => t.joinedSpaceThreadID).map(t => t.id));
    } catch (e) {
      console.warn(TAG, "Amp's thread list didn't answer; treating every thread as ordinary", e.message);
    }
  }
  return spaceThreads.has(id);
}
