// Constants: kinds and their order, labels, timings, icons. Change wording or ordering here.
export const TAG = "[amp-tweaks:focus]";

export const WORKING = new Set(["compacting", "working", "streaming", "tool_use", "running_tools"]);

// Working first (what's in motion), then what needs you, most blocking first.
export const KIND_ORDER = ["working", "approve", "asking", "failed", "stalled", "review", "quiet", "parent"];

export const NEEDS = new Set(["approve", "asking", "failed", "stalled", "review"]);

export const OLDEST_FIRST = new Set(["approve", "asking", "stalled"]);

 // longest-waiting blockers first
export const STALL_MS = 10 * 60_000;

export const RECENT_MS = 14 * 864e5;

export const MODES = { status: "Status", project: "Project", day: "Day" };

export const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

export const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

// ---------- rows: persistent parts, patched individually (never rebuilt under the pointer) ----------
export const GLYPH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="8.5"/></svg>';

export const ICON = {
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

// ---------- family tree ----------
export const MAX_KIDS = 8;

 // active sub-threads shown before "Show N more"
export const MAX_DEPTH = 3;

// "N finished" is a disclosure: finished sub-threads listed newest first, 10 at a time, each a real row
// (opens through Amp, right-click / long-press for Amp's menu). Built only while open.
export const FINISHED_PAGE = 10;

// ---------- filter menu (Amp's filter button; Amp's menu classes once seen, tokens until then) ----------
export const MENU_KEY = "amp.menuClasses";

export const KIND_LABEL = { approve: "Approvals", asking: "Questions", failed: "Failures", stalled: "Stalled", review: "Done, unread", working: "Working" };

export const AGES = [[1, "Last 24 hours"], [7, "Last 7 days"], [14, "Last 14 days"], [0, "Any time"]];

export const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';

export const VIEW_LEAD = { status: ["kinds", "age", "projects"], project: ["projects", "kinds", "age"], day: ["age", "kinds", "projects"] };

export const DETAILS = { context: "What it needs", tree: "Repo and branch", model: "Model", time: "Time", badge: "State badge", family: "Sub-thread summary" };
