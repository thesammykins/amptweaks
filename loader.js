// Runs first in <head> of every ampcode.com page served through amp-tweaks.
(() => {
  const BASE = "/__amp-tweaks/";
  const log = (...a) => console.info("[amp-tweaks]", ...a);
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
  log(`loaded ${m.css.length} css, ${m.js.length} js`);

  // Live reload: CSS swaps in place; any JS change reloads the page.
  let { cssVersion, jsVersion } = m;
  setInterval(async () => {
    try {
      const next = await (await fetch(`${BASE}manifest.json?t=${Date.now()}`, { cache: "no-store" })).json();
      if (next.jsVersion !== jsVersion) { log("js changed, reloading"); location.reload(); return; }
      if (next.cssVersion !== cssVersion) { cssVersion = next.cssVersion; applyCss(next.css, cssVersion); log("css reloaded"); }
    } catch (e) {
      log("poll failed", e);
    }
  }, 1000);
})();
