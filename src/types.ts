export interface WikiClaim {
  statement: string;
  confidence: number;
  status: string;
  source: string;
  first_seen: string;
  last_updated: string;
  evidence?: string;
  /** 产品与服务 / 实测经验 / 理论（长效），复核后才有 */
  evidence_type?: string;
  /** 最近一次复核行，如 "2026-11-07 确认——依据：…" */
  review?: string;
}

export interface WikiNode {
  id: string;
  type: 'concept' | 'method' | 'decision';
  title: string;
  summary: string;
  tags: string[];
  category: string;
  method_type?: string | null;
  decision_status?: string | null;
  claims_count: number;
  avg_confidence: number;
  claims: WikiClaim[];
}

export interface WikiLink {
  source: string;
  target: string;
  relation_type: string;
  description: string;
}

export interface WikiCategory {
  id: string;
  name: string;
  members: string[];
}

export interface WikiGraphStats {
  nodes: number;
  links: number;
  claims: number;
  categories: number;
}

export interface WikiGraph {
  generated_at: string;
  stats: WikiGraphStats;
  nodes: WikiNode[];
  links: WikiLink[];
  categories: WikiCategory[];
}

export interface GraphNode extends WikiNode {
  color: string;
  val: number;
}

export interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  relation_type: string;
  description: string;
  color: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}
