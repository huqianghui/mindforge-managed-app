import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import CloseRounded from '@mui/icons-material/CloseRounded';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { docHash } from '../docs/content';
import type { ContentIndex } from '../docs/content';
import type { WikiGraph } from '../types';
import type { History } from './history';
import { PlaybackBar } from './Playback';
import { usePlayback } from './usePlayback';
import { buildEntries, dateOf, dayIndex, GROUP_BY_KEY } from './knowledge';

// 主题脉络：一个目录就是一个主题，一条标准正弦波。横轴是真实时间，按周切成波段：每周一个完整周期，
// 周一在波峰上；整条线从主题的第一篇文章一直连到最后一篇，中间沉寂的日子照样是正弦波。
// 有文章的日子在波上高亮成大圆点。播放时波浪沿着正弦一天天往前长，视野跟着走，到了有文章的日子停一停
const PAD_X = 40;
const ROW_H = 220;
const DAY_PX = 18;
const AMP = 46;
const ACTIVE_WINDOW = 7;
const MAX_SHOWN = 2;
// 1× 时的节奏（毫秒）：每天生长的时间、到了有文章的日子先停留多久
const DAY_MS = 450;
const HOLD_MS = 1400;
const GROUP_ORDER = ['Notes', 'Azure', 'paper', 'book', 'product'];

interface Point {
  day: number;
  date: string;
  added: string[];
  edited: string[];
}

interface Topic {
  dir: string;
  group: string;
  label: string;
  points: Point[];
  /** 画线的区间：第一篇文章前一天到最后一次改动后一天 */
  from: number;
  to: number;
}

/** 播放一步：先停 delay（刚到有文章的一天），再用 grow 毫秒长到下一天 */
interface Step {
  delay: number;
  grow: number;
}

const NO_STEP: Step = { delay: 0, grow: 0 };

function loadTopics(history: History): Topic[] {
  const first = history.firstCommit;
  return Object.entries(history.topics ?? {})
    .map(([dir, days]) => {
      const group = dir.split('/')[0];
      const points = days.map(([date, added, edited]) => ({ day: dayIndex(date, first), date, added, edited }));
      return {
        dir,
        group,
        label: dir.slice(group.length + 1) || GROUP_BY_KEY[group]?.label || dir,
        points,
        from: points[0].day - 1,
        to: points.at(-1)!.day + 1,
      };
    })
    .filter((t) => GROUP_BY_KEY[t.group])
    .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || a.label.localeCompare(b.label));
}

function TopicRow({ topic, cursor, step, totalDays, firstCommit, titleOf, selectedDate, onPick, onHold }: {
  topic: Topic;
  selectedDate: string | null;
  /** 点圆点：选中那一天看详情 */
  onPick: (p: Point) => void;
  /** 鼠标在波浪上：暂停生长，和知识之树一样 */
  onHold: (h: boolean) => void;
  cursor: number;
  /** 播放中这一步的停留和生长时间；不播放时为 0 */
  step: Step;
  totalDays: number;
  firstCommit: string;
  titleOf: (dir: string, name: string) => string;
}) {
  const color = GROUP_BY_KEY[topic.group].color;
  const scrollRef = useRef<HTMLDivElement>(null);
  const clipId = useId();
  const [hover, setHover] = useState<Point | null>(null);
  const cy = ROW_H * 0.47;
  const xOfDay = (day: number) => PAD_X + (Math.min(Math.max(day, topic.from), topic.to) - topic.from) * DAY_PX;
  const width = xOfDay(topic.to) + PAD_X;
  // 周一的相位为 0：cos 在周一取波峰
  const weekday0 = (new Date(dateOf(topic.from, firstCommit)).getUTCDay() + 6) % 7;
  const yOfDay = (day: number) => cy - AMP * Math.cos((2 * Math.PI * (day - topic.from + weekday0)) / 7);
  const d = useMemo(() => {
    let path = '';
    for (let x = xOfDay(topic.from); x <= xOfDay(topic.to); x += 1) {
      const day = topic.from + (x - PAD_X) / DAY_PX;
      path += `${path ? 'L' : 'M'}${x.toFixed(1)},${yOfDay(day).toFixed(1)}`;
    }
    return path;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic, cy]);
  const mondays: number[] = [];
  for (let day = topic.from; day <= topic.to; day++) if ((day - topic.from + weekday0) % 7 === 0) mondays.push(day);

  const seen = topic.points.filter((p) => p.day <= cursor);
  const latest = seen.at(-1);
  // 相邻两个日期挨得太近时，日期标签上下错开
  const labelRow = new Map<string, number>();
  seen.forEach((p, i) => {
    const prev = seen[i - 1];
    labelRow.set(p.date, prev && xOfDay(p.day) - xOfDay(prev.day) < 44 ? 1 - (labelRow.get(prev.date) ?? 0) : 0);
  });
  const playing = step.grow > 0;
  // 整条波先画好，再用裁剪框露出来：播放时在这一步里先停 delay，再匀速扩到下一天
  const reveal = xOfDay(playing ? cursor + 1 : cursor);

  // 视野跟着波浪的生长点往前走
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ left: Math.max(0, reveal - el.clientWidth * 0.72), behavior: 'smooth' });
  }, [reveal]);

  const callout = (p: Point) => {
    const names = p.added.length ? p.added : p.edited;
    const title = titleOf(topic.dir, names[0]);
    const total = p.added.length + p.edited.length;
    return `${p.added.length ? '新增' : '修改'}「${title.length > 16 ? `${title.slice(0, 15)}…` : title}」${total > 1 ? ` 等 ${total} 篇` : ''}`;
  };

  return (
    <Box sx={{ animation: 'mfTopicIn .5s ease-out', mb: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, px: `${PAD_X}px` }}>
        <Typography sx={{ fontWeight: 700, fontSize: 15, color }}>{topic.label}</Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {GROUP_BY_KEY[topic.group].label} · {topic.points[0].date} 开始
          {latest && `，到 ${latest.date} · 累计新增 ${seen.reduce((s, p) => s + p.added.length, 0)} 篇 · 有文章的日子 ${seen.length} 天`}
        </Typography>
      </Box>
      <Box ref={scrollRef} sx={{ overflowX: 'auto', overflowY: 'hidden' }} onMouseEnter={() => onHold(true)} onMouseLeave={() => { onHold(false); setHover(null); }}>
        <Box sx={{ position: 'relative', width, height: ROW_H }}>
          <svg width={width} height={ROW_H} style={{ display: 'block' }}>
            <style>{`@keyframes mfRing { from { r: 8; opacity: .9 } to { r: 30; opacity: 0 } }`}</style>
            <line x1={PAD_X} x2={width - PAD_X} y1={cy} y2={cy} stroke="#cfd8dc" />
            {/* 每周一个波段：周一的日期标在横轴下方 */}
            {mondays.map((day) => (
              <g key={day}>
                <line x1={xOfDay(day)} x2={xOfDay(day)} y1={cy + AMP + 8} y2={cy + AMP + 14} stroke="#cfd8dc" />
                <text x={xOfDay(day)} y={ROW_H - 4} textAnchor="middle" fontSize={10} fill="#b0bec5">{dateOf(day, firstCommit).slice(5)}</text>
              </g>
            ))}
            <clipPath id={clipId}>
              <rect x={0} y={0} height={ROW_H} style={{ width: Math.max(0, reveal), transition: `width ${step.grow}ms linear ${step.delay}ms` }} />
            </clipPath>
            <path d={d} clipPath={`url(#${clipId})`} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" />
            {seen.map((p) => {
              const x = xOfDay(p.day);
              const y = yOfDay(p.day);
              const isLatest = p === latest;
              const fresh = cursor - p.day < 2 && cursor < totalDays;
              return (
                <g key={p.date} onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)} onClick={() => onPick(p)} style={{ cursor: 'pointer' }}>
                  {fresh && <circle cx={x} cy={y} r={8} fill="none" stroke={color} strokeWidth={2} style={{ animation: 'mfRing 1.1s ease-out' }} />}
                  <circle cx={x} cy={y} r={16} fill="transparent" />
                  {p.date === selectedDate && <circle cx={x} cy={y} r={13} fill="none" stroke="#263238" strokeWidth={2} />}
                  <circle cx={x} cy={y} r={p.added.length ? 8 : 6} fill={color} stroke="#fff" strokeWidth={2.5} />
                  <text x={x} y={cy + AMP + 30 + (labelRow.get(p.date) ?? 0) * 13} textAnchor="middle" fontSize={11} fontWeight={700} fill={color}>{p.date.slice(5)}</text>
                  {isLatest && (
                    <text x={x} y={cy - AMP - 16} textAnchor="middle" fontSize={11.5} fontWeight={600} fill={color}>{callout(p)}</text>
                  )}
                </g>
              );
            })}
          </svg>
          {hover && (
            <Paper
              elevation={4}
              sx={{ position: 'absolute', left: Math.min(xOfDay(hover.day) + 16, width - 300), top: cy - 20, p: 1, maxWidth: 300, pointerEvents: 'none', zIndex: 3 }}
            >
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{hover.date}</Typography>
              {hover.added.map((n) => <Typography key={n} variant="caption" sx={{ display: 'block', lineHeight: 1.35 }}>新增 {titleOf(topic.dir, n)}</Typography>)}
              {hover.edited.map((n) => <Typography key={n} variant="caption" sx={{ display: 'block', lineHeight: 1.35, color: 'text.secondary' }}>修改 {titleOf(topic.dir, n)}</Typography>)}
            </Paper>
          )}
        </Box>
      </Box>
    </Box>
  );
}

/** 发展记录：已经长到的每个有文章的日子，新增、修改了哪些文章，最新的在上 */
function DevLog({ topic, cursor, titleOf, selectedDate }: { topic: Topic; cursor: number; titleOf: (dir: string, name: string) => string; selectedDate: string | null }) {
  const color = GROUP_BY_KEY[topic.group].color;
  const seen = topic.points.filter((p) => p.day <= cursor).reverse();
  if (!seen.length) return null;
  return (
    <Box sx={{ mx: `${PAD_X}px`, mt: 1, maxHeight: 260, overflowY: 'auto', borderLeft: 2, borderColor: color, pl: 1.5 }}>
      {seen.map((p, i) => (
        <Box key={p.date} sx={{ py: 0.5, px: 1, opacity: i === 0 || p.date === selectedDate ? 1 : 0.7, bgcolor: p.date === selectedDate ? '#eef1fb' : undefined, borderRadius: 1 }}>
          <Typography variant="caption" sx={{ fontWeight: 700, color: i === 0 ? color : 'text.secondary' }}>
            {p.date}{i === 0 ? ' · 最新' : ''}
          </Typography>
          {p.added.map((n) => <Typography key={n} variant="body2" sx={{ lineHeight: 1.4 }}>新增 {titleOf(topic.dir, n)}</Typography>)}
          {p.edited.map((n) => <Typography key={n} variant="body2" sx={{ lineHeight: 1.4, color: 'text.secondary' }}>修改 {titleOf(topic.dir, n)}</Typography>)}
        </Box>
      ))}
    </Box>
  );
}

export default function TopicLines({ history, index, graph }: { history: History; index: ContentIndex; graph: WikiGraph }) {
  const { entries, totalDays } = useMemo(() => buildEntries(history, index, graph), [history, index, graph]);
  const topics = useMemo(() => loadTopics(history), [history]);
  // 两种看法：当下活跃（跟着播放自动出现、退场）和选择主题（单看一个主题的整条发展线）
  const [mode, setMode] = useState<'live' | 'pick'>('live');
  const [picked, setPicked] = useState<Topic | null>(null);
  const busiest = useMemo(() => topics.reduce((a, b) => (b.points.length > a.points.length ? b : a), topics[0]), [topics]);
  const focus = picked ?? busiest;
  // 选择主题时只播这个主题自己的区间
  const range: [number, number] = mode === 'pick' && focus ? [focus.from, Math.min(totalDays, focus.to)] : [0, totalDays];

  // 有文章的日子停一停；选择主题时只看这个主题自己的日子
  const activeDays = useMemo(
    () => new Set((mode === 'pick' && focus ? [focus] : topics).flatMap((t) => t.points.map((p) => p.day))),
    [mode, focus, topics],
  );
  const stepOf = useCallback((day: number): Step => ({ delay: activeDays.has(day) ? HOLD_MS : 0, grow: DAY_MS }), [activeDays]);
  const dwell = useCallback((day: number) => {
    const s = stepOf(day);
    return s.delay + s.grow;
  }, [stepOf]);
  // 和知识之树一样：鼠标在波浪上或选中了某一天就停住，移开、关掉详情后接着长
  const [hovering, setHovering] = useState(false);
  const [selected, setSelected] = useState<{ dir: string; point: Point } | null>(null);
  const held = hovering || selected !== null;
  const pb = usePlayback(range[1], dwell, 1, held);
  const { cursor, playing, setCursor, setPlaying, speed } = pb;
  const cur = stepOf(cursor);
  const step = playing && !held && cursor < range[1] ? { delay: cur.delay / speed, grow: cur.grow / speed } : NO_STEP;

  const choose = (m: 'live' | 'pick', t: Topic | null) => {
    setMode(m);
    setPicked(t);
    setPlaying(false);
    setSelected(null);
    // 切到某个主题时先显示它的整条线，点播放从它的第一天长起
    const f = t ?? busiest;
    setCursor(m === 'pick' && f ? Math.min(totalDays, f.to) : totalDays);
  };

  const shown = mode === 'pick'
    ? (focus ? [focus] : [])
    : topics
      .map((t) => ({ t, last: t.points.filter((p) => p.day <= cursor).at(-1)?.day ?? -1 }))
      .filter(({ last }) => last >= 0 && cursor - last < ACTIVE_WINDOW)
      .sort((a, b) => b.last - a.last || a.t.dir.localeCompare(b.t.dir))
      .slice(0, MAX_SHOWN)
      .map(({ t }) => t);

  const titleOf = useCallback((dir: string, name: string) => index.byPath.get(`${dir}/${name}`)?.title ?? name.replace(/\.md$/, ''), [index]);

  if (!topics.length) {
    return <Typography variant="body2" sx={{ color: 'text.secondary' }}>当前数据还没有主题脉络，重新同步内容后再看。</Typography>;
  }

  return (
    <Box sx={{ '@keyframes mfTopicIn': { from: { opacity: 0, transform: 'translateY(16px)' }, to: { opacity: 1, transform: 'none' } } }}>
      <PlaybackBar pb={pb} history={history} entries={entries} totalDays={totalDays} onSelect={() => {}} startDay={range[0]} endDay={range[1]} />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mb: 1 }}>
        <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_, v) => v && choose(v, picked)}>
          <ToggleButton value="live" sx={{ textTransform: 'none', px: 1.5 }}>当下活跃</ToggleButton>
          <ToggleButton value="pick" sx={{ textTransform: 'none', px: 1.5 }}>选择主题</ToggleButton>
        </ToggleButtonGroup>
        {mode === 'pick' ? (
          <Autocomplete
            size="small"
            disableClearable
            options={topics}
            value={focus}
            onChange={(_, v) => choose('pick', v)}
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
          />
        ) : (
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>播放时只出现最近 {ACTIVE_WINDOW} 天里有更新的主题，沉寂下来就退场</Typography>
        )}
      </Box>
      {!shown.length && (
        <Typography variant="body2" sx={{ py: 6, textAlign: 'center', color: 'text.disabled' }}>这几天没有主题在更新</Typography>
      )}
      {shown.map((t) => (
        <TopicRow
          key={t.dir}
          topic={t}
          cursor={cursor}
          step={step}
          totalDays={totalDays}
          firstCommit={history.firstCommit}
          titleOf={titleOf}
          selectedDate={selected?.dir === t.dir ? selected.point.date : null}
          onPick={(p) => setSelected({ dir: t.dir, point: p })}
          onHold={setHovering}
        />
      ))}
      <Typography variant="caption" sx={{ display: 'block', px: `${PAD_X}px`, color: held ? '#1a237e' : 'text.secondary' }}>
        {held ? '已暂停 · 悬停圆点看那天的文章，点击看详情' : playing ? '正在一天天往前长 · 鼠标移到波浪上暂停查看' : '点 ▶ 播放；鼠标移到波浪上查看，点圆点看详情'}
      </Typography>
      {selected && (
        <Paper variant="outlined" sx={{ mx: `${PAD_X}px`, mt: 1, p: 1.5, position: 'relative', borderColor: GROUP_BY_KEY[selected.dir.split('/')[0]]?.color }}>
          <IconButton size="small" onClick={() => setSelected(null)} sx={{ position: 'absolute', top: 4, right: 4 }} title="关闭，继续播放"><CloseRounded fontSize="small" /></IconButton>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{selected.dir} · {selected.point.date}</Typography>
          {selected.point.added.map((n) => (
            <Typography key={n} variant="body2">新增 <Link href={docHash(`${selected.dir}/${n}`)}>{titleOf(selected.dir, n)}</Link></Typography>
          ))}
          {selected.point.edited.map((n) => (
            <Typography key={n} variant="body2" sx={{ color: 'text.secondary' }}>修改 <Link href={docHash(`${selected.dir}/${n}`)}>{titleOf(selected.dir, n)}</Link></Typography>
          ))}
        </Paper>
      )}
      {mode === 'pick' && focus && <DevLog topic={focus} cursor={cursor} titleOf={titleOf} selectedDate={selected?.dir === focus.dir ? selected.point.date : null} />}
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1.5 }}>
        一个目录就是一个主题，只算它直接下面的文章。每个主题一条正弦波，横轴是真实时间，按周切成波段（每周一个周期，周一在波峰），
        从第一篇文章一直连到最后一篇；有文章的日子在波上高亮成圆点（大圆点有新文章，小圆点只修改）。播放时波浪一天天往前长，
        到了有文章的日子停一停，显示那天的文章。「当下活跃」只显示最近 {ACTIVE_WINDOW} 天里有更新的主题；「选择主题」从这个主题的第一天播到最后一天，
        下方是它的发展记录。全库改名、批量改链接这类一次动几十个文件的提交不算作修改。
      </Typography>
    </Box>
  );
}
