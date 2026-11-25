// Focus sidebar: only threads that need you, then threads still working; sub-threads nest under their root.
//
// Data
//   Amp sidebar DOM      → thread set, families, unread/running/error signals (live), hrefs, navigation, context menu
//   threads.json (CLI)   → recent threads + `updated` (change detector, excludes archived)
//   /api/threads/:id     → state, status message, model, working tree (cached across reloads)
//   Amp's remote queries → thread lineage (families) and snoozes, the same ones Amp's sidebar uses
// Behaviour stays Amp's: clicks, the right-click menu and component styling all come from Amp's own rows.
// Module map: see AGENTS.md ("Focus sidebar modules").
import { start } from "./live.js";

// Only the main window has the thread sidebar (Puck and other aux windows don't): wait for it, else stay idle.
const t0 = Date.now();

(function waitForSidebar() {
  if (document.querySelector('[data-slot="sidebar"] [data-testid="sidebar-thread-list"]')) return start();
  if (Date.now() - t0 < 15_000) setTimeout(waitForSidebar, 250);
})();
