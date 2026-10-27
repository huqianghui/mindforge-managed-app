# 08 Connector 全景

> 学习系列第 4 篇。回答：Connector 是什么、managed app 和 Copilot Studio 各自怎么用它、本租户能用哪些、参考应用用了哪些。
> 资料截至 2026-10-27。〔实测〕= 本机 `ms` CLI 0.31.0、本应用抓包、参考应用的连接同意框；〔官方〕= Microsoft Learn；〔第三方〕= 社区资料。

## 一句话

**Connector 是 Power Platform 给第三方 API 套的一层"标准外壳"**：统一的描述（swagger）、统一的认证、统一的治理（DLP）、统一的运行时（API Hub）。managed app、Copilot Studio agent、workflow 用的是**同一个 Connector 目录**，区别在于"谁的身份去调"和"以什么形式调"。

对 managed app 来说，它还多一层意义：[06](06-托管位置与连接链路.md) 里的 CSP 和 `http/send` 校验决定了，**Connector 是应用访问外部世界的唯一出口**。

## 一、四个概念

| 概念 | 是什么 | 在本项目里对应什么 |
|---|---|---|
| **Connector** | 一个 API 的定义：有哪些操作（action）或表（table）、参数、返回结构、认证方式 | `shared_microsoftcopilotstudio`、`shared_sharepointonline` 等，`ms connector list` 列出的每一行 |
| **Connection（连接）** | 某个人对某个 Connector 的一次**登录实例**，保存凭据（OAuth 令牌、API key） | 用户第一次打开应用时，在同意框里建立 |
| **Connection reference（连接引用）** | 应用里"我需要一个 X 类型的连接"的声明，指向某个具体连接 | `ms.config.json` 的 `connectionReferences` |
| **Data source（数据源）** | 应用实际使用的那部分：某个 Connector 的某些动作或某几张表，以及生成的 TypeScript 代码 | `ms app add data-source` 的产物 |

**Connector 和 Connection 不是一个东西**，最容易混：

| | Connector | Connection |
|---|---|---|
| 是什么 | 一个 API 的**类型 / 定义** | 某个人用某个账号对这个 Connector 的一次**登录** |
| 数量 | 整个平台一份（本租户目录 1393 个） | 每人、每环境、每账号各一个，可以有很多 |
| 里面有什么 | 操作列表、参数、返回结构、支持哪种认证 | **凭据**：OAuth 令牌或 API key |
| 会不会过期 | 不会 | 会（红叉 + Reconnect） |
| 在哪看 | make.powerapps.com → Connections → **New connection** 弹出的目录；`ms connector list` | make.powerapps.com → **Connections** 列表 |
| 类比 | "微信"这个 App | 你在手机上登录的那个微信账号 |

例子：在 Connections 列表里，**Microsoft Teams** 出现了两行、**M365 Copilot** 出现了两行——同一个 Connector，两个不同的连接。

三者的关系：

```text
Connector（类型：SharePoint）
   └─ Connection（实例：qiah@... 登录的 SharePoint，保存令牌）
          ▲
          └─ Connection reference（应用里的声明："我要用一个 SharePoint 连接"，
                                    写在 ms.config.json，运行时指向某个具体连接）
```

### 实测：agent 用的连接，就是 Power Platform 里的连接〔实测，2026-10-27〕

验证方法：从 agent 一侧看它用的连接，再到 Power Platform 一侧找同一个连接。

1. Copilot Studio 打开 agent `cs-agent-demo01`（新版界面）→ Build → Tools → **Work IQ**。详情面板：类型 **MCP server**，**Connection: qiah@microsoft.com**，旁边 "Manage connections"。
2. make.preview.powerapps.com 同一环境的 Connections 页。页面上**只渲染了 11 行**（列表懒加载，要往下滚），但页面实际调用的 API `GET <env>.environment.api.powerplatform.com/connectivity/connections` 返回了 **19 个连接**，其中一条：

   ```text
   apiId: shared_workiqmcp   显示名: qiah@microsoft.com   创建: 2026-10-27   状态: Connected
   ```

   Connector 相同、账号相同、创建日期就是建 agent 的当天、状态正常——就是 agent 里那个连接。

结论：

- **agent、Power Apps、managed app 用的是同一个连接池**：同一环境下、属于你的连接对象，Copilot Studio 里建的会出现在 make.powerapps.com，反之亦然。所以前面说的"同一套 Connector 目录、同一套 DLP"成立。
- **"能通"还要满足四个条件**：
  1. **Connector 类型要对得上**。agent 的 Work IQ 工具要的是 `shared_workiqmcp` 的连接；你列表里的 `M365 Copilot`（`shared_m365copilot`）是另一个 Connector，不能替代。
  2. **同一个环境**。连接不跨环境。
  3. **连接是健康的**。19 个里 17 个是 `Error`（过期），选它们会失败，要先 Reconnect。
  4. **身份模式**。agent 设为 "End user credential"（"Each end user signs in with their own account"）时，作者的连接只在作者自己测试时用；**每个最终用户第一次用都要建自己的连接**。从 agent 的连接管理页（`.../cliagent/<schema>/channels/pva-studio/user-connections`）能看到这一点：作者以用户身份访问时显示 "Work IQ MCP — Missing connection — Connect"。

- **注意 Connections 页显示不全**。要看完整列表，滚动到底，或看页面请求的 API 返回。
- 一个副产品：新版 agent 的内部类型标识是 **`cliagent`**（链接路径 `/cliagent/cr7a3_csagentdemo01_YqSLPn/`），和"GitHub Copilot harness 基于 GitHub Copilot CLI / SDK 的运行时"一致。

调用时的链路〔实测〕：

```text
应用代码 → 生成的 Service → SDK getClient().executeAsync()
  → 宿主 http/send（校验 apiId 与连接、URL 与连接的 runtimeUrl）
  → API Hub  /<connectionId>/<操作路径>     ← 宿主在这里注入连接的凭据
  → 真正的后端 API（SharePoint、Dataverse、Copilot Studio……）
```

凭据只存在于**连接对象**里，不在应用代码、不在 `ms.config.json`、也不经过应用的浏览器上下文。

### 在哪里能看到、配置 Connector

Connector 没有一个统一的"配置页"，入口按用途分散在几个产品里。**最容易找错的是治理入口：它在 Power Platform admin center，不在 Microsoft 365 admin center。**

| 想做什么 | 去哪里 | 路径（界面在 Preview 期可能调整） |
|---|---|---|
| 看自己有哪些**连接**、新建 / 修复 / 共享 / 删除连接 | Power Apps 门户 <https://make.powerapps.com>（Preview 版 <https://make.preview.powerapps.com>） | 右上角先选对**环境** → 左侧导航 **Connections**（不在列表里时点 **More** 找）。本环境直达：`/environments/0b768ed1-f103-e374-8a58-06c623794b19/connections`（2026-10-27 确认） |
| 浏览可用的 **Connector 目录** | 同上 | Connections → **New connection**，弹出的就是目录 |
| 自建 Connector（包装自己的 API） | 同上 | 左侧 **Custom connectors**（或 More 里） |
| 给 **agent** 加 Connector | Copilot Studio <https://copilotstudio.microsoft.com> | **新版界面**（GitHub Copilot harness，左侧只有 Home / Chat / Agents / Workflows / Apps）：**Agents** → 打开某个 agent → **Build** 标签页 → **Tools** 区块（"Connect the agent to external systems and actions"），在这里添加 Connector、MCP、workflow；同一页还有 Skills、Knowledge、Connected agents、Memory（2026-10-27 实测）。**经典界面**（Standard harness，左下 **…** → **Open classic experience**）：agent → **Tools** → **Add a tool** → Connector；**Settings → Connection settings** 管理连接 |
| 给 **workflow** 加 Connector | Copilot Studio | 打开 workflow → 在设计器里添加一个动作，选 Connector |
| 给 Copilot Studio 生成的 **app** 加数据源 | Copilot Studio | 打开 app → 左上角下拉菜单 → **Data** / **Connections** 视图；或者直接在对话里说"连接到某张表" |
| 给**代码写的 managed app**（本项目）加 Connector | 命令行 | `ms connector list --only-allowed`、`ms app add data-source`，结果写进 `ms.config.json` |
| **允许 / 阻止**某个 Connector（DLP） | Power Platform admin center <https://admin.powerplatform.microsoft.com>（Preview 版界面 <https://admin.preview.powerplatform.microsoft.com>） | 左侧一级导航 **Security**（盾牌图标）→ **Data and privacy** → **Data policy** 卡片，地址 `/security/dataprotection/dlp`（2026-10-27 在 Preview 版界面实测）。旧版界面是 **Policies → Data policies**。需要 Power Platform 管理员或租户管理员 |
| 看 managed app 的清单、使用情况、费用 | Microsoft 365 admin center <https://admin.microsoft.com> | **Apps**（managed apps 清单）、**Copilot → Cost management**（Credits）。这里**没有** Connector 策略 |

#### 为什么连接在制作者门户，不在 admin center

**连接是个人的，admin center 管的是规则。** 连接里存的是某个用户的登录令牌（"我以 qiah@... 登录了 SharePoint"），由用户在用到时自己创建；admin center 管的是租户和环境级的规则（"这个环境允许 SharePoint，禁止自定义 Connector"）。好比手机上登录的微信账号是你自己的，公司 MDM 只管能不能装微信，不会列出你的聊天记录。

历史上，Connections 页最早就在 Power Apps / Power Automate 的制作者门户（两边看到的是同一份列表）；Copilot Studio 后来加入，复用了这套机制，但没在自己的首页放 Connections 菜单。

#### 用户怎么"到达"连接

**大多数时候不需要专门去建——连接是在用到的地方当场创建的**〔实测〕：

| 场景 | 连接怎么来 | 证据 |
|---|---|---|
| 制作者给 agent 加工具 | 添加 Work IQ 工具时当场登录，连接自动建好 | `shared_workiqmcp` 连接创建于 2026-10-27，正是建 agent 当天 |
| 用户第一次打开 managed app | 宿主弹出同意框，列出所需 Connector，点 Allow 即建好 | 参考应用 "Allow CSU Investment Insights to access your data?" |
| agent 设为每个用户用自己的账号 | 用户第一次触发工具时弹出 Connect 卡片 | agent 连接页 "Work IQ MCP — Missing connection — Connect" |

Copilot Studio 还有**自己的**连接管理页：工具详情面板的 "Manage connections" 指向 `copilotstudio.../cliagent/<agent>/channels/pva-studio/user-connections`，不会跳到 make.powerapps.com。

**需要去 make.powerapps.com → Connections 的情况**：一次看全部连接；修复过期连接（红叉 + Reconnect）；共享连接；删除连接；创建自定义 Connector（Custom connectors）。

这确实是 Power Platform 的体验短板：入口分散在 Power Apps、Power Automate、Copilot Studio、admin center，没有统一引导。记住一条：**平时在用的地方当场建，出问题去 make.powerapps.com → Connections 统一处理。**

几点说明：

- **Connections 页列的是"连接"，不是"Connector"。** 每行第一行是连接的显示名（常常是账号，例如你的邮箱），第二行是它属于哪个 Connector（Office 365 Outlook、SharePoint……）。同一个 Connector 可以有多个连接。要浏览 Connector 目录，点页面顶部的 **New connection**。
- **状态列的红叉 + Reconnect 表示连接失效**，常见原因是 OAuth 刷新令牌过期（几个月没用）、改过密码或被条件访问策略要求重新登录。点 **Reconnect** 重新登录即可；没有 Reconnect 按钮的（例如某些 AI 类连接）一般删掉重建。失效的连接会让用到它的应用、agent、flow 运行失败。
- **连接属于环境。** 在 make.powerapps.com 看不到连接，最常见的原因是右上角选的环境不对。本应用的环境 ID 是 `0b768ed1-f103-e374-8a58-06c623794b19`。
- **Copilot Studio 首页也没有 Connector 菜单**，它只出现在 agent / workflow / app 的编辑界面里，因为 Connector 是作为"某个东西的工具或数据源"被添加的。
- **普通用户看不到 DLP 策略内容**。实测：用非管理员账号打开 Data policy 页，页面能进，但策略列表是**空的**——尽管本租户有 1266 个 Connector 被阻止，说明策略存在只是无权查看。要知道某个 Connector 是否被阻止，用 `ms connector list` 看 `isBlocked` 字段，或者在添加时看报错。
- **Manage → Environments 里没有 Connector。** 环境页管的是环境本身（容量、安全组、Dataverse、设置）。连接和 Connector 目录在 make.powerapps.com，策略在 Security → Data and privacy。

## 二、Connector 的几种属性

`ms connector list --json` 每一行带这些字段〔实测〕：`name`、`displayName`、`isBlocked`、`isTabular`、`supportsSso`。

| 属性 | 含义 | 影响 |
|---|---|---|
| **表型 / 动作型**（`isTabular`） | 表型可以像数据库一样增删改查（SharePoint 列表、SQL 表、Excel 表）；动作型是一组 API 操作（发消息、调 agent） | `ms app add data-source --as table` 还是 `--as action`；表型生成的代码有 `getAll / create / update / delete` |
| **SSO**（`supportsSso`） | 能否直接用用户的 Entra 身份，免去单独登录 | 支持 SSO 的，用户首次使用时一键同意即可；`--use-sso` |
| **认证方式** | OAuth（用户身份）、API key、服务主体、匿名等 | API key 类（例如 Azure OpenAI）通常是作者建好连接再共享，所有用户共用一个身份 |
| **可否共享** | 连接能否共享给其他用户 | Copilot Studio Connector 的连接**不可共享**，每个用户必须自己建 |
| **Standard / Premium** | 许可等级 | Premium 需要 Power Apps Premium 或按量的 Copilot Credits；同意框里会标出 |
| **Preview** | 是否预览版 | 行为可能变化 |
| **DLP 状态**（`isBlocked`） | 是否被租户的数据策略阻止 | 被阻止的 Connector 无法添加或运行 |

## 三、本租户的目录〔实测，2026-10-27〕

| 统计 | 数量 |
|---|---|
| 全部 Connector | 1393 |
| 被策略阻止 | **1266** |
| 允许使用 | 127 |
| 表型 | 31 |
| 支持 SSO | 244 |
| 名称含 MCP | 74，其中 62 个被阻止 |

**九成以上被阻止**，所以选 Connector 的第一步永远是 `ms connector list --only-allowed`。

与本项目相关、**允许使用**的：

| 类别 | Connector | id | 表型 | SSO |
|---|---|---|---|---|
| M365 数据 | SharePoint | `shared_sharepointonline` | ✅ | ✅ |
| | Excel Online (Business) | `shared_excelonlinebusiness` | ✅ | ✅ |
| | OneDrive for Business | `shared_onedriveforbusiness` | | ✅ |
| | Office 365 Users | `shared_office365users` | | ✅ |
| | Office 365 Outlook | `shared_office365` | | ✅ |
| | Microsoft Teams | `shared_teams` | | ✅ |
| 业务数据 | Microsoft Dataverse | `shared_commondataserviceforapps` | | ✅ |
| | SQL Server | `shared_sql` | ✅ | ✅ |
| | Azure Data Explorer | `shared_kusto` | | ✅ |
| | Azure Blob Storage | `shared_azureblob` | | ✅ |
| | Power BI | `shared_powerbi` | | ✅ |
| AI / agent | Microsoft Copilot Studio | `shared_microsoftcopilotstudio` | | ✅ |
| | Work IQ Copilot MCP（Preview） | `shared_a365copilotchatmcp` | | ✅ |
| | Work IQ MCP 及 Mail / Calendar / Teams / Word / OneDrive / SharePoint / User 各 MCP | `shared_workiqmcp`、`shared_a365*mcp` 等 | | ✅ |
| | Azure OpenAI | `shared_azureopenai` | | ❌ |
| | Azure AI Foundry Inference | `shared_azureaifoundryinference` | | ❌ |
| | Azure AI Search | `shared_azureaisearch` | ✅ | ❌ |
| 流程 | Standard approvals | `shared_approvals` | | ✅ |
| | Notifications | `shared_flowpush` | | ✅ |
| 通用 HTTP | HTTP with Microsoft Entra ID (preauthorized) | `shared_webcontents` | | ❌ |

**被阻止**、容易误以为能用的：`HTTP With Microsoft Entra ID`（`shared_webcontentsv2`）、`Azure AI Foundry Agent Service`（`shared_azureagentservice`）、`Microsoft 365 Admin Center MCP`。

> 更正：[02](02-Managed-Runtime与SDK参考.md) 里写"HTTP With Microsoft Entra ID 被阻止，不能当万能后端"。准确地说是 **v2 版被阻止**；preauthorized 版（`shared_webcontents`）允许，但它只能调用预先授权过的资源，同样不是万能后端〔待实测其可调用的资源范围〕。

几个 AI Connector 的动作〔实测，`ms connector list-actions`〕：

| Connector | 动作 |
|---|---|
| Microsoft Copilot Studio | `ExecuteCopilot`、`ExecuteCopilotAsyncV2`，以及 4 个评测相关操作 |
| Work IQ Copilot MCP | `mcp_m365copilot`（"Work IQ Copilot (Preview)"）——一个 MCP 服务器，提供 Microsoft 365 Copilot 搜索 |
| Azure OpenAI | `ChatCompletions_Create_2024Feb15Preview`、单 / 批 Embeddings、`ExtensionsChatCompletions_Create` |
| Generative actions | `RunAIFlow` |

## 四、managed app、agent、workflow 用 Connector 的区别

同一个目录，三种用法：

| | managed app | Copilot Studio agent | workflow |
|---|---|---|---|
| 形式 | 生成的 TypeScript Service，代码里调用 | **工具**（agent 自己决定何时调用）或**知识源**（检索用） | 流程里的一个步骤 |
| 谁的身份 | **永远是当前用户自己的连接**〔官方：data access uses the signed-in user's existing permissions〕 | 可选：作者身份，或用户身份〔官方：agent author authentication or user authentication〕 | 通常是建流程的人的连接 |
| 谁决定调哪个 | 你写的代码，确定 | 模型推理决定，不完全确定 | 流程定义，确定 |
| MCP Connector | 可以以动作形式调用（参考应用实证，见第五节） | 原生支持，作为 MCP 工具 | 〔待实测〕 |
| 登记方式 | `ms app add data-source` → `ms.config.json` | agent 的 Tools / Knowledge 页 | 流程设计器 |
| 治理 | 同一套 DLP | 同一套 DLP，另有 agent 专属策略（触发器、渠道、HTTP、认证等） | 同一套 DLP |

**身份差异是设计时最要紧的一点**：

- managed app 里**每个用户只看得到自己有权限看的数据**，因为连接是用户自己的。
- agent 如果用"作者身份"，所有用户都以作者的权限访问数据——方便，但可能越权。官方文档特别提醒事件触发器只能用作者凭据，"might allow users of an agent to access data and systems using that same authorization"。

## 五、参考应用实例：只用两个 Connector〔实测〕

2026-10-27 打开参考应用 CSU Investment Insights，首次运行弹出的连接同意框（`apps.powerapps.com/consent/...`，标题 "Allow CSU Investment Insights to access your data?"）列出了它需要的**全部** Connector：

| Connector | 标签 | 用途（从界面推断） |
|---|---|---|
| **Work IQ Copilot MCP** | Preview、Premium | 右侧 Ask Copilot 面板，底部写着 "Microsoft 365 Copilot, under your own sign-in" |
| **SharePoint** | — | 页面说明 "Status and notes are kept in the [团队] SharePoint site"，"Status is shared with everyone who opens the app"：行动项的状态与备注存在 SharePoint 列表里，所有人共享 |

其余功能**没有用 Connector**：

| 功能 | 做法 | 推断依据 |
|---|---|---|
| 指标、图表、筛选、钻取 | 每周刷新一次的数据快照，随应用打包 | 页面写 "refreshed <日期>"；同意框里没有任何业务数据源的 Connector |
| 给负责人发邮件 | `mailto:` 链接，打开用户自己的邮件客户端 | 链接是 `mailto:...?cc=...&subject=...&body=...` |
| 跳转到 CRM 记录 | 普通外链 | 链接指向 CRM 系统的记录页 |
| 导出 Excel、下载 PDF | 浏览器端生成 | 同意框里没有 Excel / OneDrive Connector |
| Glossary（中英文术语） | 静态内容 | 同上 |

这个设计值得学：

1. **能静态的都静态**：数据每周刷新一次就够，打包进应用，零 Connector、零费用、秒开。
2. **只有"共享状态"和"AI 问答"走 Connector**：这两件事静态做不到。
3. **能用浏览器原生能力的不用 Connector**：`mailto:` 代替 Outlook Connector，免去一次授权和一笔调用费。
4. 用户首次打开只需同意两个连接，而且都支持 SSO，基本是一键完成。

**这也回答了 [06](06-托管位置与连接链路.md#五回到参考应用) 留下的问题**：它的 Ask Copilot 走的是 **Work IQ Copilot MCP Connector**，不是 Copilot Studio agent，也不是实验性的 Cowork 通道。它从 managed app 里以普通 Connector 动作的形式调用了一个 MCP Connector。

## 六、费用

| 项 | 规则〔官方，Managed Runtime licensing FAQ〕 |
|---|---|
| 每次 API 调用 | 启动应用、经 Connector 读写、发布，每次 0.1 Copilot Credits |
| Power Apps Premium 用户 | 运行应用不消耗 Credits，计入每日 Power Platform 请求额度，超出部分按 Credits |
| Premium Connector | 需要 Premium 许可，或按量的 Credits |
| Work IQ API | **单独按量计费**，Premium 也不覆盖 |
| 后端服务自身的费用 | 例如 Azure OpenAI 的 token、Copilot Studio agent 的消息，另算 |

所以参考应用的做法（静态数据 + 两个 Connector）同时也是**费用最低**的做法。

## 七、选 Connector 的步骤

```bash
ms connector list --only-allowed --search <关键词>      # ① 先看允许的
ms connector list-actions --connector <id>             # ② 看有哪些动作、策略是否 Allow
ms app add data-source --connector <id> --as action --use-sso   # ③ 加进应用（会在租户里建连接）
git status                                              # ④ 看生成了哪些代码，改了 ms.config.json
```

决策顺序：

1. **这件事能不能不用 Connector？**（构建期预计算、静态数据、`mailto:`、浏览器端导出）
2. 必须用的话，**有没有支持 SSO 的？**（用户体验好，身份清楚）
3. 是不是 Premium？用户有没有许可？
4. 会不会每次交互都调用？（费用、每连接限流，例如 Copilot Studio Connector 每连接 300 次 / 60 秒）

## 八、附：Copilot Studio 和 Power Platform 的关系

**Power Platform 是地基和管理平面，Copilot Studio 是盖在上面的一个产品。** Connector 之所以在 Power Apps、Copilot Studio、managed app 里都能用、都受同一套 DLP 管，就是因为它属于地基这一层。

```text
┌──────────────────────── 产品层（造东西的地方）────────────────────────┐
│ Power Apps      Power Automate     Power Pages     Copilot Studio      │
│ 画布/模型驱动   云端流程           外部网站         agent、workflow、    │
│ 应用                                                 apps（managed app） │
└────────────────────────────────────────────────────────────────────────┘
┌──────────────────────── 地基层（大家共用）──────────────────────────────┐
│ 环境（Environment）  Dataverse  Connector / 连接  DLP 数据策略           │
│ Solutions（打包与迁移）  许可与容量  Power Platform admin center          │
└────────────────────────────────────────────────────────────────────────┘
```

### 家族成员各自的职责

make.powerapps.com 左下角 **Power Platform** → "Explore Power Platform" 面板列出的入口：

| 组件 | 一句话 | 造什么 / 管什么 | 给谁用 |
|---|---|---|---|
| **Power Apps** | 做业务应用 | 画布应用、模型驱动应用（基于 Dataverse）、代码应用。门户 make.powerapps.com 还兼管**共用地基**：Tables（Dataverse）、Connections、Solutions | 组织内部员工 |
| **Power Automate** | 做自动化流程 | 云端流程（触发器 + 动作）、桌面流程（RPA，模拟鼠标键盘）、流程挖掘 | 想把重复工作自动化的人 |
| **Power BI** | 做报表分析 | 报表、仪表板、语义模型（数据口径）；现在也是 Microsoft Fabric 的一部分 | 看数据、做决策的人 |
| **Power Pages** | 做对外网站 | 面向客户 / 合作伙伴的门户，可匿名或用外部身份登录，数据在 Dataverse | **组织外部**的人 |
| **Copilot Studio** | 做 AI | agent、workflow、apps（跑在 Managed Runtime） | 用 AI 解决问题的制作者 |
| **Power Platform Admin Center** | 管理平面 | 环境、DLP 数据策略、容量与许可、安全、监控 | 管理员 |
| **Power Platform** | 总入口 | 家族首页，汇总产品与学习资源〔具体落地页未确认〕 | 所有人 |

容易混的几组：

| 容易混 | 区别 |
|---|---|
| Power Apps 的应用 vs Copilot Studio 的 Apps | 前者拖拽 / 公式，跑在 Power Apps 播放器；后者自然语言生成，跑在 Copilot Managed Runtime（本项目属于后者） |
| Power Automate 流程 vs Copilot Studio 的 Workflows | 功能相近；后者能直接编排 agent，可跑在 GitHub Copilot harness |
| Power Pages vs managed app | 前者面向**外部**、可匿名；后者只给**内部**、必须 Entra 登录 |
| Power BI vs 在 app 里画图 | 参考应用的图表是应用自己画的，没用 Power BI；Power BI 适合复杂数据模型和多人共享报表 |

对本项目：Copilot Studio（agent）和 Power Apps 门户（连接、Dataverse 表）会用到；Admin Center 只看不改；Power Automate、Power BI、Power Pages 暂时不用（workflow 已能覆盖流程；统计图在应用里画更轻；公开访问已有 GitHub Pages）。

本项目里能直接看到的证据〔实测〕：

| 证据 | 说明 |
|---|---|
| 同一个环境 ID `0b768ed1-...` 出现在 `copilotstudio.preview.microsoft.com/environments/<id>`、`make.preview.powerapps.com/environments/<id>`、`ms.config.json` 的 `environmentId` | 三个产品共用一个 Power Platform 环境 |
| Copilot Studio 的 **…** 菜单里有 **Solutions** 和 **Power Platform Admin Center** | 打包和管理都交给 Power Platform |
| Standard agent 的调用路径是 `/powervirtualagents/dataverse-backed/...` | Copilot Studio 的前身是 Power Virtual Agents，agent 定义存在环境的 Dataverse 里 |
| managed app 的启动请求发往 `<env>.environment.api.powerplatform.com/appframework/...`，静态文件在 `powerplatformusercontent.com` | Managed Runtime 也跑在 Power Platform 的基础设施上 |
| Connector 策略在 Power Platform admin center 的 Security → Data and privacy | 治理统一在地基层 |

定位上的不同：

| | Power Platform | Copilot Studio |
|---|---|---|
| 是什么 | 一组低代码产品 + 共用的基础设施 | 其中一个产品，**以 AI 为中心**的构建界面 |
| 发展 | Power Apps、Power Automate 等多年的经典产品 | 由 Power Virtual Agents 改名演变而来；2026 年起把 agent、workflow（类似 Power Automate 的流程）、apps（类似 Power Apps 的应用，跑在 Managed Runtime）放进"一个 studio" |
| 构建方式 | 拖拽设计器、公式、流程图 | 以自然语言描述为主，由 AI 生成，再按需改代码 |
| 谁来管 | Power Platform admin center：环境、DLP、容量 | 产品内只管自己的对象；治理沿用 Power Platform，费用另有 Copilot Credits |

一个容易混淆的点：**Copilot Studio 里的 workflow 和 Power Automate 的云端流程很像，Copilot Studio 里的 app 和 Power Apps 的应用也很像，但它们是新一代的东西**——workflow 可以跑在 GitHub Copilot harness 上，app 跑在 Copilot Managed Runtime 上（不是 Power Apps 的播放器）。它们共享的是地基（环境、Dataverse、Connector、DLP），不是运行时。

另外，Managed Runtime 的**终端用户入口和应用清单**在 Microsoft 365 那一侧（`managedapps.cloud.microsoft`、Microsoft 365 admin center → Apps），而**环境、连接、DLP** 在 Power Platform 那一侧。所以一个 managed app 的管理会同时涉及两个 admin center。

## 参考资料

- 〔实测〕`ms connector list --json`、`ms connector list-actions`，本租户，2026-10-27
- 〔实测〕参考应用连接同意框与页面结构，2026-10-27（只记录 Connector 名称与技术结构，未记录业务数据）
- 〔官方〕Apps overview (preview)：<https://learn.microsoft.com/en-us/microsoft-copilot-studio/apps-experience/apps-overview>
- 〔官方〕Use connectors in Copilot Studio agents：<https://learn.microsoft.com/en-us/microsoft-copilot-studio/advanced-connectors>
- 〔官方〕Create and manage connections（作者身份与用户身份）：<https://learn.microsoft.com/en-us/microsoft-copilot-studio/authoring-connections>
- 〔官方〕Event triggers overview（作者凭据风险）：<https://learn.microsoft.com/en-us/microsoft-copilot-studio/authoring-triggers-about>
- 〔官方〕Configure data policies for agents：<https://learn.microsoft.com/en-us/microsoft-copilot-studio/admin-data-loss-prevention>
- 〔官方〕Copilot Managed Runtime licensing FAQ：<https://learn.microsoft.com/en-us/microsoft-365/admin/manage/apps/licensing-faq>
- 〔官方〕Microsoft Copilot Studio connector reference：<https://learn.microsoft.com/en-us/connectors/microsoftcopilotstudio/>
