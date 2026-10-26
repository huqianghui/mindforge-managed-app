# 02 Managed Runtime 与 SDK 参考

> 依据：本机 `ms` CLI 0.31.0 的 `--help` 输出、npm 包 `@microsoft/managed-apps@0.6.0` 与 `@microsoft/managed-apps-common@0.30.0` 的类型定义、本租户 `ms connector list` 的实际结果（2026-10-26）。
> 平台是 Preview，版本一变，以下内容都要重新核对。官方文档入口：<https://go.microsoft.com/fwlink/?LinkId=2369054>。

## 三层：CLI、SDK、宿主

| 层 | 包 / 位置 | 在本项目里的状态 |
|---|---|---|
| CLI | `@microsoft/managed-apps-cli`（命令 `ms`） | 已装，devDependency 固定 `0.31.0` |
| 客户端 SDK | `@microsoft/managed-apps` | **未安装**，加功能时 `npm i @microsoft/managed-apps` |
| 宿主 | `managedapps.cloud.microsoft` | 负责登录、加载、DLP/CA、把 SDK 调用转发给 Connector |

SDK 不直接发网络请求。它通过一个 JSON-RPC 通道把请求交给宿主（`DataClientHost.sendHttpRequest`），由宿主带着**连接身份**去调 Connector。所以：

- SDK 只在宿主里（Live、Preview、`ms app dev`）可用，`npm run dev` 的纯 Vite 环境里会失败。
- 应用代码里**不出现**任何密钥、token、Connector URL。

## 当前应用

```text
ms app info
  displayName  Mindforge Wiki
  appId        9ae71e53-dd54-4a36-90ac-0815fd93f03c
  environment  0b768ed1-f103-e374-8a58-06c623794b19
  repoType     Platform-managed Git repository
  connectors   []
```

测试地址：<https://play.preview.managedapps.cloud.microsoft/apps/9ae71e53-dd54-4a36-90ac-0815fd93f03c>。打开需要 Entra 登录，并且应用已经分享给该账号（`ms app share`）。

## SDK 接口

包没有根入口，只能按子路径导入。

### `@microsoft/managed-apps/auth`

```ts
import { getUser } from '@microsoft/managed-apps/auth';

const user = await getUser();
// { fullName: string; objectId: string; tenantId: string }
```

只有这三个字段，没有邮箱、头像、部门。要更多资料就加 `Office 365 Users` Connector（`shared_office365users`，支持 SSO）。

### `@microsoft/managed-apps/app`

```ts
import { getContext, setConfig } from '@microsoft/managed-apps/app';

const ctx = await getContext();
// ctx.app  = { appId, environmentId }
// ctx.host = { sessionId }
setConfig({ logger });   // 见 telemetry
```

### `@microsoft/managed-apps/data`

```ts
import { getClient } from '@microsoft/managed-apps/data';
import type { IOperationResult, IOperationOptions } from '@microsoft/managed-apps/data';
```

`getClient(dataSourcesInfo)` 返回 `DataClient`：

| 方法 | 用途 |
|---|---|
| `retrieveMultipleRecordsAsync<T>(table, options?)` | 表查询；`options` 支持 `select / filter / orderBy / top / skip / count / skipToken / maxPageSize` |
| `retrieveRecordAsync<T>(table, id, options?)` | 取一条 |
| `createRecordAsync / updateRecordAsync / deleteRecordAsync` | 增改删 |
| `uploadFileToRecord / downloadFileFromRecord / downloadImageFromRecord / deleteFileOrImageFromRecord` | Dataverse 文件与图片列 |
| `executeAsync<TReq, TRes>({ connectorOperation: { tableName, operationName, parameters } })` | 调 Connector **动作**（Copilot Studio、Azure OpenAI 都走这里） |

所有方法都返回：

```ts
interface IOperationResult<T> {
  success: boolean;
  data: T;
  error?: Error;
  skipToken?: string;   // 分页
  count?: number;
}
```

**不会抛异常，要检查 `success`。**

`dataSourcesInfo` 不用手写：`ms app add data-source` 会生成它和一层强类型 Service 封装，应用代码调用生成的 Service 即可。

### `@microsoft/managed-apps/telemetry`

`initializeLogger(logger)`，`logger.logMetric(metric)` 会收到宿主推来的会话加载、网络请求、数据请求汇总等指标。调试 Connector 延迟时有用。

## 加 Connector：`ms app add data-source`

```bash
# 动作型（Copilot Studio、Azure OpenAI）
ms app add data-source --connector shared_microsoftcopilotstudio --as action --use-sso

# 表型（Dataverse 表）
ms app add data-source --connector commondataserviceforapps --as action \
  --connection-id <id> --dataverse-environment-id <env-guid> --table <logical_name>
```

它做三件事：

1. 选用或新建一个**连接**（connection，属于某个人的身份）。
2. 把引用写进 `ms.config.json` 的 `connectionReferences`。
3. 生成 TypeScript：数据源描述（喂给 `getClient`）+ 每个动作 / 表一个强类型 Service 类，内部就是 `client.executeAsync(...)` 或 `client.retrieveMultipleRecordsAsync(...)`。

相关命令：

| 命令 | 作用 |
|---|---|
| `ms connector list [--only-allowed]` | 列出环境里的 Connector，含是否被 DLP 阻止 |
| `ms connector list-actions --connector <id> [--search x]` | 列出某 Connector 的动作及策略 |
| `ms app refresh data-source` | Connector 元数据变了以后重新生成代码 |
| `ms app remove data-source` | 移除 |

> 这一步会在租户里**新建连接**，属于对外可见的变更，执行前确认用谁的身份。

### `connectionReferences` 与仓库策略

| 文件 | 进 GitHub？ | 理由 |
|---|---|---|
| `ms.config.json` | 否 | 含 appId、environmentId、connectionId |
| `ms.config.example.json` | 是 | 加数据源后要同步结构，把 ID 换成占位符 |
| 生成的 TypeScript | 是 | 构建要用；里面是 Connector 元数据，不是凭据。提交前仍要看一眼确认没有租户内 ID |

`release.sh` 的"平台仓库 = GitHub main + 1 个配置提交"机制无需改动。

## 本租户里与后续功能相关的 Connector

`ms connector list` 共 1393 个。和路线图相关的：

| Connector | id | 阻止？ | SSO | 用于 |
|---|---|---|---|---|
| Microsoft Copilot Studio | `shared_microsoftcopilotstudio` | 否 | 是 | 阶段 5：调用 agent |
| Azure OpenAI | `shared_azureopenai` | 否 | 否 | 阶段 6：对比 |
| Azure AI Foundry Inference | `shared_azureaifoundryinference` | 否 | 否 | 阶段 6 备选 |
| Azure AI Search | `shared_azureaisearch` | 否 | 否 | 阶段 6 的检索端（表型） |
| Microsoft Dataverse | `shared_commondataserviceforapps` | 否 | 是 | 阶段 4：阅读进度、收藏 |
| Office 365 Users | `shared_office365users` | 否 | 是 | 用户资料扩展 |
| Azure AI Foundry Agent Service | `shared_azureagentservice` | **是** | 否 | 当前租户不可用 |
| HTTP With Microsoft Entra ID | `shared_webcontentsv2` | **是** | 否 | 当前租户不可用，不能拿它当"万能后端" |

Copilot Studio Connector 的动作：

| operationName | 说明 |
|---|---|
| `ExecuteCopilot` | 发消息，只返回 `ConversationId`（异步，不等回答） |
| `ExecuteCopilotAsyncV2` | 发消息**并等待**，返回 `lastResponse / responses[] / conversationId` |
| `GetAgentMakerEvaluationTestSets / ...TestSetDetails / ...TestRuns / ...TestRunDetails` | 读 agent 的评测集与评测结果 |
| `RunAgentMakerEvaluationTestSet` | 触发一次评测 |

Azure OpenAI Connector 的动作：`ChatCompletions_Create_2024Feb15Preview`、`SingleEmbeddings_Create_2024Feb15Preview`、`MultipleEmbeddings_Create_2024Feb15Preview`、`ExtensionsChatCompletions_Create`（On Your Data）。

## 本地调试：`ms app dev`

```bash
ms app dev                                   # 起 config server + npm run dev
ms app dev --local-app-url http://localhost:5173 --config-only   # 自己起 Vite
```

它启动一个本地 config server 并运行 `package.json` 里的 `dev` 脚本，然后打印 `Ready. You can play your app locally at: <url>`。打开这个 URL，宿主会加载你本机的 Vite 页面，于是 `getUser()` 和 Connector 调用在本地也能跑。

CLI 还会检测 `vite.config.ts` 里是否注册了名为 `managedApps` 或 `powerApps` 的 Vite 插件；有插件时由插件提供 config 和 play URL，`--config-only` 就不需要了。本项目没有用插件，走的是默认流程。几点：

- 本地运行同样受许可校验（Power Apps Premium 或 Copilot Credits）。
- CLI 文档写明：**`ms project state` 生成的状态服务不支持 `ms app dev`**，只在 Preview 或已部署的应用里可用。
- 为了让 `npm run dev` 仍能单独工作，SDK 调用要包一层"不在宿主里就降级"的判断（写法见 04）。

## 预览与发布

| 命令 | 作用 |
|---|---|
| `ms app build [--no-wait]` / `build-status` | 平台构建 |
| `ms app deploy [--commit <sha>]` | 构建并上线；本项目用 `scripts/release.sh` 包了一层 |
| `ms app play --mode preview [--branch x]` | 打开某分支或 commit 的 Preview（只对有仓库写权限的人有效） |
| `ms app share <who> [--access play/edit/test]` | 分享 |
| `ms app set-setting` / `get-settings` | 改 `appSettings`，例如 `showHeader` |

## 实验性能力（先知道，先别用）

| 能力 | 开关 | 备注 |
|---|---|---|
| App state（平台托管的按用户 / 共享数据） | `ms feature enable --name state`，`ms.config.json` 里 `state.enabled` | `ms project state add/alter/...` 定义 schema，`generate-code` 生成强类型服务。可替代 Dataverse 做阅读进度，但**实验性**，且不支持 `ms app dev` |
| Managed projects / 多环境部署 / 审批 | `projects`、`alm` | 一个人学习用不到 |

阶段 4（个性化）建议先用 Dataverse 走通"标准做法"，再拿 state 做对比。
