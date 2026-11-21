"""mitmproxy addon: injects ~/.amp-tweaks CSS/JS into the ampcode.com web client.

Two listeners share this addon:
  regular proxy  -> rewrites ampcode.com HTML, serves /__amp-tweaks/* on that origin
  reverse (pac)  -> serves /proxy.pac so only ampcode.com is routed through us
"""

import asyncio
import hashlib
import json
import logging
import os
import re
import shutil
import time
from pathlib import Path

from mitmproxy import ctx, http

TWEAKS_DIR = Path(os.environ.get("AMP_TWEAKS_DIR", Path.home() / ".amp-tweaks"))
LOADER = Path(__file__).with_name("loader.js")
REPORTS_DIR = Path(os.environ.get("AMP_TWEAKS_REPORTS", Path.home() / "Library/Logs/amp-tweaks-reports"))
PREFIX = "/__amp-tweaks/"
PROXY_PORT = int(os.environ.get("AMP_TWEAKS_PORT", "8787"))
HOST_RE = re.compile(r"(^|\.)ampcode\.com$")
TAG = f'<script src="{PREFIX}loader.js"></script>'

log = logging.getLogger("amp-tweaks")

PAC = f"""function FindProxyForURL(url, host) {{
  if (host === "ampcode.com" || dnsDomainIs(host, ".ampcode.com")) return "PROXY 127.0.0.1:{PROXY_PORT}; DIRECT";
  return "DIRECT";
}}
"""


def tweak_files() -> list[Path]:
    if not TWEAKS_DIR.is_dir():
        return []
    return sorted(
        p for p in TWEAKS_DIR.iterdir()
        if p.is_file() and p.suffix in (".css", ".js") and not p.name.startswith(("_", "."))
    )


def version(files: list[Path]) -> str:
    """Change detector from (name, mtime, size): polled every second per window, so no file reads."""
    digest = hashlib.sha1()
    for p in files:
        st = p.stat()
        digest.update(f"{p.name}\0{st.st_mtime_ns}\0{st.st_size}\n".encode())
    return digest.hexdigest()[:12]


def manifest() -> dict:
    files = tweak_files()
    css = [p for p in files if p.suffix == ".css"]
    js = [p for p in files if p.suffix == ".js"]
    return {
        "css": [p.name for p in css],
        "js": [p.name for p in js],
        "cssVersion": version(css),
        "jsVersion": version(js),
    }


def respond(flow: http.HTTPFlow, status: int, body: bytes | str, ctype: str) -> None:
    flow.response = http.Response.make(
        status, body, {"content-type": ctype, "cache-control": "no-store"}
    )


def save_report(flow: http.HTTPFlow) -> None:
    """Tweaks POST page state here so agents and humans can read it without an inspector."""
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    name = re.sub(r"[^A-Za-z0-9_.-]", "_", flow.request.query.get("name", "report"))[:64]
    (REPORTS_DIR / f"{name}.json").write_bytes(flow.request.raw_content or b"")
    log.warning("amp-tweaks: report %s (%d bytes)", name, len(flow.request.raw_content or b""))
    respond(flow, 204, b"", "text/plain")


AMP_CLI = shutil.which("amp") or str(Path.home() / ".amp/bin/amp")
THREADS_TTL = 30.0
_threads_lock = asyncio.Lock()
_threads_cache: tuple[float, bytes] = (0.0, b"[]")


async def threads_json() -> bytes:
    """Thread metadata the web DOM doesn't carry (e.g. updated time), via the amp CLI. Single-flight across windows."""
    global _threads_cache
    if time.monotonic() - _threads_cache[0] < THREADS_TTL:
        return _threads_cache[1]
    async with _threads_lock:
        if time.monotonic() - _threads_cache[0] < THREADS_TTL:
            return _threads_cache[1]
        return await _refresh_threads()


async def _refresh_threads() -> bytes:
    global _threads_cache
    proc = await asyncio.create_subprocess_exec(
        AMP_CLI, "threads", "list", "--json", "--limit", "500",
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    out, err = await proc.communicate()
    if proc.returncode != 0:
        log.warning("amp-tweaks: amp threads list failed (%s): %s", proc.returncode, err.decode()[:300])
        return _threads_cache[1]
    rows = [{"id": t["id"], "updated": t["updated"]} for t in json.loads(out)]
    _threads_cache = (time.monotonic(), json.dumps(rows).encode())
    return _threads_cache[1]


THREAD_ID = re.compile(r"^T-[0-9a-f-]{36}$")


async def archive(flow: http.HTTPFlow) -> None:
    """Archive (or ?undo=1 unarchive) threads via the amp CLI. ?id= takes one id or a comma-separated list."""
    ids = [i for i in flow.request.query.get("id", "").split(",") if i]
    if not ids or len(ids) > 500 or not all(THREAD_ID.match(i) for i in ids):
        return respond(flow, 400, "bad thread id", "text/plain")
    undo = bool(flow.request.query.get("undo"))
    gate = asyncio.Semaphore(6)

    async def one(tid: str) -> tuple[str, bool, str]:
        async with gate:
            args = [AMP_CLI, "threads", "archive", tid] + (["--unarchive"] if undo else [])
            proc = await asyncio.create_subprocess_exec(*args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
            out, err = await proc.communicate()
            return tid, proc.returncode == 0, (err or out).decode()[:200].strip()

    results = await asyncio.gather(*(one(i) for i in ids))
    failed = [{"id": t, "error": msg} for t, ok, msg in results if not ok]
    log.warning("amp-tweaks: %s %d thread(s), %d failed%s", "unarchive" if undo else "archive", len(ids), len(failed), f": {failed[:3]}" if failed else "")
    global _threads_cache
    _threads_cache = (0.0, _threads_cache[1])  # next threads.json reflects the change
    respond(flow, 200 if not failed else 502, json.dumps({"ok": not failed, "count": len(ids), "failed": failed}), "application/json")


async def serve_tweak(flow: http.HTTPFlow, name: str) -> None:
    if name == "act/archive" and flow.request.method == "POST":
        return await archive(flow)
    if name == "report" and flow.request.method == "POST":
        return save_report(flow)
    if name == "data/threads.json":
        return respond(flow, 200, await threads_json(), "application/json")
    if name == "loader.js":
        return respond(flow, 200, LOADER.read_bytes(), "text/javascript; charset=utf-8")
    if name == "manifest.json":
        return respond(flow, 200, json.dumps(manifest()), "application/json")
    path = (TWEAKS_DIR / name).resolve()
    if path.parent != TWEAKS_DIR.resolve() or path not in [p.resolve() for p in tweak_files()]:
        log.warning("amp-tweaks: refused %s", name)
        return respond(flow, 404, "not a tweak", "text/plain")
    ctype = "text/css" if path.suffix == ".css" else "text/javascript"
    respond(flow, 200, path.read_bytes(), f"{ctype}; charset=utf-8")


# Page loads (HTML documents) bypass mitmproxy's pooled upstream HTTP/2 connections, which can fail in-flight
# requests ("RECV_PING in state CLOSED") and leave the app on a 502 page. One fresh HTTP/1.1 request, retried.
HOP_BY_HOP = {"connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "te", "trailer", "host", "accept-encoding", "content-length"}


def _fetch_document(host: str, path: str, headers: list[tuple[str, str]]) -> tuple[int, list[tuple[bytes, bytes]], bytes]:
    import http.client
    import ssl
    import certifi

    context = ssl.create_default_context(cafile=certifi.where())
    last: Exception | None = None
    for attempt in range(3):
        conn = http.client.HTTPSConnection(host, 443, timeout=20, context=context)
        try:
            conn.putrequest("GET", path, skip_host=False, skip_accept_encoding=True)
            for k, v in headers:
                conn.putheader(k, v)
            conn.putheader("Accept-Encoding", "identity")
            conn.endheaders()
            r = conn.getresponse()
            body = r.read()
            out = [(k.encode(), v.encode("latin-1")) for k, v in r.getheaders() if k.lower() not in HOP_BY_HOP]
            return r.status, out, body
        except Exception as e:  # noqa: BLE001 — retried, then surfaced
            last = e
            time.sleep(0.25 * (attempt + 1))
        finally:
            conn.close()
    raise last  # type: ignore[misc]


async def request(flow: http.HTTPFlow) -> None:
    if flow.request.path.split("?")[0] == "/proxy.pac" and not HOST_RE.search(flow.request.pretty_host):
        return respond(flow, 200, PAC, "application/x-ns-proxy-autoconfig")
    if not HOST_RE.search(flow.request.pretty_host):
        return
    if flow.request.path.startswith(PREFIX):
        return await serve_tweak(flow, flow.request.path[len(PREFIX):].split("?")[0])
    if flow.request.method == "GET" and flow.request.headers.get("sec-fetch-dest") == "document":
        headers = [(k, v) for k, v in flow.request.headers.items(multi=True) if not k.startswith(":") and k.lower() not in HOP_BY_HOP]
        try:
            status, out, body = await asyncio.to_thread(_fetch_document, flow.request.pretty_host, flow.request.path, headers)
        except Exception as e:  # noqa: BLE001 — fall back to mitmproxy's own upstream path
            log.warning("amp-tweaks: document fetch failed after retries, falling back: %s %s", flow.request.path[:120], e)
            return
        flow.response = http.Response.make(status, body, http.Headers(out))


def load(loader) -> None:
    # launchd writes our stdout to a file, which Python block-buffers; failures should show up immediately.
    import sys
    sys.stdout.reconfigure(line_buffering=True)
    sys.stderr.reconfigure(line_buffering=True)
    log.warning("amp-tweaks: addon loaded (streaming non-HTML, flow logging off)")


def running() -> None:
    # Per-request flow logging is noise (and disk I/O); our own warnings still log.
    ctx.options.flow_detail = 0
    ctx.options.termlog_verbosity = "warn"  # drops mitmproxy's per-response info lines; our events log at warning


def responseheaders(flow: http.HTTPFlow) -> None:
    """Stream everything except ampcode.com HTML documents (which we rewrite): buffering adds latency to every call."""
    resp = flow.response
    if (
        HOST_RE.search(flow.request.pretty_host)
        and flow.request.method == "GET"
        and "text/html" in resp.headers.get("content-type", "")
    ):
        return
    resp.stream = True


def error(flow: http.HTTPFlow) -> None:
    """Connection-level failures (resets, timeouts) on ampcode.com, so they're attributable."""
    if HOST_RE.search(flow.request.pretty_host):
        log.warning("amp-tweaks: %s %s failed: %s", flow.request.method, flow.request.path[:120], flow.error)


def response(flow: http.HTTPFlow) -> None:
    resp = flow.response
    if resp and resp.status_code >= 500 and HOST_RE.search(flow.request.pretty_host):
        text = resp.get_text(strict=False) or ""
        m = re.search(r'"message":"([^"]{0,300})"|<title>([^<]{0,120})</title>', text)
        log.warning("amp-tweaks: upstream %s for %s: %s", resp.status_code, flow.request.path[:120], (m and (m.group(1) or m.group(2))) or text[:200])
        REPORTS_DIR.mkdir(parents=True, exist_ok=True)
        (REPORTS_DIR / f"upstream-{resp.status_code}.html").write_text(text)
    if not resp or flow.request.method != "GET" or flow.request.path.startswith(PREFIX):
        return
    if not HOST_RE.search(flow.request.pretty_host):
        return
    if "text/html" not in resp.headers.get("content-type", ""):
        return
    html = resp.get_text(strict=False) or ""
    if TAG in html:
        return
    head = re.search(r"<head[^>]*>", html, re.I)
    if not head:
        log.warning("amp-tweaks: no <head> in %s", flow.request.pretty_url)
        return
    resp.text = html[: head.end()] + TAG + html[head.end():]
    log.warning("amp-tweaks: injected into %s", flow.request.pretty_url)
