#!/usr/bin/env node
// Renders the README screenshots from the demo page (made-up threads, real focus sidebar code) with headless Chrome.
//   node docs/demo/shoot.mjs            → all shots into docs/images/
//   node docs/demo/shoot.mjs hover menu → just those
// Needs Node 22+ and Google Chrome (or CHROME=/path/to/chrome).
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const OUT = join(ROOT, "docs/images");
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SCALE = 2;

// What each shot shows. `act` runs in the page before the capture; `clip` picks the element to frame.
const SHOTS = {
  before: { query: "tweak=off" },
  after: {},
  project: { query: "mode=project&expand=" },
  hover: { query: "mode=project&expand=", hover: '[data-thread-id="T-csv"] > [data-amp-focus-row]', clip: '[data-amp-focus-group]:has([data-thread-id="T-csv"])' },
  // The whole menu, without its scroll cap, over the top of the sidebar.
  menu: { click: "[data-filter-btn]", style: "[data-amp-focus-menu] { max-height: none !important; }", clip: "[data-amp-focus-menu]", fullWidth: true },
};

// ---------- static server for the repo ----------
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^\/+/, "");
  const file = join(ROOT, path.endsWith("/") || path === "" ? join(path, "index.html") : path);
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" }).end(readFileSync(file));
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}/docs/demo/`;

// ---------- Chrome over the DevTools protocol ----------
const profile = mkdtempSync(join(tmpdir(), "amptweaks-shots-"));
const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
const wsUrl = await new Promise((ok, fail) => {
  let buf = "";
  chrome.stderr.on("data", d => { buf += d; const m = buf.match(/DevTools listening on (ws:\S+)/); if (m) ok(m[1]); });
  chrome.on("exit", c => fail(new Error(`Chrome exited (${c}) before it was ready:\n${buf}`)));
});
const browser = await connect(wsUrl);
const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
const page = (method, params) => browser.send(method, params, sessionId);

function connect(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const waiting = new Map();
  const listeners = [];
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.id && waiting.has(msg.id)) {
      const { ok, fail, method } = waiting.get(msg.id);
      waiting.delete(msg.id);
      msg.error ? fail(new Error(`${method}: ${msg.error.message}`)) : ok(msg.result);
    } else listeners.forEach(l => l(msg));
  };
  return new Promise(ok => (ws.onopen = () => ok({
    send: (method, params = {}, sessionId) => new Promise((ok, fail) => { waiting.set(++id, { ok, fail, method }); ws.send(JSON.stringify({ id, method, params, sessionId })); }),
    on: l => listeners.push(l),
    close: () => ws.close(),
  })));
}

const evaluate = async expr => {
  const r = await page("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`page: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result.value;
};
const rect = sel => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const mouse = (type, x, y) => page("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : 1 });

async function waitFor(expr, what, ms = 8000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (await evaluate(expr)) return;
  throw new Error(`timed out waiting for ${what}`);
}

// ---------- shots ----------
const errors = [];
browser.on(m => {
  if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map(a => a.value ?? a.description).join(" "));
});
await page("Runtime.enable");
await page("Page.enable");
await page("Emulation.setDeviceMetricsOverride", { width: 360, height: 800, deviceScaleFactor: SCALE, mobile: false });
await page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }, { name: "prefers-color-scheme", value: "dark" }] });

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
    const { data } = await page("Page.captureScreenshot", { format: "png", clip: { ...clip, scale: 1 }, captureBeyondViewport: true });
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, "base64"));
    console.log(`${name}.png  ${Math.round(clip.width * SCALE)}×${Math.round(clip.height * SCALE)}${errors.length ? `  page errors: ${errors.join(" | ")}` : ""}`);
  }
} finally {
  browser.close();
  chrome.kill();
  server.close();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}
