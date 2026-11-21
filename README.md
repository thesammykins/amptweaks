# amp-tweaks

Dia Tweaks–style CSS/JS injection for the Amp macOS app (and ampcode.com in any browser).

Amp.app is a signed native shell around the live ampcode.com web client, so tweaks are injected on the network: a local mitmproxy rewrites ampcode.com HTML to load `/__amp-tweaks/loader.js`, which loads every `*.css` and `*.js` in `~/.amp-tweaks/` (alphabetical; prefix `_` to disable). CSS hot-swaps; JS changes reload the page. The loader also forces `webViewInspectable`, so Safari ▸ Develop ▸ <Mac> ▸ Amp opens Web Inspector on the app.

```
bin/amp-tweaks enable              # LaunchAgent + trust CA + PAC for *.ampcode.com only
bin/amp-tweaks status
bin/amp-tweaks disable [--untrust]
bin/amp-tweaks run                 # foreground, for debugging
```

The CA in `ca/` is name-constrained to `ampcode.com` and `.ampcode.com`, so it can't sign any other site. Generate your own with `ca/ca.cnf` (see git history); the keys are gitignored. If the proxy is down, the PAC falls back to DIRECT.

After enabling, connections Amp already has open bypass the proxy until its WebKit networking process restarts (relaunch Amp, or `View ▸ Reload Window` after the pool idles). Log: `~/Library/Logs/amp-tweaks.log`.

## Writing tweaks

- Amp sets some `!important` rules inside Tailwind cascade layers, which beat unlayered `!important`. The loader declares `@layer amp-tweaks` before Amp's CSS loads, so `@layer amp-tweaks { … !important }` wins over them.
- `GET /__amp-tweaks/data/threads.json` returns `[{id, updated}]` from `amp threads list` (cached for 20s), for metadata the DOM doesn't carry.
- `POST /__amp-tweaks/act/archive?id=T-…[&undo=1]` archives or unarchives a thread through `amp threads archive`. Amp's own row buttons ignore synthetic clicks, so tweaks archive through this.
- `POST /__amp-tweaks/report?name=X` writes the request body to `~/Library/Logs/amp-tweaks-reports/X.json`, so a tweak can report page state without opening Web Inspector.
- Sidebar rows are `a[data-sidebar-thread-id]` with `data-thread-row-*` attributes; restyle those rather than re-rendering, so routing, context menus and drag keep working.
- Amp's thread context menu opens on a hidden original row if you dispatch `pointerdown`, then on the next frame a right-button `mousedown` and `contextmenu`, at the pointer's coordinates.
- Upstream 5xx pages on ampcode.com are logged with their error text, and the last one is saved to `~/Library/Logs/amp-tweaks-reports/upstream-<status>.html`.
