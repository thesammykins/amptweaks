// Amp adapter (transport): Amp's own SvelteKit remote functions, called the way Amp's sidebar calls them (same origin,
// your session). Each function lives at /_app/remote/<module hash>/<name>; the hash comes from Amp's build, so it's
// looked up in Amp's loaded scripts when the last known one stops answering.
import { TAG } from "../config.js";

const KNOWN = {
  listSidebarRecentThreads: "3abror",
  listSidebarSnoozes: "3abror",
  getSidebarResourceRevisions: "3abror",
  snoozeThreadCommand: "145jw2",
  markThreadsReadCommand: "145jw2",
  markThreadUnreadCommand: "145jw2",
};
const KEY = "amp-tweaks:focus.remoteIds";
const ids = { ...KNOWN, ...JSON.parse(localStorage.getItem(KEY) || "{}") };

export class RemoteError extends Error {
  constructor(name, status, message) { super(`${name}: ${status} ${message}`); this.status = status; }
}

export const query = (name, arg) => call(name, undefined, arg === undefined ? "" : `?payload=${b64url(flatten(arg))}`);

export const command = (name, arg) => call(name, {
  method: "POST",
  headers: { "content-type": "application/json", "x-sveltekit-pathname": location.pathname, "x-sveltekit-search": location.search },
  body: JSON.stringify({ payload: b64url(flatten(arg)), refreshes: [] }),
});

// ---------- devalue (Amp's wire format): flat array of values, objects point at indexes ----------
export function unflatten(values) {
  const out = new Array(values.length);
  const h = i => {
    if (i === -1) return undefined;
    if (i === -3) return NaN;
    if (i === -4) return Infinity;
    if (i === -5) return -Infinity;
    if (i === -6) return -0;
    if (i in out) return out[i];
    const v = values[i];
    if (!v || typeof v !== "object") return (out[i] = v);
    if (Array.isArray(v)) {
      if (typeof v[0] === "string") {
        const [type, x] = v;
        if (type === "Date") return (out[i] = new Date(x));
        if (type === "Set") { const s = (out[i] = new Set()); for (let k = 1; k < v.length; k++) s.add(h(v[k])); return s; }
        if (type === "Map") { const m = (out[i] = new Map()); for (let k = 1; k < v.length; k += 2) m.set(h(v[k]), h(v[k + 1])); return m; }
        if (type === "null") { const o = (out[i] = Object.create(null)); for (let k = 1; k < v.length; k += 2) o[v[k]] = h(v[k + 1]); return o; }
        if (type === "Object") return (out[i] = Object(x));
        if (type === "BigInt") return (out[i] = BigInt(x));
        return (out[i] = undefined);
      }
      const a = (out[i] = new Array(v.length));
      v.forEach((n, k) => { if (n !== -2) a[k] = h(n); });
      return a;
    }
    const o = (out[i] = {});
    for (const k in v) o[k] = h(v[k]);
    return o;
  };
  return h(0);
}

// Plain JSON-shaped arguments only (strings, numbers, booleans, null, arrays, objects).
export function flatten(value) {
  const values = [];
  const add = v => {
    if (v === undefined) return -1;
    const i = values.length;
    if (v === null || typeof v !== "object") { values.push(v); return i; }
    values.push(null);
    values[i] = Array.isArray(v) ? v.map(add) : Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, add(x)]));
    return i;
  };
  add(value);
  return JSON.stringify(values);
}

const b64url = s => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

// ---------- id lookup ----------
let scanning = null;

async function rescan() {
  scanning ??= (async () => {
    const urls = [...new Set([...document.querySelectorAll('script[src], link[rel="modulepreload"]')].map(e => e.src || e.href)
      .concat(performance.getEntriesByType("resource").map(e => e.name)))].filter(u => /\/_app\/immutable\/.+\.js$/.test(u));
    const want = new Set(Object.keys(KNOWN));
    const found = {};
    for (let i = 0; i < urls.length && Object.keys(found).length < want.size; i += 8) {
      const texts = await Promise.all(urls.slice(i, i + 8).map(u => fetch(u, { cache: "force-cache" }).then(r => r.text()).catch(() => "")));
      for (const t of texts) for (const m of t.matchAll(/[`"']([a-z0-9]{4,10})\/([A-Za-z]+)[`"']/g)) if (want.has(m[2])) found[m[2]] = m[1];
    }
    Object.assign(ids, found);
    localStorage.setItem(KEY, JSON.stringify(found));
    console.info(TAG, "remote ids", found);
    return found;
  })().finally(() => { scanning = null; });
  return scanning;
}

async function call(name, init, query) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const url = `/_app/remote/${ids[name]}/${name}${query ?? ""}`;
    const res = await fetch(url, { cache: "no-store", ...init });
    const body = await res.json().catch(() => null);
    if (res.ok && body?.type === "result") return body.data ? unflatten(JSON.parse(body.data))?._ : undefined;
    const status = body?.error?.status ?? res.status;
    // A moved function answers 404 (no such remote): look its new id up once, then give up.
    if (status === 404 && attempt === 0 && (await rescan())[name]) continue;
    throw new RemoteError(name, status, body?.error?.message ?? res.statusText);
  }
}
