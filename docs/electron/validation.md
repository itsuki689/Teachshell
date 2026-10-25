> 最新：**0.3.3 周视图与外观同步**，核心 299/299、新增外观与周视图验收 10 组。见 [对照与验收记录](appearance-week-parity.md)。

> 最新：**0.3.2 逐页布局同步**，核心 293/293、安装版 UI 111/111；已构建并校验五个安装包。见 [逐页对照与验收](page-layout-parity.md)。下文保留 0.3.1 的历史记录。

# Teachshell 0.3.1 界面同步验收

日期：2026-10-25。功能提交：`f04e096`。本轮重新阅读 Swift 实现、复现真实界面问题并修复；原生 `/Applications/课屿.app` 始终保留，只更新 `/Applications/Teachshell.app`。历史报告见 [0.3.0](validation-0.3.0.md)。

## 实际修改

- `Sidebar.vue`、`LibraryView.vue`、`workspace-ui`：学期同时筛选课程和资料；多关键词跨字段匹配，包含未分类；上下键、Home/End、Shift 范围选择及全选；取消丢弃时复选框、行选中和实际状态一致。
- `PlansView.vue`、`TimetableView.vue`、共享 UI store：保留列表/封面、月历/日程、课表展示模式；月历日期和课表周次共享选择，导航不丢失，切库不串库。仅展示枚举写入本机 localStorage。
- `Repository`、安全 IPC、`library` store、`App.vue`：瞬态工作区身份和快照序号阻止旧结果回退；菜单、快捷键遵循未保存和模态保护；切库清理旧编辑器及异步结果，文件操作绑定原 Repository。原 JSON 格式和数据 revision 不变。
- `MaterialInspector.vue`：保存期间续写的草稿保留；后续外部修改同字段时正确报告冲突，不静默覆盖。首次拖动未选中资料会成功，未保存草稿阻止离开。
- `HomeworkView.vue`、`ChatView.vue`：读取新作业课程时清除旧行；旧课程操作及切库卸载请求不作用于新位置；清空聊天后迟到历史不再复活。
- `WebsiteDialog.vue`、两个网站设置组件：旧网页响应不覆盖新网站类型；单项审核过期、账号变化即时失效；初始设置回复不覆盖更新事件。主进程拒绝旧账号写入的保护继续验证。

Swift 对照、异步约束与测试入口详见 [界面同步迁移说明](ui-sync-migration.md)。未修改 Swift 源码、原生测试或 `example/`。

## 已执行测试

全量核心 **293/293**，失败/跳过均 0：[完整日志](evidence/0.3.1/node-tests.txt)。TypeScript、生产构建、定向 Prettier 与 `git diff --check` 通过。

以下 **105/105** 全部直接运行 `/Applications/Teachshell.app/Contents/MacOS/Teachshell`，使用隔离临时资料库：[完整安装版日志](evidence/0.3.1/installed-tests.txt)。

| 安装版验收                             | 通过 | 报告                                                       |
| -------------------------------------- | ---: | ---------------------------------------------------------- |
| 课程/课件/计划/课表/网站/AI/MCP 主闭环 |   28 | [报告](evidence/0.3.1/teachshelf-electron-e2e.json)        |
| 批量审核与版本恢复                     |   12 | [报告](evidence/0.3.1/teachshell-website-batch-e2e.json)   |
| 分钟拖动和缩放                         |    9 | [报告](evidence/0.3.1/teachshell-schedule-drag-e2e.json)   |
| 自定义顶栏                             |    8 | [报告](evidence/0.3.1/teachshell-toolbar-e2e.json)         |
| 登录记忆与安全存储                     |    7 | [报告](evidence/0.3.1/teachshell-login-ui-packaged.json)   |
| 后台实际定时巡检                       |    9 | [报告](evidence/0.3.1/teachshell-background-e2e.json)      |
| 打开中的审核实时变化                   |    7 | [报告](evidence/0.3.1/teachshell-review-live-e2e.json)     |
| 快照顺序、菜单保护与切库               |    6 | [报告](evidence/0.3.1/teachshell-workspace-e2e.json)       |
| 草稿、作业目录与聊天竞态               |    6 | [报告](evidence/0.3.1/teachshell-component-sync.json)      |
| Swift 交互、筛选、首次拖拽及视图记忆   |    8 | [报告](evidence/0.3.1/teachshell-ui-parity-e2e.json)       |
| 网站类型、单项失效及设置事件           |    5 | [报告](evidence/0.3.1/teachshell-website-context-e2e.json) |

Browser 插件不可用，采用 Playwright Electron 的真实主窗口、preload、IPC、鼠标和键盘。页面身份、非空布局、框架错误遮罩及控制台异常均检查；正常 1260×800 与最小 1020×680、浅色/深色已验收。竞态测试延迟真实操作返回，学校网页及模型服务使用受控夹具；后台计时实际等待 30 秒和禁用后的 31 秒。另有源码 Chromium 传输/登录宿主测试通过：[日志](evidence/0.3.1/source-regression.txt)。

截图：[最小窗口深色资料](evidence/0.3.1/screenshots/teachshell-ui-parity-library-dark.png)、[月历](evidence/0.3.1/screenshots/teachshell-ui-parity-calendar-light.png)、[课表](evidence/0.3.1/screenshots/teachshell-ui-parity-timetable-light.png)。全部使用合成数据，不修改用户真实资料。

## Release、安装与保留原生应用

功能提交 `f04e096` 从独立 Git 快照构建，应用及 Keychain helper 签名验证通过。正常退出旧 Teachshell、保留可恢复副本后安装，注册并打开新版；安装时验证实际执行路径、版本、commit 及 app.asar 一致。功能验收回执见 [安装记录](evidence/0.3.1/installed-f04e096.json)。后续仅报告提交仍执行相同 Release 流程；最新回执为 `desktop/release/installed-macos.json`，最终校验为 `desktop/release/installed-verification.json`。

原生课屿版本 1.16.0、可执行文件和 Info.plist SHA256、bundle 修改时间前后完全相同：[保留证据](evidence/0.3.1/native-app-preserved.json)。

本轮安装包均为功能提交 `f04e096` / 0.3.1，位于 `desktop/release/`：

- macOS ARM64：`Teachshell-0.3.1-arm64.dmg`、`Teachshell-0.3.1-arm64-mac.zip`
- Windows x64：`Teachshell Setup 0.3.1.exe`
- Linux x64：`Teachshell-0.3.1.AppImage`、`teachshelf-desktop_0.3.1_amd64.deb`

归档完整性、包内版本、主进程/preload/renderer/stdio 载荷、架构和校验和见 [载荷清单](evidence/0.3.1/release-manifest.json)、[SHA256](evidence/0.3.1/SHA256SUMS.txt)、[验证日志](evidence/0.3.1/verification.txt)。Mac 为 ad-hoc 签名，未公证；Windows 无发布签名。没有远程推送、合并或发布。

## 尚未覆盖

Windows/Linux 已构建安装包，本轮没有对应桌面实机，不能把交叉构建视为实机交互或安全密钥环验收。真实校园账号、网络/VPN及学校页面变更仍需真实环境验证。像素级布局、Office 原生缩略图、Quick Look 等仍有平台差异；本轮没有声明整个应用已经与原生版完全等价。
