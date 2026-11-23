// Puck, front and centre: your Puck on every thread's message box, and Puck first in the new-thread popup.
// face.js copies your Puck from Amp's rail; amp.js is how this tweak reaches Amp's Puck; composer.js and start.js
// are the two places Puck shows up.
import { resumePendingDraft } from "./amp.js";
import { startComposer } from "./composer.js";
import { startPalette } from "./start.js";

startComposer();
startPalette();
resumePendingDraft();
