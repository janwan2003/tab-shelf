#!/usr/bin/env python3
"""Google Search Console for the Tabhaven site (only this site; the token also sees the operator's other sites).

  python3 scripts/gsc.py token     -> writes the FILE verification token to docs/<name>.html (deployed to the site root)
  python3 scripts/gsc.py verify    -> asks the Site Verification API to verify the site, then adds it to Search Console
  python3 scripts/gsc.py sitemap   -> submits sitemap.xml
  python3 scripts/gsc.py status    -> site permission, sitemap state, last 28 days of search analytics

Credentials: CWS_CLIENT_ID / CWS_CLIENT_SECRET / GSC_REFRESH_TOKEN from the studio .env (never printed).
(Adapted from ventures/save-image-format/scripts/gsc.py.)
"""
import datetime, json, sys, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV = dict(l.split("=", 1) for l in (ROOT.parent.parent / ".env").read_text().splitlines() if "=" in l)
SITE = "https://janwan2003.github.io/tab-shelf/"
SITEMAP = SITE + "sitemap.xml"
ENC = urllib.parse.quote(SITE, safe="")


def token():
    data = urllib.parse.urlencode(dict(client_id=ENV["CWS_CLIENT_ID"], client_secret=ENV["CWS_CLIENT_SECRET"],
                                       refresh_token=ENV["GSC_REFRESH_TOKEN"], grant_type="refresh_token")).encode()
    for attempt in range(4):
        try:
            return json.load(urllib.request.urlopen("https://oauth2.googleapis.com/token", data))["access_token"]
        except urllib.error.HTTPError as e:
            if e.code < 500 or attempt == 3:
                raise
            time.sleep(3 * (attempt + 1))


def call(method, url, body=None):
    headers = {"Authorization": f"Bearer {token()}"}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return r.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, raw[:500].decode(errors="replace")


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    sv = "https://www.googleapis.com/siteVerification/v1"
    wm = "https://www.googleapis.com/webmasters/v3"
    if cmd == "token":
        code, res = call("POST", f"{sv}/token", {"site": {"type": "SITE", "identifier": SITE}, "verificationMethod": "FILE"})
        print(code, res)
        if code == 200:
            name = res["token"]
            name = name if name.endswith(".html") else name + ".html"
            out = ROOT / "docs" / name
            out.parent.mkdir(exist_ok=True)
            out.write_text(f"google-site-verification: {name}")
            print("wrote", out.relative_to(ROOT))
    elif cmd == "verify":
        print("verify:", *call("POST", f"{sv}/webResource?verificationMethod=FILE", {"site": {"type": "SITE", "identifier": SITE}}))
        print("add to Search Console:", *call("PUT", f"{wm}/sites/{ENC}"))
    elif cmd == "sitemap":
        print("submit:", *call("PUT", f"{wm}/sites/{ENC}/sitemaps/{urllib.parse.quote(SITEMAP, safe='')}"))
    elif cmd == "status":
        print("site:", *call("GET", f"{wm}/sites/{ENC}"))
        print("sitemaps:", json.dumps(call("GET", f"{wm}/sites/{ENC}/sitemaps")[1], indent=1))
        end = datetime.date.today()
        start = end - datetime.timedelta(days=28)
        q = {"startDate": str(start), "endDate": str(end), "dimensions": ["page"], "rowLimit": 50}
        code, res = call("POST", f"{wm}/sites/{ENC}/searchAnalytics/query", q)
        rows = (res or {}).get("rows", []) if code == 200 else res
        print(f"search analytics {start}..{end}:", json.dumps(rows, indent=1) if rows else "no rows")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
