// Amp adapter: Amp's own sidebar filters (time range, hide running, needs-you only, project, automation).
// Each one takes rows out of the list this tweak reads, and with the focus sidebar on their button is hidden, so
// while it's on they're turned off and the focus sidebar's own filters are the only ones that apply.
// Amp mirrors them into the `view-state` cookie but saves them to your account, so writing the cookie doesn't
// stick; they're turned off through Amp's own shortcuts instead.
const COOKIE = "view-state";
const FILTERS = ["sidebarActiveWithin", "sidebarHideRunningThreads", "sidebarOnlyNeedsYouThreads", "sidebarProjectFilter", "sidebarAutomationFilter"];

function read() {
  const raw = document.cookie.split(";").map(c => c.trim()).find(c => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!raw) return {};
  try { return JSON.parse(decodeURIComponent(raw)) ?? {}; } catch { return {}; }
}

// The filters Amp has on right now (defaults left out), for the sidebar report.
export function ampFilters() {
  const state = read();
  return Object.fromEntries(FILTERS.filter(k => state[k] != null && state[k] !== false && state[k] !== "all").map(k => [k, state[k]]));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Amp's sidebar shortcuts are chords: ⌃. then a letter.
async function chord(letter) {
  for (const [key, code, ctrlKey] of [[".", "Period", true], [letter, `Key${letter.toUpperCase()}`, false]]) {
    for (const type of ["keydown", "keyup"]) document.body.dispatchEvent(new KeyboardEvent(type, { key, code, ctrlKey, bubbles: true, cancelable: true }));
    await sleep(30);
  }
}

// Each toggles between the filter and Amp's default.
const SHORTCUTS = { sidebarActiveWithin: "e", sidebarHideRunningThreads: "w", sidebarOnlyNeedsYouThreads: "q" };

// Turns off the filters Amp has a shortcut for. Returns the ones still on afterwards (project and automation
// filters have none, so those stay until they're cleared in Amp's own filter menu).
// Amp registers its shortcuts a moment after the sidebar appears, so it checks the cookie and tries again.
export async function clearAmpFilters() {
  for (let attempt = 0; attempt < 5; attempt++) {
    await sleep(1000);
    const on = Object.keys(ampFilters()).filter(k => SHORTCUTS[k]);
    if (!on.length) break;
    for (const k of on) await chord(SHORTCUTS[k]);
  }
  return Object.keys(ampFilters());
}
