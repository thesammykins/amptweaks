// Runs first in <head> of every ampcode.com page served through amp-tweaks.
(() => {
  const BASE = "/__amp-tweaks/";
  const log = (...a) => console.info("[amp-tweaks]", ...a);

  // Uncaught errors from tweak scripts are reported to ~/Library/Logs/amp-tweaks-reports/errors.json.
  const report = (kind, detail) => {
    try { navigator.sendBeacon?.(`${BASE}report?name=errors`, JSON.stringify({ kind, ...detail, url: location.href, at: new Date().toISOString() })); } catch {}
  };
  addEventListener("error", e => {
    if (!String(e.filename ?? "").includes(BASE)) return;
    report("error", { message: e.message, file: e.filename, line: e.lineno, col: e.colno, stack: e.error?.stack });
  });
  addEventListener("unhandledrejection", e => {
    const stack = String(e.reason?.stack ?? "");
    if (stack.includes(BASE)) report("rejection", { message: String(e.reason?.message ?? e.reason), stack });
  });
  const url = (name, v) => `${BASE}${encodeURIComponent(name)}?v=${v}`;

  // The web client tells the native shell whether its WKWebView is inspectable
  // (only for internal users). Force it on so Web Inspector can attach.
  const appState = window.webkit?.messageHandlers?.ampNativeAppState;
  if (appState) {
    const proto = Object.getPrototypeOf(appState);
    const post = proto.postMessage;
    proto.postMessage = function (msg) {
      if (this === appState && msg && typeof msg === "object") msg = { ...msg, webViewInspectable: true };
      return post.call(this, msg);
    };
    log("native shell detected; webViewInspectable forced on");
  }

  // Declare our cascade layer before any of Amp's CSS loads. Amp (Tailwind) puts some
  // `!important` rules in layers, which beat unlayered `!important`; for important
  // declarations the earliest-declared layer wins, so `@layer amp-tweaks { … !important }` beats them.
  const layer = document.createElement("style");
  layer.textContent = "@layer amp-tweaks;";
  document.head.prepend(layer);

  const styles = new Map();
  function applyCss(files, v) {
    for (const [name, el] of styles) if (!files.includes(name)) { el.remove(); styles.delete(name); }
    for (const name of files) {
      const el = styles.get(name) ?? Object.assign(document.createElement("link"), { rel: "stylesheet" });
      el.dataset.ampTweak = name;
      el.href = url(name, v);
      styles.set(name, el);
      // Re-append so tweaks stay last in the cascade.
      document.head.appendChild(el);
    }
  }

  // Synchronous so tweaks are in place before the app's own modules run.
  const xhr = new XMLHttpRequest();
  xhr.open("GET", `${BASE}manifest.json?t=${Date.now()}`, false);
  xhr.send();
  const m = JSON.parse(xhr.responseText);

  applyCss(m.css, m.cssVersion);
  for (const name of m.js) {
    const s = document.createElement("script");
    s.src = url(name, m.jsVersion);
    s.async = false;
    s.dataset.ampTweak = name;
    document.head.appendChild(s);
  }
  // Module tweaks (a folder with index.js): loaded from a real path so `import "./x.js"` resolves inside the folder.
  for (const name of m.modules ?? []) {
    const s = document.createElement("script");
    s.type = "module";
    s.src = `${BASE}${name.split("/").map(encodeURIComponent).join("/")}?v=${m.jsVersion}`;
    s.dataset.ampTweak = name;
    document.head.appendChild(s);
  }
  log(`loaded ${m.css.length} css, ${m.js.length} js, ${(m.modules ?? []).length} module tweaks`);
  // `amp-tweaks status` compares this with Amp's launch time to tell whether the running Amp has tweaks.
  if (appState) try { navigator.sendBeacon(`${BASE}report?name=loaded`, JSON.stringify({ url: location.href, at: new Date().toISOString(), tweaks: [...m.css, ...m.js, ...(m.modules ?? [])] })); } catch {}

  // Live reload: CSS swaps in place; any JS change reloads the page.
  let { cssVersion, jsVersion } = m;
  setInterval(async () => {
    if (document.hidden) return;
    try {
      const next = await (await fetch(`${BASE}manifest.json?t=${Date.now()}`, { cache: "no-store" })).json();
      if (next.jsVersion !== jsVersion) { log("js changed, reloading"); location.reload(); return; }
      if (next.cssVersion !== cssVersion) { cssVersion = next.cssVersion; applyCss(next.css, cssVersion); log("css reloaded"); }
    } catch (e) {
      log("poll failed", e);
    }
  }, 1000);
})();
