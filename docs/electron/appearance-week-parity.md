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

安装版逐页报告、Release 签名、备份路径、原生应用保留记录和安装包校验在本页后续验收记录中归档。最新机器回执保存在 `desktop/release/installed-macos.json` 与 `installed-verification.json`。

## 尚存的原生细节差异

课程行的像素潮汐背景、日夜图形持续呼吸/月面滚动尚未逐帧复刻；日夜切换本身及窗口色带动画已实现。周视图仍以既有 Electron 学期选择和课程列表控制管理学期，Swift 的全部课程/固定与活动组合筛选和全部日程外观细节仍需后续对齐。原生 Quick Look 和系统颜色面板采用跨平台预览及 Chromium 颜色选择器。

Windows/Linux 的安装包构建不能替代对应系统的实际运行验收。真实校园账号登录、学校网站变动和平台密钥环仍需在目标环境验证；本轮没有使用用户账号进行联网验收。
