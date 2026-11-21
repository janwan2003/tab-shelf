#!/usr/bin/env python3
"""Submit dist/tabhaven-<version>-firefox.zip to Firefox AMO (addons.mozilla.org API v5).

First run creates the listed add-on with its listing text; later runs add a new version.
Credentials: AMO_JWT_ISSUER / AMO_JWT_SECRET from the studio .env (never printed).
Build first: node tools/build.mjs
Usage: python3 scripts/amo-submit.py            # upload + create or add version
       python3 scripts/amo-submit.py --status   # show the add-on's review status
       python3 scripts/amo-submit.py --listing  # only update the listing summary/description
       python3 scripts/amo-submit.py --previews # upload store screenshots AMO does not have yet
(Adapted from ventures/save-image-format/scripts/amo-submit.py.)
"""
import base64, hashlib, hmac, json, sys, time, urllib.error, urllib.request, uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV = dict(l.split("=", 1) for l in (ROOT.parent.parent / ".env").read_text().splitlines() if "=" in l)
API = "https://addons.mozilla.org/api/v5"
ADDON_ID = "tabhaven@tab-shelf"
SITE = "https://janwan2003.github.io/tab-shelf/"
CATEGORIES = ["tabs"]

SUMMARY = ("Save all your tabs into searchable groups in one click and free memory. Every save is checked before a tab "
           "closes, with automatic backup files and version history, so saved tabs are never lost. No account.")
DESCRIPTION = """Tabhaven saves every tab in your window to a searchable shelf with one click, closes them to free memory, and brings them back when you need them. It is built around one promise: your saved tabs are never lost.

• One click saves this window, all windows, or one tab (toolbar button, right-click on a page or a tab, or Alt+Shift+S).
• Tabs close only after the save has been written to disk and read back. If anything fails, they stay open.
• Automatic backup files in Downloads/Tabhaven/: a JSON file and a readable HTML page of links, refreshed after changes, plus 7 daily copies. They are ordinary files, so they survive a crash, an add-on update, a reinstall or a profile reset.
• Version history: the last 30 versions of your shelf are kept. Undo a delete or a restore, or roll the whole shelf back.
• Fast with big lists: search titles and URLs across 10,000+ saved tabs as you type.
• Rename, star and lock groups; drag tabs between groups; restore a group into this window or a new one.
• Switch in one paste: imports OneTab-style "URL | title" text, JSON exports of other tab managers, bookmark HTML files and plain URL lists. Export as JSON, HTML, text or Markdown.
• Private: no account, no server, no analytics. Your shelf stays on your computer. Open source (MIT).

Switching from OneTab: """ + SITE + """switch-from-onetab.html
Lost your saved tabs in another extension? """ + SITE + """recover-lost-saved-tabs.html
Source code: https://github.com/janwan2003/tab-shelf"""


def jwt():
    b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()
    now = int(time.time())
    head = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    body = b64(json.dumps({"iss": ENV["AMO_JWT_ISSUER"], "jti": str(uuid.uuid4()), "iat": now, "exp": now + 60}).encode())
    sig = b64(hmac.new(ENV["AMO_JWT_SECRET"].encode(), f"{head}.{body}".encode(), hashlib.sha256).digest())
    return f"JWT {head}.{body}.{sig}"


def call(method, path, data=None, files=None):
    headers = {"Authorization": jwt()}
    body = None
    if files:
        boundary = uuid.uuid4().hex
        parts = []
        for k, v in (data or {}).items():
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
        for k, (name, content) in files.items():
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"; filename="{name}"\r\n'
                         f'Content-Type: {"image/png" if name.endswith(".png") else "application/zip"}\r\n\r\n'.encode() + content + b"\r\n")
        body = b"".join(parts) + f"--{boundary}--\r\n".encode()
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
    elif data is not None:
        body = json.dumps(data).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(API + path, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"null")


def status():
    code, a = call("GET", f"/addons/addon/{ADDON_ID}/")
    if code != 200:
        print("not found", code, a); return
    v = a.get("latest_unlisted_version") or a.get("current_version")
    print(json.dumps({"status": a.get("status"), "slug": a.get("slug"), "url": a.get("url"),
                      "current_version": (a.get("current_version") or {}).get("version")}, indent=1))
    code, vs = call("GET", f"/addons/addon/{ADDON_ID}/versions/?filter=all_with_unlisted")
    for ver in (vs or {}).get("results", [])[:3]:
        print("version", ver["version"], "file status:", ver.get("file", {}).get("status"))


def status():
    code, a = call("GET", f"/addons/addon/{ADDON_ID}/")
    if code != 200:
        print("not found", code, a); return
    v = a.get("latest_unlisted_version") or a.get("current_version")
    print(json.dumps({"status": a.get("status"), "slug": a.get("slug"), "url": a.get("url"),
                      "current_version": (a.get("current_version") or {}).get("version")}, indent=1))
    code, vs = call("GET", f"/addons/addon/{ADDON_ID}/versions/?filter=all_with_unlisted")
    for ver in (vs or {}).get("results", [])[:3]:
        print("version", ver["version"], "file status:", ver.get("file", {}).get("status"))


def main():
    if "--status" in sys.argv:
        return status()
    version = json.loads((ROOT / "src/manifest.json").read_text())["version"]
    zip_path = ROOT / "dist" / f"tabhaven-{version}-firefox.zip"
    code, up = call("POST", "/addons/upload/", {"channel": "listed"}, {"upload": (zip_path.name, zip_path.read_bytes())})
    print("upload", code, {k: up.get(k) for k in ("uuid", "processed", "valid")} if isinstance(up, dict) else up)
    if code >= 300:
        print(up); sys.exit(1)
    for _ in range(60):
        code, up = call("GET", f"/addons/upload/{up['uuid']}/")
        if up.get("processed"):
            break
        time.sleep(2)
    v = up.get("validation") or {}
    print("validation: valid=%s errors=%s warnings=%s" % (up.get("valid"), v.get("errors"), v.get("warnings")))
    if not up.get("valid"):
        for m in v.get("messages", []):
            if m.get("type") == "error":
                print(" -", m.get("message"), m.get("file"))
        sys.exit(1)
    code, existing = call("GET", f"/addons/addon/{ADDON_ID}/")
    if code == 200:
        code, res = call("POST", f"/addons/addon/{ADDON_ID}/versions/", {"upload": up["uuid"], "license": "MIT"})
        print("version", code, json.dumps({k: res.get(k) for k in ("id", "version")} if code < 300 else res)[:400])
        if code < 300:  # keep the listing text in step with the version
            code, res = patch_listing()
    else:
        code, res = call("POST", "/addons/addon/", {
            "categories": CATEGORIES,
            "summary": {"en-US": SUMMARY},
            "description": {"en-US": DESCRIPTION},
            "homepage": {"en-US": SITE},
            "support_url": {"en-US": "https://github.com/janwan2003/tab-shelf/issues"},
            "version": {"upload": up["uuid"], "license": "MIT"},
        })
    print("listing/create", code, json.dumps({k: res.get(k) for k in ("id", "slug", "status", "url")} if code < 300 else res)[:800])
    if code >= 300:
        sys.exit(1)


# Store screenshots (1280x800) in listing order, with captions; matched to AMO previews by caption.
PREVIEWS = [
    ("store/screenshot-1-1280x800.png", "Every tab from your window in a searchable, named group"),
    ("store/screenshot-2-1280x800.png", "Search 10,000+ saved tabs as you type"),
    ("store/screenshot-3-1280x800.png", "Version history: undo a delete or roll back the whole shelf"),
]


def upload_previews():
    code, a = call("GET", f"/addons/addon/{ADDON_ID}/")
    if code != 200:
        print("not found", code, a); return 1
    have = [((p.get("caption") or {}).get("en-US") or "") for p in a.get("previews", [])]
    print("AMO has", len(have), "preview(s):", have)
    failed = 0
    for i, (rel, caption) in enumerate(PREVIEWS):
        if i < len(have):
            continue  # AMO already has a screenshot in this position
        path = ROOT / rel
        code, res = call("POST", f"/addons/addon/{ADDON_ID}/previews/", {"position": str(i)},
                         {"image": (path.name, path.read_bytes())})
        print("preview", rel, code, json.dumps(res)[:300])
        if code < 300:  # multipart cannot carry the translated caption object; set it with JSON
            time.sleep(40)
            code, res = call("PATCH", f"/addons/addon/{ADDON_ID}/previews/{res['id']}/", {"caption": {"en-US": caption}})
            print("caption", code, json.dumps(res)[:200])
        failed |= code >= 300
    return failed


def patch_listing():
    return call("PATCH", f"/addons/addon/{ADDON_ID}/", {"summary": {"en-US": SUMMARY}, "description": {"en-US": DESCRIPTION}})


if __name__ == "__main__":
    if "--previews" in sys.argv:
        sys.exit(upload_previews())
    if "--listing" in sys.argv:
        code, res = patch_listing()
        print("listing", code, json.dumps(res)[:300] if code >= 300 else "updated")
        sys.exit(code >= 300)
    main()
