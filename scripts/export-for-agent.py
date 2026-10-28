#!/usr/bin/env python3
"""Export the synced Mindforge articles as knowledge files for a Copilot Studio agent.

Reads public/content (run sync-content.py first) and writes agent-knowledge/:
one Markdown file per article, named after its repository path so citations are
readable, each starting with a short header (title, path, GitHub link; the
managed app host does not pass the URL hash or query into the app, so app links
cannot open a specific article);
plus 00-目录.md listing every article by category. Relative links are rewritten
to GitHub URLs, since the agent only sees the uploaded text.

Uploads are manual, so export.json records a hash per file and each run prints
what was added, changed and removed since the previous export.

Usage: python3 scripts/export-for-agent.py
"""

import hashlib
import json
import os
import re
import shutil
import urllib.parse
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parent.parent
CONTENT = APP_ROOT / "public" / "content"
OUT = APP_ROOT / "agent-knowledge"
REPO_BLOB = "https://github.com/huqianghui/mindforge/blob/main/"
CATEGORIES = {
    "Notes": "笔记", "Azure": "Azure", "paper": "论文", "book": "读书",
    "product": "产品", "wiki": "Wiki", "README.md": "首页",
}
# Markdown links and images with a relative target: [text](target) / ![alt](target)
RE_LINK = re.compile(r"(!?\[[^\]]*\]\()([^)\s]+)")
RE_FRONTMATTER = re.compile(r"\A---\n.*?\n---\n", re.S)


def export_name(path: str) -> str:
    return path.replace("/", "__")


def absolute(target: str, doc_path: str) -> str:
    if target.startswith(("http://", "https://", "mailto:", "data:", "#")):
        return target
    rel, _, anchor = target.partition("#")
    full = os.path.normpath(os.path.join(os.path.dirname(doc_path), urllib.parse.unquote(rel)))
    url = REPO_BLOB + urllib.parse.quote(full)
    return f"{url}#{anchor}" if anchor else url


def render(doc: dict, text: str) -> str:
    path = doc["path"]
    body = RE_LINK.sub(lambda m: m.group(1) + absolute(m.group(2), path), text)
    header = (
        f"> 文章：{doc['title']}\n"
        f"> 路径：{path}\n"
        f"> 原文：{REPO_BLOB}{urllib.parse.quote(path)}\n\n"
    )
    # Keep the frontmatter first so its tags and dates stay with the article.
    m = RE_FRONTMATTER.match(body)
    return body[: m.end()] + "\n" + header + body[m.end():] if m else header + body


def toc(docs: list[dict], commit: str) -> str:
    lines = [
        "# Mindforge 文章目录",
        "",
        f"共 {len(docs)} 篇，来自 mindforge@{commit}。每篇文章对应一个知识文件，文件名是仓库路径，`/` 换成 `__`。",
    ]
    groups: dict[str, list[dict]] = {}
    for doc in docs:
        groups.setdefault(doc["path"].split("/")[0], []).append(doc)
    for top, items in groups.items():
        lines += ["", f"## {CATEGORIES.get(top, top)}（{len(items)} 篇）", ""]
        lines += [f"- [{d['title']}]({REPO_BLOB}{urllib.parse.quote(d['path'])})：{d['path']}" for d in items]
    return "\n".join(lines) + "\n"


def main() -> None:
    manifest = json.loads((CONTENT / "manifest.json").read_text(encoding="utf-8"))
    previous_file = OUT / "export.json"
    previous = json.loads(previous_file.read_text(encoding="utf-8"))["files"] if previous_file.exists() else {}

    shutil.rmtree(OUT, ignore_errors=True)
    OUT.mkdir()
    files = {}
    outputs = [("00-目录.md", toc(manifest["docs"], manifest["sourceCommit"]))]
    for doc in manifest["docs"]:
        text = (CONTENT / doc["file"]).read_text(encoding="utf-8")
        outputs.append((export_name(doc["path"]), render(doc, text)))
    for name, text in outputs:
        (OUT / name).write_text(text, encoding="utf-8")
        files[name] = hashlib.sha1(text.encode("utf-8")).hexdigest()

    record = {"sourceCommit": manifest["sourceCommit"], "files": files}
    previous_file.write_text(json.dumps(record, ensure_ascii=False, indent=1), encoding="utf-8")

    added = sorted(set(files) - set(previous))
    removed = sorted(set(previous) - set(files))
    changed = sorted(n for n in files if n in previous and previous[n] != files[n])
    size = sum((OUT / n).stat().st_size for n in files)
    print(f"{len(files)} files, {size // 1024} KB from mindforge@{manifest['sourceCommit']} -> {OUT}")
    if previous:
        for label, names in (("added", added), ("changed", changed), ("removed", removed)):
            print(f"{label}: {len(names)}")
            for n in names:
                print(f"  {n}")


if __name__ == "__main__":
    main()
