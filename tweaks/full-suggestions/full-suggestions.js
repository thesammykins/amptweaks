// Suggested replies show their full text. Amp shortens each one to a label and keeps the full reply in its
// aria-label ("Reply “…”"); this copies it onto the button so the CSS can show it. Amp's own button still sends it.
(() => {
  const FULL = /^Reply “([\s\S]+)”$/;
  let queued = false;

  function apply() {
    queued = false;
    for (const b of document.querySelectorAll("[data-suggested-quick-action]")) {
      const text = b.getAttribute("aria-label")?.match(FULL)?.[1];
      if (!text) continue;
      if (b.dataset.ampTweaksFull !== text) b.dataset.ampTweaksFull = text;
      document.documentElement.dataset.ampTweaksFullSuggestions = "";
    }
  }

  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(apply);
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-label"] });
  apply();
})();
