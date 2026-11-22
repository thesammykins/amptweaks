#!/usr/bin/env node
// Renders the README screenshots from the demo page (made-up threads, real focus sidebar code) with headless Chrome.
//   node tweaks/focus-sidebar/_demo/shoot.mjs            → all shots into tweaks/focus-sidebar/images/
//   node tweaks/focus-sidebar/_demo/shoot.mjs hover menu → just those
// Needs Node 22+ and Google Chrome (or CHROME=/path/to/chrome).
import { join, resolve } from "node:path";
import { openChrome, sleep } from "../../_shoot/chrome.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, "images");

// What each shot shows. `act` runs in the page before the capture; `clip` picks the element to frame.
const SHOTS = {
  before: { query: "tweak=off" },
  after: {},
  project: { query: "mode=project&expand=" },
  hover: { query: "mode=project&expand=", hover: '[data-thread-id="T-csv"] > [data-amp-focus-row]', clip: '[data-amp-focus-group]:has([data-thread-id="T-csv"])' },
  // The whole menu, without its scroll cap, over the top of the sidebar.
  menu: { click: "[data-filter-btn]", style: "[data-amp-focus-menu] { max-height: none !important; }", clip: "[data-amp-focus-menu]", fullWidth: true },
};

const { page, origin, errors, evaluate, rect, mouse, waitFor, still, close } = await openChrome({ root: ROOT, width: 360, height: 800 });
const BASE = `${origin}/_demo/`;

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SHOTS);
try {
  for (const name of wanted) {
    const shot = SHOTS[name];
    if (!shot) throw new Error(`unknown shot "${name}" (have: ${Object.keys(SHOTS).join(", ")})`);
    errors.length = 0;
    await mouse("mouseMoved", 359, 799); // park the pointer so nothing is hovered
    await page("Page.navigate", { url: `${BASE}?${shot.query ?? ""}` });
    await waitFor(`document.documentElement.hasAttribute("data-demo-ready")`, "the demo page");
    if (!shot.query?.includes("tweak=off")) await waitFor(`document.querySelectorAll("[data-amp-focus-row]").length > 3`, "the focus sidebar to render");
    await sleep(1200); // fetches settle, entry animations finish
    if (shot.style) await evaluate(`document.head.insertAdjacentHTML("beforeend", ${JSON.stringify(`<style>${shot.style}</style>`)})`);
    if (shot.hover) {
      const r = await rect(shot.hover);
      // Come in from the right edge, like a pointer moving onto the row: the row's buttons show once it's past the toggle.
      for (const x of [r.x + r.width - 4, r.x + r.width - 40, r.x + r.width * 0.6]) { await mouse("mouseMoved", x, r.y + r.height / 2); await sleep(60); }
      await sleep(500);
    }
    if (shot.click) {
      const r = await rect(shot.click);
      const [x, y] = [r.x + r.width / 2, r.y + r.height / 2];
      await mouse("mouseMoved", x, y); await mouse("mousePressed", x, y); await mouse("mouseReleased", x, y);
      await mouse("mouseMoved", 359, 799);
      await sleep(500);
    }
    let clip = { x: 0, y: 0, width: 360, height: 800 };
    if (shot.clip) {
      const r = await rect(shot.clip);
      if (!r) throw new Error(`${name}: nothing matches ${shot.clip}`);
      const pad = shot.pad ?? 4;
      clip = shot.fullWidth
        ? { x: 0, y: 0, width: 360, height: Math.ceil(r.y + r.height + 12) }
        : { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: Math.min(360, r.width + 2 * pad), height: r.height + 2 * pad };
    }
    await still(join(OUT, `${name}.png`), clip);
    console.log(`${name}.png  ${Math.round(clip.width * 2)}×${Math.round(clip.height * 2)}${errors.length ? `  page errors: ${errors.join(" | ")}` : ""}`);
  }
} finally {
  await close();
}
