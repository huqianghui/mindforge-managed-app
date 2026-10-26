# Mindforge Managed App

把 [Mindforge](https://github.com/huqianghui/mindforge) 知识库部署为 **Microsoft Copilot Managed Runtime** 上的企业内应用，并以它为练习场，逐步学习 Copilot Studio 与 Managed Runtime 的开发：统计、文档分析、Ask Copilot 等 GitHub Pages 静态站点做不到的能力。

> Managed Runtime 目前是 Preview，CLI 与平台行为可能变化。背景与选型见 [Copilot Managed Runtime 系列 01](https://github.com/huqianghui/mindforge/blob/main/Azure/Copilot-Managed-Runtime/Copilot-Managed-Runtime%E7%B3%BB%E5%88%9701%EF%BC%9A%E6%89%98%E7%AE%A1%E7%8E%AF%E5%A2%83%E5%AF%B9%E6%AF%94%E4%B8%8E%E9%80%89%E5%9E%8B.md)，部署过程见 [系列 02](https://github.com/huqianghui/mindforge/blob/main/Azure/Copilot-Managed-Runtime/Copilot-Managed-Runtime%E7%B3%BB%E5%88%9702%EF%BC%9A%E5%AE%9E%E6%88%98%E9%83%A8%E7%BD%B2%E4%B8%8E%E6%9D%83%E9%99%90%E8%A7%A3%E6%9E%90.md)。

## 和 GitHub Pages 版本的区别

| | GitHub Pages（mindforge 仓库） | 本项目（Managed Runtime） |
|---|---|---|
| 访问 | 公开 | Entra 登录，按人/组分享 |
| 内容 | README 导航 + 文章 + 知识图谱 | 同一份内容，从 mindforge 仓库同步 |
| 能力 | 静态页面 | 可接 Connector（Copilot Studio agent、Azure OpenAI、SharePoint 等），可读取登录用户身份 |
| 定位 | 公开知识库 | 学习与实验 Copilot Studio / Managed Runtime 开发 |

## 结构

```text
src/
  App.tsx              顶部导航 + hash 路由（#/doc/<path>、#/graph）
  GraphPage.tsx        知识图谱（react-force-graph）
  docs/                README 导航与文章阅读：manifest 加载、Markdown 渲染、链接改写
  components/          图谱的筛选栏、节点面板、图例
scripts/
  sync-content.py      从 mindforge 拉取内容到 public/content/
  release.sh           同步 → 本地构建 → 提交 → 推送 GitHub 与平台仓库 → deploy
public/
  content/             同步生成：文章、图片（哈希命名）与 manifest.json
  wiki-graph.json      同步生成：图谱数据
ms.config.example.json Managed Runtime 应用配置模板（真实 ms.config.json 不入库）
```

## 两个远端

| 远端 | 地址 | 用途 |
|---|---|---|
| `github` | 本仓库 | 源码与学习记录 |
| `platform` | Managed Runtime 平台托管仓库 | 平台构建与部署的来源 |

Managed Runtime 不能绑定个人 GitHub 仓库，所以源码推到两处：GitHub 存档，平台仓库负责构建。

`ms.config.json` 含租户内的应用 ID 与环境 ID，不进 GitHub；但平台构建要求它在仓库里（缺失时报 `ms.config.json is required to pack an app`）。所以 `release.sh` 每次在 GitHub 的 `main` 之上临时生成一个只加了 `ms.config.json` 的提交，强制推到平台仓库的 `main` 并部署这个提交。平台仓库的 `main` 因此总是"GitHub main + 1 个配置提交"，不要直接在平台仓库上开发。

## 内容同步

`scripts/sync-content.py` 浅克隆 mindforge 到 `.cache/mindforge`（已 gitignore），只取 git 跟踪的文件：

- `README.md` 以及 `Notes/` `Azure/` `paper/` `book/` `product/` `wiki/` 下的 Markdown
- 这些文章引用到的图片
- `wiki/wiki-graph.json`

文件改用路径哈希命名（避开中文文件名在打包与 URL 上的问题），`manifest.json` 记录原路径、标题和来源 commit。页面左下角显示当前内容对应的 `mindforge@<commit>`。

## 本地开发与发布

前置：Node.js、`npm install -g @microsoft/managed-apps-cli`、Git Credential Manager（平台仓库的 Entra OAuth 依赖它）。

```bash
npm install
ms auth login

# 首次：已有应用就复制模板填入 ID；没有应用就 ms app init 新建
cp ms.config.example.json ms.config.json

python3 scripts/sync-content.py   # 同步内容
npm run dev                       # 本地预览

scripts/release.sh                # 同步并发布到 GitHub 与 Managed App
```

## 学习路线

按"先前端、再数据、再 AI"的顺序一步步加功能，每一步对应一个可部署的版本：

| 阶段 | 功能 | 学习点 | 状态 |
|---|---|---|---|
| 0 | README 导航、文章阅读、知识图谱 | `ms app init / build / deploy / share`、平台仓库与凭据 | ✅ |
| 1 | 洞察页：按分类/类型/标签/置信度/状态/时间筛选；分类 → 节点 → Claim → 原文钻取；分布与趋势图表 | 纯前端；Recharts；筛选状态与图表联动 | ⬜ |
| 2 | 建议卡片：低置信度、stale/冲突 Claim、孤立节点、薄弱分类、近期更新 | 基于数据的规则，可解释、可复现 | ⬜ |
| 3 | 文档统计：文章数量与字数趋势、标签分布、系列完成度、链接健康度 | 构建期预计算 vs 运行期计算 | ⬜ |
| 4 | 个性化：读取登录用户，记录阅读进度与收藏 | SDK `getUser()`；Dataverse 表作为数据源 | ⬜ |
| 5 | Ask Copilot：在 Copilot Studio 中以文章为知识建 agent，应用经 Connector 调用并展示带引用的回答 | Copilot Studio agent 开发；`ms app add data-source`；连接身份与 DLP | ⬜ |
| 6 | 对比：同样的问答改用 Azure OpenAI Connector + 前端检索 | 两种 AI 接入方式的取舍 | ⬜ |
