import { contentUrl } from '../docs/content';
import type { ContentIndex } from '../docs/content';

// 本地检索：问题 → 打分选文章 → 拉正文挑最相关的段落。检索结果就是引用的来源，所以引用是结构化的。
// 中文按相邻两字切词（二元组），英文按词，不引入分词库。

export interface SearchEntry {
  p: string; // 路径
  t: string; // 标题
  d: string; // 描述
  g: string[]; // 标签
  h: string[]; // 各级标题
  x: string; // 开头一段
}

export interface Source {
  n: number;
  path: string;
  title: string;
  excerpt: string;
}

const TOP_DOCS = 5;
const SECTIONS_PER_DOC = 2;
const SECTION_CHARS = 900;
const DOC_CHARS = 1600;
// 问句里的虚词二元组，几乎每篇都有，只会拉低区分度
const STOP = new Set(['什么', '怎么', '如何', '是否', '哪些', '为什', '么是', '一下', '可以', '这个', '那个', '我们', '你们', '有哪', '区别', '之间', '的区', '是什', '么区']);
const FIELDS: [keyof Omit<SearchEntry, 'p'>, number][] = [['t', 4], ['g', 3], ['d', 2], ['h', 2], ['x', 1]];

export function terms(text: string): string[] {
  const t = text.toLowerCase();
  const out: string[] = [];
  for (const w of t.match(/[a-z0-9][a-z0-9.+#-]*[a-z0-9+#]|[a-z0-9]{2,}/g) ?? []) out.push(w);
  for (const run of t.match(/[㐀-鿿]+/g) ?? []) {
    if (run.length === 1) out.push(run);
    for (let i = 0; i < run.length - 1; i++) out.push(run.slice(i, i + 2));
  }
  return out.filter((x) => !STOP.has(x));
}

const count = (hay: string, needle: string) => {
  let n = 0;
  for (let i = hay.indexOf(needle); i >= 0 && n < 3; i = hay.indexOf(needle, i + needle.length)) n++;
  return n;
};

interface Prepared {
  entry: SearchEntry;
  fields: [string, number][];
  all: string;
}

let index: Promise<Prepared[]> | null = null;

function loadIndex(): Promise<Prepared[]> {
  index ??= fetch(contentUrl('search.json'))
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`search.json ${res.status}`))))
    .then((entries: SearchEntry[]) =>
      entries.map((entry) => {
        const fields = FIELDS.map(([k, w]) => {
          const v = entry[k];
          return [(Array.isArray(v) ? v.join(' ') : v).toLowerCase(), w] as [string, number];
        });
        return { entry, fields, all: fields.map(([s]) => s).join(' ') + ' ' + entry.p.toLowerCase() };
      }),
    );
  return index;
}

function idfOf(qs: string[], docs: string[]): Map<string, number> {
  return new Map(qs.map((q) => [q, Math.log(1 + docs.length / (1 + docs.filter((d) => d.includes(q)).length))]));
}

function rankDocs(question: string, prepared: Prepared[]): SearchEntry[] {
  const qs = [...new Set(terms(question))];
  if (qs.length === 0) return [];
  const idf = idfOf(qs, prepared.map((p) => p.all));
  return prepared
    .map((p) => ({
      entry: p.entry,
      score: qs.reduce((s, q) => s + idf.get(q)! * p.fields.reduce((n, [text, w]) => n + w * count(text, q), 0), 0),
    }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_DOCS)
    .map((r) => r.entry);
}

function stripFrontMatter(md: string): string {
  return md.startsWith('---') ? md.slice(Math.max(0, md.indexOf('\n---', 3) + 4)) : md;
}

// 按标题切段，挑和问题最相关的几段；都不相关时取开头
function excerptOf(md: string, question: string): string {
  const body = stripFrontMatter(md).replace(/```[\s\S]*?```/g, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  const sections = body.split(/\n(?=#{1,4}\s)/).map((s) => s.trim()).filter(Boolean);
  const qs = [...new Set(terms(question))];
  const lower = sections.map((s) => s.toLowerCase());
  const idf = idfOf(qs, lower);
  const scored = sections.map((text, i) => ({ text, i, score: qs.reduce((s, q) => s + idf.get(q)! * count(lower[i], q), 0) }));
  const best = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, SECTIONS_PER_DOC).sort((a, b) => a.i - b.i);
  const picked = best.length ? best : scored.slice(0, 1);
  return picked.map((s) => s.text.slice(0, SECTION_CHARS)).join('\n…\n').slice(0, DOC_CHARS);
}

/** pinned：从文章页"就这篇提问"进来时，该文固定排第一 */
export async function retrieve(question: string, content: ContentIndex, pinned?: string): Promise<Source[]> {
  const ranked = rankDocs(question, await loadIndex());
  const paths = [...new Set([...(pinned ? [pinned] : []), ...ranked.map((e) => e.p)])].slice(0, TOP_DOCS);
  const docs = await Promise.all(
    paths.map(async (path) => {
      const entry = content.byPath.get(path);
      if (!entry) return null;
      const res = await fetch(contentUrl(entry.file));
      return res.ok ? { path, title: entry.title, excerpt: excerptOf(await res.text(), question) } : null;
    }),
  );
  return docs.filter((d): d is NonNullable<typeof d> => d !== null).map((d, i) => ({ n: i + 1, ...d }));
}
