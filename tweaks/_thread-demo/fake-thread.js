// A stand-in for Amp's thread pane and left rail, filled with a made-up thread, that runs the real thread tweaks.
// Serve tweaks/ (python3 -m http.server) and open /_thread-demo/.
//   ?tweaks=quick-replies,thread-outline  only those (default: all of them)   ?tweaks=off  Amp as it is
// _thread-demo/shoot.mjs uses it for the README screenshots and clips, so nothing personal ends up in them.
const ALL = ["calm-reading", "clickable-paths", "quick-replies", "thread-outline", "tweak-settings"];
const THREAD = "T-0000b111-0000-4000-8000-000000000001";
const params = new URLSearchParams(location.search);
const wanted = params.get("tweaks") === "off" ? [] : (params.get("tweaks")?.split(",") ?? ALL);

// ---------- what Amp's API and the proxy would answer ----------
const ASK = "Turn the billing_v2 flag on for the API team?";
const realFetch = fetch.bind(window);
const json = body => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
let tweakState = Object.fromEntries([...ALL, "focus-sidebar"].map(n => [n, true]));
window.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url, location.href);
  const p = url.pathname;
  if (p.startsWith("/api/threads/")) return json({
    env: { initial: { runnerID: "demo-mac", hostname: "demo-mac.local", trees: [{ uri: "file:///Users/demo/billing", repository: { url: "https://github.com/acme/billing.git" } }] } },
    meta: { statusMessage: { text: ASK, waitingOnInput: true } },
  });
  if (p === "/__amp-tweaks/act/refs") {
    const { root, paths } = JSON.parse(init.body);
    return json(Object.fromEntries(paths.filter(x => x.includes("/") || x.includes(".")).map(x => [x, { path: `${root}/${x}`, dir: x.endsWith("/") }])));
  }
  if (p === "/__amp-tweaks/tweaks.json") return json(Object.entries(tweakState).sort().map(([name, on]) => ({ name, on, personal: false })));
  if (p === "/__amp-tweaks/act/tweak") { tweakState[url.searchParams.get("name")] = url.searchParams.get("on") === "1"; return json([]); }
  if (p.startsWith("/__amp-tweaks/")) return new Response(null, { status: 204 });
  return realFetch(input, init);
};

// ---------- the made-up thread ----------
const shot = (hue, label) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200"><rect width="320" height="200" fill="#141022"/><rect x="16" y="16" width="288" height="22" rx="5" fill="${hue}" opacity=".85"/><rect x="16" y="52" width="180" height="10" rx="3" fill="#ffffff30"/><rect x="16" y="70" width="140" height="10" rx="3" fill="#ffffff22"/><rect x="16" y="96" width="132" height="84" rx="8" fill="#ffffff12"/><rect x="160" y="96" width="144" height="84" rx="8" fill="${hue}" opacity=".35"/><text x="232" y="144" font-family="-apple-system,sans-serif" font-size="13" fill="#fff" text-anchor="middle" opacity=".8">${label}</text></svg>`)}`;
const gallery = items => `<div data-transcript-gallery>${items.map(([cap, hue, label]) => `<figure><figcaption>${cap}</figcaption><img alt="" src="${shot(hue, label)}"></figure>`).join("")}</div>`;
const ENTRIES = [
  ["user", "Move billing to the v2 API. Start with invoices and keep the old client as the default."],
  ["assistant", `<h3>Plan</h3><p>Invoices go first because everything else reads from them. The v2 client lives beside the old one in <code>src/billing/</code> until the switch.</p><ul><li>New client in <code>src/billing/invoice.ts</code></li><li>Webhook handlers for <code>invoice.finalized</code> and <code>invoice.voided</code></li><li>Backfill script in <code>scripts/backfill-invoices.sh</code></li></ul><h3>Open questions</h3><p>Do we keep sending receipts from the old mailer during the switch, or move them now?</p>`],
  ["user", "Keep the old mailer for now. Go ahead with invoices."],
  ["assistant", `<p class="run">Moved invoices to the v2 client · 6 minutes</p><h3>What changed</h3><p>Invoices now go through <code>src/billing/invoice.ts</code>, pushed as <code>4f1c9a2</code> on <code>billing-v2</code>. The old client is untouched and still the default.</p><ul><li>9,214 invoices backfilled, none skipped</li><li>Retries back off on 429s from the payments provider</li><li>Rollout steps are in <code>docs/billing/MIGRATION.md</code></li></ul><h3>Screens</h3>${gallery([["Checkout, before", "#5fa8d3", "v1"], ["Checkout, after", "#8b7cf6", "v2"], ["Invoice email", "#59c08a", "receipt"]])}<p>Both checkouts render the same totals on the 40 sample carts.</p>`],
  ["user", "Can we ship it behind a flag so the API team can test it first?"],
  ["assistant", `<p class="run">Added the billing_v2 flag and wired it through checkout · 4 minutes</p><h3>What's behind the flag</h3><ul><li>The v2 invoice client and its webhooks</li><li>The new invoice email from <code>emails/invoice.tsx</code></li><li>Nothing else: refunds and payouts stay on v1</li></ul><h3>Turning it on</h3><p>Set <code>BILLING_V2=1</code> for a workspace, or flip it for everyone from the admin page. Turning it off falls back to v1 on the next request.</p>${gallery([["Admin flag page", "#d6a038", "flag"], ["API team workspace", "#e0739a", "workspace"], ["Error rate, last hour", "#59c08a", "0.02%"]])}<p>Should I turn the flag on for the API team's workspace now?</p>`],
];
const REPLIES = ["Yes, turn it on for the API team's workspace", "Not yet, write the rollout notes for them first", "Turn it on for everyone, we're ready"];
const short = s => (s.length > 26 ? `${s.slice(0, 24).trimEnd()}…` : s);

const I = {
  threads: '<path d="M7 9h10M7 13h6"/><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-4 3v-3a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  projects: '<path d="M4 4h16v16H4z"/><path d="M4 9h16"/>',
  boxes: '<path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="m3 7 9 5 9-5M12 12v10"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
};
const svg = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const railItem = (icon, active = false) => `<li><a class="amp-rail-btn" data-active="${active}"><span class="amp-rail-icon">${svg(I[icon])}</span></a></li>`;

document.body.innerHTML = `
  <nav data-primary-navigation-rail aria-label="Primary Navigation">
    <ul data-sidebar="menu">${railItem("threads", true)}${railItem("activity")}${railItem("projects")}${railItem("boxes")}</ul>
    <div data-rail-more><ul data-sidebar="menu"><li class="amp-rail-li"><button type="button" class="amp-rail-btn" data-rail-more-trigger aria-label="More"><span class="amp-rail-icon">${svg(I.more)}</span></button></li></ul></div>
    <div data-rail-more-area></div>
    <div data-rail-footer><ul data-sidebar="menu"></ul><span class="amp-avatar">D</span></div>
  </nav>
  <main class="pane">
    <div class="tabbar"><span class="orb"></span>Migrate billing to the v2 API</div>
    <div class="transcript">
      <div data-thread-transcript-scroll data-thread-id="${THREAD}">
        <div data-transcript-entry-list>
          ${ENTRIES.map(([role, html], i) => `<div data-transcript-scroll-anchor-key="message:M-demo${i}:${role}">${role === "user"
            ? `<div data-transcript-user-message-content>${html}</div>`
            : `<div data-transcript-message-role="assistant" data-transcript-message-content><div data-transcript-markdown data-transcript-markdown-density="default">${html}</div></div>`}</div>`).join("")}
        </div>
        <div data-thread-transcript-end-spacer></div>
      </div>
      <div data-transcript-bottom-overlay>
        <div class="overlay-inner">
          <div data-thread-quick-action-row>
            <div data-thread-quick-action-scroller>
              <div class="contents"><div class="contents"><span class="floating-control plain diff"><span class="g">+42</span>&nbsp;<span class="r">−9</span></span></div></div>
              <div class="contents"><div class="contents"><button type="button" class="floating-control plain" data-thread-quick-action="ship">Ship</button></div></div>
              ${REPLIES.map(r => `<div class="contents"><div class="contents"><button type="button" data-suggested-quick-action="reply" class="floating-control" aria-label="Reply “${r}”"><span class="reply-icon">${svg(I.up)}</span> <span class="truncate">${short(r)}</span></button></div></div>`).join("")}
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="composer-wrap"><div class="composer"><span>Opus 5.5 · High</span><span class="send"></span></div></div>
  </main>`;

// Amp floats a full-text copy over a reply on hover; the quick-replies tweak replaces that.
for (const b of document.querySelectorAll("[data-suggested-quick-action]")) {
  let pop = null;
  b.addEventListener("pointerenter", () => {
    const r = b.getBoundingClientRect();
    b.style.opacity = "0";
    pop = Object.assign(document.createElement("div"), { innerHTML: `<span class="reply-icon">${svg(I.up)}</span>${b.getAttribute("aria-label").slice(7, -1)}` });
    pop.dataset.suggestionReplyExpanded = "";
    Object.assign(pop.style, { left: `${r.left}px`, top: `${r.top}px` });
    document.body.append(pop);
  });
  b.addEventListener("pointerleave", () => { b.style.opacity = ""; pop?.remove(); });
}

// The tweaks read /threads/<id> from the address bar, like they do in Amp.
history.replaceState(null, "", `/threads/${THREAD}${location.search}`);
// Amp opens a thread at its end; wait for the gallery images so "the end" is where it stays.
const scroller = document.querySelector("[data-thread-transcript-scroll]");
await Promise.all([...document.images].map(i => i.decode().catch(() => {})));
scroller.scrollTop = params.has("top") ? 0 : scroller.scrollHeight;

const STYLE_ONLY = new Set(["calm-reading"]);
for (const name of wanted) {
  document.head.append(Object.assign(document.createElement("link"), { rel: "stylesheet", href: `/${name}/${name}.css` }));
  if (!STYLE_ONLY.has(name)) document.head.append(Object.assign(document.createElement("script"), { src: `/${name}/${name}.js` }));
}
document.documentElement.dataset.demoReady = "";
