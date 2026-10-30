import { useEffect, useMemo, useRef, useState } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import type { ContentIndex } from '../docs/content';
import type { WikiGraph } from '../types';
import type { History } from './history';
import { PlaybackBar } from './Playback';
import { usePlayback } from './usePlayback';
import { buildEntries, dateOf, dayIndex, GROUP_BY_KEY } from './knowledge';

// 主题脉络：一个目录就是一个主题。默认只显示光标前 ACTIVE_WINDOW 天里有动静的主题（通常一两个），
// 沉寂下来就退场；也可以选定一个主题单独看。每个主题一条余弦波，从它第一篇文章那天起，
// 把每个有文章出现、改动的日子串成一个个波峰，画到当天为止；每行有自己的横轴，铺满这个主题的跨度
const PAD_X = 28;
const ROW_H = 190;
const ACTIVE_WINDOW = 7;
const MAX_SHOWN = 2;
const AMP_MAX = 52;
const MIN_SPAN = 14;
const GROUP_ORDER = ['Notes', 'Azure', 'paper', 'book', 'product'];

interface Point {
  day: number;
  date: string;
  added: number;
  edited: number;
}

interface Topic {
  dir: string;
  group: string;
  label: string;
  points: Point[];
}

interface Hover {
  topic: Topic;
  point: Point;
  x: number;
  top: number;
}

/** 当天的波峰高度：新增文章比修改分量重 */
const amp = (p: Point) => Math.min(AMP_MAX, 18 + Math.sqrt(p.added * 2 + p.edited) * 11);

/**
 * 一条余弦波把几个日期串起来：每个日期是一个波峰，相邻两个日期之间是一个波谷，
 * 开头用半个余弦从基线升起。只画到 upTo（当天），播放时波浪一点点往前长
 */
function wavePath(points: Point[], y: number, xOfDay: (d: number) => number, upTo: number): string {
  const pts = points.map((p) => ({ x: xOfDay(p.day), a: amp(p) }));
  const lead = Math.min(24, PAD_X - 4);
  const x0 = pts[0].x - lead;
  const last = pts.at(-1)!;
  const x1 = Math.min(last.x, upTo);
  const offset = (x: number): number => {
    if (x <= pts[0].x) return (pts[0].a * (1 - Math.cos((Math.PI * (x - x0)) / lead))) / 2;
    if (x >= last.x) return last.a;
    const i = pts.findIndex((p) => p.x > x) - 1;
    const t = (x - pts[i].x) / (pts[i + 1].x - pts[i].x);
    const a = pts[i].a + (pts[i + 1].a - pts[i].a) * t;
    return a * (0.2 + 0.8 * Math.cos(2 * Math.PI * t));
  };
  let d = '';
  for (let x = x0; x <= x1; x += 1) d += `${d ? 'L' : 'M'}${x.toFixed(1)},${(y - offset(x)).toFixed(1)}`;
  return d;
}

function loadTopics(history: History): Topic[] {
  const first = history.firstCommit;
  return Object.entries(history.topics ?? {})
    .map(([dir, days]) => {
      const group = dir.split('/')[0];
      return {
        dir,
        group,
        label: dir.slice(group.length + 1) || GROUP_BY_KEY[group]?.label || dir,
        points: days.map(([date, added, edited]) => ({ day: dayIndex(date, first), date, added, edited })),
      };
    })
    .filter((t) => GROUP_BY_KEY[t.group])
    .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || a.label.localeCompare(b.label));
}

function TopicRow({ topic, cursor, totalDays, width, top, history, onHover }: {
  topic: Topic;
  cursor: number;
  totalDays: number;
  width: number;
  top: number;
  history: History;
  onHover: (h: Hover | null) => void;
}) {
  const color = GROUP_BY_KEY[topic.group].color;
  const seen = topic.points.filter((p) => p.day <= cursor);
  const start = topic.points[0];
  const latest = seen.at(-1);
  // 这一行自己的横轴：从主题的第一天到当天；刚起步的主题往前补足 MIN_SPAN 天，右边始终是当天
  const hi = cursor + 1;
  const lo = Math.min(start.day - 1, hi - MIN_SPAN);
  const inner = width - PAD_X * 2;
  const xOfDay = (d: number) => PAD_X + ((d - lo) / (hi - lo)) * inner;
  const cy = ROW_H * 0.56;
  const axisY = ROW_H - 14;
  const step = Math.max(1, Math.ceil((hi - lo) / Math.max(4, Math.floor(inner / 70))));
  const ticks: { x: number; label: string }[] = [];
  for (let d = Math.ceil(lo); d <= hi; d += step) ticks.push({ x: xOfDay(d), label: dateOf(d, history.firstCommit).slice(5) });
  const upTo = xOfDay(cursor);
  const d = seen.length ? wavePath(seen, cy, xOfDay, upTo) : '';
  return (
    <Box sx={{ position: 'absolute', left: 0, right: 0, top, height: ROW_H, transition: 'top .5s ease', animation: 'mfTopicIn .5s ease-out' }}>
      <Box sx={{ position: 'absolute', left: PAD_X, top: 4, display: 'flex', alignItems: 'baseline', gap: 1, zIndex: 1 }}>
        <Typography sx={{ fontWeight: 700, fontSize: 15, color }}>{topic.label}</Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {GROUP_BY_KEY[topic.group].label}
          {latest
            ? ` · ${start.date} 开始，到 ${latest.date} · 累计 ${seen.reduce((s, p) => s + p.added, 0)} 篇 · 活跃 ${seen.length} 天`
            : ` · ${start.date} 才开始`}
        </Typography>
      </Box>
      <svg width={width} height={ROW_H} style={{ display: 'block', overflow: 'visible' }}>
        <style>{`@keyframes mfRing { from { r: 7; opacity: .9 } to { r: 28; opacity: 0 } }`}</style>
        <line x1={PAD_X} x2={width - PAD_X} y1={axisY - 14} y2={axisY - 14} stroke="#eceff1" />
        {ticks.map((t) => (
          <text key={t.label} x={t.x} y={axisY} textAnchor="middle" fontSize={10} fill="#90a4ae">{t.label}</text>
        ))}
        <line x1={upTo} x2={upTo} y1={22} y2={axisY - 14} stroke="#1a237e" strokeOpacity={0.35} strokeWidth={1.5} />
        {d && <path d={d} fill="none" stroke={color} strokeWidth={2.2} strokeOpacity={0.85} strokeLinejoin="round" />}
        {seen.map((p) => {
          const x = xOfDay(p.day);
          const y = cy - amp(p);
          const fresh = cursor - p.day < 4 && cursor < totalDays;
          return (
            <g key={p.date}>
              {fresh && <circle cx={x} cy={y} r={7} fill="none" stroke={color} strokeWidth={2} style={{ animation: 'mfRing 1.1s ease-out' }} />}
              <circle cx={x} cy={y} r={p.added ? 7 : 5} fill={color} stroke="#fff" strokeWidth={2} pointerEvents="none" />
              <circle
                cx={x}
                cy={y}
                r={14}
                fill="transparent"
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => onHover({ topic, point: p, x, top: top + y })}
                onMouseLeave={() => onHover(null)}
              />
            </g>
          );
        })}
        {/* 起点和最近一个日期 */}
        {seen.length > 0 && (
          <text x={xOfDay(start.day)} y={cy - amp(start) - 14} textAnchor="middle" fontSize={11} fontWeight={700} fill={color}>
            起 {start.date.slice(5)}
          </text>
        )}
        {latest && latest !== start && (
          <text x={xOfDay(latest.day)} y={cy - amp(latest) - 14} textAnchor="middle" fontSize={11} fontWeight={700} fill={color}>
            {latest.date.slice(5)}
          </text>
        )}
      </svg>
    </Box>
  );
}

export default function TopicLines({ history, index, graph }: { history: History; index: ContentIndex; graph: WikiGraph }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1100);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(640, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { entries, totalDays } = useMemo(() => buildEntries(history, index, graph), [history, index, graph]);
  const topics = useMemo(() => loadTopics(history), [history]);
  const pb = usePlayback(totalDays);
  const { cursor } = pb;
  const [hover, setHover] = useState<Hover | null>(null);
  // 两种看法：当下活跃（跟着播放自动出现、退场）和选择主题（单看一个主题的整条发展线）
  const [mode, setMode] = useState<'live' | 'pick'>('live');
  const [picked, setPicked] = useState<Topic | null>(null);
  const busiest = useMemo(() => topics.reduce((a, b) => (b.points.length > a.points.length ? b : a), topics[0]), [topics]);
  const focus = picked ?? busiest;

  const shown = mode === 'pick'
    ? (focus ? [focus] : [])
    : topics
      .map((t) => ({ t, last: t.points.filter((p) => p.day <= cursor).at(-1)?.day ?? -1 }))
      .filter(({ last }) => last >= 0 && cursor - last < ACTIVE_WINDOW)
      .sort((a, b) => b.last - a.last || a.t.dir.localeCompare(b.t.dir))
      .slice(0, MAX_SHOWN)
      .map(({ t }) => t);
  const bodyH = Math.max(1, shown.length) * ROW_H;

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
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mb: 1 }}>
        <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_, v) => v && setMode(v)}>
          <ToggleButton value="live" sx={{ textTransform: 'none', px: 1.5 }}>当下活跃</ToggleButton>
          <ToggleButton value="pick" sx={{ textTransform: 'none', px: 1.5 }}>选择主题</ToggleButton>
        </ToggleButtonGroup>
        {mode === 'pick' ? (
        <Autocomplete
          size="small"
          options={topics}
          value={focus ?? null}
          onChange={(_, v) => setPicked(v)}
          groupBy={(t) => GROUP_BY_KEY[t.group].label}
          getOptionLabel={(t) => t.label}
          isOptionEqualToValue={(a, b) => a.dir === b.dir}
          renderOption={(props, t) => (
            <li {...props} key={t.dir}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%', gap: 1 }}>
                <span>{t.label}</span>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {t.points[0].date.slice(5)} → {t.points.at(-1)!.date.slice(5)} · {t.points.length} 天
                </Typography>
              </Box>
            </li>
          )}
          renderInput={(params) => <TextField {...params} placeholder="选择主题" />}
          sx={{ width: 360 }}
          disableClearable
        />
        ) : (
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>播放时只出现最近 {ACTIVE_WINDOW} 天里有更新的主题，沉寂下来就退场</Typography>
        )}
      </Box>
      <Box
        ref={wrapRef}
        sx={{
          position: 'relative',
          height: bodyH,
          transition: 'height .5s ease',
          '@keyframes mfTopicIn': { from: { opacity: 0, transform: 'translateY(16px)' }, to: { opacity: 1, transform: 'none' } },
        }}
      >
        {!shown.length && (
          <Typography variant="body2" sx={{ position: 'absolute', top: ROW_H / 2 - 10, width: '100%', textAlign: 'center', color: 'text.disabled' }}>
            这几天没有主题在更新
          </Typography>
        )}
        {shown.map((t, i) => (
          <TopicRow key={t.dir} topic={t} cursor={cursor} totalDays={totalDays} width={width} top={i * ROW_H} history={history} onHover={setHover} />
        ))}
        {hover && (
          <Paper
            elevation={4}
            sx={{ position: 'absolute', left: Math.min(hover.x + 14, width - 300), top: hover.top + 12, p: 1, maxWidth: 300, pointerEvents: 'none', zIndex: 3 }}
          >
            <Typography variant="caption" sx={{ color: GROUP_BY_KEY[hover.topic.group].color, fontWeight: 700 }}>{hover.topic.dir}</Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {hover.point.date}
              {hover.point.added > 0 && ` · 新增 ${hover.point.added} 篇`}
              {hover.point.edited > 0 && ` · 修改 ${hover.point.edited} 篇`}
            </Typography>
            {addedTitles(hover.topic.dir, hover.point.date).slice(0, 6).map((title) => (
              <Typography key={title} variant="caption" sx={{ display: 'block', lineHeight: 1.35 }}>+ {title}</Typography>
            ))}
          </Paper>
        )}
      </Box>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1 }}>
        一个目录就是一个主题，只算它直接下面的文章。「当下活跃」只显示最近 {ACTIVE_WINDOW} 天里有更新的主题，沉寂下来就退场；「选择主题」单看一个主题的整条发展线。
        每条线从主题的第一篇文章开始，把每个有文章出现或修改的日子串成波峰，画到当天为止：大圆点是那天有新文章，小圆点是只修改，动的文章越多波峰越高。
        全库改名、批量改链接这类一次动几十个文件的提交不算作修改。
      </Typography>
    </Box>
  );
}
