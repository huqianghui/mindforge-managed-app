import type { WikiClaim, WikiNode } from '../../types';

// 方案助手的检索与提示词：只用决策页和与微软三支柱、语音相关的页里的 Claim，
// 每条带状态、置信度、证据类型、复核日期，让模型只能引用这些依据，并把依据薄弱的单列出来。

/** 第一版的范围：微软三支柱 + 语音。超出范围的场景如实说库里依据不足 */
const SCOPE_DECISIONS = new Set([
  'microsoft-ai-pillars-selection',
  'voice-agent-build-approach',
  'foundry-agent-type-selection',
  'copilot-studio-harness-selection',
  'cascaded-vs-e2e-voice',
]);
const SCOPE_CATEGORIES = new Set(['Azure 与云平台', '语音与实时交互']);
const SCOPE_EXTRA = new Set(['voice-cascaded-pipeline', 'weak-network-adaptive-degradation', 'agent-infra-three-layers', 'agent-sandbox']);
const MAX_CONCEPT_CLAIMS = 60;

export interface CitedClaim {
  cid: string;
  node: WikiNode;
  claim: WikiClaim;
}

export interface PlanLayer {
  layer: string;
  recommendation: string;
  why: string;
  cites: string[];
}

export interface PlanResult {
  in_scope: boolean;
  summary: string;
  layers: PlanLayer[];
  verify_first: { cite: string; reason: string }[];
  ask_customer: string[];
  risks: string[];
  /** 生成时引用到的 Claim 快照，存档后即使 wiki 变了也能看到当时的依据 */
  claims: Record<string, { node: string; type: string; title: string; statement: string; confidence: number; status: string; evidenceType?: string; review?: string }>;
}

const reviewDate = (c: WikiClaim) => c.review?.match(/\d{4}-\d{2}-\d{2}/)?.[0];

/** 依据是否薄弱：stale / conflicting / outdated、复核待定、置信度 < 0.6 */
export function weak(c: { status: string; confidence: number; review?: string }): string | null {
  if (c.status !== 'active') return `状态 ${c.status}`;
  if (c.review?.includes('待定')) return '上次复核待定';
  if (c.confidence > 0 && c.confidence < 0.6) return `置信度 ${c.confidence}`;
  return null;
}

function terms(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z0-9][a-z0-9.+-]+/g) ?? [];
  const han = text.replace(/[^一-鿿]/g, '');
  const bigrams: string[] = [];
  for (let i = 0; i < han.length - 1; i++) bigrams.push(han.slice(i, i + 2));
  return [...new Set([...words, ...bigrams])];
}

export function selectClaims(nodes: WikiNode[], scenario: string): CitedClaim[] {
  const q = terms(scenario);
  const out: CitedClaim[] = [];
  const concepts: { node: WikiNode; claim: WikiClaim; score: number }[] = [];
  for (const node of nodes) {
    const inDecision = node.type === 'decision' && SCOPE_DECISIONS.has(node.id);
    const inScope = inDecision || SCOPE_CATEGORIES.has(node.category) || SCOPE_EXTRA.has(node.id);
    if (!inScope) continue;
    for (const claim of node.claims) {
      if (claim.status === 'outdated') continue;
      if (inDecision) {
        out.push({ cid: '', node, claim });
      } else {
        const text = `${claim.statement} ${claim.evidence ?? ''}`.toLowerCase();
        const score = q.reduce((s, t) => s + (text.includes(t) ? 1 : 0), 0);
        concepts.push({ node, claim, score });
      }
    }
  }
  concepts.sort((a, b) => b.score - a.score);
  for (const c of concepts.slice(0, MAX_CONCEPT_CLAIMS)) out.push({ cid: '', node: c.node, claim: c.claim });
  return out.map((c, i) => ({ ...c, cid: `c${i + 1}` }));
}

export function buildPlanPrompt(scenario: string, claims: CitedClaim[]): string {
  const lines = claims.map(({ cid, node, claim }) => {
    const meta = [`置信度 ${claim.confidence}`, `状态 ${claim.status}`, claim.evidence_type && `证据类型 ${claim.evidence_type}`, reviewDate(claim) && `复核 ${reviewDate(claim)}${claim.review?.includes('待定') ? ' 待定' : ''}`]
      .filter(Boolean)
      .join('，');
    const ev = (claim.evidence ?? '').replace(/\s+/g, ' ').slice(0, 280);
    return `[${cid}]（${node.type === 'decision' ? '决策页' : '概念页'}《${node.title}》；${meta}）${claim.statement}——${ev}`;
  });
  return [
    '你是微软 AI 方案顾问的助手。下面是一个客户场景和一组知识库里的论断（Claim）。请只根据这些论断给出方案，不要使用论断以外的知识；论断不够支撑时如实说明。',
    '',
    '输出严格的 JSON（不要 Markdown 代码块），结构：',
    '{"in_scope": true|false, "summary": "一句话方案", "layers": [{"layer": "入口|大脑|语音|治理|集成|成本 中的一个", "recommendation": "推荐用什么、怎么用", "why": "理由，说到客户场景的哪一点", "cites": ["c3", "c12"]}], "verify_first": [{"cite": "c7", "reason": "为什么要先核实"}], "ask_customer": ["需要向客户确认的问题"], "risks": ["风险或一票否决项"]}',
    '',
    '要求：',
    '- 按"入口 → 大脑 → 语音 → 治理"的顺序给层，没有涉及的层可以省略；每层至少引用一条论断',
    '- verify_first 列出你依赖的、但状态不是 active、复核待定或置信度低于 0.6 的论断，以及涉及预览功能、数字、地域的论断',
    '- ask_customer 列出场景里没说清、但会改变方案的问题（如是否需要逐轮控制、数据驻留、用户是否匿名）',
    '- 场景明显超出微软三支柱与语音的范围时，in_scope 设为 false，summary 说明库里缺哪方面的依据，layers 可以为空',
    '- 全部用中文，简洁，不写客套话',
    '',
    `客户场景：${scenario}`,
    '',
    '论断：',
    ...lines,
  ].join('\n');
}

export function parsePlan(raw: string, claims: CitedClaim[]): PlanResult {
  const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
  const data = JSON.parse(json) as Partial<PlanResult>;
  const byId = new Map(claims.map((c) => [c.cid, c]));
  const used = new Set<string>();
  const layers = (data.layers ?? []).map((l) => ({ ...l, cites: (l.cites ?? []).filter((c) => byId.has(c)) }));
  for (const l of layers) for (const c of l.cites) used.add(c);
  const verify = (data.verify_first ?? []).filter((v) => byId.has(v.cite));
  for (const v of verify) used.add(v.cite);
  // 模型漏掉的薄弱依据补进"先核实"：引用了就要看得见它的状态
  for (const cid of used) {
    const c = byId.get(cid)!;
    const why = weak({ ...c.claim, review: c.claim.review });
    if (why && !verify.some((v) => v.cite === cid)) verify.push({ cite: cid, reason: why });
  }
  const snap: PlanResult['claims'] = {};
  for (const cid of used) {
    const { node, claim } = byId.get(cid)!;
    snap[cid] = {
      node: node.id, type: node.type, title: node.title, statement: claim.statement, confidence: claim.confidence,
      status: claim.status, evidenceType: claim.evidence_type, review: claim.review,
    };
  }
  return {
    in_scope: data.in_scope !== false,
    summary: data.summary ?? '',
    layers,
    verify_first: verify,
    ask_customer: data.ask_customer ?? [],
    risks: data.risks ?? [],
    claims: snap,
  };
}

export const nodeDocPath = (id: string, type: string) => `wiki/${type === 'decision' ? 'decisions' : type === 'method' ? 'methods' : 'concepts'}/${id}.md`;
