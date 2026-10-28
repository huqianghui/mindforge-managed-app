import { askCopilot } from './copilot';

// Copilot Studio Standard harness agent "Mindforge Ask"（mf_MindforgeAsk，解决方案 Mindforge）。
// Copilot Studio Connector 的 ExecuteCopilotAsyncV2 要求回调地址（notificationUrl），managed app 收不到回调；
// 这个 agent 同时发布到了 Microsoft 365 Copilot，于是改经 Work IQ copilot_chat 传 agentId。
// 2026-10-28 复测：agentId 只被原样回显，回答仍来自 M365 Copilot 本体，agent 的指令没有生效（docs/03 实测 §5）。
export const AGENT_ID = 'T_c7f66753-0f26-f573-96fc-f7e374b762a3';

export function askAgent(message: string): Promise<string> {
  return askCopilot(message, AGENT_ID);
}
