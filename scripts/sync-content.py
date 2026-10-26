#!/usr/bin/env python3
"""Copy the public Mindforge content into public/content for the managed app.

The source is the public GitHub repository (shallow clone cached in .cache/),
so the app always mirrors what is published there. Only files tracked by git
are considered. Files are stored under hashed names to keep the build archive
ASCII-only; manifest.json maps repository paths to them.

Usage: python3 scripts/sync-content.py [local-checkout]
       (without an argument, clones or updates SOURCE_REPO)
"""

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

DOC_ROOTS = ("Notes/", "Azure/", "paper/", "book/", "product/", "wiki/")
IMG_EXT = (".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp")
RE_IMG_MD = re.compile(r"!\[[^\]]*\]\(([^)\s]+)")
RE_IMG_HTML = re.compile(r"<img[^>]+src=[\"']([^\"']+)[\"']", re.I)
RE_TITLE = re.compile(r"^title:\s*(.+?)\s*$", re.M)
RE_H1 = re.compile(r"^#\s+(.+?)\s*$", re.M)

SOURCE_REPO = "https://github.com/huqianghui/mindforge.git"
APP_ROOT = Path(__file__).resolve().parent.parent
CACHE = APP_ROOT / ".cache" / "mindforge"
OUT = APP_ROOT / "public" / "content"


def key(path: str) -> str:
    return hashlib.sha1(path.encode("utf-8")).hexdigest()[:12]


def title_of(text: str, path: str) -> str:
    if text.startswith("---"):
        end = text.find("\n---", 3)
        m = RE_TITLE.search(text[:end]) if end > 0 else None
        if m:
            return m.group(1).strip("'\"")
    m = RE_H1.search(text)
    return m.group(1) if m else Path(path).stem


def git(*args: str, cwd: Path | None = None) -> str:
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, check=True, text=True).stdout.strip()


def checkout_source() -> Path:
    if (CACHE / ".git").exists():
        git("fetch", "--depth", "1", "origin", "main", cwd=CACHE)
        git("reset", "--hard", "FETCH_HEAD", cwd=CACHE)
    else:
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        git("clone", "--depth", "1", SOURCE_REPO, str(CACHE))
    return CACHE


def main() -> None:
    vault = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else checkout_source()
    commit = git("rev-parse", "--short", "HEAD", cwd=vault)
    tracked = subprocess.run(
        ["git", "-C", str(vault), "ls-files", "-z"], capture_output=True, check=True
    ).stdout.decode("utf-8").split("\0")
    tracked_set = set(tracked)
    docs = sorted(
        f for f in tracked if f.endswith(".md") and (f == "README.md" or f.startswith(DOC_ROOTS))
    )

    shutil.rmtree(OUT, ignore_errors=True)
    (OUT / "d").mkdir(parents=True)
    (OUT / "i").mkdir()

    doc_entries, assets = [], {}
    for path in docs:
        text = (vault / path).read_text(encoding="utf-8")
        file = f"d/{key(path)}.md"
        (OUT / file).write_text(text, encoding="utf-8")
        doc_entries.append({"path": path, "title": title_of(text, path), "file": file})
        for m in list(RE_IMG_MD.finditer(text)) + list(RE_IMG_HTML.finditer(text)):
            ref = m.group(1)
            if ref.startswith(("http://", "https://", "data:")):
                continue
            img = os.path.normpath(os.path.join(os.path.dirname(path), urllib.parse.unquote(ref.split("#")[0])))
            if img in tracked_set and img.lower().endswith(IMG_EXT) and img not in assets:
                file_i = f"i/{key(img)}{Path(img).suffix.lower()}"
                shutil.copyfile(vault / img, OUT / file_i)
                assets[img] = file_i

    manifest = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sourceCommit": commit,
        "docs": doc_entries,
        "assets": assets,
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    shutil.copyfile(vault / "wiki" / "wiki-graph.json", APP_ROOT / "public" / "wiki-graph.json")
    size = sum(f.stat().st_size for f in OUT.rglob("*") if f.is_file())
    print(f"{len(doc_entries)} docs, {len(assets)} images, {size // 1024} KB from mindforge@{commit} -> {OUT}")


if __name__ == "__main__":
    main()
