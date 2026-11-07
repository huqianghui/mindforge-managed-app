import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Link from '@mui/material/Link';
import { ACTIONS, BUCKETS, recommendationHref } from './data';
import type { Bucket, Recommendation } from './data';

/** 三栏推荐卡片：学习页首页与周报页共用 */
export default function Recommendations({ items, week }: { items: Recommendation[]; week?: string }) {
  if (!items.length) return null;
  const order: Bucket[] = ['must', 'heavy', 'extend'];
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 2 }}>
      {order.map((b) => {
        const list = items.filter((r) => r.bucket === b);
        if (!list.length) return null;
        const meta = BUCKETS[b];
        return (
          <Box key={b}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, color: meta.color }}>{meta.label}</Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>{meta.hint}</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {list.map((r) => {
                const href = recommendationHref(r);
                return (
                  <Paper key={r.title} variant="outlined" sx={{ p: 1.5, borderLeft: 4, borderLeftColor: meta.color }}>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>{r.title}</Typography>
                    <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5, lineHeight: 1.6 }}>{r.reason}</Typography>
                    <Box sx={{ display: 'flex', gap: 1.5, mt: 0.75, alignItems: 'baseline', flexWrap: 'wrap' }}>
                      {r.effort && <Typography variant="caption" sx={{ color: 'text.secondary' }}>{r.effort}</Typography>}
                      {href && r.action && <Link href={href} variant="caption" sx={{ fontWeight: 700 }}>{ACTIONS[r.action]} →</Link>}
                    </Box>
                  </Paper>
                );
              })}
            </Box>
          </Box>
        );
      })}
      {week && <Typography variant="caption" sx={{ color: 'text.secondary', gridColumn: '1 / -1' }}>来自 {week} 周报，每周日更新。</Typography>}
    </Box>
  );
}
