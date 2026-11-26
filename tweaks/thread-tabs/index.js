// Thread tabs: middle-click a thread to open it as a tab beside the one you're in; with ⌥ (and the split setting on),
// beside it in a split. Amp's own windows for one thread and the framed Amp in a split get no tabs.
import { startInFrame, startSplit } from "./split.js";
import { startTabs } from "./tabs.js";

const root = document.documentElement;
if (root.hasAttribute("data-amp-tweaks-frame")) startInFrame();
else if (!root.dataset.ampAuxiliaryWindow) {
  startTabs();
  startSplit();
}
