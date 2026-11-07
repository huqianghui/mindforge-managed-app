"""Learning paths and quiz banks from wiki/paths/ -> paths.json.

Called by sync-content.py. A path file is wiki/paths/<id>.md; its quiz bank, if any,
is wiki/paths/<id>.quiz.md. Wikilinks are rewritten to in-app #/doc/ links here, so the
page only renders Markdown. Each station also gets the knowledge-gap trends whose nodes
overlap the wiki pages it links to (latest reports first), so the "frontier" stays
current without editing the path.
"""

import json
import re
import urllib.parse
from pathlib import Path

import yaml

PATHS_DIR = "wiki/paths/"
GAP_DIR = "wiki/knowledge-gap/"
RECENT_REPORTS = 4

RE_FM = re.compile(r"^---\n(.*?)\n---\n", re.S)
RE_WIKILINK = re.compile(r"\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]")
RE_STATION = re.compile(r"^## 第\s*(\d+)\s*站\s*·\s*(.+?)\s*$", re.M)
RE_SECTION = re.compile(r"^## (.+?)\s*$", re.M)
RE_FIELD = re.compile(r"^- \*\*(.+?)\*\*：(.*)$")
RE_QUESTION = re.compile(r"^### Q(\d+)\s*·\s*(.+?)\s*$", re.M)
RE_NUM = re.compile(r"\d+")


def front_matter(text: str) -> tuple[dict, str]:
    m = RE_FM.match(text)
    if not m:
        return {}, text
    return yaml.safe_load(m.group(1)) or {}, text[m.end():]


def link_rewriter(by_stem: dict):
    def rewrite(md: str) -> str:
        def repl(m: re.Match) -> str:
            stem, label = m.group(1).strip(), (m.group(2) or m.group(1)).strip()
            path = by_stem.get(stem)
            return f"[{label}](#/doc/{urllib.parse.quote(path, safe='')})" if path else label
        return RE_WIKILINK.sub(repl, md)
    return rewrite


def wiki_stems(md: str, wiki_pages: set) -> list:
    return [s for s in dict.fromkeys(m.group(1).strip() for m in RE_WIKILINK.finditer(md)) if s in wiki_pages]


def parse_prereq(value: str) -> list:
    if "无" in value:
        return []
    if "~" in value:
        a, b = (int(x) for x in RE_NUM.findall(value)[:2])
        return list(range(a, b + 1))
    return [int(x) for x in RE_NUM.findall(value)]


def parse_minutes(value: str) -> int | None:
    m = re.search(r"([\d.]+)\s*(小时|分钟)", value)
    if not m:
        return None
    n = float(m.group(1))
    return round(n * 60) if m.group(2) == "小时" else round(n)


def split_sections(body: str) -> list:
    """[(heading, text)] for every '## ' section, in order."""
    marks = list(RE_SECTION.finditer(body))
    return [(m.group(1), body[m.end():marks[i + 1].start() if i + 1 < len(marks) else len(body)].strip())
            for i, m in enumerate(marks)]


def parse_station(n: int, title: str, text: str, rewrite, wiki_pages: set) -> dict:
    station = {"n": n, "title": title, "reads": "", "prereq": [], "minutes": None, "stale": "", "mastery": [], "pages": []}
    current = None
    for line in text.splitlines():
        m = RE_FIELD.match(line)
        if m:
            key, value = m.group(1), m.group(2).strip()
            current = key
            if key == "读":
                station["pages"] = wiki_stems(value, wiki_pages)
                station["reads"] = rewrite(value)
            elif key == "前置":
                station["prereq"] = parse_prereq(value)
            elif key == "用时":
                station["minutes"] = parse_minutes(value)
            elif "stale" in key:
                station["stale"] = rewrite(value)
            continue
        item = re.match(r"^\s{2,}- (.+)$", line)
        if item and current == "算会":
            station["mastery"].append(rewrite(item.group(1).strip()))
    return station


def parse_quiz(text: str, path_id: str, rewrite) -> list:
    _, body = front_matter(text)
    out = []
    for heading, section in split_sections(body):
        sm = re.match(r"第\s*(\d+)\s*站", heading)
        if not sm:
            continue
        n = int(sm.group(1))
        marks = list(RE_QUESTION.finditer(section))
        for i, m in enumerate(marks):
            block = section[m.end():marks[i + 1].start() if i + 1 < len(marks) else len(section)]
            parts = {}
            for key in ("问", "答", "出处"):
                pm = re.search(rf"\*\*{key}\*\*：(.*?)(?=\n\*\*(?:问|答|出处)\*\*：|\Z)", block, re.S)
                parts[key] = pm.group(1).strip() if pm else ""
            out.append({
                "id": f"{path_id}/s{n}/q{m.group(1)}",
                "station": n,
                "type": m.group(2),
                "question": rewrite(parts["问"]),
                "answer": rewrite(parts["答"]),
                "source": rewrite(parts["出处"]),
            })
    return out


def recent_trends(vault: Path, tracked: list) -> list:
    reports = sorted(p for p in tracked if p.startswith(GAP_DIR) and p.endswith("-gap-analysis.md"))[-RECENT_REPORTS:]
    trends = []
    for p in reversed(reports):
        fm, _ = front_matter((vault / p).read_text(encoding="utf-8"))
        day = Path(p).name[:10]
        for t in fm.get("trends") or []:
            trends.append({
                "topic": t.get("topic"), "title": t.get("title"), "priority": t.get("priority"),
                "action": t.get("action"), "nodes": t.get("nodes") or [], "date": day, "report": p,
            })
    return trends


def build(vault: Path, docs: list, out: Path) -> None:
    by_stem = {}
    for d in docs:
        by_stem.setdefault(Path(d).stem, d)
    wiki_pages = {Path(d).stem for d in docs if re.match(r"wiki/(concepts|methods|decisions)/", d)}
    rewrite = link_rewriter(by_stem)
    trends = recent_trends(vault, docs)

    paths = []
    for doc in sorted(d for d in docs if d.startswith(PATHS_DIR) and not d.endswith(".quiz.md")):
        fm, body = front_matter((vault / doc).read_text(encoding="utf-8"))
        path_id = fm.get("path_id") or Path(doc).stem
        intro = body.split("\n## ", 1)[0]
        intro = re.sub(r"^# .+\n", "", intro.strip()).strip()
        stations, extras = [], {}
        for heading, text in split_sections(body):
            sm = RE_STATION.match(f"## {heading}")
            if sm:
                stations.append(parse_station(int(sm.group(1)), sm.group(2), text, rewrite, wiki_pages))
            elif heading.startswith("前沿站"):
                extras["frontier"] = rewrite(text)
            elif heading.startswith("毕业标准"):
                extras["graduation"] = rewrite(text)
            elif heading.startswith("这条路径暴露的缺口"):
                extras["gaps"] = rewrite(text)
        for s in stations:
            pages = set(s["pages"])
            seen, auto = set(), []
            for t in trends:
                hit = pages.intersection(t["nodes"])
                if hit and t["title"] not in seen:
                    seen.add(t["title"])
                    auto.append({k: t[k] for k in ("topic", "title", "priority", "action", "date", "report")} | {"via": sorted(hit)})
            s["frontierAuto"] = auto[:4]
        quiz_doc = f"{PATHS_DIR}{Path(doc).stem}.quiz.md"
        quiz = parse_quiz((vault / quiz_doc).read_text(encoding="utf-8"), path_id, rewrite) if quiz_doc in docs else []
        paths.append({
            "id": path_id,
            "doc": doc,
            "title": str(fm.get("title") or path_id).removeprefix("学习路径："),
            "audience": fm.get("audience"),
            "gapTopics": fm.get("gap_topics") or [],
            "signals": fm.get("signals") or [],
            "intro": rewrite(intro),
            "stations": stations,
            "frontier": extras.get("frontier", ""),
            "graduation": extras.get("graduation", ""),
            "gaps": extras.get("gaps", ""),
            "quiz": quiz,
        })
    out.write_text(json.dumps({"paths": paths}, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    import subprocess
    import sys
    vault = Path(sys.argv[1]).resolve()
    tracked = subprocess.run(["git", "-C", str(vault), "ls-files"], capture_output=True, text=True, check=True).stdout.split()
    target = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("paths.json")
    build(vault, [t for t in tracked if t.endswith(".md")], target)
    data = json.loads(target.read_text(encoding="utf-8"))
    for p in data["paths"]:
        print(p["id"], len(p["stations"]), "stations", len(p["quiz"]), "questions",
              sum(len(s["frontierAuto"]) for s in p["stations"]), "auto-frontier")
