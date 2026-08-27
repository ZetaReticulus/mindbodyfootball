#!/usr/bin/env python3
"""Refresh the 9 latest @mind_body_football Instagram thumbs into assets/ig/.

Instagram blocks unauthenticated profile scrapes, so this uses the public
oEmbed API against a curated shortcode list (plus any extras you pass on
the CLI). Verifies author_name == mind_body_football, sorts by media id
(newest first), downloads 9 thumbnails, and prints the HTML snippet to paste.
"""
from __future__ import annotations

import html as htmlmod
import json
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "assets" / "ig"
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

# Seed shortcodes known to belong to the account (extend over time).
SEED = [
    "DZ_4WGmNPiu",
    "DZUkje8zVbM",
    "DYL8_KYTETt",
    "DYBqV1rTdMt",
    "DX8WhfCT6XV",
    "DX794e8zbnq",
    "DXt0IW_k1ZY",
    "DW0YqKBE9dr",
    "DVxLq-cE1ov",
    "DTfGX9sE89q",
    "DTZis2TExGf",
    "DDbHU-WSYCa",
    "C5rgMI1yzmc",
    "C3Km_iTypfF",
]


def shortcode_to_id(code: str) -> int:
    n = 0
    for ch in code:
        n = n * 64 + ALPHABET.index(ch)
    return n


def oembed(code: str) -> dict | None:
    for kind in ("p", "reel"):
        path = f"https://www.instagram.com/{kind}/{code}/"
        api = (
            "https://www.instagram.com/api/v1/oembed/?url="
            + urllib.parse.quote(path, safe="")
            + "&omitscript=true"
        )
        req = urllib.request.Request(
            api, headers={"User-Agent": UA, "Accept": "application/json"}
        )
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                data = json.loads(r.read().decode())
        except Exception:
            continue
        author = (data.get("author_name") or "").strip()
        if author and author.lower() != "mind_body_football":
            return None
        m = re.search(
            r'data-instgrm-permalink=\\"([^\\]+)\\"', data.get("html") or ""
        )
        permalink = htmlmod.unescape(m.group(1)).split("?")[0] if m else path
        return {
            "code": code,
            "id": shortcode_to_id(code),
            "title": (data.get("title") or "").strip(),
            "thumb": data.get("thumbnail_url"),
            "permalink": permalink.rstrip("/") + "/",
            "author": author or "mind_body_football",
        }
    return None


def download(url: str, dest: Path) -> int:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": UA,
            "Referer": "https://www.instagram.com/",
            "Accept": "image/avif,image/webp,image/*,*/*;q=0.8",
        },
    )
    with urllib.request.urlopen(req, timeout=45) as r:
        data = r.read()
    if len(data) < 2000:
        raise RuntimeError(f"too small ({len(data)}B)")
    dest.write_bytes(data)
    subprocess.run(
        ["sips", "-s", "format", "jpeg", str(dest), "--out", str(dest)],
        check=False,
        capture_output=True,
    )
    return len(data)


def main() -> int:
    extras = [c.strip() for c in sys.argv[1:] if c.strip()]
    codes, seen = [], set()
    for c in SEED + extras:
        if c not in seen:
            seen.add(c)
            codes.append(c)

    OUT.mkdir(parents=True, exist_ok=True)
    posts = []
    for c in codes:
        p = oembed(c)
        if p and p.get("thumb"):
            posts.append(p)
            print(f"OK   {c}  id={p['id']}  {(p['title'] or '')[:60]!r}")
        else:
            print(f"SKIP {c}")
        time.sleep(0.12)

    posts.sort(key=lambda p: p["id"], reverse=True)
    top = posts[:9]
    if len(top) < 9:
        print(f"\nOnly found {len(top)} posts — need 9. Pass more shortcodes.")
        return 1

    for old in OUT.glob("*"):
        if old.is_file():
            old.unlink()

    print("\nTop 9:")
    for i, p in enumerate(top, 1):
        dest = OUT / f"{i:02d}-{p['code']}.jpg"
        n = download(p["thumb"], dest)
        p["file"] = f"assets/ig/{dest.name}"
        # square graphic vs portrait reel
        dim = subprocess.run(
            ["sips", "-g", "pixelWidth", "-g", "pixelHeight", str(dest)],
            capture_output=True,
            text=True,
        ).stdout
        w = h = 0
        for line in dim.splitlines():
            if "pixelWidth" in line:
                w = int(line.split()[-1])
            if "pixelHeight" in line:
                h = int(line.split()[-1])
        p["square"] = h <= w * 1.08
        href_kind = "p" if p["square"] else "reel"
        p["href"] = f"https://www.instagram.com/{href_kind}/{p['code']}/"
        print(f"  {i:02d} {dest.name:28} {n/1024:6.1f}KB  {w}x{h}  {p['href']}")

    (OUT / "manifest.json").write_text(json.dumps(top, indent=2))
    print(f"\nWrote {OUT}/manifest.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
