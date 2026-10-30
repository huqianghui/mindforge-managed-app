import { useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import type { ContentIndex } from '../docs/content';
import type { WikiGraph } from '../types';
import type { History } from './history';
import { PlaybackBar } from './Playback';
import { usePlayback } from './usePlayback';
import { buildEntries, dateOf, dayIndex, GROUP_BY_KEY } from './knowledge';

// 主题脉络：一个目录就是一个主题，一行一条线，从它第一篇文章画到最近一次改动；
// 实心点是那天新增了文章，空心点是只修改了已有文章，点越大当天动的文章越多
const LABEL_W = 180;
const PAD_R = 24;
const ROW_H = 18;
const GROUP_GAP = 10;
const AXIS_H = 40;
const GROUP_ORDER = ['Notes', 'Azure', 'paper', 'book', 'product'];

interface Topic {
  dir: string;
  group: string;
  label: string;
  y: number;
  points: { day: number; date: string; added: number; edited: number }[];
}

interface Hover {
  topic: Topic;
  point?: Topic['points'][number];
  x: number;
}

function layoutTopics(history: History): { topics: Topic[]; height: number } {
  const first = history.firstCommit;
  const rows = Object.entries(history.topics ?? {})
    .map(([dir, days]) => {
      const group = dir.split('/')[0];
      const rest = dir.slice(group.length + 1);
      return {
        dir,
        group,
        label: rest || GROUP_BY_KEY[group]?.label || dir,
        y: 0,
        points: days.map(([date, added, edited]) => ({ day: dayIndex(date, first), date, added, edited })),
      };
    })
    .filter((t) => GROUP_BY_KEY[t.group])
    .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || a.points[0].day - b.points[0].day);
  let y = 0;
  let prev = '';
  for (const t of rows) {
    if (prev && t.group !== prev) y += GROUP_GAP;
    prev = t.group;
    t.y = y + ROW_H / 2;
    y += ROW_H;
  }
  return { topics: rows, height: y };
}

export default function TopicLines({ history, index, graph }: { history: History; index: ContentIndex; graph: WikiGraph }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1100);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(720, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { entries, totalDays } = useMemo(() => buildEntries(history, index, graph), [history, index, graph]);
  const { topics, height } = useMemo(() => layoutTopics(history), [history]);
  const pb = usePlayback(totalDays);
  const { cursor } = pb;
  const [hover, setHover] = useState<Hover | null>(null);

  const inner = width - LABEL_W - PAD_R;
  const xOfDay = (d: number) => LABEL_W + (d / totalDays) * inner;
  const months: { x: number; label: string }[] = [];
  for (let d = 0; d <= totalDays; d++) {
    const s = dateOf(d, history.firstCommit);
    if (s.endsWith('-01')) months.push({ x: xOfDay(d), label: s.slice(0, 7) });
  }
  const svgH = height + AXIS_H;

  // 悬停某一天：列出这个目录当天新增的文章
  const addedTitles = (dir: string, date: string) =>
    Object.entries(history.docs)
      .filter(([p, [created]]) => created === date && p.slice(0, p.lastIndexOf('/')) === dir)
      .map(([p]) => index.byPath.get(p)?.title ?? p.slice(p.lastIndexOf('/') + 1));

  if (!topics.length) {
    return <Typography variant="body2" sx={{ color: 'text.secondary' }}>当前数据还没有主题脉络，重新同步内容后再看。</Typography>;
  }

  return (
    <Box>
      <PlaybackBar pb={pb} history={history} entries={entries} totalDays={totalDays} onSelect={() => {}} />
      <Box ref={wrapRef} sx={{ position: 'relative' }}>
        <svg width={width} height={svgH} style={{ display: 'block', userSelect: 'none' }}>
          {months.map((m) => (
            <g key={m.label}>
              <line x1={m.x} x2={m.x} y1={0} y2={height} stroke="#e0e0e0" strokeDasharray="2 4" />
              <text x={m.x + 3} y={height + 24} fontSize={11} fill="#90a4ae">{m.label}</text>
            </g>
          ))}
          <rect x={LABEL_W} y={0} width={Math.max(0, xOfDay(cursor) - LABEL_W)} height={height} fill="#1a237e" opacity={0.025} />
          {topics.map((t) => {
            const color = GROUP_BY_KEY[t.group].color;
            const start = t.points[0].day;
            const end = Math.min(t.points.at(-1)!.day, cursor);
            const active = hover?.topic.dir === t.dir;
            const dim = hover && !active;
            return (
              <g
                key={t.dir}
                opacity={dim ? 0.35 : 1}
                onMouseEnter={() => setHover({ topic: t, x: xOfDay(t.points.at(-1)!.day) })}
                onMouseLeave={() => setHover(null)}
              >
                <rect x={0} y={t.y - ROW_H / 2} width={width} height={ROW_H} fill={active ? '#eef1fb' : 'transparent'} />
                <rect x={LABEL_W - 8} y={t.y - 5} width={3} height={10} rx={1.5} fill={color} opacity={0.7} />
                <text x={LABEL_W - 14} y={t.y + 4} textAnchor="end" fontSize={11} fill="#455a64" fontWeight={active ? 700 : 500}>
                  {t.label.length > 24 ? `…${t.label.slice(-23)}` : t.label}
                </text>
                {start <= cursor && (
                  <line x1={xOfDay(start)} x2={xOfDay(end)} y1={t.y} y2={t.y} stroke={color} strokeWidth={active ? 3 : 2} strokeOpacity={0.55} strokeLinecap="round" />
                )}
                {t.points.filter((p) => p.day <= cursor).map((p) => {
                  const r = 2.5 + Math.sqrt(p.added + p.edited) * 1.1;
                  return (
                    <circle
                      key={p.date}
                      cx={xOfDay(p.day)}
                      cy={t.y}
                      r={r}
                      fill={p.added ? color : '#fff'}
                      stroke={color}
                      strokeWidth={1.5}
                      style={{ cursor: 'pointer' }}
                      onMouseEnter={() => setHover({ topic: t, point: p, x: xOfDay(p.day) })}
                    />
                  );
                })}
              </g>
            );
          })}
          <line x1={xOfDay(cursor)} x2={xOfDay(cursor)} y1={0} y2={height + 8} stroke="#1a237e" strokeWidth={1.5} />
          <circle cx={xOfDay(cursor)} cy={height + 8} r={4} fill="#1a237e" />
        </svg>
        {hover && (
          <Paper
            elevation={4}
            sx={{ position: 'absolute', left: Math.min(hover.x + 12, width - 300), top: hover.topic.y + 10, p: 1, maxWidth: 300, pointerEvents: 'none', zIndex: 2 }}
          >
            <Typography variant="caption" sx={{ color: GROUP_BY_KEY[hover.topic.group].color, fontWeight: 700 }}>{hover.topic.dir}</Typography>
            {hover.point ? (
              <>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {hover.point.date}
                  {hover.point.added > 0 && ` · 新增 ${hover.point.added} 篇`}
                  {hover.point.edited > 0 && ` · 修改 ${hover.point.edited} 篇`}
                </Typography>
                {addedTitles(hover.topic.dir, hover.point.date).slice(0, 6).map((title) => (
                  <Typography key={title} variant="caption" sx={{ display: 'block', lineHeight: 1.35 }}>+ {title}</Typography>
                ))}
              </>
            ) : (
              <Typography variant="body2">
                {hover.topic.points[0].date} → {hover.topic.points.at(-1)!.date} · 活跃 {hover.topic.points.length} 天 ·
                新增 {hover.topic.points.reduce((s, p) => s + p.added, 0)} 篇 · 修改 {hover.topic.points.reduce((s, p) => s + p.edited, 0)} 篇次
              </Typography>
            )}
          </Paper>
        )}
      </Box>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1 }}>
        每一行是一个目录（主题），只算它直接下面的文章；线从第一篇文章画到最近一次改动。实心点是当天新增了文章，空心点是只修改了已有文章，点越大当天动的文章越多。
        全库改名、批量改链接这类一次动几十个文件的提交不算作修改。只列出在两天以上有改动的目录。
      </Typography>
    </Box>
  );
}
