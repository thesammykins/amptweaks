// Small fixes across Amp that don't each need a tweak of their own.
// - Links to other threads in a reply are cut off with no way to read the rest: give them the full title on hover.
(() => {
  let queued = false;

  function fullTitles() {
    queued = false;
    for (const text of document.querySelectorAll("[data-amp-thread-link-text]")) {
      const link = text.closest("[data-amp-thread-link]") ?? text;
      const title = text.textContent.replace(/\s+/g, " ").trim();
      if (title && link.title !== title) link.title = title;
    }
  }

  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(fullTitles);
  }).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  fullTitles();
})();
