import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Alert from '@mui/material/Alert';
import Link from '@mui/material/Link';
import Tooltip from '@mui/material/Tooltip';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import { docHash } from '../../docs/content';
import { useGraphData } from '../../hooks/useGraphData';
import { useUser } from '../../platform/user';
import { AOAI_DEFAULT, AOAI_DEPLOYMENTS, askAzureOpenAI } from '../../platform/aoai';
import type { AoaiDeployment } from '../../platform/aoai';
import { buildPlanPrompt, nodeDocPath, parsePlan, selectClaims, weak } from './plan';
import type { PlanResult } from './plan';
import { saveSolution, useSolutions } from './store';
import type { Outcome, OutcomeStatus, Solution } from './store';

// 方案模式：输入客户场景 → 从决策页与相关 Claim 里给出分层推荐，每层引用依据，薄弱依据单列"先核实"；
// 方案自动存进个人 App state，事后回来填实际结果，再导出流回 vault（由 Claude Code 脱敏后写进决策页）

const FACETS: { label: string; options: string[] }[] = [
  { label: '用户从哪里进来', options: ['员工在 M365 / Teams', '来电', '网页 / App', '数字人', '自有产品后端', '开发者'] },
  { label: '谁来长期维护', options: ['业务团队', '平台 / 开发团队'] },
  { label: '要不要逐轮控制对话', options: ['需要', '不需要', '还不确定'] },
  { label: '其他约束', options: ['要接企业系统', '数据驻留严格', '需要私网', '外部或匿名用户', '要被其他应用调用', '已有 D365 Contact Center'] },
];

const STATUS: Record<OutcomeStatus, string> = { open: '进行中', adopted: '按推荐落地', changed: '改了方案落地', dropped: '没有落地' };
const LAYER_COLORS: Record<string, string> = { 入口: '#1565c0', 大脑: '#6a1b9a', 语音: '#00838f', 治理: '#2e7d32', 集成: '#ef6c00', 成本: '#6d4c41' };

function CiteChip({ cid, result }: { cid: string; result: PlanResult }) {
  const c = result.claims[cid];
  if (!c) return null;
  const w = weak(c);
  return (
    <Tooltip title={<Box sx={{ fontSize: 12 }}><b>{c.title}</b><br />{c.statement}<br />置信度 {c.confidence} · {c.status}{c.evidenceType ? ` · ${c.evidenceType}` : ''}{c.review ? <><br />复核：{c.review.slice(0, 80)}</> : null}</Box>}>
      <Chip size="small" component="a" clickable href={docHash(nodeDocPath(c.node, c.type))} label={`${c.title.slice(0, 18)}${c.title.length > 18 ? '…' : ''}`}
        color={w ? 'warning' : 'default'} variant={w ? 'filled' : 'outlined'} sx={{ maxWidth: 260 }} />
    </Tooltip>
  );
}

function ResultView({ result }: { result: PlanResult }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {!result.in_scope && <Alert severity="info">{result.summary || '这个场景超出了目前的范围（微软三支柱 + 语音），库里的决策依据不够。'}</Alert>}
      {result.in_scope && result.summary && <Typography variant="body1" sx={{ fontWeight: 700 }}>{result.summary}</Typography>}
      {result.layers.map((l, i) => (
        <Paper key={i} variant="outlined" sx={{ p: 1.5, borderLeft: 4, borderLeftColor: LAYER_COLORS[l.layer] ?? 'divider' }}>
          <Typography variant="caption" sx={{ fontWeight: 700, color: LAYER_COLORS[l.layer] ?? 'text.secondary' }}>{l.layer}</Typography>
          <Typography variant="body2" sx={{ fontWeight: 600, mt: 0.25 }}>{l.recommendation}</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5, lineHeight: 1.6 }}>{l.why}</Typography>
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.75 }}>{l.cites.map((c) => <CiteChip key={c} cid={c} result={result} />)}</Box>
        </Paper>
      ))}
      {result.verify_first.length > 0 && (
        <Alert severity="warning" icon={false}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>用之前先核实</Typography>
          {result.verify_first.map((v) => (
            <Box key={v.cite} sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 0.5, flexWrap: 'wrap' }}>
              <CiteChip cid={v.cite} result={result} />
              <Typography variant="body2">{v.reason}</Typography>
            </Box>
          ))}
        </Alert>
      )}
      {result.ask_customer.length > 0 && (
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>还要向客户确认</Typography>
          {result.ask_customer.map((q, i) => <Typography key={i} variant="body2" sx={{ mt: 0.5 }}>· {q}</Typography>)}
        </Paper>
      )}
      {result.risks.length > 0 && (
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>风险与一票否决项</Typography>
          {result.risks.map((r, i) => <Typography key={i} variant="body2" sx={{ mt: 0.5 }}>· {r}</Typography>)}
        </Paper>
      )}
    </Box>
  );
}

function OutcomeForm({ s }: { s: Solution }) {
  const [o, setO] = useState<Outcome>(s.outcome ?? { status: 'open', chosen: '', worked: '', pitfalls: '', updatedAt: '' });
  const [saved, setSaved] = useState(false);
  const set = (patch: Partial<Outcome>) => { setO({ ...o, ...patch }); setSaved(false); };
  return (
    <Paper variant="outlined" sx={{ p: 2, bgcolor: '#fafafa' }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>结果回填</Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>方案用出去之后回来记一下：只存在你自己的账号里；导出后由 Claude Code 脱敏，再写进对应决策页的实践记录、调整置信度。</Typography>
      <Box sx={{ display: 'grid', gap: 1.5, mt: 1.5 }}>
        <Select size="small" value={o.status} onChange={(e) => set({ status: e.target.value as OutcomeStatus })}>
          {(Object.keys(STATUS) as OutcomeStatus[]).map((k) => <MenuItem key={k} value={k}>{STATUS[k]}</MenuItem>)}
        </Select>
        <TextField size="small" label="客户最后选了什么" value={o.chosen} onChange={(e) => set({ chosen: e.target.value })} multiline />
        <TextField size="small" label="行得通的地方" value={o.worked} onChange={(e) => set({ worked: e.target.value })} multiline />
        <TextField size="small" label="踩的坑、和推荐不一致的地方" value={o.pitfalls} onChange={(e) => set({ pitfalls: e.target.value })} multiline />
        <Box>
          <Button variant="contained" size="small" onClick={async () => { await saveSolution({ ...s, outcome: { ...o, updatedAt: new Date().toISOString() } }); setSaved(true); }}>保存</Button>
          {saved && <Typography component="span" variant="caption" sx={{ ml: 1, color: 'success.main' }}>已保存</Typography>}
        </Box>
      </Box>
    </Paper>
  );
}

function exportMarkdown(items: Solution[]): string {
  const lines = [`# 方案实践记录导出 ${new Date().toISOString().slice(0, 10)}`, '', '> 从 Mindforge 方案助手导出，含客户信息。放进 vault 的 inbox/solutions/（不进 git），由 Claude Code 脱敏后写进决策页的实践记录并调整置信度。', ''];
  for (const s of items.filter((x) => x.outcome && x.outcome.status !== 'open')) {
    const o = s.outcome!;
    lines.push(`## ${s.title}（${s.createdAt.slice(0, 10)}）`, '', `- 场景：${s.scenario.replace(/\n/g, ' ')}`, `- 推荐：${s.result.summary}`);
    for (const l of s.result.layers) lines.push(`  - ${l.layer}：${l.recommendation}（依据：${l.cites.map((c: string) => `${s.result.claims[c]?.node}「${s.result.claims[c]?.statement.slice(0, 40)}」`).join('；')}）`);
    lines.push(`- 结果：${STATUS[o.status]}`, `- 客户最后选择：${o.chosen || '—'}`, `- 行得通：${o.worked || '—'}`, `- 踩坑 / 不一致：${o.pitfalls || '—'}`, '');
  }
  return lines.join('\n');
}

export default function PlanPage() {
  const { allNodes, loading } = useGraphData();
  const user = useUser();
  const { items, backend } = useSolutions();
  const [scenario, setScenario] = useState('');
  const [facets, setFacets] = useState<string[]>([]);
  const [deployment, setDeployment] = useState<AoaiDeployment>(AOAI_DEFAULT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [current, setCurrent] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const list = useMemo(() => [...items.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [items]);
  const shown = current ? items.get(current) : undefined;

  const run = async () => {
    const text = [scenario.trim(), facets.length ? `（补充：${facets.join('；')}）` : ''].filter(Boolean).join(' ');
    if (!text || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      if (user === null) throw new Error('方案助手要在 Managed App 里使用（经 Azure OpenAI connector 调模型）');
      const claims = selectClaims(allNodes, text);
      const res = await askAzureOpenAI(buildPlanPrompt(text, claims), deployment);
      const result = parsePlan(res.text, claims);
      const s: Solution = {
        id: `s-${Date.now().toString(36)}`,
        createdAt: new Date().toISOString(),
        title: scenario.trim().slice(0, 40) || facets.join(' · ').slice(0, 40),
        scenario: text,
        deployment: res.model ?? deployment,
        result,
      };
      await saveSolution(s);
      setCurrent(s.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '260px 1fr' }, gap: 3 }}>
      <Box>
        <Button fullWidth variant={current ? 'outlined' : 'contained'} onClick={() => setCurrent(null)} sx={{ mb: 1.5 }}>新方案</Button>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>我的方案（{list.length}）· {backend === 'cloud' ? '按账号保存' : backend === 'loading' ? '读取中…' : '只在本机'}</Typography>
        {list.map((s) => (
          <Paper key={s.id} variant="outlined" onClick={() => setCurrent(s.id)}
            sx={{ p: 1, mt: 0.75, cursor: 'pointer', bgcolor: s.id === current ? 'action.selected' : undefined, '&:hover': { bgcolor: 'action.hover' } }}>
            <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.4 }}>{s.title}</Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>{s.createdAt.slice(0, 10)} · {STATUS[s.outcome?.status ?? 'open']}</Typography>
          </Paper>
        ))}
        {list.some((s) => s.outcome && s.outcome.status !== 'open') && (
          <Button size="small" sx={{ mt: 1 }} onClick={() => setExportOpen(true)}>导出已回填的结果</Button>
        )}
      </Box>
      <Box>
        {shown ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Paper variant="outlined" sx={{ p: 1.5 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>客户场景 · {shown.createdAt.slice(0, 16).replace('T', ' ')}{shown.deployment ? ` · ${shown.deployment}` : ''}</Typography>
              <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-wrap' }}>{shown.scenario}</Typography>
            </Paper>
            <ResultView result={shown.result} />
            <OutcomeForm key={shown.id} s={shown} />
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              描述一个客户场景，从决策页和相关论断里给出分层方案，每一层都引用依据；依据里 stale、复核待定或置信度低的单独列出来，用之前先核实。目前覆盖微软三支柱与语音。
            </Typography>
            <TextField multiline minRows={3} placeholder="例：一家保险公司，员工在 Teams 里查保单和理赔规则，要接内部核心系统，后面可能加电话客服"
              value={scenario} onChange={(e) => setScenario(e.target.value)} />
            {FACETS.map((f) => (
              <Box key={f.label}>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>{f.label}</Typography>
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.25 }}>
                  {f.options.map((o) => {
                    const on = facets.includes(o);
                    return <Chip key={o} size="small" label={o} color={on ? 'primary' : 'default'} variant={on ? 'filled' : 'outlined'}
                      onClick={() => setFacets(on ? facets.filter((x) => x !== o) : [...facets, o])} />;
                  })}
                </Box>
              </Box>
            ))}
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <Button variant="contained" disabled={busy || loading || (!scenario.trim() && !facets.length)} onClick={run}>{busy ? '生成中…' : '出方案'}</Button>
              <Select size="small" value={deployment} onChange={(e) => setDeployment(e.target.value as AoaiDeployment)}>
                {AOAI_DEPLOYMENTS.map((d) => <MenuItem key={d} value={d}>{d}</MenuItem>)}
              </Select>
            </Box>
            {busy && <LinearProgress />}
            {error && <Alert severity="warning">{error}</Alert>}
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              场景描述会发给你所在租户的 Azure OpenAI 部署；方案只存在你自己的账号里。依据不足时会如实说明，不会凭空补全。也可以参考 <Link href={docHash('wiki/decisions/microsoft-ai-pillars-selection.md')}>三支柱选型决策页</Link>。
            </Typography>
          </Box>
        )}
      </Box>
      <Dialog open={exportOpen} onClose={() => setExportOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>导出已回填的方案结果</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 1 }}>内容含客户信息，只放进 vault 的 inbox/solutions/（不进 git），由 Claude Code 脱敏后再写进决策页。</Alert>
          <TextField fullWidth multiline minRows={12} value={exportMarkdown(list)} slotProps={{ input: { readOnly: true, sx: { fontFamily: 'monospace', fontSize: 12 } } }} />
        </DialogContent>
        <DialogActions><Button onClick={() => setExportOpen(false)}>关闭</Button></DialogActions>
      </Dialog>
    </Box>
  );
}
