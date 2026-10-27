import { WorkIQCopilotMCPService as WorkIQ } from '../../generated/services/WorkIQCopilotMCPService';

// Work IQ Copilot MCP（shared_a365copilotchatmcp）：以当前用户身份调 Microsoft 365 Copilot。
// 请求体是 MCP 的 JSON-RPC tools/call，工具名 copilot_chat；返回 result.content[] 里的文本片段。

interface RpcResponse {
  id?: string;
  result?: { content?: { type?: string; text?: string }[]; isError?: boolean };
  error?: { code?: number; message?: string };
}

// 连接器可能原样返回 JSON，也可能是 SSE（event: message / data: {...}）
function toRpc(data: unknown): RpcResponse {
  if (typeof data !== 'string') return (data ?? {}) as RpcResponse;
  const events = data.split('\n').filter((l) => l.startsWith('data:'));
  return JSON.parse(events.length ? events.at(-1)!.slice(5) : data) as RpcResponse;
}

interface Conversation {
  messages?: { text?: string }[];
}

// copilot_chat 的文本是一层 JSON：{ conversationId, reply, rawResponse, message }，末尾再跟一行
// "CorrelationId: …, TimeStamp: …"。reply 实测为空；rawResponse 是 Graph copilotConversation 的 JSON 字符串，
// messages[0] 是我们发的提示词，最后一条才是回答。解析不了时退回原文。
function answerOf(text: string, prompt: string): string {
  const body = text.replace(/\s*CorrelationId:[^\n]*$/, '').trim();
  try {
    const outer = JSON.parse(body) as { reply?: string; rawResponse?: string | Conversation };
    if (outer.reply?.trim()) return outer.reply;
    const conv: Conversation = typeof outer.rawResponse === 'string' ? JSON.parse(outer.rawResponse) : outer.rawResponse ?? {};
    const answer = (conv.messages ?? []).findLast((m) => typeof m.text === 'string' && m.text.trim() !== prompt.trim());
    if (answer?.text) return answer.text;
  } catch {
    // 不是 JSON：工具直接返回了回答文本
  }
  return body;
}

export async function askCopilot(message: string): Promise<string> {
  const id = crypto.randomUUID();
  const res = await WorkIQ.mcp_m365copilot(undefined, {
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name: 'copilot_chat', arguments: { message } },
  });
  // SDK 不抛异常，失败体现在 success 上
  if (!res.success) throw res.error ?? new Error('Work IQ Copilot 调用失败');
  const rpc = toRpc(res.data);
  if (rpc.error) throw new Error(`Work IQ Copilot：${rpc.error.message ?? rpc.error.code}`);
  const text = (rpc.result?.content ?? []).filter((c) => c.text).map((c) => c.text).join('\n');
  if (rpc.result?.isError) throw new Error(`Work IQ Copilot：${text || '工具返回错误'}`);
  if (!text) throw new Error('Work IQ Copilot 返回了空回答');
  return answerOf(text, message);
}
