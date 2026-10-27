"""Build public/content/search.json: a compact per-article index for Ask Copilot.

The app scores questions against this index in the browser, then fetches the
top articles and quotes their most relevant sections in the prompt. Keeping
only titles, descriptions, tags, headings and the opening paragraph keeps the
file small; full text is fetched on demand.
"""

import json
import re
from pathlib import Path

from stats import RE_CODE, front_matter, tags_of

RE_TITLE = re.compile(r"^title:\s*(.+?)\s*$", re.M)
RE_DESC = re.compile(r"^description:\s*(.+?)\s*$", re.M)
RE_HEADING = re.compile(r"^#{1,4}\s+(.+?)\s*#*\s*$", re.M)
RE_MARKUP = re.compile(r"!\[[^\]]*\]\([^)]*\)|<[^>]+>|\[\[|\]\]|[*_`>#|]")
RE_LINK = re.compile(r"\[([^\]]*)\]\([^)]*\)")
OPENING_CHARS = 240


def plain(text: str) -> str:
    text = RE_LINK.sub(r"\1", text)
    return re.sub(r"\s+", " ", RE_MARKUP.sub(" ", text)).strip()


def build(vault: Path, doc_paths: list[str], out: Path) -> None:
    entries = []
    for path in doc_paths:
        fm, body = front_matter((vault / path).read_text(encoding="utf-8"))
        body = RE_CODE.sub(" ", body)
        title = RE_TITLE.search(fm)
        h1 = RE_HEADING.search(body)
        desc = RE_DESC.search(fm)
        headings = [plain(h) for h in RE_HEADING.findall(body)]
        # 开头一段：跳过标题行，取第一段正文
        opening = ""
        for para in re.split(r"\n\s*\n", body):
            if para.lstrip().startswith("#"):
                continue
            opening = plain(para)
            if opening:
                break
        entries.append({
            "p": path,
            "t": (title.group(1).strip("'\"") if title else h1.group(1) if h1 else Path(path).stem),
            "d": plain(desc.group(1).strip("'\"")) if desc else "",
            "g": [t for t in tags_of(fm) if t not in ("wiki", "concept", "method", "decision")],
            "h": headings[1:] if h1 and headings and headings[0] == plain(h1.group(1)) else headings,
            "x": opening[:OPENING_CHARS],
        })
    out.write_text(json.dumps(entries, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"search: {len(entries)} docs, {out.stat().st_size // 1024} KB -> {out}")


if __name__ == "__main__":
    # 单独重建：python3 scripts/search.py（用 .cache/mindforge 与现有 manifest，不重新同步）
    root = Path(__file__).resolve().parent.parent
    manifest = json.loads((root / "public/content/manifest.json").read_text(encoding="utf-8"))
    build(root / ".cache/mindforge", [d["path"] for d in manifest["docs"]], root / "public/content/search.json")
