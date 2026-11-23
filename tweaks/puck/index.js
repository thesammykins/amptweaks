// Puck, front and centre: your Puck on every thread's message box, Puck's own window for conversations, Puck
// first in the new-thread popup, and a presence setting for how often Puck speaks up.
// face.js copies your Puck from Amp's rail; amp.js is how this tweak reaches Amp's Puck; settings.js is the
// presence option; composer.js and start.js are where Puck shows up.
import { resumePendingDraft } from "./amp.js";
import { startComposer } from "./composer.js";
import { loadSettings } from "./settings.js";
import { startPalette } from "./start.js";

await loadSettings();
startComposer();
startPalette();
resumePendingDraft();
