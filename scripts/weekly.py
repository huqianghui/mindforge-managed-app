"""Weekly digests from wiki/weekly/<ISO week>.md -> weekly.json.

Called by sync-content.py. The front matter carries the structured parts the app renders
as cards (new articles, wiki deltas, revalidation counts, heavy hitters, recommendations);
the body is shown as Markdown with wikilinks rewritten to in-app links, as in paths.py.
"""

import json
import re
from pathlib import Path

from paths import front_matter, link_rewriter

WEEKLY_DIR = "wiki/weekly/"


def build(vault: Path, docs: list, out: Path) -> None:
    by_stem = {}
    for d in docs:
        by_stem.setdefault(Path(d).stem, d)
    rewrite = link_rewriter(by_stem)
    titles = {}
    weeks = []
    for doc in sorted((d for d in docs if d.startswith(WEEKLY_DIR)), reverse=True):
        fm, body = front_matter((vault / doc).read_text(encoding="utf-8"))
        body = re.sub(r"^# .+\n", "", body.strip()).strip()
        articles = []
        for a in fm.get("new_articles") or []:
            if a not in titles:
                text = (vault / a).read_text(encoding="utf-8") if (vault / a).exists() else ""
                m = re.search(r"^title:\s*(.+?)\s*$", text, re.M)
                titles[a] = m.group(1).strip("'\"") if m else Path(a).stem
            articles.append({"path": a, "title": titles[a]})
        weeks.append({
            "week": str(fm.get("week") or Path(doc).stem),
            "range": fm.get("range"),
            "title": fm.get("title"),
            "doc": doc,
            "edition": fm.get("edition"),
            "newArticles": articles,
            "wiki": fm.get("wiki") or {},
            "revalidate": fm.get("revalidate") or {},
            "heavy": fm.get("heavy") or [],
            "recommendations": fm.get("recommendations") or [],
            "body": rewrite(body),
        })
    out.write_text(json.dumps({"weeks": weeks}, ensure_ascii=False, default=str), encoding="utf-8")
