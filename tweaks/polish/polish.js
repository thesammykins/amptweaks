// Small fixes across Amp that don't each need a tweak of their own.
// - A link to another thread or an artifact in a reply shows its title and status in a preview that Amp cuts
//   short, while the tooltip only repeats the link's own short label. The tooltip gets the preview's full text.
(() => {
  let queued = false;

  function fullTitles() {
    queued = false;
    for (const host of document.querySelectorAll("[data-amp-thread-link-host], [data-amp-artifact-link-host]")) {
      const link = host.closest("a") ?? host.parentElement;
      const preview = host.textContent.replace(/\s+/g, " ").trim();
      if (preview && link.title !== preview) link.title = preview;
    }
  }

  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(fullTitles);
  }).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  fullTitles();
})();
