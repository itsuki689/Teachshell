# Teachshell 0.3.3：周视图与外观同步

本轮读取原生课屿的实际 Swift 实现，并只读查看正在运行的原生计划页、设置页和强调色编辑器。原生课屿保持独立，安装目标始终是 `/Applications/Teachshell.app`；不修改 Swift 源码、`example/` 或用户资料库。

## 对照及实现

| Swift 依据 | 本轮实际改动 | 数据与交互 |
| --- | --- | --- |
| `ScheduleWorkspace`、`ScheduleWeekMetrics`、`ScheduleWeekTimeline` | `workspace-ui`、`Sidebar`、`PlansView`、`TimetableView`、`TaskEditor` | 计划首次进入周视图；记住月/周/日选择，列表作为单独入口。没有导入学期时，按真实北京时间显示七天并管理本地计划；前后周、本周、日期跳转、选择日期创建、全天/截止提醒、双击编辑；保留拖拽、边界缩放和键盘调时。网格按窗口可用高度伸缩。 |
| `ColorPalette`、`AccentColorEditor`、`AppTheme` | `shared/appearance`、`AccentColorEditor`、`AppearanceHost` | 原版十二预设、六位 HEX 规范化、颜色选择器、500px 编辑器、整窗预览、取消恢复及恢复默认。正文强调色按背景满足 4.5:1，增强对比度时 7:1；白字按钮单独计算背景颜色。课程边框开关保留各课程颜色。 |
| `SettingsWorkspace`、`AppearanceTransitionSettingsControl` | `AppearanceSettings`、`SettingsView` | 显示模式、个性配色、切换动效分组；开关、四方向、0.5–2× 速度、单色/彩虹十色、HEX、预览和重置；后台文件同步不覆盖正在输入的动效 HEX。 |
| `AppearanceTransition`、`AppearancePreference`、`DayNightToggle` | `AppearanceCurtain`、`AppearanceHost`、`DayNightArtwork`、`stores/appearance` | 0.74/速度秒，覆盖/停留/揭开比例 40/10/50，十条错峰色带；覆盖完成才切换界面，揭开中反转保留当前透明度。日夜开关用原版图形坐标绘制太阳、月亮、云层和星星；右键选择系统/浅色/深色。连续选择由主进程持久队列保存，预览不写库；减少动态效果、隐藏窗口和切库立即收束。 |
| `LibraryRepository+Preferences`、`LibraryState` | `Repository.saveAppearance`、main IPC、preload、API | 直接保存原有 `appearance`、`accentColor`、`showCourseBorders`、`appearanceTransition` 字段。保留其他 JSON 字段及未来动效字段，不改变课程/课件/计划。严格输入及资料库身份校验；即时偏好按最后选择串行保存，颜色编辑器保留 revision 冲突检查；通过原子事务及关闭等待写入。 |

外观以当前资料库 JSON 为准。旧 Desktop 全局 `theme` 不再覆盖导入的 Swift 外观；旧 `saveSettings({theme})` 接口仍兼容写入当前库。仅视图枚举保存在本机 localStorage；旧版本只记录列表模式时，新版计划入口采用周视图。

## 验证

- `npm test`：299/299，失败、跳过均为 0。包含真实 Swift JSON、文件原件、重命名/移动、原子失败恢复、AI/MCP、外观字段及未知字段往返、颜色对比度和动画反转测试。
- `npm run build`：TypeScript、Vue、Vite、Electron 和 Keychain helper 生产构建通过；修改文件 Prettier 与 `git diff --check` 通过。
- `appearance-week.e2e.mjs`：10 组真实 Electron 验收。包含未导入学期的周计划闭环、月份记忆、颜色取消前后索引字节相同、无效 HEX 和错误资料库拒绝、后台同步期间草稿保留、动画预览零写入、快速切换、减少动态效果、系统模式、连续写入后立即退出/重启及切库。
- 逐页检查：全部资料、课程、收藏、最近、未分类、作业、计划列表、月/周/日、AI、教学网站、七个设置分类，以及课程/计划/颜色编辑器。正常 1260×800 浅色与最小 1020×680 深色；检查非空页面、无框架错误遮罩、无控制台异常、实际鼠标/键盘和数据持久化。
- 浏览器插件不可用，使用 Playwright Electron。所有自动化使用临时合成资料库及受控网络夹具，不打开原生真实资料库进行写入。

安装版 **121/121** 全部通过，直接启动 `/Applications/Teachshell.app/Contents/MacOS/Teachshell`，未使用开发服务器。完整日志：[核心测试](evidence/0.3.3/node-tests.txt)、[安装版逐页验收](evidence/0.3.3/installed-tests.txt)、[外观与周视图报告](evidence/0.3.3/appearance-week-report.json)、[其余传输回归](evidence/0.3.3/source-regression.txt)。

| 安装版套件 | 通过 |
| --- | ---: |
| 课程、课件、计划、课表、AI/MCP 主闭环 | 28 |
| 增量同步、批量审核与版本恢复 | 12 |
| 调课/计划拖拽、键盘微调和边界缩放 | 9 |
| 自定义顶栏 | 8 |
| 登录记忆、安全存储及立即退出 | 7 |
| 后台实际计时巡检 | 9 |
| 打开中的审核实时变化 | 7 |
| 工作区身份与快照顺序 | 6 |
| 草稿、作业目录、聊天竞态 | 6 |
| 筛选、选择、日期与视图同步 | 8 |
| 逐页布局 | 6 |
| 本轮默认周视图与外观 | 10 |
| 网站上下文与单项失效 | 5 |

截图：[本地周计划](evidence/0.3.3/screenshots/appearance-week-local-plan.png)、[强调色编辑](evidence/0.3.3/screenshots/appearance-accent-preview.png)、[切换动效](evidence/0.3.3/screenshots/appearance-transition.png)、[最小深色窗口](evidence/0.3.3/screenshots/appearance-dark-settings-外观.png)。其余页面和套件明细在同一证据目录。

## Release 与安装

功能提交 `5bf86e2`，版本 0.3.3。从该提交构建的应用及 Keychain helper 均通过严格签名验证；正常退出旧 Teachshell、备份、替换、注册并打开新版。实际窗口已用原生界面工具核对计划周视图、外观设置和关于页；页面 file URL、可执行路径、版本和提交一致。[安装回执](evidence/0.3.3/installed-5bf86e2.json) 包含备份路径与载荷哈希。[更新前 0.3.2 备份](evidence/0.3.3/previous-release-backup.json) 仍可完整恢复。[原生课屿保留证据](evidence/0.3.3/native-app-preserved.json) 确认 1.16.0 的可执行文件、Info.plist 和 bundle 修改时间均未变化。

本轮五个安装包位于 `desktop/release/`，均为 0.3.3 / `5bf86e2` 的相同功能载荷：

- `Teachshell-0.3.3-arm64.dmg`、`Teachshell-0.3.3-arm64-mac.zip`
- `Teachshell Setup 0.3.3.exe`
- `Teachshell-0.3.3.AppImage`、`teachshelf-desktop_0.3.3_amd64.deb`

归档完整性、版本、主进程/preload/renderer/stdio、架构及 Mac helper 已校验：[安装包清单](evidence/0.3.3/release-manifest.json)、[SHA256](evidence/0.3.3/SHA256SUMS.txt)、[校验日志](evidence/0.3.3/package-verification.txt)。Mac 为 ad-hoc 签名，未公证；Windows 未签名。没有远程推送、合并或发布。

报告提交之后仍按项目约定重建、备份安装，并核对功能载荷与以上 121 项验收版本逐字节一致。最新机器回执为 `desktop/release/installed-macos.json` 与 `installed-verification.json`。

## 尚存的原生细节差异

课程行的像素潮汐背景、日夜图形持续呼吸/月面滚动尚未逐帧复刻；日夜切换本身及窗口色带动画已实现。周视图仍以既有 Electron 学期选择和课程列表控制管理学期，Swift 的全部课程/固定与活动组合筛选和全部日程外观细节仍需后续对齐。原生 Quick Look 和系统颜色面板采用跨平台预览及 Chromium 颜色选择器。

Windows/Linux 的安装包构建不能替代对应系统的实际运行验收。真实校园账号登录、学校网站变动和平台密钥环仍需在目标环境验证；本轮没有使用用户账号进行联网验收。
