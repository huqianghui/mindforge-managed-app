# 开发文档

| 文档 | 内容 | 什么时候看 |
|---|---|---|
| [01 项目现状剖析](01-项目现状剖析.md) | 代码地图、路由、两份数据的结构与规模、内容同步、两个远端的发布机制、现状检查结果 | 第一次接手项目 |
| [02 Managed Runtime 与 SDK 参考](02-Managed-Runtime与SDK参考.md) | CLI / SDK / 宿主三层；`getUser`、`getContext`、`DataClient` 接口；`ms app add data-source`；本租户可用的 Connector；`ms app dev` | 写任何调用平台能力的代码之前 |
| [03 Copilot Studio 集成指南](03-Copilot-Studio集成指南.md) | 建 agent、加知识源、接 Copilot Studio Connector、引用解析、身份与费用、评测动作 | 做路线图阶段 5 |
| [04 新功能开发指南](04-新功能开发指南.md) | 加页面的套路、代码约定、路线图 1–6 阶段的具体设计 | 开始做任何新功能 |
| [05 Copilot Studio Harness 对比](05-Copilot-Studio-Harness对比.md) | Standard / GitHub Copilot / Copilot Chat 三种 harness 的能力、计费、能否从 managed app 调用 | 决定 Ask Copilot 用哪种 agent 之前 |
| [06 托管位置与连接链路](06-托管位置与连接链路.md) | managed app 的域名、区域；CSP 是什么、本应用的 CSP；宿主为何用 iframe 装应用却不让应用再嵌 iframe；宿主 JSON-RPC 方法表；三种 harness 各自跑在哪；应用到 agent 的每一跳；实验性的 Cowork 通道 | 想知道"为什么这条路走不通"时 |
| [07 Agent、Workflow、App 协作模式](07-Agent-Workflow-App协作模式.md) | 三者的定位与调用关系；共享数据、同步调用、触发 workflow 三种模式；按场景选择 | 设计一个功能要用到 agent 或 workflow 时 |
| [08 Connector 全景](08-Connector全景.md) | Connector 与连接的区别、连接引用、数据源；在哪里看和配置；属性与费用；本租户可用目录；app、agent、workflow 用法的区别；参考应用只用两个 Connector 的实例；附 Copilot Studio 与 Power Platform 的关系 | 选数据源或 AI 接入方式之前 |
| [09 环境与自定义 Connector](09-环境与自定义Connector.md) | 环境的概念、类型、本项目环境的实况与不活动清理规则、创建与 ALM；用自定义 Connector 接自己的 API（本租户被阻止） | 要分开发 / 生产，或要接自己的后端时 |

文中 **〔待实测〕** 标记的是官方文档没写清、需要在租户里跑一次才能确认的行为；实测后请把结论回填，去掉标记。

平台是 Preview。文档基线：`ms` CLI 0.31.0、`@microsoft/managed-apps` 0.6.0、2026-10-26。升级 CLI 或 SDK 后，先重新核对 02。
