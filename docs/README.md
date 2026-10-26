# 开发文档

| 文档 | 内容 | 什么时候看 |
|---|---|---|
| [01 项目现状剖析](01-项目现状剖析.md) | 代码地图、路由、两份数据的结构与规模、内容同步、两个远端的发布机制、现状检查结果 | 第一次接手项目 |
| [02 Managed Runtime 与 SDK 参考](02-Managed-Runtime与SDK参考.md) | CLI / SDK / 宿主三层；`getUser`、`getContext`、`DataClient` 接口；`ms app add data-source`；本租户可用的 Connector；`ms app dev` | 写任何调用平台能力的代码之前 |
| [03 Copilot Studio 集成指南](03-Copilot-Studio集成指南.md) | 建 agent、加知识源、接 Copilot Studio Connector、引用解析、身份与费用、评测动作 | 做路线图阶段 5 |
| [04 新功能开发指南](04-新功能开发指南.md) | 加页面的套路、代码约定、路线图 1–6 阶段的具体设计 | 开始做任何新功能 |

文中 **〔待实测〕** 标记的是官方文档没写清、需要在租户里跑一次才能确认的行为；实测后请把结论回填，去掉标记。

平台是 Preview。文档基线：`ms` CLI 0.31.0、`@microsoft/managed-apps` 0.6.0、2026-10-26。升级 CLI 或 SDK 后，先重新核对 02。
