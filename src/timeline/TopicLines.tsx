import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
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
import { buildEntries, dayIndex, GROUP_BY_KEY } from './knowledge';

// 主题脉络：一个目录就是一个主题。默认只显示光标前 ACTIVE_WINDOW 天里有动静的主题（通常一两个），
// 沉寂下来就退场；也可以选定一个主题单独看。每个主题一条标准余弦波，从它第一篇文章那天起，
// 把每个有文章出现、改动的日子等距串成一个个波峰，画到当天为止
const PAD_X = 28;
const ROW_H = 190;
const ACTIVE_WINDOW = 7;
const MAX_SHOWN = 2;
const AMP = 34;
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

/**
 * 主题的日期等距排开，每个日期占一个完整周期、正好落在波峰上，所以整条线是标准余弦波。
 * pos 是"第几个日期"，两个日期之间按天数线性插值：播放时波浪按时间匀速从一个波峰长到下一个
 */
function posOfDay(points: Point[], day: number): number {
  if (day < points[0].day) return -0.5;
  const i = points.findIndex((p) => p.day > day);
  if (i < 0) return points.length - 1;
  const a = points[i - 1];
  return i - 1 + (day - a.day) / (points[i].day - a.day);
}

/** 从第一个波峰前半个周期（波谷）起，一直画到最后一个波峰 */
function wavePath(n: number, y: number, xOfPos: (pos: number) => number): string {
  const x0 = xOfPos(-0.5);
  const x1 = xOfPos(n - 1);
  const per = xOfPos(1) - xOfPos(0);
  let d = '';
  for (let x = x0; x <= x1 + 0.01; x += 0.5) {
    const pos = (x - xOfPos(0)) / per;
    d += `${d ? 'L' : 'M'}${x.toFixed(1)},${(y - AMP * Math.cos(2 * Math.PI * pos)).toFixed(1)}`;
  }
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

function TopicRow({ topic, cursor, stepMs, totalDays, width, top, onHover }: {
  topic: Topic;
  cursor: number;
  /** 播放时在这一天停留多久：这段时间里波浪匀速长到下一天，到了下一天那天的圆点才出现；不播放时为 0 */
  stepMs: number;
  totalDays: number;
  width: number;
  top: number;
  onHover: (h: Hover | null) => void;
}) {
  const color = GROUP_BY_KEY[topic.group].color;
  const seen = topic.points.filter((p) => p.day <= cursor);
  const start = topic.points[0];
  const latest = seen.at(-1);
  const clipId = useId();
  const n = topic.points.length;
  const per = (width - PAD_X * 2) / n;
  const xOfPos = (pos: number) => PAD_X + (pos + 0.5) * per;
  const xOfDay = (day: number) => xOfPos(posOfDay(topic.points, day));
  const cy = ROW_H * 0.52;
  const dateY = cy + AMP + 22;
  // 日期挤不下时隔几个标一个，起点和最近一个总是标
  const every = Math.ceil(46 / per);
  const upTo = xOfDay(cursor);
  // 整条波浪先画好，再用裁剪框露到当天；播放时裁剪框在这一天的停留时间里匀速扩到下一天
  const reveal = cursor < start.day - 1 ? 0 : xOfDay(stepMs > 0 ? cursor + 1 : cursor);
  const d = wavePath(n, cy, xOfPos);
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
        <line x1={PAD_X} x2={width - PAD_X} y1={cy} y2={cy} stroke="#eceff1" />
        {seen.length > 0 && <line x1={upTo} x2={upTo} y1={22} y2={dateY - 12} stroke="#1a237e" strokeOpacity={0.3} strokeWidth={1.5} />}
        <clipPath id={clipId}>
          <rect x={0} y={0} height={ROW_H} style={{ width: Math.max(0, reveal), transition: `width ${stepMs}ms linear` }} />
        </clipPath>
        <path d={d} clipPath={`url(#${clipId})`} fill="none" stroke={color} strokeWidth={2.2} strokeOpacity={0.85} strokeLinejoin="round" />
        {seen.map((p, i) => {
          const x = xOfPos(i);
          const y = cy - AMP;
          const fresh = cursor - p.day < 4 && cursor < totalDays;
          return (
            <g key={p.date}>
              {fresh && <circle cx={x} cy={y} r={7} fill="none" stroke={color} strokeWidth={2} style={{ animation: 'mfRing 1.1s ease-out' }} />}
              <circle cx={x} cy={y} r={p.added ? 7 : 5} fill={color} stroke="#fff" strokeWidth={2} pointerEvents="none" />
              {(i === 0 || i === seen.length - 1 || i % every === 0) && (
                <text x={x} y={dateY} textAnchor="middle" fontSize={10.5} fontWeight={i === 0 || i === seen.length - 1 ? 700 : 500} fill={i === 0 || i === seen.length - 1 ? color : '#78909c'}>
                  {i === 0 ? '起 ' : ''}{p.date.slice(5)}
                </text>
              )}
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
  const [hover, setHover] = useState<Hover | null>(null);
  // 两种看法：当下活跃（跟着播放自动出现、退场）和选择主题（单看一个主题的整条发展线）
  const [mode, setMode] = useState<'live' | 'pick'>('live');
  const [picked, setPicked] = useState<Topic | null>(null);
  const busiest = useMemo(() => topics.reduce((a, b) => (b.points.length > a.points.length ? b : a), topics[0]), [topics]);
  const focus = picked ?? busiest;
  // 播放节奏跟着内容走：快到有更新的日子放慢，看清波浪长到那个日期；没动静的日子快速走过。
  // 选择主题时只看这个主题自己的日期
  const activeDays = useMemo(() => new Set((mode === 'pick' && focus ? [focus] : topics).flatMap((t) => t.points.map((p) => p.day))), [mode, focus, topics]);
  const dwell = useCallback((day: number) => (activeDays.has(day + 1) ? 1400 : activeDays.has(day) ? 500 : 90), [activeDays]);
  const pb = usePlayback(totalDays, dwell, 1);
  const { cursor } = pb;

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
          <TopicRow key={t.dir} topic={t} cursor={cursor} stepMs={pb.playing && cursor < totalDays ? dwell(cursor) / pb.speed : 0} totalDays={totalDays} width={width} top={i * ROW_H} onHover={setHover} />
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
        每条线是一条标准余弦波：主题的每个日期等距排开、各占一个波峰，下方标着日期；大圆点是那天有新文章，小圆点是只修改。播放时波浪按时间从一个波峰长到下一个，快到有更新的日子会放慢，没动静的日子快速走过。
        全库改名、批量改链接这类一次动几十个文件的提交不算作修改。
      </Typography>
    </Box>
  );
}
