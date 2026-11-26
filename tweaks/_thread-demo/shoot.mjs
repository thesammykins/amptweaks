#!/usr/bin/env node
// Renders the thread tweaks' README screenshots and clips from the demo page (a made-up thread, the real tweak
// code) with headless Chrome. Each lands in that tweak's images/ folder.
//   node tweaks/_thread-demo/shoot.mjs                        → everything
//   node tweaks/_thread-demo/shoot.mjs quick-replies/open.gif → just that one
// Needs Node 22+, Google Chrome (or CHROME=/path/to/chrome) and ffmpeg for the clips.
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { openChrome, sleep } from "../_shoot/chrome.mjs";

const ROOT = resolve(import.meta.dirname, ".."); // tweaks/, where each tweak's images/ lives
const REPO = resolve(ROOT, ".."); // served, so the demo reads the real changes.json and tweak.json files
const W = 1280;
const H = 780;
const REST = [W - 2, H - 2]; // where the pointer waits, so nothing is hovered

// Frames: the composer with the quick actions above it, the right edge with the outline, a paragraph, the rail.
const bottom = async h => {
  const c = await h.rect(".composer");
  return { x: c.x - 24, y: c.y - 220, width: c.width + 48, height: H - (c.y - 220) };
};
const rightSide = async () => ({ x: W - 560, y: 36, width: 560, height: 330 });
const paragraph = async h => {
  const p = await h.rect('[data-transcript-scroll-anchor-key$="3:assistant"] p:nth-of-type(2)');
  return { x: p.x - 16, y: p.y - 12, width: p.width + 32, height: p.height + 24 };
};
const rail = async () => ({ x: 0, y: H - 300, width: 300, height: 300 });
const news = async () => ({ x: 0, y: H - 240, width: 380, height: 240 });

const centre = r => [r.x + r.width / 2, r.y + r.height / 2];
const tabRow = async () => ({ x: 0, y: 0, width: 1000, height: 190 });
const row = n => `.amp-list a:nth-child(${n})`;
const middleClick = async (h, [x, y]) => {
  for (const type of ["mousePressed", "mouseReleased"]) await h.page("Input.dispatchMouseEvent", { type, x, y, button: "middle", buttons: type === "mousePressed" ? 4 : 0, clickCount: 1 });
};

const SHOTS = {
  "quick-replies/before.png": { query: "tweaks=off", frame: bottom },
  "quick-replies/after.png": { query: "tweaks=quick-replies", frame: bottom },
  "quick-replies/open.png": {
    query: "tweaks=quick-replies", frame: bottom,
    act: async h => { await h.glide(REST, centre(await h.rect("[data-amp-tweaks-qr-chip]")), 250); await sleep(500); },
  },
  "quick-replies/open.gif": {
    query: "tweaks=quick-replies", frame: bottom,
    act: async h => {
      const chip = centre(await h.rect("[data-amp-tweaks-qr-chip]"));
      await h.glide([chip[0] + 260, chip[1] + 90], chip, 500);
      await sleep(700);
      const reply = centre(await h.rect('[data-amp-tweaks-qr-slot="1"] [data-suggested-quick-action]'));
      await h.glide(chip, reply, 450);
      await sleep(700);
      await h.glide(reply, [reply[0] + 300, chip[1] + 110], 400);
      await sleep(700);
    },
  },
  "thread-outline/outline.png": { query: "tweaks=thread-outline", frame: rightSide, setup: "scrollTo(document.querySelector('h3'))" },
  "thread-outline/rail.gif": {
    query: "tweaks=thread-outline", frame: rightSide, setup: "scrollTo(document.querySelectorAll('h3')[1])",
    act: async h => {
      // Scroll down past the first gallery: the outline tucks into the rail beside it and comes back after.
      for (let i = 0; i < 60; i++) { await h.evaluate("document.querySelector('[data-thread-transcript-scroll]').scrollTop += 7"); await sleep(16); }
      await sleep(600);
      const r = await h.rect("[data-amp-tweaks-outline-rail]");
      if (r) { await h.glide([r.x - 200, r.y + 120], [r.x + r.width / 2, r.y + 120], 400); await sleep(900); await h.glide([r.x + 4, r.y + 120], [r.x - 260, r.y + 120], 300); await sleep(700); }
      for (let i = 0; i < 70; i++) { await h.evaluate("document.querySelector('[data-thread-transcript-scroll]').scrollTop += 8"); await sleep(16); }
      await sleep(900);
    },
  },
  "clickable-paths/hover.png": {
    query: "tweaks=clickable-paths", frame: paragraph, setup: "scrollTo(document.querySelectorAll('h3')[2])",
    act: async h => { await h.waitFor("document.querySelector('[data-amp-tweaks-ref=\"file\"]')", "paths to be marked"); await h.glide(REST, centre(await h.rect('[data-amp-tweaks-ref="file"]')), 200); await sleep(400); },
  },
  "runner-folders/serve.png": {
    query: "tweaks=runner-folders&notice", frame: async h => { const n = await h.rect(".notice"); return { x: n.x - 12, y: n.y - 12, width: n.width + 24, height: n.height + 24 }; },
    setup: "scrollTo(document.querySelector('.notice'))",
  },
  "calm-reading/before.png": { query: "tweaks=off", frame: paragraph, setup: "scrollTo(document.querySelectorAll('h3')[2])" },
  "calm-reading/after.png": { query: "tweaks=calm-reading", frame: paragraph, setup: "scrollTo(document.querySelectorAll('h3')[2])" },
  "tweak-settings/menu.png": {
    query: "tweaks=tweak-settings", frame: rail,
    act: async h => { const b = centre(await h.rect("[data-amp-tweaks-settings] button")); await h.glide(REST, b, 200); await h.click(...b); await sleep(500); },
  },
  // What's new opens on its own when there's something unseen; thread-outline starts off so its card can turn it on.
  "thread-tabs/tabs.png": {
    query: "tweaks=thread-tabs&sidebar", frame: tabRow,
    act: async h => {
      for (const n of [2, 3]) { const r = centre(await h.rect(row(n))); await h.glide(REST, r, 150); await middleClick(h, r); await sleep(200); }
      await h.glide(REST, centre(await h.rect("[data-tt-tab]")), 200);
      await sleep(400);
    },
  },
  "thread-tabs/open.gif": {
    query: "tweaks=thread-tabs&sidebar", frame: tabRow,
    act: async h => {
      let at = [700, 150];
      for (const n of [2, 3]) { const r = centre(await h.rect(row(n))); await h.glide(at, r, 450); await sleep(250); await middleClick(h, r); await sleep(600); at = r; }
      const tab = centre(await h.rect('[data-tt-tab][data-id$="02"] [data-tt-open]'));
      await h.glide(at, tab, 500); await sleep(300);
      await h.click(...tab); await sleep(900);
      const close = centre(await h.rect('[data-tt-tab][data-id$="03"] [data-tt-close]'));
      await h.glide(tab, close, 400); await sleep(400);
      await h.click(...close); await sleep(900);
    },
  },
  "tweak-settings/news.png": { query: "tweaks=tweak-settings", frame: news, act: async () => sleep(600) },
  "tweak-settings/news.gif": {
    query: "tweaks=tweak-settings&off=thread-outline", frame: news,
    act: async h => {
      await sleep(400);
      const next = centre(await h.rect("[data-amp-tweaks-news] [data-next]"));
      await h.glide(REST, next, 350);
      for (let i = 0; i < 4; i++) { await h.click(...next); await sleep(450); }
      const turnOn = centre(await h.rect("[data-amp-tweaks-news] [data-state]"));
      await h.glide(next, turnOn, 300); await sleep(250);
      await h.click(...turnOn); await sleep(900);
      const close = centre(await h.rect("[data-amp-tweaks-news] [data-close]"));
      await h.glide(turnOn, close, 300); await h.click(...close); await sleep(600);
    },
  },
  "tweak-settings/open.gif": {
    query: "tweaks=tweak-settings", frame: rail,
    act: async h => {
      const b = centre(await h.rect("[data-amp-tweaks-settings] button"));
      await h.glide([b[0] + 120, b[1] - 60], b, 350); await sleep(250);
      await h.click(...b); await sleep(700);
      const calm = centre(await h.rect('[data-amp-tweaks-settings-menu] [data-name="calm-reading"]'));
      await h.glide(b, calm, 350); await sleep(300);
      await h.click(...calm); await sleep(600);
      await h.click(...calm); await sleep(600);
      await h.page("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
      await sleep(600);
    },
  },
};

const h = await openChrome({ root: REPO, width: W, height: H });
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SHOTS);
try {
  for (const name of wanted) {
    const shot = SHOTS[name];
    if (!shot) throw new Error(`unknown shot "${name}" (have: ${Object.keys(SHOTS).join(", ")})`);
    const gif = name.endsWith(".gif");
    h.errors.length = 0;
    await h.setMotion(!gif); // stills settle instantly; clips show the real motion
    await h.mouse("mouseMoved", ...REST);
    await h.page("Page.navigate", { url: `${h.origin}/tweaks/_thread-demo/?${shot.query}` });
    await h.waitFor(`document.documentElement.hasAttribute("data-demo-ready")`, "the demo page");
    if (shot.setup) await h.evaluate(`(() => { const scrollTo = el => { const s = document.querySelector('[data-thread-transcript-scroll]'); s.scrollTop += el.getBoundingClientRect().top - 60; }; ${shot.setup}; })()`);
    await sleep(1200); // tweaks mount, entry animations finish
    const frame = await shot.frame(h);
    const out = join(ROOT, name.replace("/", "/images/"));
    mkdirSync(dirname(out), { recursive: true });
    if (gif) {
      const { frames, seconds } = await h.clip(out, frame, () => shot.act(h));
      console.log(`${name}  ${frames} frames over ${seconds}s (${Math.round(frames / seconds)} fps)`);
    } else {
      if (shot.act) await shot.act(h);
      await h.still(out, frame);
      console.log(name);
    }
    if (h.errors.length) console.log(`  page errors: ${h.errors.join(" | ")}`);
  }
} finally {
  await h.close();
}
