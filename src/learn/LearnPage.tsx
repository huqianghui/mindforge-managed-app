import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import TextField from '@mui/material/TextField';
import Alert from '@mui/material/Alert';
import Link from '@mui/material/Link';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import LinearProgress from '@mui/material/LinearProgress';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import { docHash } from '../docs/content';
import { askAzureOpenAI } from '../platform/aoai';
import { totalMinutes, usePaths } from './data';
import type { LearningPath, Question, Station } from './data';
import { getReview, getStation, gradeQuestion, toggleMastery, useLearning } from './progress';
import type { Grade } from './progress';

// 学习页：路径 → 站点 → 「算会」勾选与自测。没有打卡、没有连续天数，进度只记给自己看。
// 地址：#/learn?path=<路径 id>&s=<站号>

const COLORS = { done: '#2e7d32', doing: '#f9a825', todo: '#b0bec5', frontier: '#7e57c2' };
const PRIORITY: Record<string, { label: string; color: string }> = {
  high: { label: '高', color: '#d32f2f' },
  medium: { label: '中', color: '#f57c00' },
  low: { label: '低', color: '#78909c' },
};
const GRADES: { grade: Grade; label: string; color: 'error' | 'warning' | 'success' }[] = [
  { grade: 'again', label: '没答上', color: 'error' },
  { grade: 'hard', label: '有点模糊', color: 'warning' },
  { grade: 'good', label: '答上了', color: 'success' },
];

function readRoute(): { path?: string; s?: number } {
  const h = window.location.hash;
  const i = h.indexOf('?');
  const qs = new URLSearchParams(i < 0 ? '' : h.slice(i + 1));
  const s = Number(qs.get('s'));
  return { path: qs.get('path') ?? undefined, s: Number.isFinite(s) && s > 0 ? s : undefined };
}

function go(path?: string, s?: number) {
  const qs = new URLSearchParams();
  if (path) qs.set('path', path);
  if (s) qs.set('s', String(s));
  window.location.hash = `#/learn${qs.toString() ? `?${qs}` : ''}`;
}

function Md({ children, small }: { children: string; small?: boolean }) {
  return (
    <Box className="markdown-body" sx={{ fontSize: small ? 13 : 14, '& p': { my: 0.5 }, '& ul': { my: 0.5, pl: 2.5 } }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </Box>
  );
}

type Values = ReadonlyMap<string, unknown>;

function stationState(values: Values, path: LearningPath, s: Station): 'done' | 'doing' | 'todo' {
  const checked = getStation(values, path.id, s.n).checked.length;
  if (s.mastery.length > 0 && checked >= s.mastery.length) return 'done';
  return checked > 0 ? 'doing' : 'todo';
}

function pathProgress(values: Values, path: LearningPath) {
  const total = path.stations.reduce((n, s) => n + s.mastery.length, 0);
  const checked = path.stations.reduce((n, s) => n + Math.min(getStation(values, path.id, s.n).checked.length, s.mastery.length), 0);
  return { total, checked, pct: total ? Math.round((checked / total) * 100) : 0 };
}

const hours = (min: number) => (min >= 60 ? `${Math.round(min / 6) / 10} 小时` : `${min} 分钟`);

/** 首页：所有路径的卡片 */
function PathCards({ paths, values }: { paths: LearningPath[]; values: Values }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 2 }}>
      {paths.map((p) => {
        const prog = pathProgress(values, p);
        return (
          <Paper key={p.id} variant="outlined" onClick={() => go(p.id)}
            sx={{ p: 2, cursor: 'pointer', transition: 'box-shadow .15s', '&:hover': { boxShadow: 3 } }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{p.title}</Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {p.stations.length} 站 · 约 {hours(totalMinutes(p))}{p.quiz.length ? ` · ${p.quiz.length} 道题` : ' · 题库待补'}
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5, my: 1.5, flexWrap: 'wrap' }}>
              {p.stations.map((s) => (
                <Box key={s.n} title={`第 ${s.n} 站 · ${s.title}`}
                  sx={{ width: 14, height: 14, borderRadius: '50%', bgcolor: COLORS[stationState(values, p, s)] }} />
              ))}
              <Box title="前沿站" sx={{ width: 14, height: 14, borderRadius: '50%', border: `2px dashed ${COLORS.frontier}` }} />
            </Box>
            <LinearProgress variant="determinate" value={prog.pct} sx={{ height: 6, borderRadius: 3 }} />
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {prog.checked ? `已掌握 ${prog.checked} / ${prog.total} 条「算会」` : '还没开始，从哪一站读起都可以'}
            </Typography>
          </Paper>
        );
      })}
    </Box>
  );
}

/** 左栏：站点路线 */
function StationRail({ path, values, current }: { path: LearningPath; values: Values; current?: number }) {
  return (
    <Box sx={{ position: 'relative', pl: 1 }}>
      <Box sx={{ position: 'absolute', left: 17, top: 12, bottom: 12, width: 2, bgcolor: 'divider' }} />
      {path.stations.map((s) => {
        const st = stationState(values, path, s);
        const active = s.n === current;
        return (
          <Box key={s.n} onClick={() => go(path.id, s.n)}
            sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', py: 0.75, cursor: 'pointer', position: 'relative', borderRadius: 1, '&:hover': { bgcolor: 'action.hover' }, bgcolor: active ? 'action.selected' : undefined }}>
            <Box sx={{ width: 20, height: 20, mt: 0.25, borderRadius: '50%', flexShrink: 0, bgcolor: COLORS[st], color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1 }}>
              {s.n}
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: active ? 700 : 500, lineHeight: 1.4 }}>{s.title}</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {s.minutes ? hours(s.minutes) : ''}{s.prereq.length ? ` · 前置 ${s.prereq.join('、')}` : ''}{s.stale ? ' · ⚠️' : ''}
              </Typography>
            </Box>
          </Box>
        );
      })}
      <Box onClick={() => go(path.id, 99)}
        sx={{ display: 'flex', gap: 1.5, alignItems: 'center', py: 0.75, cursor: 'pointer', borderRadius: 1, '&:hover': { bgcolor: 'action.hover' }, bgcolor: current === 99 ? 'action.selected' : undefined }}>
        <Box sx={{ width: 20, height: 20, borderRadius: '50%', border: `2px dashed ${COLORS.frontier}`, bgcolor: '#fff', zIndex: 1, flexShrink: 0 }} />
        <Typography variant="body2" sx={{ color: COLORS.frontier, fontWeight: current === 99 ? 700 : 500 }}>前沿站 · 正在发生的变化</Typography>
      </Box>
    </Box>
  );
}

/** 一道题：先自己想（可写下来），再看参考答案、自评；写了答案可以请 AI 点评 */
function QuizCard({ q, values, onNext }: { q: Question; values: Values; onNext?: () => void }) {
  const [revealed, setRevealed] = useState(false);
  const [mine, setMine] = useState('');
  const [review, setReview] = useState<{ loading?: boolean; text?: string; error?: string }>({});
  const prev = getReview(values, q.id);

  const askReview = async () => {
    setReview({ loading: true });
    const prompt = [
      '你是一位耐心的技术学习伙伴。下面是一道自测题、参考要点和学习者自己的回答。',
      '请用中文简短点评，格式固定为四行：',
      '判断：一句话（基本答上 / 部分答上 / 偏了）',
      '答到的：列出答对的要点',
      '漏掉的：列出参考要点里没提到、但重要的地方；没有就写"无"',
      '追问：给一个能帮他想得更深的问题',
      '不要重复题目，不要说客套话。',
      '',
      `题目：${q.question}`,
      `参考要点：${q.answer}`,
      `学习者的回答：${mine}`,
    ].join('\n');
    try {
      const res = await askAzureOpenAI(prompt);
      setReview({ text: res.text });
    } catch (e) {
      setReview({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1 }}>
        <Chip size="small" label={q.type} color={q.type === '场景' ? 'primary' : q.type === '辨析' ? 'secondary' : 'default'} />
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>第 {q.station} 站</Typography>
        {prev && (
          <Typography variant="caption" sx={{ color: 'text.secondary', ml: 'auto' }}>
            上次：{GRADES.find((g) => g.grade === prev.last)?.label} · 下次 {prev.due.slice(0, 10)}
          </Typography>
        )}
      </Box>
      <Md>{q.question}</Md>
      <TextField fullWidth multiline minRows={2} size="small" placeholder="先自己想一想，也可以写下来（可选，写了才能请 AI 点评）"
        value={mine} onChange={(e) => setMine(e.target.value)} sx={{ my: 1.5 }} />
      {!revealed ? (
        <Button variant="contained" onClick={() => setRevealed(true)}>看参考要点</Button>
      ) : (
        <>
          <Box sx={{ bgcolor: '#f5f9ff', borderLeft: 3, borderColor: 'primary.main', p: 1.5, borderRadius: 1 }}>
            <Md>{q.answer}</Md>
            {q.source && <Typography component="div" variant="caption" sx={{ color: 'text.secondary' }}>出处：<Md small>{q.source}</Md></Typography>}
          </Box>
          <Box sx={{ display: 'flex', gap: 1, mt: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
            {GRADES.map((g) => (
              <Button key={g.grade} size="small" variant="outlined" color={g.color}
                onClick={() => { gradeQuestion(q.id, g.grade); onNext?.(); }}>{g.label}</Button>
            ))}
            <Button size="small" disabled={!mine.trim() || review.loading} onClick={askReview} sx={{ ml: 'auto' }}>
              {review.loading ? '点评中…' : 'AI 点评我的回答'}
            </Button>
          </Box>
          {review.loading && <LinearProgress sx={{ mt: 1 }} />}
          {review.text && <Alert severity="info" icon={false} sx={{ mt: 1.5, whiteSpace: 'pre-wrap' }}>{review.text}</Alert>}
          {review.error && <Alert severity="warning" sx={{ mt: 1.5 }}>AI 点评没成功：{review.error}</Alert>}
        </>
      )}
    </Paper>
  );
}

/** 右栏：站点详情 */
function StationDetail({ path, s, values }: { path: LearningPath; s: Station; values: Values }) {
  const checked = getStation(values, path.id, s.n).checked;
  const questions = path.quiz.filter((q) => q.station === s.n);
  const [qi, setQi] = useState(-1);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>第 {s.n} 站 · {s.title}</Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {s.minutes ? `约 ${hours(s.minutes)}` : ''}{s.prereq.length ? ` · 建议先读第 ${s.prereq.join('、')} 站` : ' · 可以直接开始'}
        </Typography>
      </Box>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>读这些</Typography>
        <Md>{s.reads}</Md>
        {s.stale && <Alert severity="warning" sx={{ mt: 1 }}><Md small>{s.stale}</Md></Alert>}
      </Paper>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>学到什么程度算会</Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>能不看资料说出来，就勾上</Typography>
        {s.mastery.map((m, i) => (
          <Box key={i} sx={{ display: 'flex', alignItems: 'flex-start' }}>
            <Checkbox size="small" checked={checked.includes(i)} onChange={() => toggleMastery(path.id, s.n, i)} sx={{ mt: -0.5 }} />
            <Box sx={{ pt: 0.25 }}><Md>{m}</Md></Box>
          </Box>
        ))}
      </Paper>
      {s.frontierAuto.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2, borderStyle: 'dashed', borderColor: COLORS.frontier }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, color: COLORS.frontier }}>这一站的前沿</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>知识差距报告里与本站相关的主题，学有余力再看：它改变了本站哪条结论？</Typography>
          {s.frontierAuto.map((f) => (
            <Box key={f.title} sx={{ display: 'flex', gap: 1, alignItems: 'baseline', mt: 0.75, flexWrap: 'wrap' }}>
              {f.priority && <Typography variant="caption" sx={{ color: PRIORITY[f.priority]?.color, fontWeight: 700 }}>{PRIORITY[f.priority]?.label}</Typography>}
              <Link href={`#/gaps?topic=${encodeURIComponent(f.topic)}`} variant="body2">{f.title}</Link>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>{f.date} · 经 {f.via.join('、')}</Typography>
            </Box>
          ))}
        </Paper>
      )}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>本站自测</Typography>
        {questions.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>这条路径的题库还在补，先用上面的「算会」自查。</Typography>
        ) : qi < 0 ? (
          <Button sx={{ mt: 1 }} variant="outlined" onClick={() => setQi(0)}>来一题（共 {questions.length} 题）</Button>
        ) : (
          <Box sx={{ mt: 1 }}>
            <QuizCard key={questions[qi].id} q={questions[qi]} values={values}
              onNext={() => setQi((i) => (i + 1 < questions.length ? i + 1 : -1))} />
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>{qi + 1} / {questions.length}</Typography>
          </Box>
        )}
      </Paper>
    </Box>
  );
}

/** 随手一题：从到期或没做过的题里随机挑；都做过且没到期就说一声 */
function pickQuestion(path: LearningPath, values: Values, skip?: string): Question | null {
  const now = new Date().toISOString();
  const due = path.quiz.filter((q) => q.id !== skip && (getReview(values, q.id)?.due ?? '') <= now);
  return due.length ? due[Math.floor(Math.random() * due.length)] : null;
}

function exportMarkdown(paths: LearningPath[], values: Values): string {
  const day = new Date().toISOString().slice(0, 10);
  const lines = [`# 学习记录导出 ${day}`, '', '> 从 Mindforge 学习页导出，放进 inbox/ 后由 harvest 收走；只含进度与自评，不含写下的回答。', ''];
  for (const p of paths) {
    const prog = pathProgress(values, p);
    const misses = p.quiz
      .map((q) => ({ q, r: getReview(values, q.id) }))
      .filter(({ r }) => r && r.last !== 'good');
    if (!prog.checked && !misses.length) continue;
    lines.push(`## ${p.title}`, '', `- 「算会」已勾选 ${prog.checked} / ${prog.total}`);
    for (const s of p.stations) {
      const c = getStation(values, p.id, s.n).checked.length;
      if (c) lines.push(`  - 第 ${s.n} 站 ${s.title}：${c} / ${s.mastery.length}`);
    }
    if (misses.length) {
      lines.push('', '答得不好的题：', '');
      for (const { q, r } of misses) lines.push(`- [${r!.last === 'again' ? '没答上' : '模糊'}] 第 ${q.station} 站 · ${q.question.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').slice(0, 80)}（\`${q.id}\`，失误 ${r!.lapses} 次）`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function ExportDialog({ open, onClose, text }: { open: boolean; onClose: () => void; text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>导出学习记录</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
          复制下面的 Markdown，存成 vault 里 <code>inbox/learning/</code> 下的文件，答得不好的题会进入知识差距的"个人掌握度"。复制按钮不可用时，可以全选文本框手动复制。
        </Typography>
        <TextField fullWidth multiline minRows={12} value={text} slotProps={{ input: { readOnly: true, sx: { fontFamily: 'monospace', fontSize: 12 } } }} />
      </DialogContent>
      <DialogActions>
        <Button onClick={copy}>{copied ? '已复制' : '复制'}</Button>
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  );
}

export default function LearnPage() {
  const paths = usePaths();
  const { values, backend } = useLearning();
  const route = readRoute();
  const [tab, setTab] = useState<'route' | 'quiz' | 'about'>('route');
  const [random, setRandom] = useState<Question | null | undefined>(undefined);
  const [exportOpen, setExportOpen] = useState(false);
  const path = useMemo(() => paths?.find((p) => p.id === route.path), [paths, route.path]);

  if (!paths) return <Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress /></Box>;

  const saved = backend === 'cloud' ? '进度按你的账号保存' : backend === 'loading' ? '读取进度中…' : '进度只保存在本机';

  if (!path) {
    return (
      <Box sx={{ flex: 1, overflow: 'auto', p: 3 }}>
        <Box sx={{ maxWidth: 1200, mx: 'auto' }}>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>学习路径</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5, mb: 2.5 }}>
            把网状的知识图谱排成有先后的路线。挑一条感兴趣的，从哪一站读起都行；每站读完对照「学到什么程度算会」自查，有题库的可以顺手做两题。{saved}。
          </Typography>
          <PathCards paths={paths} values={values} />
          <Box sx={{ mt: 2 }}>
            <Button size="small" onClick={() => setExportOpen(true)}>导出学习记录</Button>
          </Box>
          <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} text={exportMarkdown(paths, values)} />
        </Box>
      </Box>
    );
  }

  const station = route.s && route.s !== 99 ? path.stations.find((s) => s.n === route.s) : undefined;
  const prog = pathProgress(values, path);

  return (
    <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      <Box sx={{ width: 320, flexShrink: 0, borderRight: 1, borderColor: 'divider', overflow: 'auto', p: 2 }}>
        <Link component="button" variant="caption" onClick={() => go()}>← 全部路径</Link>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mt: 1 }}>{path.title}</Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>已掌握 {prog.checked} / {prog.total} · {saved}</Typography>
        <LinearProgress variant="determinate" value={prog.pct} sx={{ height: 6, borderRadius: 3, my: 1.5 }} />
        <StationRail path={path} values={values} current={route.s} />
      </Box>
      <Box sx={{ flex: 1, overflow: 'auto', p: 3 }}>
        <Box sx={{ maxWidth: 860 }}>
          {station ? (
            <StationDetail key={station.n} path={path} s={station} values={values} />
          ) : route.s === 99 ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Typography variant="h6" sx={{ fontWeight: 700, color: COLORS.frontier }}>前沿站 · 正在发生的变化</Typography>
              <Paper variant="outlined" sx={{ p: 2, borderStyle: 'dashed', borderColor: COLORS.frontier }}><Md>{path.frontier || '暂无'}</Md></Paper>
              {path.gaps && (
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>这条路径暴露的缺口</Typography>
                  <Md>{path.gaps}</Md>
                </Paper>
              )}
            </Box>
          ) : (
            <>
              <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
                <Tab value="route" label="路线" />
                <Tab value="quiz" label={`随手一题${path.quiz.length ? '' : '（待补）'}`} disabled={!path.quiz.length} />
                <Tab value="about" label="毕业标准与信号源" />
              </Tabs>
              {tab === 'route' && (
                <Box>
                  <Md>{path.intro}</Md>
                  <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 1.5, mt: 2 }}>
                    {path.stations.map((s) => {
                      const st = stationState(values, path, s);
                      return (
                        <Paper key={s.n} variant="outlined" onClick={() => go(path.id, s.n)}
                          sx={{ p: 1.5, cursor: 'pointer', borderLeft: 4, borderLeftColor: COLORS[st], '&:hover': { boxShadow: 2 } }}>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>第 {s.n} 站{s.minutes ? ` · ${hours(s.minutes)}` : ''}</Typography>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>{s.title}</Typography>
                          {s.frontierAuto.length > 0 && <Typography variant="caption" sx={{ color: COLORS.frontier }}>{s.frontierAuto.length} 条前沿</Typography>}
                        </Paper>
                      );
                    })}
                  </Box>
                  <Button sx={{ mt: 2 }} variant="contained" onClick={() => go(path.id, path.stations.find((s) => stationState(values, path, s) !== 'done')?.n ?? 1)}>
                    {prog.checked ? '接着学' : '从第 1 站开始'}
                  </Button>
                </Box>
              )}
              {tab === 'quiz' && (
                <Box>
                  <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>从没做过或已经到期的题里随机挑一道，答完自评，系统按间隔复习安排下次出现的时间。想做就做，不做也不会提醒你。</Typography>
                  {random === undefined ? (
                    <Button variant="contained" onClick={() => setRandom(pickQuestion(path, values))}>来一题</Button>
                  ) : random === null ? (
                    <Alert severity="success">这条路径的题目都还没到复习时间，过几天再来。</Alert>
                  ) : (
                    <QuizCard key={random.id} q={random} values={values} onNext={() => setRandom(pickQuestion(path, values, random.id))} />
                  )}
                </Box>
              )}
              {tab === 'about' && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <Paper variant="outlined" sx={{ p: 2 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>毕业标准</Typography>
                    <Md>{path.graduation}</Md>
                  </Paper>
                  <Paper variant="outlined" sx={{ p: 2 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>这个领域盯哪些信号源</Typography>
                    <Md>{path.signals.map((s) => `- ${s}`).join('\n')}</Md>
                    {path.gapTopics.length > 0 && (
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 1 }}>
                        {path.gapTopics.map((t) => <Chip key={t} size="small" component="a" clickable href={`#/gaps?topic=${encodeURIComponent(t)}`} label={t} />)}
                      </Box>
                    )}
                  </Paper>
                  <Link href={docHash(path.doc)} variant="body2">打开路径原文 →</Link>
                </Box>
              )}
            </>
          )}
        </Box>
      </Box>
    </Box>
  );
}
