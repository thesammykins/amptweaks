"""mitmproxy addon: injects tweaks (bundled ./tweaks + ~/.amp-tweaks) into the ampcode.com web client.

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

# Tweaks come from two places: the ones bundled with this repo, and the user's own folder.
# A user file with the same name overrides a bundled one; names listed in <user dir>/disabled are skipped.
TWEAKS_DIR = Path(os.environ.get("AMP_TWEAKS_DIR", Path.home() / ".amp-tweaks"))
BUNDLED_DIR = Path(__file__).with_name("tweaks")
LOADER = Path(__file__).with_name("loader.js")
REPORTS_DIR = Path(os.environ.get("AMP_TWEAKS_REPORTS", Path.home() / "Library/Logs/amp-tweaks-reports"))
PREFIX = "/__amp-tweaks/"
PROXY_PORT = int(os.environ.get("AMP_TWEAKS_PORT", "8787"))
HOST_RE = re.compile(r"(^|\.)ampcode\.com$")
TAG = f'<script src="{PREFIX}loader.js"></script>'

log = logging.getLogger("amp-tweaks")

PAC = f"""function FindProxyForURL(url, host) {{
  if (host === "ampcode.com") return "PROXY 127.0.0.1:{PROXY_PORT}; DIRECT";
  return "DIRECT";
}}
"""


def _disabled() -> set[str]:
    f = TWEAKS_DIR / "disabled"
    if not f.is_file():
        return set()
    return {line.strip() for line in f.read_text().splitlines() if line.strip() and not line.startswith("#")}


def _assets(d: Path) -> list[Path]:
    """A tweak folder's .css/.js files, including subfolders (module tweaks import from them); _ and . names skipped."""
    return sorted(
        p for p in d.rglob("*")
        if p.is_file() and p.suffix in (".css", ".js")
        and not any(part.startswith(("_", ".")) for part in p.relative_to(d).parts)
    )


def tweak_sources() -> tuple[dict[str, Path], dict[str, Path]]:
    """Every tweak, on or off: (folders by name, loose files by file name). A personal folder overrides the
    bundled one with the same name; loose .css/.js files only count in ~/.amp-tweaks."""
    folders: dict[str, Path] = {}
    loose: dict[str, Path] = {}
    for root in (BUNDLED_DIR, TWEAKS_DIR):
        if not root.is_dir():
            continue
        for entry in root.iterdir():
            if entry.name.startswith(("_", ".")):
                continue
            if entry.is_dir():
                folders[entry.name] = entry
            elif root == TWEAKS_DIR and entry.is_file() and entry.suffix in (".css", ".js"):
                loose[entry.name] = entry
    return folders, loose


def tweak_files() -> list[tuple[str, Path]]:
    """Enabled tweak files as (served name, path), sorted by name so load order is predictable.

    A tweak is a folder (tweaks/<name>/*.js|css, or ~/.amp-tweaks/<name>/), served as "<name>/<file>".
    Loose files in ~/.amp-tweaks also work (served by file name). Names in ~/.amp-tweaks/disabled are skipped."""
    folders, loose = tweak_sources()
    off = _disabled()
    out = [(f"{name}/{p.relative_to(d).as_posix()}", p) for name, d in folders.items() if name not in off for p in _assets(d)]
    out += [(n, p) for n, p in loose.items() if n not in off and Path(n).stem not in off]
    return sorted(out)


def _meta(d: Path) -> dict:
    """A tweak folder's tweak.json: title, summary, and needs ("amp": only Amp's web app, or "this-mac": the proxy
    or the amp CLI on this Mac) with why. Missing or broken files just mean no metadata."""
    f = d / "tweak.json"
    try:
        m = json.loads(f.read_text()) if f.is_file() else {}
    except ValueError as e:
        log.warning("amp-tweaks: %s: %s", f, e)
        return {}
    return {k: m[k] for k in ("title", "summary", "needs", "why") if isinstance(m.get(k), str)}


def tweak_list() -> list[dict]:
    """Every tweak with whether it's on and its tweak.json, for the in-app menu. Same rules as `amp-tweaks tweaks`."""
    folders, loose = tweak_sources()
    off = _disabled()
    rows = [{"name": n, "on": n not in off, "personal": d.parent == TWEAKS_DIR, **_meta(d)} for n, d in folders.items()]
    rows += [{"name": n, "on": n not in off and Path(n).stem not in off, "personal": True} for n in loose]
    return sorted(rows, key=lambda r: r["name"])


CHANGES = Path(__file__).with_name("changes.json")


def set_tweak(flow: http.HTTPFlow) -> None:
    """POST ?name=<tweak>&on=0|1 turns a tweak off or on by editing ~/.amp-tweaks/disabled (as the CLI does)."""
    name, on = flow.request.query.get("name", ""), flow.request.query.get("on") == "1"
    if name not in {r["name"] for r in tweak_list()}:
        return respond(flow, 404, "no such tweak", "text/plain")
    f = TWEAKS_DIR / "disabled"
    lines = f.read_text().splitlines() if f.is_file() else []
    keep = [l for l in lines if l.strip() not in (name, Path(name).stem)]
    if not on:
        keep.append(name)
    TWEAKS_DIR.mkdir(parents=True, exist_ok=True)
    f.write_text("".join(f"{l}\n" for l in keep))
    log.warning("amp-tweaks: %s %s from the app", "enabled" if on else "disabled", name)
    respond(flow, 200, json.dumps(tweak_list()), "application/json")


def version(files: list[tuple[str, Path]]) -> str:
    """Change detector from (name, mtime, size): polled every second per window, so no file reads."""
    digest = hashlib.sha1()
    for name, p in files:
        st = p.stat()
        digest.update(f"{name}\0{st.st_mtime_ns}\0{st.st_size}\n".encode())
    return digest.hexdigest()[:12]


def manifest() -> dict:
    """css: stylesheets. js: classic scripts, loaded in order. modules: a tweak folder with an index.js is an ES module
    tweak; only index.js is loaded (as type=module) and it imports the folder's other files by relative path."""
    files = tweak_files()
    css = [f for f in files if f[1].suffix == ".css"]
    js = [f for f in files if f[1].suffix == ".js"]
    module_dirs = {n.split("/")[0] for n, _ in js if n.endswith("/index.js")}
    in_module = lambda n: "/" in n and n.split("/")[0] in module_dirs
    return {
        "css": [n for n, _ in css],
        "js": [n for n, _ in js if not in_module(n)],
        "modules": [f"{d}/index.js" for d in sorted(module_dirs)],
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
# Per-thread ordering: archive/unarchive for the same thread run in arrival order, so an Undo sent while
# its archive is still running always lands after it (even if the page that sent it has gone).
_thread_locks: dict[str, asyncio.Lock] = {}


async def archive(flow: http.HTTPFlow) -> None:
    """Archive (or ?undo=1 unarchive) threads via the amp CLI. ?id= takes one id or a comma-separated list."""
    ids = [i for i in flow.request.query.get("id", "").split(",") if i]
    if not ids or len(ids) > 500 or not all(THREAD_ID.match(i) for i in ids):
        return respond(flow, 400, "bad thread id", "text/plain")
    undo = bool(flow.request.query.get("undo"))
    gate = asyncio.Semaphore(6)

    async def one(tid: str) -> tuple[str, bool, str]:
        # Amp's server intermittently answers "Internal error"; retry once before calling it a failure.
        msg = ""
        lock = _thread_locks.setdefault(tid, asyncio.Lock())
        async with lock:
            return await attempt_archive(tid, msg)

    async def attempt_archive(tid: str, msg: str) -> tuple[str, bool, str]:
        for attempt in range(2):
            async with gate:
                args = [AMP_CLI, "threads", "archive", tid] + (["--unarchive"] if undo else [])
                proc = await asyncio.create_subprocess_exec(*args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
                out, err = await proc.communicate()
            msg = (err or out).decode()[:200].strip()
            if proc.returncode == 0:
                return tid, True, msg
            await asyncio.sleep(1.0)
        return tid, False, msg

    results = await asyncio.gather(*(one(i) for i in ids))
    done = [t for t, ok, _ in results if ok]
    failed = [{"id": t, "error": msg} for t, ok, msg in results if not ok]
    log.warning("amp-tweaks: %s %d thread(s), %d failed%s", "unarchive" if undo else "archive", len(ids), len(failed), f": {failed[:3]}" if failed else "")
    global _threads_cache
    _threads_cache = (0.0, _threads_cache[1])  # next threads.json reflects the change
    # Always 200 with per-thread results: the client restores exactly what failed and undoes exactly what succeeded.
    respond(flow, 200, json.dumps({"ok": not failed, "count": len(ids), "done": done, "failed": failed}), "application/json")


# clickable-paths: file paths in Amp's replies open on this Mac. Only existing paths under your home folder, and files
# open in an editor (never with their default app), so a page script can't use this to launch anything.
EDITORS = [os.environ.get("AMP_TWEAKS_EDITOR"), "Zed", "Visual Studio Code", "Cursor"]
MAX_REFS = 200


def _editor() -> str | None:
    for name in filter(None, EDITORS):
        if any(Path(root, f"{name}.app").exists() for root in ("/Applications", Path.home() / "Applications")):
            return name
    return None


def _local(path: str, root: str | None) -> Path | None:
    """An existing path under $HOME, from an absolute, ~ or root-relative path; None otherwise."""
    if not path or len(path) > 1024 or "\0" in path:
        return None
    if path.startswith("~/"):
        p = Path.home() / path[2:]
    elif path.startswith("/"):
        p = Path(path)
    elif root and root.startswith("/"):
        p = Path(root) / path
    else:
        return None
    try:
        p = p.resolve(strict=True)
    except (OSError, RuntimeError):
        return None
    return p if p.is_relative_to(Path.home()) else None


# A thread's files are only on this Mac when it ran on a runner here. Amp records the runner's id and hostname;
# this Mac is known by its host names and the runner ids `amp runner list` reports. Cached: runners rarely change.
LOCAL_TTL = 300.0
_local_cache: tuple[float, set[str], set[str]] = (0.0, set(), set())


def _short(host: str | None) -> str:
    return (host or "").split(".")[0].strip().lower()


_runner_dirs: dict[str, list[str]] = {}


async def local_identity() -> tuple[set[str], set[str]]:
    """(this Mac's short host names, runner ids running here). Also refreshes the folders each runner serves."""
    global _local_cache
    if time.monotonic() - _local_cache[0] < LOCAL_TTL:
        return _local_cache[1], _local_cache[2]
    import socket
    names = {_short(socket.gethostname())}
    for key in ("LocalHostName", "ComputerName"):
        try:  # launchd's PATH has no /usr/sbin
            proc = await asyncio.create_subprocess_exec("/usr/sbin/scutil", "--get", key, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
            out, _ = await proc.communicate()
            names.add(_short(out.decode()))
        except OSError as e:
            log.warning("amp-tweaks: scutil --get %s failed: %s", key, e)
    runners: set[str] = set()
    try:
        proc = await asyncio.create_subprocess_exec(AMP_CLI, "runner", "list", "--json", stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        out, err = await asyncio.wait_for(proc.communicate(), 15)
        listed = [r for r in json.loads(out).get("runners", []) if r.get("runnerId")]
        runners = {r["runnerId"] for r in listed}
        _runner_dirs.clear()
        _runner_dirs.update({r["runnerId"]: [d["path"] for d in r.get("directories", []) if d.get("path")] for r in listed})
    except (OSError, ValueError, asyncio.TimeoutError) as e:
        log.warning("amp-tweaks: amp runner list failed, matching on host name only: %s", e)
    names.discard("")
    _local_cache = (time.monotonic(), names, runners)
    return names, runners


async def ran_here(runner: dict) -> bool:
    """True when a thread's runner ({id, hostname} from Amp's thread env) is this Mac. Orb threads have neither."""
    names, runners = await local_identity()
    return bool((runner.get("id") and runner["id"] in runners) or (runner.get("hostname") and _short(runner["hostname"]) in names))


async def refs(flow: http.HTTPFlow) -> None:
    """POST {root, runner: {id, hostname}, paths: [...]} -> {local, paths: {path: {path, dir}}}: whether the thread
    ran on this Mac, and which of its paths exist here. No paths unless it ran here, so an orb's or another
    machine's paths never open local files."""
    try:
        body = json.loads(flow.request.raw_content or b"{}")
        root, runner, paths = body.get("root"), body.get("runner") or {}, body.get("paths", [])[:MAX_REFS]
    except (ValueError, AttributeError):
        return respond(flow, 400, "bad body", "text/plain")
    local = isinstance(runner, dict) and await ran_here(runner)
    found = {}
    for raw in paths if local else []:
        p = _local(str(raw), root if isinstance(root, str) else None)
        if p:
            found[raw] = {"path": str(p), "dir": p.is_dir()}
    respond(flow, 200, json.dumps({"local": local, "paths": found}), "application/json")


async def runners_json(flow: http.HTTPFlow) -> None:
    """GET -> {runner id: [folders it serves]} for the runners on this Mac."""
    await local_identity()
    respond(flow, 200, json.dumps(_runner_dirs), "application/json")


async def serve_dir(flow: http.HTTPFlow) -> None:
    """POST ?runner=<id>&dir=<path>: `amp runner dirs add` for one of this Mac's runners and a folder under $HOME,
    for a thread Amp can't resume because its runner doesn't serve that folder."""
    global _local_cache
    runner, d = flow.request.query.get("runner", ""), _local(flow.request.query.get("dir", ""), None)
    _, runners = await local_identity()
    if runner not in runners:
        return respond(flow, 404, "not a runner on this Mac", "text/plain")
    if not d or not d.is_dir():
        return respond(flow, 404, "not a folder under your home folder", "text/plain")
    proc = await asyncio.create_subprocess_exec(AMP_CLI, "runner", "dirs", "add", "--runner-id", runner, str(d), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    out, err = await proc.communicate()
    _local_cache = (0.0, set(), set())  # pick up the new folder on the next look
    if proc.returncode != 0:
        log.warning("amp-tweaks: amp runner dirs add %s failed: %s", d, (err or out).decode()[:200])
        return respond(flow, 500, (err or out).decode()[:200] or "amp runner dirs add failed", "text/plain")
    log.warning("amp-tweaks: runner %s now serves %s", runner, d)
    respond(flow, 204, b"", "text/plain")


COMMIT_URL = re.compile(r"^https://github\.com/[\w.-]+/[\w.-]+/commit/[0-9a-f]{7,40}$")


async def open_ref(flow: http.HTTPFlow) -> None:
    """POST ?path=<abs>[&reveal=1] opens a file in your editor or shows it in Finder; ?url= opens a GitHub commit."""
    q = flow.request.query
    if url := q.get("url"):
        if not COMMIT_URL.match(url):
            return respond(flow, 400, "only GitHub commit links", "text/plain")
        args = ["open", url]
    else:
        p = _local(q.get("path", ""), None)
        if not p:
            return respond(flow, 404, "not a path under your home folder", "text/plain")
        editor = _editor()
        if q.get("reveal") or p.is_dir():
            args = ["open", "-R", str(p)]
        else:
            args = ["open", "-a", editor, str(p)] if editor else ["open", "-t", str(p)]
    proc = await asyncio.create_subprocess_exec(*args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    _, err = await proc.communicate()
    if proc.returncode != 0:
        log.warning("amp-tweaks: %s failed: %s", " ".join(args[:3]), err.decode()[:200])
        return respond(flow, 500, err.decode()[:200] or "open failed", "text/plain")
    respond(flow, 204, b"", "text/plain")


async def serve_tweak(flow: http.HTTPFlow, name: str) -> None:
    if name == "act/archive" and flow.request.method == "POST":
        return await archive(flow)
    if name == "tweaks.json":
        return respond(flow, 200, json.dumps(tweak_list()), "application/json")
    if name == "changes.json":
        return respond(flow, 200, CHANGES.read_bytes() if CHANGES.is_file() else b"[]", "application/json")
    if name == "act/tweak" and flow.request.method == "POST":
        return set_tweak(flow)
    if name == "act/refs" and flow.request.method == "POST":
        return await refs(flow)
    if name == "runners.json":
        return await runners_json(flow)
    if name == "act/serve" and flow.request.method == "POST":
        return await serve_dir(flow)
    if name == "act/open" and flow.request.method == "POST":
        return await open_ref(flow)
    if name == "report" and flow.request.method == "POST":
        return save_report(flow)
    if name == "data/threads.json":
        return respond(flow, 200, await threads_json(), "application/json")
    if name == "loader.js":
        return respond(flow, 200, LOADER.read_bytes(), "text/javascript; charset=utf-8")
    if name == "manifest.json":
        return respond(flow, 200, json.dumps(manifest()), "application/json")
    # Serve only enabled tweaks, looked up by exact name (no paths), so nothing else on disk is reachable.
    from urllib.parse import unquote
    name = unquote(name)
    path = next((p for n, p in tweak_files() if n == name), None)
    if path is None:
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
    # Answer the client's TLS handshake straight away from our CA (by SNI) instead of first connecting to
    # ampcode.com to copy its certificate; with lazy connections, upstream is only dialled when a request needs it.
    ctx.options.upstream_cert = False


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


def websocket_message(flow: http.HTTPFlow) -> None:
    """mitmproxy keeps every websocket message on the flow for the life of the connection. Amp's thread
    streams are long-lived and chatty, so memory (and GC pauses) grow with uptime. Nothing here reads them."""
    if flow.websocket and len(flow.websocket.messages) > 1:
        del flow.websocket.messages[:-1]


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
