import type { Source } from './retrieve';

// 提示词结构参考 CSU Investment Insights 的 Ask Copilot（docs/10）：限定只用给出的资料，
// 约定最后一行 RELATED: 输出所用资料的编号，由应用解析成应用内链接。

export interface Turn {
  question: string;
  answer: string;
}

const HISTORY_TURNS = 2;
const HISTORY_CHARS = 400;

/** allowWeb：Copilot Studio agent 开着 Web Search，资料里没有时可以查公开网络；Work IQ 没有这个开关 */
export function buildPrompt(question: string, sources: Source[], history: Turn[], allowWeb = false): string {
  const parts = [
    'You are the help assistant inside Mindforge, a personal knowledge base about AI engineering, Azure and developer tools.',
    ...(allowWeb
      ? [
          'Answer from the SOURCES below first. Only if they do not contain the answer, search the public web,',
          'start the answer with the line "知识库里没有相关内容，以下来自公开网络：" and cite the web pages; never present web facts as [n].',
        ]
      : [
          'Answer ONLY from the SOURCES below. Do not search files, mail, chats or the web, and do not use other knowledge.',
          'If the SOURCES do not contain the answer, say so plainly (in Chinese: 知识库里没有相关内容) and suggest what to look for instead.',
        ]),
    'Rules: answer in the language of the question; at most 300 Chinese characters or 200 English words; Markdown lists and bold are fine, no tables;',
    'cite sources inline as [n] using the source numbers; keep product names, commands and code identifiers exactly as written in the sources.',
    'End with one last line exactly like: RELATED: 1, 3   (the numbers of the sources you used; RELATED: none if you used none).',
    '',
    'SOURCES',
    ...sources.map((s) => `[${s.n}] ${s.title} (${s.path})\n${s.excerpt}\n`),
  ];
  const recent = history.slice(-HISTORY_TURNS);
  if (recent.length) {
    parts.push('EARLIER IN THIS CONVERSATION');
    for (const t of recent) parts.push(`Q: ${t.question}`, `A: ${t.answer.slice(0, HISTORY_CHARS)}`, '');
  }
  parts.push('QUESTION', question);
  return parts.join('\n');
}

export interface ParsedAnswer {
  text: string;
  related: number[];
}

/** 去掉 RELATED 行，取出编号；模型没守约时 related 为空，界面仍列出检索到的全部资料 */
export function parseAnswer(raw: string, sourceCount: number): ParsedAnswer {
  const lines = raw.trimEnd().split('\n');
  const i = lines.findLastIndex((l) => /^\s*\**RELATED\**\s*[:：]/i.test(l));
  if (i < 0) return { text: raw.trim(), related: [] };
  const nums = (lines[i].match(/\d+/g) ?? []).map(Number).filter((n) => n >= 1 && n <= sourceCount);
  lines.splice(i, 1);
  return { text: lines.join('\n').trim(), related: [...new Set(nums)] };
}
