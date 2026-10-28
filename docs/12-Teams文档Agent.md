# 12 Teams 文档 Agent

> 把应用的"文章导航"能力做成一个 Copilot Studio agent「Mindforge Docs」，发布到 Teams 和 Microsoft 365 Copilot。知识源先用上传文件。基线 2026-10-28。
> 标 **〔待实测〕** 的地方要在租户里跑一次才能确认。

## 为什么这条路走得通

阶段 5 没走通的是 **app → agent**：从浏览器里的 managed app 同步调用 agent（[11 · 一](11-方案讨论.md#一问答的后端)）。这里是反方向：**Teams 里的用户 → agent → mindforge 文章**，是 Copilot Studio 的常规用法，不经过 managed app，也就不受它的 Connector 和 CSP 限制。

和应用的分工：

| 应用的功能 | Teams agent |
|---|---|
| 搜索、按问题找文章 | ✅ 回答带引用 |
| 摘要、跨文章对比、解释概念 | ✅ |
| 打开原文 | ✅ 给 GitHub 链接（应用链接打不开具体文章，见下文） |
| 目录树 | ⚠️ 按 `00-目录.md` 用文字列出 |
| 阅读进度、收藏 | ❌ 在 App state 里，agent 读不到 |
| 图谱、洞察、演进等可视化 | ❌ 留在应用里 |

## 第一步：导出知识文件

```bash
python3 scripts/sync-content.py        # 从 mindforge 同步到 public/content
python3 scripts/export-for-agent.py    # 生成 agent-knowledge/（已 gitignore）
```

产出（mindforge@040c9fa）：405 个文件，约 6.1 MB。

| 文件 | 内容 |
|---|---|
| `<路径，/ 换成 __>.md` × 404 | 原文；frontmatter 之后插入三行：文章标题、仓库路径、GitHub 原文链接。正文的相对链接和图片改成 GitHub 绝对地址，agent 只看得到文本 |
| `00-目录.md` | 按分类列出全部文章，每篇带 GitHub 链接，用来回答"有哪些文章" |
| `export.json` | 每个文件的哈希；再次导出时脚本打印新增、修改、删除的文件，只需重传这些 |

文件名用仓库路径而不用 `public/content/d/` 里的哈希名，是为了引用里能看出是哪篇。最长的文件名 139 字节。

### 原文链接为什么只放 GitHub

本想优先链到应用：`https://play.preview.managedapps.cloud.microsoft/apps/<app>/#/doc/<路径>`。实测（2026-10-28）打开的总是 README：宿主建的 iframe 地址只有 `…/_platform/app/loader?ms_embedderOrigin=…`，外层地址的 `#/doc/...` 和 `?doc=...` 都没带进去；SDK 的 `getContext()` 也只返回 appId、environmentId、sessionId。应用不知道要打开哪篇，改应用代码也没用。GitHub 链接谁都能打开，所以只放它。

## 第二步：建 agent

1. Agents → **New agent** 右侧下拉 → **Agent（Standard）**。新建默认是 GitHub Copilot harness，一问一答的知识库用它会"想太多"，更慢也更费 Credits（[05](05-Copilot-Studio-Harness对比.md)）。
2. 名称 `Mindforge Docs`；Agent settings 里解决方案选 **Mindforge**，schema name 因此是 `mf_MindforgeDocs`。
3. **Instructions**：粘贴 [`agent/mindforge-docs-instructions.md`](../agent/mindforge-docs-instructions.md) 的全文。
4. **Knowledge** → Add knowledge → **Upload files**，选 `agent-knowledge/` 里全部 `.md`，不要选 `export.json`。〔待实测：每个 agent 的上传文件数上限，印象中是 500，现在 405 个；`.md` 是否支持〕
5. 关掉 **Web search** 和 **Use general knowledge**。否则资料外的问题会去查网页，就分不清回答是否来自 mindforge（阶段 5 Work IQ 误判的教训，[03 · 实测 §5](03-Copilot-Studio集成指南.md#实测从-managed-app-调用-standard-agent2026-10-28)）。
6. 上传后等文件状态变成 Ready 再测试。

新建而不复用「Mindforge Ask」：后者的指令是给"应用把 SOURCES 写进消息"那种调用设计的，而且开着上网。

## 第三步：测试

在测试面板里问下面几类问题，判断标准写在右边：

| 问题 | 应该看到 |
|---|---|
| Copilot Managed Runtime 里 App state 和 Dataverse 怎么选？ | 引用"系列 08"等文章，来源行带 GitHub 链接 |
| Prompt Cache 两代框架有什么区别？ | 引用 Prompt Cache 系列 01 |
| Azure 下有哪些文章？ | 按 `00-目录.md` 列出带链接的标题 |
| 澳大利亚的首都是哪里？ | "知识库里没有相关内容。"，**不能**答出堪培拉 |
| What is Voice Live? | 英文回答，来源段落标题是 Sources |

最后一类"裸问题"最关键：判断"是 agent 在按指令答"，要看只有这份指令才会产生的行为（拒答常识题、`来源` 段落），不能看回答是否通顺（[11 · 教训](11-方案讨论.md#一问答的后端)）。

## 第四步：发布到 Teams

和「Mindforge Ask」相同（[03 · 发布前必须有渠道](03-Copilot-Studio集成指南.md#3-发布前必须有渠道)）：

1. **Channels** → 添加 **Microsoft 365 and Microsoft Teams**，保留 "Make agent available in Microsoft 365 Copilot"。界面可能一直显示 "Turning on Teams…"，上次 6 分钟后刷新才发现已经加好。
2. **Publish**。以 Dataverse `bots.publishedon` 有值为准。
3. 渠道面板的 **See agent in Teams** 打开自己的 Teams 测试。
4. 给别人用：**Share** 给指定用户或组，或提交管理员批准后上架到组织的应用目录 〔待实测：本租户的审批流程〕。

费用：用户没有 M365 Copilot 许可证时，生成式回答消耗 Copilot Credits 〔待实测：在 admin center 的 Cost management 里核对〕。

## 更新内容

```bash
python3 scripts/sync-content.py && python3 scripts/export-for-agent.py
```

按脚本打印的 added / changed / removed：在 Knowledge 里删掉 removed 和 changed 的旧文件，上传 added 和 changed 的新文件，然后 **Publish**。`00-目录.md` 只要有文章增删就会变，也要重传。

手工重传是这一阶段的代价。下一步换成 SharePoint 文档库：同步脚本或 Power Automate 把文章写进文档库，agent 挂文档库，内容自动保持最新。

## 待实测

- 上传文件数与格式的上限（第二步第 4 条）。
- 引用卡片里显示的是文件名还是文章标题；如果是文件名，`__` 分隔的路径是否好认。
- 同名文章更新后，覆盖上传与"先删后传"是否有区别。
