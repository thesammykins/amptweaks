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
