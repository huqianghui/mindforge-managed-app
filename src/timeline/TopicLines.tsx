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

// 主题脉络：一个目录就是一个主题。只显示光标前 ACTIVE_WINDOW 天里有动静的主题（通常一两个），
// 每个主题一条大余弦波：它的文章在哪些日子出现、改动，波峰就在哪里；沉寂超过 BURST_GAP 天线就断开。
// 主题沉寂下来就从图上退场，下次活跃再出现
const PAD_X = 16;
const ROW_H = 150;
const AXIS_H = 28;
const ACTIVE_WINDOW = 7;
const MAX_SHOWN = 2;
const BURST_GAP = 10;
const AMP_MAX = 48;
const VIEW_DAYS = 60;
const MIN_SPAN = 21;

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

/** 相隔不超过 BURST_GAP 天的活跃日连成一段 */
function bursts(points: Point[]): Point[][] {
  const out: Point[][] = [];
  for (const p of points) {
    const last = out.at(-1);
    if (last && p.day - last.at(-1)!.day <= BURST_GAP) last.push(p);
    else out.push([p]);
  }
  return out;
}

/** 当天的波峰高度：新增文章比修改分量重 */
const amp = (p: Point) => Math.min(AMP_MAX, 16 + Math.sqrt(p.added * 2 + p.edited) * 10);

/**
 * 一段余弦波把几个日期串起来：每个日期是一个波峰，相邻两个日期之间是一个波谷，
 * 两头用半个余弦从基线升起、落回。只画到 upTo（当天），播放时波浪一点点往前长
 */
function wavePath(burst: Point[], y: number, xOfDay: (d: number) => number, upTo: number): string {
  const pts = burst.map((p) => ({ x: xOfDay(p.day), a: amp(p) }));
  const tail = 36;
  const x0 = pts[0].x - tail;
  const x1 = Math.min(pts.at(-1)!.x + tail, upTo);
  if (x1 <= Math.max(x0, PAD_X)) return '';
  const offset = (x: number): number => {
    if (x <= pts[0].x) return (pts[0].a * (1 - Math.cos((Math.PI * (x - x0)) / tail))) / 2;
    const last = pts.at(-1)!;
    if (x >= last.x) return (last.a * (1 + Math.cos((Math.PI * (x - last.x)) / tail))) / 2;
    const i = pts.findIndex((p) => p.x > x) - 1;
    const t = (x - pts[i].x) / (pts[i + 1].x - pts[i].x);
    const a = pts[i].a + (pts[i + 1].a - pts[i].a) * t;
    return a * (0.2 + 0.8 * Math.cos(2 * Math.PI * t));
  };
  let d = '';
  for (let x = Math.max(x0, PAD_X); x <= x1; x += 1) d += `${d ? 'L' : 'M'}${x.toFixed(1)},${(y - offset(x)).toFixed(1)}`;
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
    .filter((t) => GROUP_BY_KEY[t.group]);
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

  // 当下活跃的主题：最近一次动静在窗口内，越近越靠上
  const shown = topics
    .map((t) => ({ t, last: t.points.filter((p) => p.day <= cursor).at(-1)?.day ?? -1 }))
    .filter(({ last }) => last >= 0 && cursor - last < ACTIVE_WINDOW)
    .sort((a, b) => b.last - a.last || a.t.dir.localeCompare(b.t.dir))
    .slice(0, MAX_SHOWN)
    .map(({ t }) => t);

  // 横轴跟着当天滑动，并缩放到在场主题最近的日期（最多回看 VIEW_DAYS 天，至少 MIN_SPAN 天），
  // 刚起步的系列也能铺开；波浪从右边长出来，旧的日期往左移出去
  const hi = cursor + 3;
  const recent = shown.flatMap((t) => t.points.filter((p) => p.day <= cursor && p.day >= cursor - VIEW_DAYS).map((p) => p.day));
  const lo = Math.max(0, Math.min(hi - MIN_SPAN, (recent.length ? Math.min(...recent) : cursor) - 4));
  const inner = width - PAD_X * 2;
  const xOfDay = (d: number) => PAD_X + ((d - lo) / (hi - lo)) * inner;
  const ticks: { x: number; label: string }[] = [];
  for (let d = Math.ceil(lo); d <= hi; d++) {
    const s = dateOf(d, history.firstCommit);
    if ((hi - lo > 35 ? new Date(s).getUTCDay() === 1 : true) && xOfDay(d) < width - 40) {
      ticks.push({ x: xOfDay(d), label: s.slice(5) });
    }
  }
  const bodyH = Math.max(1, shown.length) * ROW_H;
  const upTo = xOfDay(cursor);

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
      <Box
        ref={wrapRef}
        sx={{
          position: 'relative',
          height: bodyH + AXIS_H,
          transition: 'height .5s ease',
          '@keyframes mfTopicIn': { from: { opacity: 0, transform: 'translateY(16px)' }, to: { opacity: 1, transform: 'none' } },
        }}
      >
        <svg width={width} height={bodyH + AXIS_H} style={{ position: 'absolute', inset: 0, display: 'block' }}>
          {ticks.map((m) => (
            <g key={m.label}>
              <line x1={m.x} x2={m.x} y1={0} y2={bodyH} stroke="#eceff1" strokeDasharray="2 4" />
              <text x={m.x + 3} y={bodyH + 18} fontSize={11} fill="#90a4ae">{m.label}</text>
            </g>
          ))}
          <line x1={upTo} x2={upTo} y1={0} y2={bodyH + 4} stroke="#1a237e" strokeWidth={1.5} />
          <circle cx={upTo} cy={bodyH + 4} r={4} fill="#1a237e" />
        </svg>
        {!shown.length && (
          <Typography variant="body2" sx={{ position: 'absolute', top: ROW_H / 2 - 10, width: '100%', textAlign: 'center', color: 'text.disabled' }}>
            这几天没有主题在更新
          </Typography>
        )}
        {shown.map((t, i) => {
          const color = GROUP_BY_KEY[t.group].color;
          const seen = t.points.filter((p) => p.day <= cursor);
          const cy = ROW_H * 0.6;
          // 新增文章的日期标在波峰下方，挨得太近的跳过
          let lastLabelX = -99;
          const labels = seen.filter((p) => p.added > 0).filter((p) => {
            const x = xOfDay(p.day);
            if (x < PAD_X || x - lastLabelX < 44) return false;
            lastLabelX = x;
            return true;
          });
          return (
            <Box
              key={t.dir}
              sx={{ position: 'absolute', left: 0, right: 0, top: i * ROW_H, height: ROW_H, transition: 'top .5s ease', animation: 'mfTopicIn .5s ease-out' }}
            >
              <Box sx={{ position: 'absolute', left: PAD_X, top: 6, display: 'flex', alignItems: 'baseline', gap: 1, zIndex: 1 }}>
                <Typography sx={{ fontWeight: 700, fontSize: 14, color }}>{t.label}</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {GROUP_BY_KEY[t.group].label} · 累计 {seen.reduce((s, p) => s + p.added, 0)} 篇 · 活跃 {seen.length} 天
                </Typography>
              </Box>
              <svg width={width} height={ROW_H} style={{ display: 'block', overflow: 'visible' }}>
                <style>{`
                  .mf-flow { animation: mfFlow 2.4s linear infinite; }
                  @keyframes mfFlow { from { stroke-dashoffset: 64 } to { stroke-dashoffset: 0 } }
                  @keyframes mfRing { from { r: 4; opacity: .9 } to { r: 26; opacity: 0 } }
                `}</style>
                <line x1={PAD_X} x2={upTo} y1={cy} y2={cy} stroke={color} strokeOpacity={0.12} />
                {bursts(t.points).map((b) => {
                  const d = wavePath(b, cy, xOfDay, upTo);
                  if (!d) return null;
                  return (
                    <g key={b[0].date}>
                      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeOpacity={0.85} strokeLinejoin="round" />
                      {/* 沿着波浪往前流动的光点 */}
                      <path className="mf-flow" d={d} fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeDasharray="3 61" strokeOpacity={0.9} />
                    </g>
                  );
                })}
                {seen.map((p) => {
                  const x = xOfDay(p.day);
                  const fresh = cursor - p.day < 4 && cursor < totalDays;
                  return (
                    <g key={p.date}>
                      {fresh && <circle cx={x} cy={cy - amp(p)} r={4} fill="none" stroke={color} strokeWidth={2} style={{ animation: 'mfRing 1.1s ease-out' }} />}
                      <circle cx={x} cy={cy - amp(p)} r={p.added ? 4 : 3} fill={p.added ? color : '#fff'} stroke={p.added ? '#fff' : color} strokeWidth={1.5} pointerEvents="none" />
                      <circle
                        cx={x}
                        cy={cy - amp(p)}
                        r={14}
                        fill="transparent"
                        style={{ cursor: 'pointer' }}
                        onMouseEnter={() => setHover({ topic: t, point: p, x, top: i * ROW_H + cy - amp(p) })}
                        onMouseLeave={() => setHover(null)}
                      />
                    </g>
                  );
                })}
                {labels.map((p) => (
                  <text key={p.date} x={xOfDay(p.day)} y={ROW_H - 8} textAnchor="middle" fontSize={10} fill={color} fontWeight={600}>
                    {p.date.slice(5)} +{p.added}
                  </text>
                ))}
              </svg>
            </Box>
          );
        })}
        {hover && (
          <Paper
            elevation={4}
            sx={{ position: 'absolute', left: Math.min(hover.x + 14, width - 300), top: hover.top + 10, p: 1, maxWidth: 300, pointerEvents: 'none', zIndex: 3 }}
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
        横轴随播放往前滑动，并缩放到在场主题最近的日期（最多回看 {VIEW_DAYS} 天）。只显示最近 {ACTIVE_WINDOW} 天里有更新的主题（一个目录就是一个主题，只算它直接下面的文章），沉寂下来就退场。
        一条余弦波把这个系列的日期串起来：每个波峰是一个有文章出现或修改的日子（实心有新文章，空心只修改），动的文章越多波峰越高；下方标的是新增文章的日期和篇数。
        相隔超过 {BURST_GAP} 天没有动静，波浪就断开。全库改名、批量改链接这类一次动几十个文件的提交不算作修改。
      </Typography>
    </Box>
  );
}
