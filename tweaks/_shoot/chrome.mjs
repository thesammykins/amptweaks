// Headless Chrome for the demo pages' README screenshots and clips: serves a folder, drives one page over the
// DevTools protocol, and saves PNG stills or GIF clips. Used by focus-sidebar/_demo and _thread-demo.
// Needs Node 22+, Google Chrome (or CHROME=/path/to/chrome) and, for clips, ffmpeg.
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
export const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Serves `root`, starts Chrome at width×height (CSS px) and returns helpers for one page. Call close() when done. */
export async function openChrome({ root, width, height, scale = 2, reducedMotion = true }) {
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^\/+/, "");
    const file = join(root, path.endsWith("/") || path === "" ? join(path, "index.html") : path);
    if (!file.startsWith(root) || !existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" }).end(readFileSync(file));
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`;

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

  const errors = [];
  browser.on(m => {
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map(a => a.value ?? a.description).join(" "));
  });
  await page("Runtime.enable");
  await page("Page.enable");
  await page("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false });
  const setMotion = reduce => page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: reduce ? "reduce" : "no-preference" }, { name: "prefers-color-scheme", value: "dark" }] });
  await setMotion(reducedMotion);

  const evaluate = async expr => {
    const r = await page("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`page: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };
  const rect = sel => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
  const mouse = (type, x, y) => page("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : 1 });
  const click = async (x, y) => { await mouse("mouseMoved", x, y); await mouse("mousePressed", x, y); await mouse("mouseReleased", x, y); };
  /** Moves the pointer in steps, like a hand would, so hover and pointerenter fire along the way. */
  const glide = async (from, to, ms = 300, steps = 12) => {
    for (let i = 1; i <= steps; i++) { await mouse("mouseMoved", from[0] + (to[0] - from[0]) * i / steps, from[1] + (to[1] - from[1]) * i / steps); await sleep(ms / steps); }
  };
  const waitFor = async (expr, what, ms = 8000) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (await evaluate(expr)) return;
    throw new Error(`timed out waiting for ${what}`);
  };

  /** A PNG of `clip` (CSS px), or the whole viewport. */
  const still = async (file, clip = { x: 0, y: 0, width, height }) => {
    const { data } = await page("Page.captureScreenshot", { format: "png", clip: { ...clip, scale: 1 }, captureBeyondViewport: true });
    writeFileSync(file, Buffer.from(data, "base64"));
  };

  /** Records `run()` and writes a GIF of `clip` at its real timing. Frames are 2× screenshots taken back to back
   *  (Chrome's screencast only gives 1× frames), so the clip is as sharp as the stills. */
  const clip = async (file, clipRect, run, { fps = 24 } = {}) => {
    const dir = mkdtempSync(join(tmpdir(), "amptweaks-clip-"));
    const times = [];
    let recording = true;
    const grab = (async () => {
      while (recording) {
        // Chrome now and then refuses one capture mid-animation; skip that frame rather than lose the clip.
        const shot = await page("Page.captureScreenshot", { format: "png", optimizeForSpeed: true, clip: { ...clipRect, scale: 1 } }).catch(() => null);
        if (!shot) { await sleep(10); continue; }
        const { data } = shot;
        writeFileSync(join(dir, `f${String(times.length).padStart(5, "0")}.png`), Buffer.from(data, "base64"));
        times.push(performance.now() / 1000);
      }
    })();
    await sleep(250);
    await run();
    await sleep(250);
    recording = false;
    await grab;
    // Each frame shows until the next one was taken; ffmpeg's concat demuxer takes those durations.
    const name = i => `f${String(i).padStart(5, "0")}.png`;
    const list = times.map((t, i) => `file '${name(i)}'\nduration ${Math.max(0.001, (times[i + 1] ?? t + 0.5) - t).toFixed(3)}`).join("\n");
    writeFileSync(join(dir, "list.txt"), `${list}\nfile '${name(times.length - 1)}'\n`);
    const vf = `fps=${fps},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`;
    const r = spawnSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", join(dir, "list.txt"), "-vf", vf, "-loop", "0", file]);
    if (r.status !== 0) throw new Error(`ffmpeg failed (frames kept in ${dir}): ${String(r.stderr).split("\n").slice(0, 4).join(" ")}`);
    rmSync(dir, { recursive: true, force: true });
    return { frames: times.length, seconds: +(times.at(-1) - times[0]).toFixed(1) };
  };

  const close = async () => {
    browser.close();
    chrome.kill();
    server.close();
    await sleep(300);
    rmSync(profile, { recursive: true, force: true });
  };
  return { page, origin, errors, evaluate, rect, mouse, click, glide, waitFor, still, clip, setMotion, close };
}

function connect(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const waiting = new Map();
  const listeners = new Set();
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
    on: l => listeners.add(l),
    off: l => listeners.delete(l),
    close: () => ws.close(),
  })));
}
