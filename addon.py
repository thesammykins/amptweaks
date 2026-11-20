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

from mitmproxy import http

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
    digest = hashlib.sha1()
    for p in files:
        digest.update(p.name.encode() + b"\0" + p.read_bytes())
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
    log.info("amp-tweaks: report %s (%d bytes)", name, len(flow.request.raw_content or b""))
    respond(flow, 204, b"", "text/plain")


AMP_CLI = shutil.which("amp") or str(Path.home() / ".amp/bin/amp")
THREADS_TTL = 20.0
_threads_cache: tuple[float, bytes] = (0.0, b"[]")


async def threads_json() -> bytes:
    """Thread metadata the web DOM doesn't carry (e.g. updated time), via the amp CLI."""
    global _threads_cache
    if time.monotonic() - _threads_cache[0] < THREADS_TTL:
        return _threads_cache[1]
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


async def serve_tweak(flow: http.HTTPFlow, name: str) -> None:
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


async def request(flow: http.HTTPFlow) -> None:
    if flow.request.path.split("?")[0] == "/proxy.pac" and not HOST_RE.search(flow.request.pretty_host):
        return respond(flow, 200, PAC, "application/x-ns-proxy-autoconfig")
    if HOST_RE.search(flow.request.pretty_host) and flow.request.path.startswith(PREFIX):
        await serve_tweak(flow, flow.request.path[len(PREFIX):].split("?")[0])


def response(flow: http.HTTPFlow) -> None:
    resp = flow.response
    if not resp or flow.request.method != "GET" or flow.request.path.startswith(PREFIX):
        return
    if not HOST_RE.search(flow.request.pretty_host):
        return
    if "text/html" not in resp.headers.get("content-type", ""):
        return
    html = resp.get_text(strict=False) or ""
    head = re.search(r"<head[^>]*>", html, re.I)
    if not head:
        log.warning("amp-tweaks: no <head> in %s", flow.request.pretty_url)
        return
    resp.text = html[: head.end()] + TAG + html[head.end():]
    log.info("amp-tweaks: injected into %s", flow.request.pretty_url)
