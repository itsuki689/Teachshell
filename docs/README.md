# 技术文档目录

2026-10-28 统一复核。当前应用为独立仓库 `desktop/` 中的 Electron + Vue 3 + TypeScript 实现；保留的 Swift、资源和测试用于兼容性对照，`example/` WPF 不参与。macOS 仅 Apple Silicon，另支持 Windows x64 和 Linux。

## 当前使用与开发

- [项目首页](../README.md)、[开发/测试/构建/安装](../desktop/README.md)、[使用指南](usage.md)。
- [AI 助手](AI.md)、[MCP 接入](MCP.md)：正文为当前 Electron 指引，折叠部分是原生 Swift 历史说明。
- [当前验证](electron/validation.md)、[文件监听诊断与回归](electron/filesystem-watch.md)。
- [Swift 功能映射](electron/feature-map.md)、[JSON/文件兼容契约](electron/data-compatibility.md)：开头注明原生基线与现有实现，不把设计目标当成已验收功能。
- [课程与作业目录](electron/homework-migration.md)、[计划月/周/日](electron/schedule-workspace.md)、[界面与异步状态](electron/ui-sync-migration.md)、[原生交互与平台边界](electron/native-interactions-migration.md)。
- [教学作业/DDL](electron/teaching-sync-migration.md)、[批量审核与版本](electron/teaching-batch-migration.md)、[登录记忆](electron/login-session-migration.md)、[网站后台巡检](electron/background-sync-migration.md)。本地文件监听和联网网站巡检是两套独立机制。
- [课表解析器与授权](../Resources/Timetable/README.md)。

## 历史报告与发布资料

- Electron 阶段报告：[0.1.0](electron/validation-0.1.0.md)、[0.2.0](electron/validation-0.2.0.md)、[0.3.0](electron/validation-0.3.0.md)、[0.3.1](electron/validation-0.3.1.md)、[逐页布局](electron/page-layout-parity.md)、[周视图和外观](electron/appearance-week-parity.md)、[图标控件](electron/controls-parity.md)、[前后端审计](electron/detail-audit-0.3.6.md)。测试数和当时安装状态不改写为当前结果。
- Swift 历史：[验证归档](validation-history.md)、[网站早期方案](web-in-plan.md)、[网站实施记录](web-in-progress.md)。历史路径和步骤仅供研究，不能用来替换原生课屿或修改真实数据。
- 版本说明：[0.3.8](../desktop/release-notes/0.3.8.md)、[0.3.9](../desktop/release-notes/0.3.9.md)、[0.3.10](../desktop/release-notes/0.3.10.md)、[0.3.11](../desktop/release-notes/0.3.11.md)、[0.3.12](../desktop/release-notes/0.3.12.md)。保留历史发布记录；0.3.10 起停止 Intel Mac 分发，0.3.12 汇总输入响应及文件同步修复。

## 维护规则

代码与文档验证通过后按 [AGENTS.md](../AGENTS.md) 提交，并从该提交构建/签名/备份安装 Teachshell；推送和公开发布需用户明确授权。原生 `/Applications/课屿.app` 永不被此流程修改。测试结果注明日期、平台、命令和源提交；源码、打包程序、实际学校登录以及安装向导是不同验收范围。历史报告保留原始证据，当前状态集中在验证页，避免相互矛盾的“最新”计数。
