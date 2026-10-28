import { AzureOpenAIService } from '../../generated/services/AzureOpenAIService';

// Azure OpenAI connector（shared_azureopenai），连接用 API Key 认证（keyBasedAuth）。
// Entra ID Integrated 在本环境创建连接时报 AADSTS50011（connector 的第一方应用没有登记回调地址），
// 而且资源在另一个租户，见 docs/04 阶段 6。部署不在连接里选，每次调用时传 deployment-id，问答页可下拉切换。
export const AOAI_RESOURCE = 'azure-open-ai-hu-sweden-centeral';
// 资源 azure-open-ai-hu-sweden-centeral 里的对话部署（realtime / image / embedding 部署不适用）。
// connector 没有"列出部署"的动作，新增部署时在这里补一行。
export const AOAI_DEPLOYMENTS = [
  'gpt-6.1-sol',
  'gpt-6.1-terra',
  'gpt-6-sol',
  'gpt-6-luna',
  'gpt-6-astra',
  'gpt-5.6-sol',
  'gpt-5.6-luna',
  'gpt-5.6-terra',
] as const;
export type AoaiDeployment = (typeof AOAI_DEPLOYMENTS)[number];
export const AOAI_DEFAULT: AoaiDeployment = 'gpt-6.1-terra';
const API_VERSION = '2024-10-21';

export interface AoaiAnswer {
  text: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
}

export async function askAzureOpenAI(prompt: string, deployment: AoaiDeployment = AOAI_DEFAULT): Promise<AoaiAnswer> {
  const res = await AzureOpenAIService.ChatCompletions_Create_2024Feb15Preview(
    { messages: [{ role: 'user', content: prompt }] },
    deployment,
    API_VERSION,
  );
  if (!res.success) {
    const err = res.error as unknown;
    throw new Error(err instanceof Error ? err.message : JSON.stringify(err).slice(0, 500));
  }
  const choice = res.data.choices?.[0];
  const text = choice?.message?.content;
  if (!text) throw new Error(`Azure OpenAI 返回了空回答（finish_reason: ${choice?.finish_reason ?? '未知'}）`);
  return {
    text,
    model: res.data.model,
    promptTokens: res.data.usage?.prompt_tokens,
    completionTokens: res.data.usage?.completion_tokens,
  };
}
