# amptweaks

Load your own CSS and JS into the Amp Mac app, the same way you'd use a userscript in a browser. It ships with one tweak, the focus sidebar, which swaps Amp's thread list for just the threads that need you and the ones still working.

This is an unofficial mod, it isn't made or supported by Amp.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/thesammykins/amptweaks/main/install.sh | zsh
```

Then quit and reopen Amp. Run the same line again to update.

It installs mitmproxy with Homebrew if you don't have it, and macOS will ask for your password once to trust a local certificate.

## Uninstall

```sh
curl -fsSL https://raw.githubusercontent.com/thesammykins/amptweaks/main/uninstall.sh | zsh
```

This puts your proxy settings back the way they were, removes the certificate and its trust, and deletes the logs and app. Your own tweaks in `~/.amp-tweaks` are left alone.

## How it works

Amp's Mac app is a native shell around ampcode.com, so tweaks go in at the network rather than by patching the app. A small proxy runs on your Mac and only ampcode.com is routed through it, everything else goes direct. It adds one script tag to Amp's pages, and that script loads the tweaks. The certificate it uses is restricted to ampcode.com, so it can't be used to intercept any other site. If the proxy stops, Amp connects directly and keeps working, just without tweaks.

## Focus sidebar

Threads are grouped by Status, Project or Day, with a filter menu at the top right for what each view shows. Sub-threads and Spaces nest under their parent, and a family's finished threads sit under "N finished".

- Hover a row for archive and Amp's own menu (plus Mark done on an Ask, which hides it until the thread changes, and Retry on a failure), or swipe left with two fingers (a full swipe archives). Swipe right to snooze until something changes.
- Right-click or long-press opens Amp's menu for that thread.
- ⌃⌘A archives the open thread and moves to the next one. ⌘Z undoes.
- Arrow keys move between rows, → and ← open and close families, Enter opens, E archives, S snoozes, D marks an Ask done.

Archiving a parent archives its sub-threads too, and Undo puts back exactly what was archived. Archive uses the `amp` CLI, so install that too if you haven't ([ampcode.com/install](https://ampcode.com/install)).

## Your own tweaks

Put `.css` and `.js` files in `~/.amp-tweaks`, either loose or in a folder per tweak (`~/.amp-tweaks/my-tweak/`). They load on every Amp page and reload when you save. Anything starting with `_` is skipped, and a folder with the same name as a bundled tweak replaces it.

The installer links `amp-tweaks` into `~/.local/bin` if you have that folder, otherwise it's at `~/Library/Application Support/amp-tweaks/app/bin/amp-tweaks`.

```sh
amp-tweaks tweaks                       # what's on
amp-tweaks tweaks disable focus-sidebar # turn a tweak off
amp-tweaks status                       # proxy, routing and certificate
amp-tweaks logs                         # follow the proxy log
```

Errors from tweaks are written to `~/Library/Logs/amp-tweaks-reports/errors.json`. [AGENTS.md](AGENTS.md) covers building tweaks and fixing them when Amp changes.

## If something's off

- No tweaks after installing: quit and reopen Amp, since connections it already had open skip the proxy.
- Amp looks broken: `amp-tweaks tweaks disable focus-sidebar` to rule the sidebar out, or `amp-tweaks disable` to take everything out of the path.

## Requirements

macOS, the Amp Mac app, Homebrew (for mitmproxy) and the `amp` CLI for the focus sidebar's archive and thread list.

## License

MIT
