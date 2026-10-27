import { askCopilot } from './copilot';

// Copilot Studio Standard harness agent "Mindforge Ask"（mf_MindforgeAsk，解决方案 Mindforge）。
// Copilot Studio Connector 的 ExecuteCopilotAsyncV2 要求回调地址（notificationUrl），managed app 收不到回调；
// 这个 agent 同时发布到了 Microsoft 365 Copilot，所以经 Work IQ copilot_chat 的 agentId 调它。
export const AGENT_ID = 'T_c7f66753-0f26-f573-96fc-f7e374b762a3';

export function askAgent(message: string): Promise<string> {
  return askCopilot(message, AGENT_ID);
}
