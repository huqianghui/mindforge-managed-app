# 12 Teams 文档 Agent

> 把应用的"文章导航"能力做成一个 Copilot Studio agent「Mindforge Docs」，发布到 Teams 和 Microsoft 365 Copilot。知识源先用上传文件。基线 2026-10-28。
> 标 **〔待实测〕** 的地方要在租户里跑一次才能确认。

**当前在用的 agent（2026-10-29 起）**：环境「Mindforge Docs (US)」`cd3bb1b6-62a1-ee92-9805-3e71e1b41a08`，区域 `unitedstates`（westus），Dataverse `https://mindforgedocsus.crm.dynamics.com/`；bot id `4f87fa86-24d3-f111-a059-70a8a5af933e`，405 个知识文件，已发布到 Teams 和 M365 Copilot。它**不在**应用所在的环境里：应用环境在抢先体验区域，上传文件的索引在那里一直不完成（见下文"实际创建记录"）。Teams 用户直接和 agent 对话，不经过应用，所以分开放没有影响。

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
4. **Knowledge** → Add knowledge → **Upload files**，选 `agent-knowledge/` 里的 `.md`，不要选 `export.json`。**每次不超过约 45 个**，见下文"上传踩坑"。
5. Settings → Knowledge：**Allow ungrounded responses** 改成 Off（存储里是 `aISettings.useModelKnowledge: false`），**Use information from the Web** 保持 Off（新建默认就是 Off）。否则资料外的问题会用模型自身知识或网页回答，就分不清回答是否来自 mindforge（阶段 5 Work IQ 误判的教训，[03 · 实测 §5](03-Copilot-Studio集成指南.md#实测从-managed-app-调用-standard-agent2026-10-28)）。
6. 上传后等文件状态从 In progress 变成 Ready 再测试。

新建而不复用「Mindforge Ask」：后者的指令是给"应用把 SOURCES 写进消息"那种调用设计的，而且开着上网。

### 实际创建记录（2026-10-28，浏览器自动化）

agent「Mindforge Docs」，bot id `25132acf-bbd2-f111-84e8-7c1e520d5f0d`，schema `mf_MindforgeDocs`，模型 GPT Chat Latest（`GPT56Chat`）。

**上传踩坑。** 第一次把 405 个文件放在一个对话框里一起提交：`PUT .../content/botcomponents` 跑了约 115 秒后返回 412 `DuplicateRecordsFound`，门户随即自动重试，每次都是 400 `ExportKeyInvalidCreate`（`mf_MindforgeDocs.file.00-.md_FuL` 已存在），界面提示 "There was a problem creating your knowledge source."。查 Dataverse 发现第一次请求其实在服务端写完了：405 行 `componenttype = 14`（Bot File Attachment）都在，但都没有文件内容（`filedata_name` 为空），Knowledge 页也不显示。处理：用 Web API 删掉这 405 行，再按每批 45 个重传，每批约 30 秒，9 批都一次成功。可以用 `filedata_name` 是否有值判断一行是否真的传完。

**指令被写坏。** 和 [03 · 一个坑](03-Copilot-Studio集成指南.md#2-一个坑脚本改指令把配置写坏了) 一样：脚本往指令编辑器里粘贴后，界面显示正常，但 `mf_MindforgeDocs.gpt.default` 的 YAML 末尾多出一百多个按字符编号的键（`0: k`、`1: i`……，拼起来是默认模板），`aISettings.model` 变成 `{}`。直接 PATCH `data` 修好。手工在门户里编辑不会这样。

**显示名截断到 100 个字符。** 4 个文件名超长被截短，其中两篇「A Survey of Context Engineering…」截断后同名。文件内容不受影响，只是引用里看起来一样；以后可以在导出脚本里缩短这类文件名。

**索引一直不完成（未解决）。** 上传后两个多小时，405 个文件全是 In progress，测试面板检索返回 "No information was found that could help answer this."。排查记录：

- 环境的 Dataverse search 原本是关的（`organizations.isexternalsearchindexenabled = false`）。21:33 用 Web API 改成 `true`，PPAC → Settings → Features 随即显示 "Dataverse search: On"；`GET /api/data/v9.2/copilottextdatastatus` 返回 `status: provisioned`。
- 改完之后新传一个小文件 `zz-index-probe.md`（里面一个暗号），40 分钟后状态仍是 In progress（门户新版界面里显示 Unknown），问暗号同样检索不到。所以光开 Dataverse search 不够，至少不能马上见效。
- 这个环境是 Developer 类型，区域是 **Preview (United States)**，门户走 `copilotstudio.preview.microsoft.com`。文件索引卡住可能和预览区域有关，〔待实测：同样的文件在正式区域的环境里多久变成 Ready〕。

结论：原因是区域。应用环境 `0b768ed1-…` 的区域实际是 `unitedstatesfirstrelease`（抢先体验，新功能先在这里上线）。2026-10-29 新建了一个正式区域 `unitedstates` 的 Developer 环境（BAP API `POST /providers/Microsoft.BusinessAppPlatform/environments`，20 秒建好），只传一篇 Prompt Cache 系列 01，约 5 分钟就能检索到并带引用回答。同一个文件在旧环境里放了一整晚都检索不到。之后在新环境建了正式的 agent，旧环境里的 agent 只留作记录，确认新的能用后删掉。

**新环境的做法**（2026-10-29）：

- 先建成「Mindforge Docs Test」，确认能检索后改名为「Mindforge Docs」继续用，schema 因此是 `new_MindforgeDocsTest`。新环境里没有 Mindforge 解决方案，agent 放在默认解决方案里。
- 指令和设置不经过门户编辑器，直接用 Web API 写：PATCH `new_MindforgeDocsTest.gpt.default` 的 `data`，内容是旧 agent 的整份 YAML（含 `webBrowsing: false`）；PATCH `bots.configuration`，把 `aISettings.useModelKnowledge` 设为 `false`。新建的 agent 默认这两项是**开**的，`webBrowsing: true`、`useModelKnowledge: true`。
- 文件仍按每批 45 个上传，9 批共 404 个，每批 35～45 秒，没有出错。
- 新版门户的状态栏显示 Unknown，但实际能检索到，以测试面板的回答为准。

## 第三步：测试

在测试面板里问下面几类问题，判断标准写在右边：

| 问题 | 应该看到 |
|---|---|
| Copilot Managed Runtime 里 App state 和 Dataverse 怎么选？ | 引用"系列 08"等文章，来源行带 GitHub 链接 |
| Prompt Cache 两代框架有什么区别？ | 引用 Prompt Cache 系列 01 |
| Azure 下有哪些文章？ | 按 `00-目录.md` 列出带链接的标题 |
| 埃菲尔铁塔有多高？ | 拒答，**不能**答出高度 |
| What is Voice Live? | 英文回答，来源段落标题是 Sources |

"裸问题"最关键：判断"是 agent 在按指令答"，要看只有这份指令才会产生的行为（拒答常识题、`来源` 段落），不能看回答是否通顺（[11 · 教训](11-方案讨论.md#一问答的后端)）。拒答题要先 `grep agent-knowledge/` 确认知识库里真的没有：原来用的"澳大利亚的首都是哪里？"出现在 Copilot Managed Runtime 系列 10 里（那篇正是拿它做实验），agent 引用系列 10 答出堪培拉，这是按知识库答，不算违规。

实测（2026-10-29，新环境）：

| 问题 | 结果 |
|---|---|
| App state 和 Dataverse 怎么选？ | ✅ 引用系列 08、12，`来源` 段落带 GitHub 链接 |
| Prompt Cache 两代框架有什么区别？ | ✅ 引用系列 01 |
| Azure 下有哪些文章？ | ⚠️ 按 `00-目录.md` 列出 48 篇，但输出里混着 `citeturn102search0` 这类残留标记，列表很长、输出要几分钟 |
| 埃菲尔铁塔有多高？ | ✅ 没有编造；回的是系统的 "No information was found that could help answer this."，不是指令里的"知识库里没有相关内容。"（看起来检索为空时直接走了系统兜底话术，没有进入按指令生成这一步；未验证） |
| What is Voice Live? | ✅ 英文回答，引用 Voice Live 系列 01，段落标题是 Sources |

## 第四步：发布到 Teams

和「Mindforge Ask」相同（[03 · 发布前必须有渠道](03-Copilot-Studio集成指南.md#3-发布前必须有渠道)）：

1. **Channels** → 添加 **Microsoft 365 and Microsoft Teams**，保留 "Make agent available in Microsoft 365 Copilot"。界面可能一直显示 "Turning on Teams…"，上次 6 分钟后刷新才发现已经加好。
2. **Publish**。以 Dataverse `bots.publishedon` 有值为准。
3. 渠道面板的 **See agent in Teams** 打开自己的 Teams 测试。
4. 给别人用：**Share** 给指定用户或组，或提交管理员批准后上架到组织的应用目录 〔待实测：本租户的审批流程〕。

实际记录（2026-10-28）：新版门户里 Channels 在顶部标签的 "+2" 菜单里，不在 `/channels` 路径（那个地址打开是空白页）。点 **Add channel** 后显示 "Turning on Teams ..."，不到一分钟就弹出 "Ready to publish?"，直接 Publish；`bots.publishedon = 2026-10-28T13:31:35Z`。知识索引没完成时也能发布，发布后 agent 在 Teams 里能对话，但检索不到内容。

新环境（2026-10-29）同样操作：Add channel 后约 1 分钟弹出 "Ready to publish?"，Publish 后 40 秒 `bots.publishedon = 2026-10-29T00:01:31Z`。

费用：用户没有 M365 Copilot 许可证时，生成式回答消耗 Copilot Credits 〔待实测：在 admin center 的 Cost management 里核对〕。

## 更新内容

```bash
python3 scripts/sync-content.py && python3 scripts/export-for-agent.py
```

按脚本打印的 added / changed / removed：在 Knowledge 里删掉 removed 和 changed 的旧文件，上传 added 和 changed 的新文件，然后 **Publish**。`00-目录.md` 只要有文章增删就会变，也要重传。

手工重传是这一阶段的代价。下一步换成 SharePoint 文档库：同步脚本或 Power Automate 把文章写进文档库，agent 挂文档库，内容自动保持最新。

## 待实测

- 上传文件数上限：`.md` 可以上传，405 个全部接受；500 个的上限没有验证。
- 正式区域里单个文件约 5 分钟可检索；405 个全部传完 10 分钟后抽测的 5 题都能检索到，但没有逐个确认每个文件。
- `00-目录.md` 类长列表回答里的 `cite…turn…search…` 残留标记能否通过指令去掉。
- 引用卡片里显示的是文件名还是文章标题；如果是文件名，`__` 分隔的路径是否好认。
- 同名文章更新后，覆盖上传与"先删后传"是否有区别。
