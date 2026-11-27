"""Writes sitemap.xml: the site's pages, the MP pages with data and every replay.

The MPs and the replays come from Firestore's public data (the same reads the site's pages make), over its REST
API with the site's public web key from js/config.js: no login, so the security rules allow only what any visitor
may read. Firestore enforces App Check, so a request also needs an App Check token. The script gets one by
exchanging an App Check debug token for the site's web app, from the environment (APP_CHECK_DEBUG_TOKEN; the
GitHub Action's secret of the same name; Firebase console → App Check → Apps → Manage debug tokens). Python's
standard library only (Python 3.8+). The GitHub Action .github/workflows/sitemap.yml runs it every day and commits
the file if it changed; to run it by hand, from the repo root:

    APP_CHECK_DEBUG_TOKEN=… python3 tools/sitemap.py              # rewrites sitemap.xml
    APP_CHECK_DEBUG_TOKEN=… python3 tools/sitemap.py --print      # prints it instead

Which pages go in:
- every .html page in the repo root, except the ones that need a parameter (TEMPLATES). index.html is listed as
  the site's root URL. lastmod is the page's last commit;
- mp.html?id=<id> for the MPs with has_data only. The other MP pages show just the name, party, role and photo,
  which search engines tend to file as thin or soft-404 pages; they join once they have speeches;
- watch.html?s=<run> for every archive/ document, the runs archive.html lists.
lastmod is the document's updated_at for MPs and replays, and the newest of those for mps.html and archive.html.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parent.parent
BASE = "https://vitaradar.hu/"
TEMPLATES = {"mp.html", "watch.html", "fact.html", "profile.html", "404.html", "offline.html"}  # pages that need ?id= / ?s= / ?f= or a sign-in, or aren't pages (offline.html: sw.js; fact.html only forwards a shared fact)
CONFIG = json.loads(re.search(r"firebaseConfig\s*=\s*(\{.*?\});", (ROOT / "js/config.js").read_text(), re.S).group(1))
API = f"https://firestore.googleapis.com/v1/projects/{CONFIG['projectId']}/databases/(default)/documents"
APP_CHECK = (f"https://firebaseappcheck.googleapis.com/v1/projects/{CONFIG['projectId']}"
             f"/apps/{CONFIG['appId']}:exchangeDebugToken")


def call(url: str, body: dict | None = None, headers: dict | None = None) -> object:
    req = urllib.request.Request(
        f"{url}{'&' if '?' in url else '?'}key={CONFIG['apiKey']}",
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json", "Referer": BASE, **(headers or {})},  # the key may be limited to the site
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def app_check() -> dict:  # the App Check header for Firestore, from the debug token (none without one)
    debug = os.environ.get("APP_CHECK_DEBUG_TOKEN", "").strip()
    if not debug:
        print("APP_CHECK_DEBUG_TOKEN is not set: Firestore will refuse the reads (App Check)", file=sys.stderr)
        return {}
    return {"X-Firebase-AppCheck": call(APP_CHECK, {"debugToken": debug})["token"]}


HEADERS: dict = {}  # filled once by entries()


def value(field: dict | None):  # a Firestore REST value: {"integerValue": "…"} etc.
    if not field:
        return None
    (kind, v), = field.items()
    return int(v) if kind == "integerValue" else v


def fetch(collection: str, where_has_data: bool = False) -> list[tuple[str, dict]]:
    query: dict = {"from": [{"collectionId": collection}],
                   "select": {"fields": [{"fieldPath": "updated_at"}, {"fieldPath": "date"}]}}
    if where_has_data:
        query["where"] = {"fieldFilter": {"field": {"fieldPath": "has_data"}, "op": "EQUAL",
                                          "value": {"booleanValue": True}}}
    rows = call(f"{API}:runQuery", {"structuredQuery": query}, HEADERS)
    docs = [r["document"] for r in rows if "document" in r]
    return [(d["name"].rsplit("/", 1)[1], {k: value(v) for k, v in d.get("fields", {}).items()}) for d in docs]


def day(ms: int | None) -> str | None:
    return datetime.fromtimestamp(ms / 1000, timezone.utc).date().isoformat() if ms else None


def committed(page: str) -> str | None:  # the day of the page's last commit
    out = subprocess.run(["git", "-C", str(ROOT), "log", "-1", "--format=%cs", "--", page],
                         capture_output=True, text=True).stdout.strip()
    return out or None


def entries() -> list[tuple[str, str | None]]:
    HEADERS.update(app_check())
    mps = sorted(fetch("mps", where_has_data=True))
    runs = sorted(fetch("archive"), key=lambda r: (r[1].get("date") or "", r[0]), reverse=True)  # newest first
    newest = lambda docs: max((day(d.get("updated_at")) or "" for _, d in docs), default="") or None  # noqa: E731
    data_day = {"mps.html": newest(mps), "archive.html": newest(runs)}

    pages = sorted(p.name for p in ROOT.glob("*.html") if p.name not in TEMPLATES)
    pages.sort(key=lambda p: p != "index.html")  # the root URL first
    out = []
    for page in pages:
        days = [d for d in (committed(page), data_day.get(page)) if d]
        out.append((BASE if page == "index.html" else BASE + page, max(days) if days else None))
    out += [(f"{BASE}mp.html?id={quote(i)}", day(m.get("updated_at"))) for i, m in mps]
    out += [(f"{BASE}watch.html?s={quote(r)}", day(a.get("updated_at"))) for r, a in runs]
    return out


def render(urls: list[tuple[str, str | None]]) -> str:
    lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for loc, last in urls:
        lines.append(f"  <url><loc>{escape(loc)}</loc>" + (f"<lastmod>{last}</lastmod>" if last else "") + "</url>")
    return "\n".join(lines + ["</urlset>"]) + "\n"


if __name__ == "__main__":
    xml = render(urls := entries())
    if "--print" in sys.argv:
        sys.stdout.write(xml)
    else:
        (ROOT / "sitemap.xml").write_text(xml, encoding="utf-8")
        print(f"sitemap.xml: {len(urls)} URLs", file=sys.stderr)
