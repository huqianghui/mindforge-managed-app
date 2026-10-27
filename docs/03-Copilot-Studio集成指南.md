# 03 Copilot Studio 集成指南

> 对应路线图第 5 阶段 "Ask Copilot"。依据：Copilot Studio Connector 官方参考（<https://learn.microsoft.com/en-us/connectors/microsoftcopilotstudio/>，2026-07-11 版）与本租户 `ms connector list-actions` 结果。
> **现状**：阶段 5 已先用 Work IQ Copilot MCP + 本地检索实现（不需要建 agent，见 [04 · 阶段 5](04-新功能开发指南.md#阶段-5ask-copilotwork-iq--本地检索)）。本文是接入 Copilot Studio agent 这第二种后端的指南。
> 标 **〔待实测〕** 的地方是文档没写清楚、需要在租户里跑一次才能确认的行为。

## 整体链路

```text
┌──────────────── Managed App（本项目，浏览器里的 SPA） ────────────────┐
│  AskPage.tsx                                                         │
│    └─ 生成的 MicrosoftCopilotStudioService.ExecuteCopilotAsyncV2()   │
│         └─ getClient(dataSources).executeAsync({ connectorOperation })│
└───────────────────────────────┬──────────────────────────────────────┘
                                │ JSON-RPC 交给宿主
                                ▼
          Managed Runtime 宿主  ── 用"当前用户自己的连接"调 Connector
                                │
                                ▼
          Copilot Studio Connector (shared_microsoftcopilotstudio)
                                │
                                ▼
          Copilot Studio agent  ── 知识源：mindforge 文章
                                │  生成式回答（含引用）
                                ▼
          { lastResponse, responses[], conversationId }
```

两个开发面：

| 面 | 在哪做 | 产出 |
|---|---|---|
| Agent | Copilot Studio（<https://copilotstudio.microsoft.com>），**与应用同一个环境** `0b768ed1-...` | 一个已发布的 agent |
| 应用 | 本仓库 | 一个问答页 + 生成的 Connector 代码 |

## 第一步：在 Copilot Studio 建 agent

### 1. 建 agent

- **必须选 Standard harness。** Copilot Studio Connector 的 `ExecuteCopilotAsyncV2` 只能调用 Standard harness 的 agent；2026-08 起新建 agent 默认是 GitHub Copilot harness，调用它只会拿到空的或占位的回复，且 harness 创建后不能互转。详见 [05 Harness 对比](05-Copilot-Studio-Harness对比.md#三能从-managed-app-调用哪个这一节决定方案)。
- 环境选和应用相同的环境（不同环境也能调，`ExecuteCopilot` 有可选的 `environmentId` 参数，但同环境最省事）。
- 指令（Instructions）建议写清三件事：只根据知识源回答；回答用中文；找不到就明确说"知识库里没有"，不要编。
- 关掉"使用通用知识"（General knowledge / Web search），否则无法判断回答是否来自 mindforge。

### 2. 加知识源

mindforge 是公开 GitHub 仓库，可选做法：

| 做法 | 优点 | 缺点 |
|---|---|---|
| **公开网站**：填 GitHub Pages 地址 `https://huqianghui.github.io/mindforge/` | 零维护，内容随站点更新 | 依赖 Bing 索引，新文章出现有延迟；只能填有限个 URL 前缀 |
| **上传文件**：把 `public/content/d/*.md` 或原始 Markdown 上传 | 精确可控，离线可测 | 需要手动或脚本重传；文件名是哈希，引用里不好看——上传原始文件名的版本 |
| **SharePoint**：把文章同步到一个文档库再挂进去 | 企业场景最常见，权限跟随 SharePoint | 多一套同步；对这个学习项目偏重 |

学习目的建议：**先用上传文件走通**（可控、可复现），再换成公开网站对比回答质量和新鲜度。

### 3. 测试并发布

- 在 Copilot Studio 的测试面板里问几个能在文章里找到答案的问题，确认回答带引用。
- **发布（Publish）**。Connector 调用的是已发布版本 〔待实测：未发布的草稿是否可调〕。
- 认证选 "Authenticate with Microsoft"（Entra），这样 Connector 调用时就是当前用户身份。
- 记下 agent 的 **schema name**（形如 `cr123_mindforgeAsk`），Connector 的 `Copilot` 参数要用它 〔待实测：参数接受 schema name 还是 bot id，生成代码里会有说明〕。

## 第二步：在应用里接 Connector

```bash
npm i @microsoft/managed-apps
ms connector list-actions --connector shared_microsoftcopilotstudio   # 确认动作未被策略阻止
ms app add data-source --connector shared_microsoftcopilotstudio --as action --use-sso
```

执行后会改 `ms.config.json`（加 `connectionReferences`）并生成 TypeScript。**先 `git status` 看清它生成了哪些文件、放在哪里**，再决定 import 路径；下文用 `src/generated/...` 代称。

### 动作选择

| 动作 | 返回 | 适用 |
|---|---|---|
| `ExecuteCopilot` | 只有 `ConversationId` | 异步场景（配合 Power Automate 回调），**前端问答用不上** |
| `ExecuteCopilotAsyncV2` | `lastResponse: string`、`responses: string[]`、`conversationId: string` | **问答页用这个** |

`ExecuteCopilotAsyncV2` 的参数：

| key | 必填 | 说明 |
|---|---|---|
| `Copilot` | 是 | agent 标识（路径参数） |
| `message` | 否 | 用户问题 |
| `x-ms-conversation-id` | 否 | 传上一轮的 `conversationId` 实现多轮对话 |
| `locale` | 否 | BCP-47，例如 `zh-CN` |
| `environmentId` | 否 | agent 不在本环境时填 |

### 调用骨架

生成的 Service 名称和参数结构以实际生成结果为准，下面是形状：

```ts
// src/ask/askAgent.ts
import { MicrosoftCopilotStudioService } from '../generated/services/MicrosoftCopilotStudioService';

const AGENT = 'cr123_mindforgeAsk';   // 第一步记下的 schema name

export interface AgentReply {
  text: string;
  all: string[];
  conversationId: string;
}

export async function askAgent(message: string, conversationId?: string): Promise<AgentReply> {
  const res = await MicrosoftCopilotStudioService.ExecuteCopilotAsyncV2(AGENT, {
    message,
    locale: 'zh-CN',
    'x-ms-conversation-id': conversationId,
  });
  // SDK 不抛异常，失败只体现在 success 上
  if (!res.success) throw res.error ?? new Error('Copilot Studio 调用失败');
  return { text: res.data.lastResponse, all: res.data.responses, conversationId: res.data.conversationId };
}
```

## 引用：路线图要调整的地方

路线图写的是"展示带引用的回答"。但 `ExecuteCopilotAsyncV2` 的返回里**只有字符串**，没有结构化的 citation 字段。所以引用只能从文本里解析：

1. 先实测 `lastResponse` 的原始样子 〔待实测〕。Copilot Studio 生成式回答在其他渠道里通常是正文带 `[1]` 这类标记、末尾附来源链接或标题的 Markdown。
2. 写一个 `parseCitations(text)`，把来源标题或 URL 抽出来。
3. 用本项目已有的 manifest 把来源映射回应用内文章：
   - 来源是 GitHub Pages 或 GitHub 的 URL → 去掉前缀得到仓库路径 → `index.byPath`；
   - 来源是上传文件名 → 去掉扩展名 → `index.byStem`；
   - 来源是标题 → 在 `index.docs` 里按 `title` 匹配。
4. 渲染成 `docHash(path)` 链接，点击直接在应用里打开原文。**这一步是 Managed App 相对 Copilot Studio 自带聊天窗口的增值点**：回答和原文在同一个应用里闭环。

如果实测发现文本里根本没有来源信息，备选方案：

- 在 agent 指令里要求"回答末尾以 `来源：<文章路径>` 列出依据"——简单，但依赖模型遵守；
- 或者把引用这件事放到第 6 阶段的 Azure OpenAI 方案里做（检索由前端控制，引用天然是结构化的）。这正好是两种方案取舍的对比点。

## 身份、权限与费用

| 点 | 结论 | 影响 |
|---|---|---|
| 连接身份 | Copilot Studio Connector 只支持 Entra OAuth，且**连接不可共享** | 每个用户第一次用问答页都会被宿主提示创建自己的连接。agent 以该用户身份访问知识源 |
| 用户需要什么 | 能打开应用（play 权限）+ 能使用 agent（agent 的分享 / 认证设置） | 只分享应用、不分享 agent，问答会失败。分享时两边都要做 |
| DLP | Copilot Studio Connector 目前在本租户为 Allow | 租户策略变更会让问答页失效，页面上要有可读的错误提示 |
| 限流 | 每个连接 300 次 / 60 秒 | 个人使用不会触发；不要做"输入即发请求"的联想 |
| 费用 | 应用侧按 Managed Runtime 的许可或 Copilot Credits；agent 侧按 Copilot Studio 消息计费 | 两笔账，做演示前确认租户的容量 |
| 延迟 | "and wait" 是同步等待生成完成 | 要有明显的加载态；考虑超时提示 〔待实测：Connector 侧的超时上限〕 |

## 用评测动作做质量回归（可选加分项）

Connector 还暴露了 agent 评测：`GetAgentMakerEvaluationTestSets`、`RunAgentMakerEvaluationTestSet`、`GetAgentMakerEvaluationTestRuns`、`GetAgentMakerEvaluationTestRunDetails`。可以在应用里加一个"评测"子页：

1. 在 Copilot Studio 里为 agent 建一个测试集（例如 20 个能在 mindforge 找到答案的问题）。
2. 页面列出测试集，一键触发评测，轮询 `RunStatusResponse.state`。
3. 展示每题的 `metricsResults` 和 `aiResultReason`。

这让"换知识源 / 改指令后，回答是变好还是变差"变成可量化的事，也是学习 Copilot Studio 很好的切入点。

## 验收清单

- [ ] agent 是 Standard harness，已在同一环境发布，测试面板里回答带引用
- [ ] `ms connector list-actions` 显示 `ExecuteCopilotAsyncV2` 为 Allow
- [ ] `ms app add data-source` 后，`ms.config.json` 与生成代码都已检查并提交
- [ ] `ms app dev` 下能问答；`npm run dev` 下问答页显示"需在宿主中运行"而不是白屏
- [ ] 多轮对话：第二问能引用第一问的上下文（`conversationId` 生效）
- [ ] 至少一条引用能跳到应用内原文
- [ ] 用另一个账号（只有 play 权限）验证首次连接提示与失败提示
