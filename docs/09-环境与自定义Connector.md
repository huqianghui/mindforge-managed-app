# 09 环境与自定义 Connector

> 学习系列第 5 篇。回答两个问题：环境是什么、怎么创建和管理；能不能把自己的 API（Container Apps、App Service）做成 Connector 接进来。
> 资料截至 2026-10-27。〔实测〕= 本租户 Power Platform admin center 与 `ms` CLI；〔官方〕= Microsoft Learn。

## 一、环境（Environment）

### 1.1 是什么

**环境是租户里的一个隔离容器**，装着应用、agent、流程、连接、Dataverse 数据库。一个租户可以有很多环境，常见用法就是你说的开发 / 测试 / 生产分开。

```text
租户（Microsoft Entra tenant，例如 microsoft.com）
 ├─ 环境 A：Default（每个租户自带一个，所有人默认都在里面）
 ├─ 环境 B：Production   ← 正式业务
 ├─ 环境 C：Sandbox      ← 测试、UAT
 └─ 环境 D：Developer    ← 某个人的个人开发空间
      ├─ Dataverse 数据库（可选，一个环境最多一个）
      ├─ 应用、agent、workflow、managed app
      ├─ 连接（Connection）
      └─ 安全角色、用户
```

环境是这些东西的边界：

| 边界 | 说明 |
|---|---|
| 数据 | 每个环境最多一个 Dataverse 数据库，数据不跨环境 |
| 连接 | 连接属于环境（[08](08-Connector全景.md) 实测） |
| 权限 | 环境级的安全组、安全角色决定谁能进、能做什么 |
| 区域 | 创建时选定区域，数据存在那里 |
| 策略 | DLP 可以按环境或环境组设置 |

### 1.2 环境类型〔官方〕

| 类型 | 用途 | 谁能建 | 占容量 | 特点 |
|---|---|---|---|---|
| **Default** | 每个租户自带，Microsoft 365 场景的个人小工具 | 自动 | — | 所有许可用户都是制作者，通常被 DLP 管得最严 |
| **Production** | 正式业务 | 管理员（或租户设置允许的人） | 需要 Dataverse 容量 | 长期保留 |
| **Sandbox** | 开发、测试、UAT | 管理员 | 需要容量 | 可以复制、重置 |
| **Developer** | 个人开发空间 | 制作者自己（Power Apps Developer Plan，免费） | **不占租户容量** | 每人最多 3 个；**长期不活动会被禁用再删除**；不能装 Dynamics 365 应用 |
| **Trial** | 短期试用 | 用户 | — | 到期自动删除 |
| **Dataverse for Teams** | Teams 里的轻量应用 | 自动 | — | 跟随 Teams 团队 |

### 1.3 本项目的环境〔实测〕

Power Platform admin center → Manage → Environments：

| 字段 | 值 |
|---|---|
| 名称 | Qianghui Hu |
| 类型 | **Developer** |
| 分组 | **Personal Developer Environments** |
| Managed Environment | Yes |
| Dataverse | Yes，`org7a5c9694.crm.dynamics.com` |
| 区域 | Preview (United States) |
| 发布节奏 | Early（refresh cadence: Frequent） |
| 创建 | 2025-06-09，创建人 Qianghui Hu |
| 安全组 | 未设置 |
| 审计 | 开启，保留 180 天 |

结论：**Mindforge Wiki、`cs-agent-demo01` 都放在你的个人开发者环境里**。这对学习合适，但有两个后果：

1. **会因不活动被清理。** 2026-10-27 详情页警告："This Developer environment has been inactive for 0 day(s), since 10/26/2026. Due to inactivity, it will be automatically disabled on **10/29/2026** then scheduled for deletion." 下面有 **Trigger environment activity** 按钮。
2. **不适合给别人长期用。** 开发者环境定位是个人工作区，官方要求不用于生产。

### 1.4 不活动清理的规则〔官方〕

按 "Automatic deletion of Power Platform environments" 文档：

| 阶段 | 普通开发者环境 | 已开启 Managed Environment 的个人开发者环境（**本环境属于这种**） |
|---|---|---|
| 不活动阈值 | 30 天 | **60 天** |
| 警告 | 第 23 天发邮件，列表和详情页出现倒计时；第 27 天第二封邮件 | 达到阈值后按同样的节奏通知 |
| 禁用 | 到阈值自动禁用 | 同左 |
| 删除 | 禁用 15 天后自动删除；期间可以重新启用 | 同左 |
| 恢复 | 删除后 7 天内可恢复 | 同左 |

（另一篇环境策略指南写的是 90 天，属于旧说法；以 admin center 显示的日期为准。）

**什么算"活动"**〔官方〕：Power Apps、Power Automate、Power Platform、Copilot Studio、Dataverse 里，由用户、制作者或管理员发起的**大多数增删改查操作**都算；**只打开首页、解决方案浏览器、设计器不算**。2025-04-20 起，CoE 工具包的跨组织查询也不再算活动。

**2026-10-27 的处理记录**〔实测〕：详情页显示 "inactive for 0 day(s), since 10/26/2026 … disabled on 10/29/2026"——"0 天"和"3 天后禁用"与上面的阈值对不上，原因不明。点击 **Trigger environment activity** 后提示 "After a few seconds, the environment's last activity will be updated to today"；刷新列表后状态从 "Ready (2 days until disabled)" 变为 **Ready**，Last activity 变为 **10/27/2026**。

**自动化：`scripts/keep-env-active.sh`**〔实测〕

admin center 的 Trigger environment activity 按钮调用的是 BAP 管理接口（从 admin center 前端代码中找到，**不是公开文档里的 API**，可能随时变化）：

```text
GET  https://api.bap.microsoft.com/providers/Microsoft.BusinessAppPlatform
     /scopes/admin/environments/{环境ID}/lastActivity?api-version=2021-04-01   读取最近活动
POST 同一地址                                                                  触发活动
令牌资源：https://service.powerapps.com/
```

同一组接口里还有 `/inactivityCleanupExclusion`（"Prevent automatic deletion"，把环境排除在清理之外），按命名应是租户管理员操作，未尝试。

脚本用法（需要 `az` 已登录到环境所在租户）：

```bash
scripts/keep-env-active.sh --status     # 只看最近活动时间
scripts/keep-env-active.sh              # 触发一次，15 秒后读回确认
scripts/keep-env-active.sh --install    # 装成 macOS launchd 定时任务：每周一 10:00
scripts/keep-env-active.sh --uninstall  # 卸载
```

实测：手动运行，最近活动从 `04:55:19Z` 变为 `05:00:29Z`；launchd 立即执行一次，变为 `05:02:50Z`。

注意事项：

- macOS 隐私保护不允许 launchd 任务读取 `~/Downloads`、`~/Documents`、`~/Desktop`，所以 `--install` 会把脚本复制到 `~/Library/Application Support/com.mindforge.keep-env-active/`，环境 ID 写进 plist。**改了脚本要重新 `--install`**。
- 日志在 `~/Library/Logs/com.mindforge.keep-env-active.log`。Mac 关机期间错过的任务不会补跑（睡眠唤醒后会补）；每周一次，离 60 天阈值很远。
- `az` 的登录会过期（公司租户的条件访问可能要求定期重新登录）。日志里出现取令牌失败时，执行 `az login --tenant <租户ID>`。
- 这只是刷新"最近活动"的时间戳，不是真实使用；它解决的是"放着不用会被清理"，不改变开发者环境"不用于生产"的定位。

**怎么避免再被禁用**：

1. **收到警告就点 Trigger environment activity**（Manage → Environments → 环境 → 详情页的 "Environment inactive" 卡片）。这是官方提供的、最直接的办法。
2. **保持真实的使用**：在环境里打开并操作 managed app、在 Copilot Studio 里测试或发布 agent、读写 Dataverse 表、跑一次 workflow。只"看一眼首页"不算。
3. **留意邮件**：警告邮件发给环境管理员和创建者，也就是你。
4. **做好备份**：managed app 源码在 Git（本项目有 GitHub 备份）；agent 用 Solutions 导出；Dataverse 数据导出。这样即使环境被删，也能在新环境重建。
5. **长期给别人用的东西，不要放开发者环境**：开发者环境定位是个人工作区，正式使用应申请 Production 环境。

### 1.5 怎么创建和管理

| 操作 | 在哪里 |
|---|---|
| 创建环境 | Power Platform admin center → **Manage → Environments → New**。选名称、类型、区域、是否带 Dataverse。Production / Sandbox 通常需要管理员和容量；Developer 制作者自己能建（除非租户关闭了这个权限） |
| 查看详情、类型、到期警告 | 同上，点环境名称 → 详情页（地址形如 `/manage/environments/environment/<id>/hub`） |
| 复制、备份、重置、删除 | 环境详情页顶部操作；Developer 环境的所有者可以重置或删除 |
| 分组与规则 | **Environment groups**：把一批环境放进一组，统一套用规则（本环境属于 "Personal Developer Environments" 组） |
| Managed Environments | 环境级的"高级治理"开关：共享限制、使用洞察、数据策略等；本环境已开启 |
| 在各产品里切换环境 | make.powerapps.com、Copilot Studio 右上角或左下角的环境选择器；`ms` CLI 用 `--environment-id` |

### 1.6 开发 → 测试 → 生产怎么走（ALM）

| 对象 | 跨环境搬运的方式 |
|---|---|
| Power Apps、Power Automate、Copilot Studio agent | **Solutions**（解决方案）：在开发环境打包导出，导入到测试 / 生产；或用 **Pipelines in Power Platform** 自动化 |
| managed app（本项目这类代码应用） | 源码在 Git。CLI 提供了**预览**功能：`ms feature enable --name projects` / `--name alm` 后，`ms project`、`ms app add config`、`ms app deploy --target <name>`、部署审批（`ms project add approval`）。当前 CLI 0.31.0 默认没开，`ms project` 会报 Unknown command |
| 连接 | **不搬**。每个环境里重新建连接；Solutions 里只带"连接引用"，导入时绑定目标环境的连接 |

对这个学习项目：**一个开发者环境够用**。等到要给别人正式使用，再考虑申请一个 Production 环境（公司租户里需要找 IT），或者在你自己有管理员权限的测试租户里建一套完整的开发 / 生产。

## 二、自定义 Connector：把自己的 API 接进来

### 2.1 能不能

**能，这正是自定义 Connector（Custom connector）的用途**：给你自己的 REST API 写一份 OpenAPI 描述，平台就把它当成一个普通 Connector，managed app、agent、workflow 都能用，同样受 DLP 管、同样走 API Hub。

对 managed app 来说这一点尤其重要：[06](06-托管位置与连接链路.md) 里讲过，CSP 禁止应用直接 `fetch` 外部地址，**自定义 Connector 是 managed app 调用自己后端的正规途径**（中间层函数尚未开放）。

```text
managed app ──http/send──▶ 宿主 ──▶ API Hub ──▶ 你的 API
                                       │         （Container Apps / App Service /
                                       │           Functions / API Management）
                         自定义 Connector 的定义：
                         OpenAPI（路径、参数、返回）+ 认证方式 + 主机地址
```

### 2.2 本租户的现实〔实测〕

`ms connector list` 里能看到你以前在这个环境建过的自定义 Connector：

```text
name:        shared_cr7a3-5fswagger-20petstore-5f4b737abff33a89ca
displayName: Swagger Petstore
isBlocked:   True      ← 被阻止
```

`cr7a3` 是这个环境的发布者前缀。**它被 DLP 阻止了**，说明微软公司租户的数据策略**不允许自定义 Connector**。所以：

- **在公司租户里，这条路目前走不通**，除非 IT 为你的环境单独放行。
- **想动手实验，用你自己有管理员权限的测试租户**（你的账号列表里有两个 MngEnvMCAP 租户）。在那里你可以自己设 DLP，把自定义 Connector 放到允许的分组。

### 2.3 怎么做（在允许的租户里）

1. **部署你的 API**：Azure Container Apps 或 App Service，HTTPS，有 OpenAPI（Swagger）描述。
2. **决定认证方式**：

   | 方式 | 效果 | 适合 |
   |---|---|---|
   | **OAuth 2.0（Microsoft Entra ID）** | 每个用户用自己的身份调用，API 收到用户的令牌，可以按人做权限 | 推荐，和 managed app "每个用户用自己的连接"一致 |
   | API key | 所有人共用一个 key | 简单的内部服务 |
   | 无认证 | 不推荐 | — |

   用 Entra ID 时：为 API 注册一个应用（暴露 scope），再为 Connector 注册一个客户端应用（申请这个 scope），Connector 里填客户端 ID、密钥、资源 URL。
3. **创建自定义 Connector**：make.powerapps.com → 选环境 → **Custom connectors** → New，可以导入 OpenAPI 文件或 URL；也有命令行工具（`paconn`、`pac connector`）。
4. **测试**：Connector 页面里的 Test 标签，建一个连接试调。
5. **在各处使用**：
   - managed app：`ms connector list` 找到它的 id → `ms app add data-source --connector <id> --as action`〔待实测：CLI 对自定义 Connector 的代码生成〕
   - agent：Build → Tools → 添加 Connector
   - workflow：添加动作时选它

### 2.4 网络与运维要点

| 点 | 说明 |
|---|---|
| 谁在调你的 API | 是 **API Hub**（Power Platform 的 Connector 运行时）从微软云端发起，不是用户浏览器。所以不需要配 CORS，但 API 必须对 API Hub 可达 |
| 公网可达 | 最简单是公网 HTTPS 端点；可以用 Azure 的服务标签（例如 `AzureConnectors`）限制入站来源〔待实测具体标签〕 |
| 私网 | Power Platform 支持把 Connector 流量接入你的 Azure 虚拟网络（admin center → Security → Data and privacy → **Azure Virtual Network policies**，[08](08-Connector全景.md) 里看到过这个入口），或用本地数据网关 |
| 超时 | Connector 单次请求约 120 秒上限（[06](06-托管位置与连接链路.md)），长任务要改成"提交 + 查询状态"两步 |
| 流式 | Connector 不能把流式响应交给调用方，要一次性返回 |
| 计费 | 每次调用照常按 Managed Runtime 的 API 调用计（0.1 Credits，Premium 用户计入请求额度）；自定义 Connector 属于 Premium |

### 2.5 和 MCP 的关系

Copilot Studio 的 agent 也能把你自己的 **MCP 服务器**（同样可以部署在 Container Apps）通过自定义 Connector 接进来作为工具；[08](08-Connector全景.md) 里参考应用用的 Work IQ Copilot MCP 就是微软做好的 MCP Connector。所以"自己写服务 → 包成 Connector → app 和 agent 共用"是一条通用的扩展路径，前提仍然是租户允许自定义 Connector。

## 参考资料

- 〔实测〕Power Platform admin center（Preview）环境列表与详情页，2026-10-27
- 〔实测〕`ms connector list --json`，2026-10-27
- 〔官方〕Automatic deletion of Power Platform environments：<https://learn.microsoft.com/en-us/power-platform/admin/automatic-environment-cleanup>
- 〔官方〕Power Apps Developer Plan：<https://learn.microsoft.com/en-us/power-platform/developer/plan>
- 〔官方〕Develop a tenant environment strategy：<https://learn.microsoft.com/en-us/power-platform/guidance/adoption/environment-strategy>
