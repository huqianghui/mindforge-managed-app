import { useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Slider from '@mui/material/Slider';
import Chip from '@mui/material/Chip';
import Link from '@mui/material/Link';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded';
import PauseRounded from '@mui/icons-material/PauseRounded';
import ReplayRounded from '@mui/icons-material/ReplayRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import { docHash } from '../docs/content';
import type { ContentIndex } from '../docs/content';
import type { WikiGraph, WikiNode } from '../types';
import { graphAt } from './history';
import type { GapReport, History } from './history';

// 时间维度：横轴是 commit 日期，每条泳道一类知识；和知识图谱（相关性维度）互补，
// 选中节点时再把相关性叠加回来（相关概念连线、文章贡献的概念）
type Kind = 'gap' | 'concept' | 'method' | 'decision' | 'article';

interface Item {
  key: string;
  kind: Kind;
  lane: string;
  day: number;
  date: string;
  title: string;
  path?: string;
  node?: WikiNode;
  gap?: { report: GapReport; index: number };
  edits?: number;
  x: number;
  y: number;
  r: number;
}

interface Lane {
  key: string;
  label: string;
  color: string;
  height: number;
}

const LANES: Lane[] = [
  { key: 'gap', label: '知识差距', color: '#e53935', height: 54 },
  { key: 'concept', label: '概念', color: '#4A90D9', height: 92 },
  { key: 'method', label: '方法', color: '#50C878', height: 42 },
  { key: 'decision', label: '决策', color: '#FF8C42', height: 30 },
  { key: 'Notes', label: '笔记', color: '#5c6bc0', height: 70 },
  { key: 'Azure', label: 'Azure', color: '#0288d1', height: 42 },
  { key: 'paper', label: '论文', color: '#8e24aa', height: 30 },
  { key: 'book', label: '读书', color: '#6d4c41', height: 24 },
  { key: 'product', label: '产品', color: '#00897b', height: 24 },
];
const LANE_BY_KEY = Object.fromEntries(LANES.map((l) => [l.key, l]));
const NODE_DIR: Record<string, Kind> = { 'wiki/concepts/': 'concept', 'wiki/methods/': 'method', 'wiki/decisions/': 'decision' };
const LABEL_W = 70;
const PAD_R = 24;
const AXIS_H = 40;
const STEP = 6.5;
const DAY_MS = 86_400_000;
const SPEEDS = { slow: 140, normal: 60, fast: 20 } as const;

const dayIndex = (d: string, first: string) => Math.round((Date.parse(d) - Date.parse(first)) / DAY_MS);
const dateOf = (i: number, first: string) => new Date(Date.parse(first) + i * DAY_MS).toISOString().slice(0, 10);
// Claim 的 source 是去掉空格的文章标题，比较前两边都去掉空白和标点
const norm = (s: string) => s.replace(/[\s\p{P}\p{S}]+/gu, '').toLowerCase();

function layout(history: History, index: ContentIndex, graph: WikiGraph, width: number): { items: Item[]; totalDays: number } {
  const first = history.firstCommit;
  const totalDays = dayIndex(history.lastCommit, first);
  const inner = width - LABEL_W - PAD_R;
  const xOf = (day: number) => LABEL_W + (day / totalDays) * inner;
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const raw: Omit<Item, 'x' | 'y' | 'r'>[] = [];

  history.gaps.forEach((report, i) => {
    raw.push({ key: report.path, kind: 'gap', lane: 'gap', day: dayIndex(report.date, first), date: report.date, title: report.title, path: report.path, gap: { report, index: i } });
  });
  for (const [path, [created, edits]] of Object.entries(history.docs)) {
    const dir = Object.keys(NODE_DIR).find((d) => path.startsWith(d));
    const title = index.byPath.get(path)?.title ?? path;
    if (dir) {
      const id = path.slice(dir.length).replace(/\.md$/, '');
      const node = nodeById.get(id);
      raw.push({ key: path, kind: NODE_DIR[dir], lane: NODE_DIR[dir], day: dayIndex(created, first), date: created, title: node?.title ?? title, path, node, edits });
      continue;
    }
    const top = path.split('/')[0];
    if (LANE_BY_KEY[top] && path.includes('/')) {
      raw.push({ key: path, kind: 'article', lane: top, day: dayIndex(created, first), date: created, title, path, edits });
    }
  }

  // 同一泳道同一天的点竖向堆叠，堆满一列往右挪，像蜂群图
  let top = 0;
  const laneTop: Record<string, number> = {};
  for (const l of LANES) {
    laneTop[l.key] = top;
    top += l.height;
  }
  const stacks = new Map<string, number>();
  // 相隔不到一周的两期报告上下错开，免得大圆重叠
  let lastGapDay = -99;
  let gapFlip = false;
  const items = raw
    .sort((a, b) => a.day - b.day || a.title.localeCompare(b.title))
    .map((it) => {
      const lane = LANE_BY_KEY[it.lane];
      if (it.kind === 'gap') {
        gapFlip = it.day - lastGapDay < 7 ? !gapFlip : false;
        lastGapDay = it.day;
        return { ...it, x: xOf(it.day), y: laneTop.gap + lane.height / 2 + (gapFlip ? 12 : -4), r: 11 };
      }
      const k = `${it.lane}:${it.day}`;
      const n = stacks.get(k) ?? 0;
      stacks.set(k, n + 1);
      const rows = Math.max(1, Math.floor((lane.height - 8) / STEP));
      const col = Math.floor(n / rows);
      const row = n % rows;
      return { ...it, x: xOf(it.day) + col * STEP * 0.85, y: laneTop[it.lane] + lane.height - 6 - row * STEP, r: 2.6 };
    });
  return { items, totalDays };
}

function Detail({ item, history, related, contributes, onSelect, onClose }: {
  item: Item;
  history: History;
  related: Item[];
  contributes: Item[];
  onSelect: (key: string) => void;
  onClose: () => void;
}) {
  const lane = LANE_BY_KEY[item.lane];
  const snap = item.gap ? graphAt(history, item.date) : undefined;
  const list = (title: string, xs: Item[]) =>
    xs.length > 0 && (
      <>
        <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mt: 1.5, mb: 0.5 }}>{title}（{xs.length}）</Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {xs.slice(0, 40).map((r) => (
            <Chip
              key={r.key}
              size="small"
              label={r.title}
              onClick={() => onSelect(r.key)}
              sx={{ maxWidth: 220, bgcolor: `${LANE_BY_KEY[r.lane].color}18`, '&:hover': { bgcolor: `${LANE_BY_KEY[r.lane].color}30` } }}
            />
          ))}
        </Box>
      </>
    );
  return (
    <Paper elevation={0} sx={{ p: 2, border: 1, borderColor: 'divider', borderLeft: 4, borderLeftColor: lane.color, height: '100%', overflow: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="caption" sx={{ color: lane.color, fontWeight: 700 }}>
            {item.gap ? `G${item.gap.index + 1} · ` : ''}{lane.label} · {item.date}{item.edits ? ` · ${item.edits} 次提交` : ''}
          </Typography>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.35 }}>{item.title}</Typography>
        </Box>
        <IconButton size="small" onClick={onClose}><CloseRounded fontSize="small" /></IconButton>
      </Box>
      {item.node && (
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1, display: '-webkit-box', WebkitLineClamp: 5, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {item.node.summary.replace(/\*\*/g, '')}
        </Typography>
      )}
      {item.node && (
        <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.secondary' }}>
          {item.node.claims_count} 条 Claims · 平均置信度 {item.node.avg_confidence.toFixed(2)} · {item.node.category || '未分类'}
        </Typography>
      )}
      {snap && (
        <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.secondary' }}>
          当时 {snap.concepts} 概念 · {snap.methods} 方法 · {snap.claims} Claims（stale {snap.stale}）
        </Typography>
      )}
      {item.gap && (
        <>
          <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mt: 1.5, mb: 0.5 }}>本期建议（{item.gap.report.suggestions.length}）</Typography>
          {item.gap.report.suggestions.map((s, i) => (
            <Typography key={i} variant="body2" sx={{ fontSize: 13, mb: 0.4, pl: 1, borderLeft: 2, borderColor: s.carried ? '#ffb74d' : 'divider' }}>
              {s.title}{s.carried && <Box component="span" sx={{ color: '#ef6c00', fontSize: 11 }}> · 沿袭</Box>}
            </Typography>
          ))}
        </>
      )}
      {list(item.gap ? '本期到下一期之间新增' : item.kind === 'article' ? '这篇文章贡献的 wiki 节点' : '相关节点', item.gap ? related : item.kind === 'article' ? contributes : related)}
      {item.kind !== 'article' && list('引用它的文章', contributes)}
      {item.path && (
        <Link href={docHash(item.path)} variant="body2" sx={{ display: 'inline-block', mt: 1.5, fontWeight: 600 }}>打开原文 →</Link>
      )}
    </Paper>
  );
}

export default function TimeAxis({ history, index, graph }: { history: History; index: ContentIndex; graph: WikiGraph }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1100);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(720, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { items, totalDays } = useMemo(() => layout(history, index, graph, width), [history, index, graph, width]);
  const byKey = useMemo(() => new Map(items.map((i) => [i.key, i])), [items]);
  const nodeItem = useMemo(() => new Map(items.filter((i) => i.node).map((i) => [i.node!.id, i])), [items]);

  // 播放：光标一天一天往前走
  const [cursor, setCursor] = useState(totalDays);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<keyof typeof SPEEDS>('normal');
  useEffect(() => {
    if (!playing) return;
    const t = window.setInterval(() => {
      setCursor((c) => {
        if (c >= totalDays) {
          setPlaying(false);
          return c;
        }
        return c + 1;
      });
    }, SPEEDS[speed]);
    return () => window.clearInterval(t);
  }, [playing, speed, totalDays]);
  const play = () => {
    if (cursor >= totalDays) setCursor(0);
    setPlaying(true);
  };

  const [hover, setHover] = useState<Item | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = selectedKey ? byKey.get(selectedKey) ?? null : null;

  // 选中节点时叠加相关性：概念之间的关系、文章与它贡献的概念、差距报告与这一期新增的内容
  const { related, contributes } = useMemo(() => {
    if (!selected) return { related: [] as Item[], contributes: [] as Item[] };
    if (selected.gap) {
      const next = history.gaps[selected.gap.index + 1]?.date ?? '9999';
      return { related: items.filter((i) => i.kind !== 'gap' && i.date >= selected.date && i.date < next), contributes: [] };
    }
    if (selected.node) {
      const id = selected.node.id;
      const rel = graph.links
        .filter((l) => l.source === id || l.target === id)
        .map((l) => nodeItem.get(l.source === id ? l.target : l.source))
        .filter((x): x is Item => !!x);
      const sources = new Set(selected.node.claims.map((c) => norm(c.source)));
      const arts = items.filter((i) => i.kind === 'article' && sources.has(norm(i.title)));
      return { related: [...new Map(rel.map((r) => [r.key, r])).values()], contributes: arts };
    }
    const t = norm(selected.title);
    const nodes = items.filter((i) => i.node?.claims.some((c) => norm(c.source) === t));
    return { related: [], contributes: nodes };
  }, [selected, items, graph, nodeItem, history.gaps]);
  const highlighted = useMemo(() => new Set([...related, ...contributes].map((i) => i.key)), [related, contributes]);

  const visible = items.filter((i) => i.day <= cursor);
  const countOf = (k: Kind) => visible.filter((i) => i.kind === k).length;
  const currentDate = dateOf(cursor, history.firstCommit);
  const commitsToday = history.days.find(([d]) => d === currentDate)?.[1] ?? 0;
  const freshGap = [...history.gaps].reverse().find((g) => {
    const d = dayIndex(g.date, history.firstCommit);
    return d <= cursor && cursor - d < 8;
  });
  const addedToday = visible.filter((i) => i.day === cursor && i.kind !== 'gap');

  const laneTops: number[] = [];
  let acc = 0;
  for (const l of LANES) {
    laneTops.push(acc);
    acc += l.height;
  }
  const svgH = acc + AXIS_H;
  const inner = width - LABEL_W - PAD_R;
  const xOfDay = (d: number) => LABEL_W + (d / totalDays) * inner;
  const months: { x: number; label: string }[] = [];
  for (let d = 0; d <= totalDays; d++) {
    const s = dateOf(d, history.firstCommit);
    if (s.endsWith('-01')) months.push({ x: xOfDay(d), label: s.slice(0, 7) });
  }
  const maxCommits = Math.max(...history.days.map(([, n]) => n));

  const stats: [string, number, string][] = [
    ['文章', countOf('article'), '#5c6bc0'],
    ['概念', countOf('concept'), '#4A90D9'],
    ['方法', countOf('method'), '#50C878'],
    ['决策', countOf('decision'), '#FF8C42'],
    ['差距报告', countOf('gap'), '#e53935'],
  ];

  return (
    <Box>
      {/* 播放控制与当前日期 */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mb: 1 }}>
        <IconButton
          onClick={() => (playing ? setPlaying(false) : play())}
          sx={{ bgcolor: '#1a237e', color: '#fff', '&:hover': { bgcolor: '#283593' }, width: 40, height: 40 }}
        >
          {playing ? <PauseRounded /> : <PlayArrowRounded />}
        </IconButton>
        <IconButton size="small" onClick={() => { setCursor(0); setPlaying(true); }} title="从头播放"><ReplayRounded /></IconButton>
        <ToggleButtonGroup size="small" exclusive value={speed} onChange={(_, v) => v && setSpeed(v)}>
          <ToggleButton value="slow" sx={{ px: 1.2, py: 0.3 }}>慢</ToggleButton>
          <ToggleButton value="normal" sx={{ px: 1.2, py: 0.3 }}>中</ToggleButton>
          <ToggleButton value="fast" sx={{ px: 1.2, py: 0.3 }}>快</ToggleButton>
        </ToggleButtonGroup>
        <Box sx={{ ml: 1 }}>
          <Typography sx={{ fontWeight: 800, fontSize: 22, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{currentDate}</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            第 {cursor + 1} 天 · 当天 {commitsToday} 次提交{addedToday.length > 0 && ` · 新增 ${addedToday.length} 项`}
          </Typography>
        </Box>
        <Box sx={{ flex: 1 }} />
        {stats.map(([label, n, color]) => (
          <Box key={label} sx={{ textAlign: 'right', minWidth: 52 }}>
            <Typography sx={{ fontWeight: 800, fontSize: 20, color, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>{n}</Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>{label}</Typography>
          </Box>
        ))}
      </Box>
      <Slider
        size="small"
        value={cursor}
        min={0}
        max={totalDays}
        onChange={(_, v) => { setPlaying(false); setCursor(v as number); }}
        valueLabelDisplay="auto"
        valueLabelFormat={(v) => dateOf(v, history.firstCommit)}
        sx={{ mb: 0.5 }}
      />
      <Box sx={{ height: 24, mb: 0.5 }}>
        {freshGap && (
          <Chip
            size="small"
            onClick={() => setSelectedKey(freshGap.path)}
            label={`G${history.gaps.indexOf(freshGap) + 1} · ${freshGap.date} 知识差距报告：${freshGap.suggestions.length} 条建议`}
            sx={{ bgcolor: '#ffebee', color: '#c62828', fontWeight: 600, animation: 'mfPulse 1.6s ease-in-out infinite' }}
          />
        )}
      </Box>

      <Box sx={{ display: 'flex', gap: 2, alignItems: 'stretch' }}>
        <Box ref={wrapRef} sx={{ flex: 1, minWidth: 0, position: 'relative' }}>
          <svg width={width} height={svgH} style={{ display: 'block', userSelect: 'none' }} onClick={() => setSelectedKey(null)}>
            <style>{`
              .mf-dot { transition: transform .45s cubic-bezier(.2,1.6,.4,1), opacity .35s; transform-box: fill-box; transform-origin: center; cursor: pointer; }
              @keyframes mfPulse { 0%,100% { opacity: 1 } 50% { opacity: .55 } }
              @keyframes mfRing { from { r: 3; opacity: .9 } to { r: 14; opacity: 0 } }
            `}</style>
            {LANES.map((l, i) => (
              <g key={l.key}>
                <rect x={0} y={laneTops[i]} width={width} height={l.height} fill={i % 2 ? '#fafafa' : '#fff'} />
                <rect x={LABEL_W - 6} y={laneTops[i] + 4} width={3} height={l.height - 8} rx={1.5} fill={l.color} opacity={0.7} />
                <text x={LABEL_W - 14} y={laneTops[i] + l.height / 2 + 4} textAnchor="end" fontSize={12} fontWeight={600} fill="#455a64">{l.label}</text>
              </g>
            ))}
            {months.map((m) => (
              <g key={m.label}>
                <line x1={m.x} x2={m.x} y1={0} y2={acc} stroke="#e0e0e0" strokeDasharray="2 4" />
                <text x={m.x + 3} y={acc + 32} fontSize={11} fill="#90a4ae">{m.label}</text>
              </g>
            ))}
            {/* 底部每日提交活跃度 */}
            {history.days.map(([d, n]) => {
              const di = dayIndex(d, history.firstCommit);
              const h = (n / maxCommits) * 18;
              return <rect key={d} x={xOfDay(di) - 1} y={acc + 20 - h} width={2} height={h} rx={1} fill={di <= cursor ? '#90a4ae' : '#eceff1'} />;
            })}
            {/* 已走过的时间段 */}
            <rect x={LABEL_W} y={0} width={Math.max(0, xOfDay(cursor) - LABEL_W)} height={acc} fill="#1a237e" opacity={0.025} />
            {/* 选中节点的相关连线 */}
            {selected && [...related, ...contributes].filter((r) => r.day <= cursor).map((r) => {
              const mx = (selected.x + r.x) / 2;
              const my = Math.min(selected.y, r.y) - 18;
              return <path key={r.key} d={`M${selected.x},${selected.y} Q${mx},${my} ${r.x},${r.y}`} fill="none" stroke={LANE_BY_KEY[selected.lane].color} strokeOpacity={0.45} strokeWidth={1} />;
            })}
            {items.map((it) => {
              const lane = LANE_BY_KEY[it.lane];
              const shown = it.day <= cursor;
              const dim = selected && selected.key !== it.key && !highlighted.has(it.key);
              const fresh = shown && cursor - it.day < 3 && cursor < totalDays;
              return (
                <g
                  key={it.key}
                  onMouseEnter={() => setHover(it)}
                  onMouseLeave={() => setHover(null)}
                  onClick={(e) => { e.stopPropagation(); setSelectedKey(it.key); }}
                >
                  {fresh && <circle cx={it.x} cy={it.y} r={3} fill="none" stroke={lane.color} style={{ animation: 'mfRing 1s ease-out' }} />}
                  <circle
                    className="mf-dot"
                    cx={it.x}
                    cy={it.y}
                    r={selected?.key === it.key ? it.r + 2 : it.r}
                    fill={it.kind === 'gap' ? '#fff' : lane.color}
                    stroke={it.kind === 'gap' ? lane.color : selected?.key === it.key ? '#263238' : 'none'}
                    strokeWidth={it.kind === 'gap' ? 3 : 1.5}
                    style={{ transform: shown ? 'scale(1)' : 'scale(0)', opacity: shown ? (dim ? 0.15 : 0.9) : 0 }}
                  />
                  {it.gap && shown && (
                    <text x={it.x} y={it.y + 4} textAnchor="middle" fontSize={9} fontWeight={800} fill={lane.color} pointerEvents="none" opacity={dim ? 0.3 : 1}>
                      {it.gap.index + 1}
                    </text>
                  )}
                </g>
              );
            })}
            {/* 时间光标 */}
            <line x1={xOfDay(cursor)} x2={xOfDay(cursor)} y1={0} y2={acc + 22} stroke="#1a237e" strokeWidth={1.5} />
            <circle cx={xOfDay(cursor)} cy={acc + 22} r={4} fill="#1a237e" />
          </svg>
          {hover && (
            <Paper
              elevation={4}
              sx={{ position: 'absolute', left: Math.min(hover.x + 12, width - 260), top: Math.max(0, hover.y - 10), p: 1, maxWidth: 260, pointerEvents: 'none', zIndex: 2 }}
            >
              <Typography variant="caption" sx={{ color: LANE_BY_KEY[hover.lane].color, fontWeight: 700 }}>
                {LANE_BY_KEY[hover.lane].label} · {hover.date}
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.3 }}>{hover.title}</Typography>
            </Paper>
          )}
        </Box>
        {selected && (
          <Box sx={{ width: 320, flexShrink: 0, maxHeight: svgH }}>
            <Detail
              item={selected}
              history={history}
              related={related}
              contributes={contributes}
              onSelect={setSelectedKey}
              onClose={() => setSelectedKey(null)}
            />
          </Box>
        )}
      </Box>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1 }}>
        每个点是一篇文章或一个 wiki 节点，横向位置是它在 GitHub 上的首次提交日期（跟随改名）；红色大圆是知识差距报告。点任意节点查看详情，相关节点会连线高亮。
      </Typography>
    </Box>
  );
}
