import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Link from '@mui/material/Link';
import Alert from '@mui/material/Alert';
import LinearProgress from '@mui/material/LinearProgress';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import { docHash, useContentIndex } from '../docs/content';
import { useUser } from '../platform/user';
import { askCopilot } from '../platform/copilot';
import { askAgent } from '../platform/agent';
import { retrieve } from './retrieve';
import type { Source } from './retrieve';
import { buildPrompt, parseAnswer } from './prompt';
import type { Turn } from './prompt';

type Backend = 'workiq' | 'agent';
const BACKENDS: Record<Backend, string> = { workiq: 'Work IQ（M365 Copilot）', agent: 'Copilot Studio agent' };

interface Message {
  backend: Backend;
  question: string;
  sources: Source[];
  answer?: string;
  related?: number[];
  error?: string;
  ms?: number;
}

const SLOW_MS = 10_000;
const EXAMPLES = ['A2A 和 MCP 分别解决什么问题？', 'Voice Live 在弱网下表现如何？', 'Prompt Cache 新旧两代有什么区别？'];

// 正文里的 [n] 改成指向来源文章的链接
function linkCitations(text: string, sources: Source[]): string {
  return text.replace(/\[(\d+)\](?!\()/g, (m, n: string) => {
    const s = sources[Number(n) - 1];
    return s ? `[[${n}]](${docHash(s.path)})` : m;
  });
}

export default function AskPage({ initialQuestion, pinned }: { initialQuestion?: string; pinned?: string }) {
  const content = useContentIndex();
  const user = useUser();
  const [input, setInput] = useState(initialQuestion ?? '');
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [backend, setBackend] = useState<Backend>('workiq');
  const [slow, setSlow] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const pinnedTitle = pinned ? content?.byPath.get(pinned)?.title : undefined;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, slow]);

  const ask = async (question: string) => {
    if (!content || busy || !question.trim()) return;
    const q = question.trim();
    setInput('');
    setBusy(true);
    setSlow(false);
    const slowTimer = setTimeout(() => setSlow(true), SLOW_MS);
    const started = performance.now();
    const history: Turn[] = messages.filter((m) => m.answer).map((m) => ({ question: m.question, answer: m.answer! }));
    let sources: Source[] = [];
    const update = (patch: Partial<Message>) =>
      setMessages((ms) => ms.map((m, i) => (i === ms.length - 1 ? { ...m, ...patch } : m)));
    setMessages((ms) => [...ms, { backend, question: q, sources }]);
    try {
      sources = await retrieve(q, content, pinned);
      update({ sources });
      // 宿主外 SDK 调用不会返回，只演示检索
      if (user === null) throw new Error('offhost');
      const prompt = buildPrompt(q, sources, history, backend === 'agent');
      const raw = backend === 'agent' ? await askAgent(prompt) : await askCopilot(prompt);
      const { text, related } = parseAnswer(raw, sources.length);
      update({ answer: text, related, ms: performance.now() - started });
    } catch (e) {
      update({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      clearTimeout(slowTimer);
      setBusy(false);
      setSlow(false);
    }
  };

  const offHost = user === null;

  return (
    <Box sx={{ flex: 1, overflow: 'auto', bgcolor: 'background.default' }}>
      <Box sx={{ maxWidth: 880, mx: 'auto', px: { xs: 2, md: 4 }, py: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>问答</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
          先在本应用里检索最相关的文章段落，再经 Work IQ 以你的身份交给{' '}
          {backend === 'agent'
            ? 'Copilot Studio agent「Mindforge Ask」（Standard harness，可选模型；资料里没有时会查公开网络并标明）'
            : 'Microsoft 365 Copilot，只根据这些段落作答'}
          ；[n] 与下方引用都能直接打开原文。
        </Typography>
        <ToggleButtonGroup size="small" exclusive value={backend} onChange={(_, v: Backend | null) => v && setBackend(v)} sx={{ mb: 2 }}>
          {(Object.keys(BACKENDS) as Backend[]).map((b) => <ToggleButton key={b} value={b} disabled={busy}>{BACKENDS[b]}</ToggleButton>)}
        </ToggleButtonGroup>
        {offHost && (
          <Alert severity="info" sx={{ mb: 2 }}>
            问答要通过平台 Connector 调用，需在 Managed App 中运行（线上或 <code>ms app dev</code>）。这里仍可试检索：提交后会列出检索到的资料。
          </Alert>
        )}
        {pinnedTitle && (
          <Alert severity="success" icon={false} sx={{ mb: 2 }}>
            围绕《{pinnedTitle}》提问：这篇固定作为第一条资料。<Link href="#/ask" sx={{ ml: 1 }}>改为全库检索</Link>
          </Alert>
        )}

        {messages.length === 0 && (
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
            {EXAMPLES.map((q) => <Chip key={q} label={q} onClick={() => setInput(q)} variant="outlined" />)}
          </Box>
        )}

        <Box sx={{ display: 'grid', gap: 2, mb: 2 }}>
          {messages.map((m, i) => (
            <Box key={i} sx={{ display: 'grid', gap: 1 }}>
              <Paper elevation={0} sx={{ justifySelf: 'end', maxWidth: '80%', px: 2, py: 1, bgcolor: 'primary.main', color: 'primary.contrastText', borderRadius: 3 }}>
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{m.question}</Typography>
              </Paper>
              <Paper variant="outlined" sx={{ px: 2.5, py: 1.5, borderRadius: 3 }}>
                {m.error && <Alert severity="error">{offHost ? '未在 Managed App 中运行，无法调用 Copilot。' : m.error}</Alert>}
                {!m.error && m.answer === undefined && (
                  <Box sx={{ py: 1 }}>
                    <LinearProgress sx={{ mb: 1 }} />
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {m.sources.length ? `已检索到 ${m.sources.length} 篇资料，等待 Copilot 回答…` : '检索中…'}
                      {slow && i === messages.length - 1 && ' 仍在处理，Copilot 通常需要 10–30 秒。'}
                    </Typography>
                  </Box>
                )}
                {m.answer !== undefined && (
                  <Box className="markdown-body" sx={{ fontSize: 15 }}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{linkCitations(m.answer, m.sources)}</ReactMarkdown>
                  </Box>
                )}
                {m.sources.length > 0 && (
                  <Box sx={{ mt: 1.5, pt: 1, borderTop: 1, borderColor: 'divider' }}>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {m.answer !== undefined && m.related?.length ? '引用' : '检索到的资料'}
                      {m.ms !== undefined && ` · ${(m.ms / 1000).toFixed(1)} 秒`} · {BACKENDS[m.backend]}
                    </Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 0.5 }}>
                      {m.sources.map((s) => {
                        const used = m.related?.includes(s.n);
                        return (
                          <Chip
                            key={s.n}
                            size="small"
                            component="a"
                            href={docHash(s.path)}
                            clickable
                            label={`${s.n}. ${s.title}`}
                            title={s.path}
                            color={used ? 'primary' : 'default'}
                            variant={used || !m.related?.length ? 'filled' : 'outlined'}
                            sx={{ maxWidth: '100%' }}
                          />
                        );
                      })}
                    </Box>
                  </Box>
                )}
              </Paper>
            </Box>
          ))}
          <div ref={endRef} />
        </Box>

        <Paper variant="outlined" sx={{ p: 1.5, display: 'flex', gap: 1, alignItems: 'flex-end', position: 'sticky', bottom: 0 }}>
          <TextField
            fullWidth
            multiline
            maxRows={6}
            size="small"
            placeholder="问知识库里的内容，Enter 发送，Shift+Enter 换行"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void ask(input);
              }
            }}
          />
          <Button variant="contained" disabled={busy || !input.trim() || !content} onClick={() => void ask(input)}>发送</Button>
          {messages.length > 0 && <Button disabled={busy} onClick={() => setMessages([])}>新对话</Button>}
        </Paper>
        <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.disabled' }}>
          回答由 AI 生成，可能有误；以引用的原文为准。
        </Typography>
      </Box>
    </Box>
  );
}
