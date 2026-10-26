import { useEffect, useMemo, useRef, useState } from 'react';
import type { AnchorHTMLAttributes, ImgHTMLAttributes } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSlug from 'rehype-slug';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import type { ContentIndex } from './content';
import { contentUrl, docHash, resolvePath, REPO_BLOB } from './content';

interface DocViewProps {
  index: ContentIndex;
  path: string;
  anchor?: string;
}

interface FrontMatter {
  title?: string;
  description?: string;
  tags: string[];
}

// 只取展示需要的三个字段，不引入 YAML 解析库
function splitFrontMatter(text: string): [FrontMatter, string] {
  const fm: FrontMatter = { tags: [] };
  if (!text.startsWith('---')) return [fm, text];
  const end = text.indexOf('\n---', 3);
  if (end < 0) return [fm, text];
  for (const line of text.slice(3, end).split('\n')) {
    const m = line.match(/^(title|description|tags):\s*(.*)$/);
    if (!m) continue;
    const value = m[2].trim().replace(/^["']|["']$/g, '');
    if (m[1] === 'tags') fm.tags = value.replace(/^\[|\]$/g, '').split(',').map((t) => t.trim()).filter(Boolean);
    else fm[m[1] as 'title' | 'description'] = value;
  }
  return [fm, text.slice(end + 4)];
}

// wikilink 与 GitHub alert 不是 GFM 语法，渲染前转成普通 markdown
function preprocess(body: string, index: ContentIndex): string {
  return body
    .replace(/\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g, (_, target: string, anchor?: string, alias?: string) => {
      const doc = index.byStem.get(target.trim());
      const label = alias ?? target;
      return doc ? `[${label}](${docHash(doc.path, anchor)})` : label;
    })
    .replace(/^(>\s*)\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/gim, (_, q: string, kind: string) => `${q}**${kind.toUpperCase()}**`);
}

export default function DocView({ index, path, anchor }: DocViewProps) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const entry = index.byPath.get(path);

  useEffect(() => {
    setText(null);
    setError(false);
    if (!entry) return;
    fetch(contentUrl(entry.file))
      .then((res) => (res.ok ? res.text() : Promise.reject(res.status)))
      .then(setText)
      .catch(() => setError(true));
  }, [entry]);

  useEffect(() => {
    if (text === null) return;
    const target = anchor ? document.getElementById(anchor) : null;
    if (target) target.scrollIntoView();
    else scrollRef.current?.scrollTo(0, 0);
  }, [text, anchor]);

  const [fm, body] = useMemo(() => (text ? splitFrontMatter(text) : [{ tags: [] }, '']), [text]);
  const source = useMemo(() => preprocess(body, index), [body, index]);

  const components = useMemo(
    () => ({
      a: ({ href = '', children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) => {
        if (href.startsWith('#/')) return <a href={href}>{children}</a>;
        if (href.startsWith('#')) {
          const id = decodeURIComponent(href.slice(1));
          return (
            <a href={href} onClick={(e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView(); }}>
              {children}
            </a>
          );
        }
        // 公开站点的图谱入口指回应用内的图谱页
        if (href.startsWith('https://huqianghui.github.io/mindforge/wiki')) return <a href="#/graph">{children}</a>;
        if (/^[a-z]+:/i.test(href)) {
          return <a href={href} target="_blank" rel="noreferrer" {...rest}>{children}</a>;
        }
        const [ref, frag] = href.split('#');
        const resolved = resolvePath(path, ref);
        if (index.byPath.has(resolved)) return <a href={docHash(resolved, frag)}>{children}</a>;
        // 目录或非文章文件：回到 GitHub 上看
        return <a href={REPO_BLOB + resolved} target="_blank" rel="noreferrer">{children}</a>;
      },
      img: ({ src = '', alt = '', ...rest }: ImgHTMLAttributes<HTMLImageElement>) => {
        const [label, width] = alt.split('|');
        const url = typeof src === 'string' && /^(https?:|data:)/.test(src)
          ? src
          : (() => {
              const file = index.assets[resolvePath(path, String(src).split('#')[0])];
              return file ? contentUrl(file) : String(src);
            })();
        const style = /^\d+$/.test(width ?? '') ? { maxWidth: `${width}px`, width: '100%' } : undefined;
        return <img src={url} alt={label} style={style} loading="lazy" {...rest} />;
      },
    }),
    [index, path]
  );

  if (!entry) {
    return <Typography sx={{ p: 4 }}>找不到页面：{path}</Typography>;
  }

  return (
    <Box ref={scrollRef} sx={{ flex: 1, overflow: 'auto', bgcolor: '#fff' }}>
      <Box sx={{ maxWidth: 960, mx: 'auto', px: { xs: 2, md: 5 }, py: 4 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {path} ·{' '}
          <Link href={REPO_BLOB + path} target="_blank" rel="noreferrer">在 GitHub 查看</Link>
        </Typography>
        {fm.description && (
          <Typography variant="body2" sx={{ mt: 1, color: 'text.secondary', lineHeight: 1.7 }}>
            {fm.description}
          </Typography>
        )}
        {fm.tags.length > 0 && (
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 1 }}>
            {fm.tags.map((t) => <Chip key={t} label={t} size="small" variant="outlined" />)}
          </Box>
        )}
        {error && <Typography color="error" sx={{ mt: 3 }}>页面加载失败</Typography>}
        {text === null && !error && <CircularProgress size={28} sx={{ mt: 4 }} />}
        {text !== null && (
          <Box className="markdown-body" sx={{ mt: 2 }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, rehypeSlug]} components={components}>
              {source}
            </ReactMarkdown>
          </Box>
        )}
      </Box>
    </Box>
  );
}
