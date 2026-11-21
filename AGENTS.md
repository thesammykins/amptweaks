# AGENTS.md

Tweaks run inside Amp's web client (SvelteKit, Tailwind) loaded through a local proxy. Amp ships often, so tweaks have to expect its DOM to move.

## Building a tweak

- One folder per tweak: `tweaks/<name>/` (bundled) or `~/.amp-tweaks/<name>/` (personal), holding its `.js` and/or `.css`. A personal folder with the same name overrides the bundled one. Files are served as `<name>/<file>`.
- Find Amp's elements by its `data-*` attributes (`data-sidebar-thread-id`, `data-thread-row-*`, `data-slot`), never by Tailwind classes.
- Style with Amp's tokens (`--color-*`, `--text-*`). To beat Amp's own `!important` rules, use `@layer amp-tweaks { … !important }`.
- Act through Amp, not around it. Clicks, navigation and menus go through Amp's own (hidden) rows. Space threads 500 if you follow their href, and Amp's buttons ignore synthetic `.click()`.
- Fail open. If a tweak can't find what it needs, leave Amp's UI visible.

## When Amp changes under the hood

1. Check `~/Library/Logs/amp-tweaks-reports/errors.json` and `amp-tweaks logs`.
2. Add a temporary `zz-probe.js` that posts what it sees to `/__amp-tweaks/report?name=probe`, then read `~/Library/Logs/amp-tweaks-reports/probe.json`. Delete it when you're done.
3. Update the selectors in one place (in the focus sidebar, that's `readRow()` and `ampClasses()` in `tweaks/focus-sidebar/focus-sidebar.js`).
4. Prove it in the running app with a report or screenshot. This repo has no test suite, don't add one.

## Useful endpoints

- `GET /__amp-tweaks/data/threads.json`: thread ids and updated times from the `amp` CLI.
- `POST /__amp-tweaks/act/archive?id=T-…[,T-…][&undo=1]`: archive or unarchive, in order per thread.
- `POST /__amp-tweaks/report?name=X`: writes the body to `~/Library/Logs/amp-tweaks-reports/X.json`.
