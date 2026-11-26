// Thread tabs: middle-click a thread (in Amp's sidebar or the focus sidebar) to open it as a tab after the one you're
// in, without leaving it. Tabs sit in Amp's own tab row. Amp's tab for the conversation you're in stays Amp's (with
// its menu) and is moved into its slot with CSS order, so no tab shifts under the pointer when you switch.
// Like a browser: opening a thread from the sidebar replaces the tab you're in, and closing the last but one tab
// leaves just the thread, with no tabs.
import { navigate, openAmpMenu, preload } from "../focus-sidebar/amp/nav.js";
import { agentTab, hrefOf, inSpace, onPageChange, rowThread, TAG, threadIn, titleOf, unreadIn } from "./amp.js";
import { openSplit } from "./split.js";

const KEY = "amp-tweaks:tabs.open";
const TITLES = "amp-tweaks:tabs.titles";
// Per window (sessionStorage survives reloads): each Amp window has its own tabs, like browser windows.
const read = (k, fallback) => { try { return JSON.parse(sessionStorage.getItem(k)) ?? fallback; } catch { return fallback; } };

let tabs = read(KEY, []); // thread ids, in tab order
const titles = new Map(read(TITLES, []));
let lastTab = threadIn(); // the tab you're in, or were in before a Space thread
let streak = 0; // tabs opened from the current one, so the next goes after them (as browsers do)

export function startTabs() {
  // Middle button, acted on at mouseup: Amp's Mac app opens a link's middle-click in a new window natively and
  // doesn't always send auxclick, so the press, the release and any auxclick are all cancelled on our targets.
  const ours = e => e.button === 1 && (rowThread(e.target) || e.target.closest('[data-tt-tab], [data-card-tab="agent"]'));
  for (const type of ["mousedown", "auxclick", "click"]) document.addEventListener(type, e => { if (ours(e)) stop(e); }, true);
  document.addEventListener("mouseup", e => { if (ours(e)) { stop(e); onMiddle(e); } }, true);
  // The focus sidebar asks through this event (cancelled = handled), so it needs no knowledge of tabs.
  addEventListener("amp-tweaks:open-thread", e => { e.preventDefault(); open(e.detail.id, { split: !!e.detail.split }); });
  // One sync at a time: it can wait on Amp's thread list.
  let running = Promise.resolve();
  onPageChange(() => { running = running.then(sync, sync); });
  console.info(TAG, `ready, ${tabs.length} tabs`);
}

function onMiddle(e) {
  const tab = e.target.closest("[data-tt-tab]");
  const id = tab?.dataset.id ?? (e.target.closest('[data-card-tab="agent"]') && tabs.includes(threadIn()) ? threadIn() : null);
  if (id) return close(id);
  const row = rowThread(e.target);
  if (row) open(row, { split: e.altKey });
}

export async function open(id, { split = false } = {}) {
  if (split && openSplit(id)) return;
  const here = threadIn();
  if (!here || id === here || (await inSpace(id))) return navigate(id, hrefOf(id), {}); // a Space's own tab
  if (!tabs.includes(here)) tabs.push(here);
  if (!tabs.includes(id)) tabs.splice(Math.min(tabs.indexOf(here) + 1 + streak++, tabs.length), 0, id);
  remember(id);
  save();
  render(here);
}

export function close(id) {
  const i = tabs.indexOf(id);
  if (i < 0) return;
  tabs.splice(i, 1);
  if (id === threadIn()) {
    const next = tabs[i] ?? tabs[i - 1];
    if (next) { lastTab = next; navigate(next, hrefOf(next), {}); }
  }
  if (tabs.length < 2) tabs = [];
  save();
  render(threadIn());
}

// Runs on page changes: follow navigation, and put the tabs back when Amp re-renders its row.
async function sync() {
  const here = threadIn();
  if (here && here !== lastTab && tabs.length) {
    if (tabs.includes(here)) lastTab = here;
    else if (!(await inSpace(here))) {
      // You opened another thread in the tab you were in.
      const i = tabs.indexOf(lastTab);
      i >= 0 ? (tabs[i] = here) : tabs.push(here);
      lastTab = here;
      save();
    }
    streak = 0;
  } else if (here !== lastTab && !tabs.length) lastTab = here;
  render(here);
}

function render(here) {
  const agent = agentTab();
  const row = agent?.parentElement;
  for (const t of document.querySelectorAll("[data-tt-tab]")) if (t.parentElement !== row || !tabs.includes(t.dataset.id) || t.dataset.id === here) t.remove();
  if (!row || tabs.length < 2) {
    row?.removeAttribute("data-tt-row");
    row?.style.removeProperty("--tt-tab-max");
    agent?.style.removeProperty("order");
    return;
  }
  row.setAttribute("data-tt-row", "");
  // Same widest size as Amp's tab, so a tab keeps roughly its place when it turns into Amp's on switching.
  row.style.setProperty("--tt-tab-max", getComputedStyle(agent).maxWidth);
  const at = tabs.indexOf(here);
  agent.style.order = String(at >= 0 ? at : tabs.length);
  tabs.forEach((id, i) => {
    if (id === here) return;
    const t = row.querySelector(`:scope > [data-tt-tab][data-id="${CSS.escape(id)}"]`) ?? row.appendChild(makeTab(id));
    t.style.order = String(i);
    const title = remember(id);
    const label = t.querySelector("[data-tt-title]");
    if (label.textContent !== title) { label.textContent = title; t.querySelector("[data-tt-open]").title = title; }
    t.toggleAttribute("data-unread", unreadIn(id));
  });
}

function makeTab(id) {
  const t = document.createElement("div");
  t.dataset.ttTab = "";
  t.dataset.id = id;
  t.setAttribute("role", "presentation");
  // Not a link: a middle-click on a link opens a new window in Amp's Mac app before any handler can stop it.
  t.innerHTML = `<button type="button" role="tab" aria-selected="false" data-tt-open><span data-tt-dot></span><span data-tt-title></span></button><button type="button" data-tt-close aria-label="Close tab"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>`;
  const link = t.querySelector("[data-tt-open]");
  // Through Amp's own row, like a sidebar click, warmed on hover the way Amp's sidebar warms it.
  link.addEventListener("click", e => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    stop(e);
    if (e.altKey && openSplit(id)) return;
    lastTab = id;
    navigate(id, hrefOf(id), {});
  });
  link.addEventListener("pointerenter", () => preload(id));
  link.addEventListener("focus", () => preload(id));
  t.querySelector("[data-tt-close]").addEventListener("click", e => { stop(e); close(id); });
  // Right-click: Amp's own menu for that thread, as on Amp's tab for the one you're in.
  t.addEventListener("contextmenu", e => { stop(e); openAmpMenu(id, e.clientX, e.clientY); });
  return t;
}

function remember(id) {
  const title = titleOf(id) ?? titles.get(id) ?? "Thread";
  if (titles.get(id) !== title) {
    titles.set(id, title);
    sessionStorage.setItem(TITLES, JSON.stringify([...titles].filter(([k]) => tabs.includes(k))));
  }
  return title;
}

function save() {
  sessionStorage.setItem(KEY, JSON.stringify(tabs));
}

function stop(e) {
  e.preventDefault();
  e.stopPropagation();
}
