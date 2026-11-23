// Puck, front and centre: a dock with your Puck on every screen, and Puck first in the new-thread popup.
// face.js copies your Puck from Amp's rail; amp.js is how this tweak reaches Amp's Puck; dock.js and start.js are
// the two places Puck shows up.
import { resumePendingDraft } from "./amp.js";
import { startDock } from "./dock.js";
import { startPalette } from "./start.js";

startDock();
startPalette();
resumePendingDraft();
