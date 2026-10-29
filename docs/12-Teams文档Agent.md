# 12 Teams 文档 Agent

> 2026-10-29 起，Copilot Studio agent「Mindforge Docs」单独放在 [mindforge-copilot-agent](https://github.com/huqianghui/mindforge-copilot-agent) 仓库维护：指令、topic、设置、知识导出脚本，以及原来这篇文档的全部内容（[docs/operations.md](https://github.com/huqianghui/mindforge-copilot-agent/blob/main/docs/operations.md)）。本仓库不再包含 agent 相关的文件。

和本应用的关系，简要记在这里：

- agent 回答"按问题找文章、摘要、对比"这类问题，原文链接只给 GitHub：应用宿主不把 URL 的 hash 和 query 传进应用，应用链接打不开具体文章。
- 阅读进度、收藏在应用的 App state 里，agent 读不到；图谱、洞察等可视化也只在应用里。
- agent 不在本应用所在的环境 `0b768ed1-…`，而是在单独的「Mindforge Docs (US)」环境：本应用环境属于抢先体验区域（`unitedstatesfirstrelease`），Copilot Studio 上传文件的索引在那里一直不完成。在这个环境里做 Copilot Studio 文件知识前，先看那边的记录。
- 知识文件直接从 mindforge 仓库生成，不依赖本仓库的 `sync-content.py`。
