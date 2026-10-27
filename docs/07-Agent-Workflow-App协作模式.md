# 07 Agent、Workflow、App 协作模式

> 学习系列第 3 篇。问题：Copilot Studio 里 agent 能调 agent、workflow 能编排 agent，**app 怎么和它们互动？**
> 资料截至 2026-10-27。〔官方〕= Microsoft Learn / 官方博客 / Microsoft Mechanics 演示；〔实测〕= 本项目抓包与 `ms connector list-actions`；〔第三方〕= 社区视频与文章。

## 一句话

**app 和 agent、workflow 之间最主要的协作方式不是"互相调用"，而是"共享同一份数据"。** agent 和 workflow 在后台把结果写进 Dataverse（或 SharePoint 等），app 读出来给人看、让人做决定，人的决定再写回数据，触发下一步 workflow。app 直接同步调用 agent 也可以，但只有少数几条路，且有限制。

## 一、三者各自的定位

| | Agent | Workflow | App |
|---|---|---|---|
| 是什么 | 会推理的 AI 助手 | 确定的多步自动化：触发器 + 动作 | 有界面的网页应用（跑在 Copilot Managed Runtime） |
| 擅长 | 理解自然语言、处理例外、做判断 | 按固定路径执行，可靠、可重复、可审计 | 给人一个**专门的屏幕**：浏览、筛选、对比、审批、录入 |
| 谁来驱动 | 用户对话，或事件触发 | 事件、定时、手动、agent 调用 | 用户点击 |
| 状态 | 对话上下文 / 记忆 | 每次运行的变量 | 页面状态 + 数据源 |

官方的说法〔官方〕：一个入职方案可以"用 app 给经理和员工一个结构化界面，用 workflow 执行可重复的入职步骤，用 agent 回答问题、处理例外"。

## 二、调用关系全图

```text
                 ┌──────────── 同步调用（实线）────────────┐
   Agent ──调用──▶ Agent              （connected agents / 子 agent）
   Agent ──调用──▶ Workflow           （workflow 作为 agent 的工具，
                                         触发器 "When an agent calls the flow"）
   Workflow ─调用─▶ Agent             （workflow 的 agent 节点）
   Workflow ─调用─▶ M365 Copilot       （Copilot 节点：Copilot Chat、Cowork 任务、
                                         Researcher / Analyst、Agent Builder agent）
   App ────调用──▶ Standard Agent     （Copilot Studio Connector：ExecuteCopilotAsyncV2）
   App ────调用──▶ M365 Copilot？      （Work IQ Copilot MCP Connector〔待实测〕；
                                         宿主 cowork/* 通道〔实验性〕）

                 ┌──────────── 共享数据（虚线，官方主推）───────────┐
   Workflow / Agent ──写──▶  Dataverse 表  ◀──读 / 写── App
                                  │
                                  └── 行新增 / 修改 ──▶ 触发 Workflow
```

注意 **app 这一列只有"被人点"和"读写数据、调 Connector"两种能力**，没有"被 agent 或 workflow 调用"的入口——app 是给人用的界面，不是服务。

## 三、模式 A：共享数据（官方演示的做法）

### 3.1 官方演示：多供应商投标评审〔官方，Microsoft Mechanics，2026-09〕

```text
① 供应商邮件到达 ──触发──▶ Workflow
② Workflow 分类投标，依次交给几个 agent（GitHub Copilot harness）
③ 最后一个 agent 汇总前面的结果、给出推荐，
   并把结果"作为新的一行写进 Dataverse"
④ 需要人工判断的，Workflow 暂停等待人工审核
⑤ App（"Bid Management App"，直接绑定这张 Dataverse 表）
   让采购团队筛选需要人工审核的投标、做出批准决定
```

原文要点："It then creates a record as a new row in Dataverse, our backend data source for the process"；app 是 "connected to your Dataverse table, or to sources like SharePoint through connectors"，团队在 app 里 "filter, review, and approve every bid from one shared view"。

另一个社区演示〔第三方，Reza Dorrani，2026-10〕：用 Copilot Studio 生成一个软件权限申请 app，绑定 Dataverse 的申请表和软件目录表；审批则另建一个 workflow 完成。

### 3.2 为什么这是主推方式

| 好处 | 说明 |
|---|---|
| **绕开所有 harness 限制** | app 从不直接调 agent，所以 agent 用 GitHub Copilot harness 也没关系——这正好解决了 [05](05-Copilot-Studio-Harness对比.md) 里"Connector 调不了 GitHub Copilot harness"的问题 |
| 异步，不怕慢 | agent 跑几分钟、几十分钟都行，不受 Connector 约 120 秒超时的限制；用户打开 app 时看到的是已经算好的结果 |
| 可审计 | 每一步的结果都是表里的一行，有时间、有状态、有负责人 |
| 人在回路 | app 是人做决定的地方，决定写回数据，workflow 继续往下走 |
| 权限清楚 | app 读写数据用的是**当前用户自己的权限**〔官方，Apps overview〕；agent 和 workflow 用各自的连接身份 |

### 3.3 典型的数据流

```text
                    后台（无人值守）                         前台（有人操作）
 ┌────────────┐   ┌────────────┐   写   ┌───────────┐   读   ┌─────────┐
 │ 触发器      │──▶│ Workflow   │──────▶│ Dataverse │◀──────│  App    │
 │ 邮件/定时/  │   │  └ Agent   │       │  表       │──────▶│  人审批  │
 │ 数据变化    │   └────────────┘       └───────────┘   写   └─────────┘
 └────────────┘          ▲                   │
                         └── 行被修改（例如状态改成"已批准"）触发下一个 Workflow
```

关键是表里要有**状态列**（例如 `待处理 / 待人工审核 / 已批准 / 已驳回`），它就是 agent、workflow、app 三方之间的"契约"。

## 四、模式 B：app 同步调用 agent

用户在 app 里提问、当场要答案的场景（例如 Ask Copilot），共享数据太慢，需要直接调用：

| 路径 | 可用性 | 限制 |
|---|---|---|
| Copilot Studio Connector `ExecuteCopilotAsyncV2` → Standard agent | ✅ 官方支持〔官方〕 | 只支持 **Standard harness**；一次性返回纯文本，无流式；连接不可共享，每个用户自己建连接 |
| 同一 Connector → GitHub Copilot harness agent | ❌〔官方确认的已知限制〕 | 见 [06](06-托管位置与连接链路.md#42-为什么-github-copilot-harness-接不上) |
| Work IQ Copilot MCP Connector（`shared_a365copilotchatmcp`，动作 `mcp_m365copilot`）→ M365 Copilot | 本租户可见、未被策略阻止〔实测〕；能否从 app 调用、返回什么〔待实测〕 | Work IQ API 单独按量计费 |
| 宿主 `cowork/streamPrompt` → Cowork | 宿主已实现，流式〔实测〕 | **实验性**，默认关闭，需手工配置 token，SDK 未封装 |
| iframe 嵌入 agent 网页聊天 | ❌ | CSP `frame-src 'self'` 禁止〔实测〕 |

## 五、模式 C：app 触发 workflow

**我没有找到官方文档描述"app 里的按钮直接调用一个 Copilot Studio workflow"的方式。** workflow 的触发器类型是：手动、定时、事件（含数据变化）、被 agent 调用〔官方，Workflows overview〕。所以 app 触发 workflow 的现实做法是：

1. **改数据触发（推荐）**：app 新增或修改 Dataverse 的一行 → workflow 的"行新增 / 修改"触发器启动。这就是模式 A 的回路。
2. **经 agent 中转**：app 调一个 Standard agent，agent 把 workflow 当工具调用（受模式 B 的限制）。

## 六、按场景选模式

| 场景 | 推荐 | 理由 |
|---|---|---|
| 审批、工单、评审 | A 共享数据 | 异步、可审计、人在回路 |
| 报表、看板、洞察 | A 共享数据，或构建期预计算 | 结果可以提前算好 |
| 定期分析、生成报告文件 | A：GitHub Copilot harness agent 定时跑，结果写表，文件放 SharePoint | 重活放后台，不受超时和 harness 调用限制 |
| 当场问答（Ask Copilot） | B：Standard agent，或 M365 Copilot（待实测） | 需要即时回答 |
| 术语解释（Glossary） | 静态数据为主，必要时 B | 大部分术语可以预先写好 |

## 七、对本项目的启发

之前的路线图第 5 阶段只想到"app 同步调用 agent"（模式 B）。模式 A 打开了另一种可能，而且**这类能力 GitHub Pages 做不到**：

| 想法 | 怎么做 | 用到的模式 |
|---|---|---|
| 每周知识体检 | GitHub Copilot harness agent 定时读 mindforge 的 stale Claim，逐条判断是否仍成立，结果写进 Dataverse 表；app 的"建议卡片"页读这张表展示，用户点"确认 / 驳回"写回 | A |
| 阅读与收藏 | app 直接读写 Dataverse（第 4 阶段原计划） | A 的简化版 |
| Ask Copilot | Standard agent，知识源是 mindforge 文章 | B |

这些放到系列最后的方案讨论里，和成本一起权衡。

## 参考资料

- 〔官方〕Copilot Studio overview（agents、workflows、agent flows、apps 的关系）：<https://learn.microsoft.com/en-us/microsoft-copilot-studio/fundamentals-what-is-copilot-studio>
- 〔官方〕Apps overview (preview)：<https://learn.microsoft.com/en-us/microsoft-copilot-studio/apps-experience/apps-overview>
- 〔官方〕Workflows overview：<https://learn.microsoft.com/en-us/microsoft-copilot-studio/workflows-experience/flows-overview>
- 〔官方〕Build apps, workflows, and agents together（2026-09）：<https://www.microsoft.com/en-us/copilot/blog/copilot-studio/new-and-improved-build-apps-extend-agents-and-transform-business-processes-in-microsoft-copilot-studio>
- 〔官方〕Microsoft Mechanics：Build Automated Agents, Workflows, and Apps：<https://techcommunity.microsoft.com/blog/microsoftmechanicsblog/build-automated-agents-workflows-and-apps---new-in-copilot-studio/4562164>
- 〔官方〕What's new in Copilot Studio（workflow 的 Copilot 节点）：<https://learn.microsoft.com/en-us/microsoft-copilot-studio/whats-new>
- 〔第三方〕Reza Dorrani，Microsoft Copilot Studio Can Build Apps Now!（2026-10-12）：<https://www.youtube.com/watch?v=ClcdJt3U-SY>
