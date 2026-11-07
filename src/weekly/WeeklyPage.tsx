import { lazy, Suspense, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Link from '@mui/material/Link';
import Chip from '@mui/material/Chip';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import { docHash } from '../docs/content';
import { useWeeks } from './data';
import type { Week } from './data';
import Recommendations from './Recommendations';

// 周报页：每周日 loop-weekly 生成的公开周报（wiki/weekly/），加上原来的「差距追踪」作为历史视图。
// #/weekly 打开最新一周，#/weekly?w=2026-W45 打开指定周，#/gaps?topic= 打开差距追踪（旧链接保持可用）

const GapsPage = lazy(() => import('../gaps/GapsPage'));

function readRoute(): { view: 'week' | 'gaps'; w?: string } {
  const h = window.location.hash;
  if (h.startsWith('#/gaps')) return { view: 'gaps' };
  const i = h.indexOf('?');
  const w = new URLSearchParams(i < 0 ? '' : h.slice(i + 1)).get('w') ?? undefined;
  return { view: 'week', w };
}

function Stat({ label, value, delta }: { label: string; value: number | string; delta?: number }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, minWidth: 110 }}>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>{label}</Typography>
      <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
        {value}
        {delta ? <Typography component="span" variant="caption" sx={{ color: delta > 0 ? 'success.main' : 'error.main', ml: 0.5 }}>{delta > 0 ? `+${delta}` : delta}</Typography> : null}
      </Typography>
    </Paper>
  );
}

function WeekView({ week }: { week: Week }) {
  const w = week.wiki;
  const r = week.revalidate;
  const pair = (p?: [number, number]) => (p ? { value: p[1], delta: p[1] - p[0] } : undefined);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      <Box>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>{week.title ?? week.week}</Typography>
        {week.edition && <Typography variant="caption" sx={{ color: 'text.secondary' }}>{week.edition}</Typography>}
      </Box>

      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
        <Stat label="新文章" value={week.newArticles.length} />
        {pair(w.concepts) && <Stat label="概念页" {...pair(w.concepts)!} />}
        {pair(w.claims) && <Stat label="Claims" {...pair(w.claims)!} />}
        {r.stale_after !== undefined && <Stat label="stale" value={r.stale_after} delta={r.stale_before !== undefined ? r.stale_after - r.stale_before : undefined} />}
        {w.new_questions ? <Stat label="新增自测题" value={w.new_questions} /> : null}
      </Box>

      <Box>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>下周推荐学什么</Typography>
        <Recommendations items={week.recommendations} />
      </Box>

      {week.heavy.length > 0 && (
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>重磅热点</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 1.5 }}>
            {week.heavy.map((h) => (
              <Paper key={h.title} variant="outlined" sx={{ p: 1.75, borderTop: 3, borderTopColor: '#d84315' }}>
                <Typography variant="body1" sx={{ fontWeight: 700 }}>
                  {h.url ? <Link href={h.url} target="_blank" rel="noreferrer">{h.title}</Link> : h.title}
                </Typography>
                <Typography variant="body2" sx={{ mt: 0.75, lineHeight: 1.6 }}><b>为什么热：</b>{h.why_hot}</Typography>
                <Typography variant="body2" sx={{ mt: 0.5, lineHeight: 1.6 }}><b>和你的关系：</b>{h.relation}</Typography>
                <Typography variant="body2" sx={{ mt: 0.5, lineHeight: 1.6, color: 'text.secondary' }}><b>建议投入：</b>{h.effort}</Typography>
                {h.path && <Link href={`#/learn?path=${encodeURIComponent(h.path)}&s=99`} variant="caption">在学习路径里看 →</Link>}
              </Paper>
            ))}
          </Box>
        </Box>
      )}

      {r.scanned ? (
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>知识复核</Typography>
          <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
            {([['longterm', '长效'], ['confirm', '确认'], ['revise', '修订'], ['downgrade', '降级'], ['retire', '退役'], ['pending', '待定']] as const).map(([k, label]) =>
              r[k] ? <Chip key={k} label={`${label} ${r[k]}`} size="small" variant={k === 'pending' ? 'outlined' : 'filled'} /> : null,
            )}
          </Box>
        </Box>
      ) : null}

      {week.newArticles.length > 0 && (
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 0.5 }}>本周新文章</Typography>
          {week.newArticles.map((a) => (
            <Box key={a.path}><Link href={docHash(a.path)} variant="body2">{a.title}</Link></Box>
          ))}
        </Box>
      )}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Box className="markdown-body" sx={{ fontSize: 14 }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{week.body}</ReactMarkdown>
        </Box>
        <Link href={docHash(week.doc)} variant="caption">打开周报原文 →</Link>
      </Paper>
    </Box>
  );
}

export default function WeeklyPage() {
  const weeks = useWeeks();
  const route = readRoute();
  const [view, setView] = useState<'week' | 'history' | 'gaps'>(route.view === 'gaps' ? 'gaps' : 'week');

  const tabs = (
    <Box sx={{ px: 3, borderBottom: 1, borderColor: 'divider', bgcolor: '#fff' }}>
      <Tabs value={view} onChange={(_, v) => setView(v)} sx={{ minHeight: 40, '& .MuiTab-root': { minHeight: 40 } }}>
        <Tab value="week" label="本周" />
        <Tab value="history" label="往期" />
        <Tab value="gaps" label="差距追踪" />
      </Tabs>
    </Box>
  );

  if (view === 'gaps') {
    return (
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {tabs}
        <Suspense fallback={null}><GapsPage /></Suspense>
      </Box>
    );
  }

  const week = weeks?.find((w) => w.week === route.w) ?? weeks?.[0];
  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {tabs}
      <Box sx={{ flex: 1, overflow: 'auto', p: 3 }}>
        <Box sx={{ maxWidth: 1100, mx: 'auto' }}>
          {!weeks ? (
            <Box sx={{ textAlign: 'center', p: 4 }}><CircularProgress /></Box>
          ) : !weeks.length ? (
            <Alert severity="info">还没有周报。每周日晚上的周度复盘会生成一期。</Alert>
          ) : view === 'history' ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {weeks.map((w) => (
                <Paper key={w.week} variant="outlined" sx={{ p: 1.5, cursor: 'pointer', '&:hover': { boxShadow: 2 } }}
                  onClick={() => { window.location.hash = `#/weekly?w=${encodeURIComponent(w.week)}`; setView('week'); }}>
                  <Typography variant="body1" sx={{ fontWeight: 700 }}>{w.title ?? w.week}</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {w.newArticles.length} 篇新文 · {w.heavy.length} 个重磅热点 · {w.recommendations.length} 条推荐
                  </Typography>
                </Paper>
              ))}
            </Box>
          ) : (
            week && <WeekView week={week} />
          )}
        </Box>
      </Box>
    </Box>
  );
}
