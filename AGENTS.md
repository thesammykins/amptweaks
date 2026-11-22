# AGENTS.md

Tweaks run inside Amp's web client (SvelteKit, Tailwind) loaded through a local proxy. Amp ships often, so tweaks have to expect its DOM to move.

## Building a tweak

- One folder per tweak: `tweaks/<name>/` (bundled) or `~/.amp-tweaks/<name>/` (personal), holding its `.js` and/or `.css`. A personal folder with the same name overrides the bundled one. Files are served as `<name>/<path>`.
- A folder with an `index.js` is an ES module tweak: only `index.js` loads (as `type=module`) and it imports the rest by relative path. Without one, every `.js` loads as a classic script in name order.
- Find Amp's elements by its `data-*` attributes (`data-sidebar-thread-id`, `data-thread-row-*`, `data-slot`), never by Tailwind classes.
- Style with Amp's tokens (`--color-*`, `--text-*`). To beat Amp's own `!important` rules, use `@layer amp-tweaks { … !important }`.
- Act through Amp, not around it. Clicks, navigation and menus go through Amp's own (hidden) rows. Space threads 500 if you follow their href, and Amp's buttons ignore synthetic `.click()`.
- Fail open. If a tweak can't find what it needs, leave Amp's UI visible.
- After restarting the proxy, quit and reopen Amp. While the proxy is down Amp opens a direct connection to ampcode.com, and later reloads can go over it without tweaks.

## When Amp changes under the hood

1. Run `amp-tweaks status` to see which layer broke: routing (macOS can cache a failed PAC fetch and go direct with the setting still on; `amp-tweaks repair` fixes it), Amp not loading the tweaks (quit and reopen it), or Amp's markup (the sidebar line lists missing hooks from `AMP_HOOKS` in `tweaks/focus-sidebar/amp/dom.js`). Then check `~/Library/Logs/amp-tweaks-reports/errors.json` and `amp-tweaks logs`.
2. Add a temporary `zz-probe.js` that posts what it sees to `/__amp-tweaks/report?name=probe`, then read `~/Library/Logs/amp-tweaks-reports/probe.json`. Delete it when you're done.
3. Update the selectors in one place (in the focus sidebar, that's `tweaks/focus-sidebar/amp/`).
4. Prove it in the running app with a report or screenshot. This repo has no test suite, don't add one.

## Focus sidebar modules

Each file owns one job, so a change usually touches one file. Shared mutable state lives on `S` in `state.js`.

| To change | Edit |
| --- | --- |
| How Amp's sidebar is read (selectors, row signals) | `amp/dom.js` |
| Turning off Amp's own sidebar filters (time range, hide running, needs-you only) | `amp/view-state.js` |
| Clicking through to Amp (navigate, menu, pin, retry) | `amp/actions.js` |
| What counts as working / needs you / done, grouping, search | `model.js` |
| Labels, kind order, timings, icons | `config.js` |
| A row's lines and hover buttons | `render/rows.js` |
| Sub-thread lines, colours, "N finished" | `render/tree.js` |
| Sections, ordering animation, header | `render/list.js` |
| Archive, undo, snooze, mark done, toasts | `actions.js` |
| Filter menu | `menu.js` |
| Swipes, keyboard, hover reveal | `input.js` |
| Refresh timing, Amp change detection | `live.js` |
| Saved prefs and caches | `store.js` |
| Thread data from the proxy and Amp's API | `data.js` |
| Look and feel | `focus-sidebar.css` |

## Demo page and screenshots

`tweaks/focus-sidebar/_demo/` is a stand-in for Amp's sidebar with made-up threads (`threads.js`) that runs the real focus sidebar code, so you can try a change without the live app. Serve `tweaks/focus-sidebar` (`python3 -m http.server`) and open `/_demo/` (`?tweak=off` for Amp's own list, `?mode=project` or `?mode=day`). `node tweaks/focus-sidebar/_demo/shoot.mjs [name…]` re-renders the screenshots in `tweaks/focus-sidebar/images/` for the tweak's README. The `_` prefix keeps the loader from injecting the demo into Amp. Never screenshot the live app for a README: it shows real threads.

## Useful endpoints

- `GET /__amp-tweaks/data/threads.json`: thread ids and updated times from the `amp` CLI.
- `POST /__amp-tweaks/act/archive?id=T-…[,T-…][&undo=1]`: archive or unarchive, in order per thread.
- `POST /__amp-tweaks/act/refs` with `{root, paths}`: which paths exist under your home folder, resolved against the thread's root.
- `POST /__amp-tweaks/act/open?path=…[&reveal=1]` or `?url=<GitHub commit>`: opens a file in your editor, shows it in Finder, or opens a commit. Files never open with their default app, so nothing can be launched this way.
- `POST /__amp-tweaks/report?name=X`: writes the body to `~/Library/Logs/amp-tweaks-reports/X.json`.
