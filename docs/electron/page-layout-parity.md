# 0.3.2 逐页布局同步

本轮以 `Sources/Teachshelf` 中的实际 SwiftUI 视图为基准；另外只读查看原生课屿的课程、周课表和设置窗口，结束后恢复原课程页。未修改 Swift 源码、原生应用包或用户资料库。Teachshell 与课屿继续并存。

## 对照与改动

| 页面 / 原版依据                                                           | 原有差异                               | 本轮调整                                                                                                                              |
| ------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 全局框架：`ContentView`                                                   | 搜索挤在右端，课程行带教师副标题与色条 | 返回/前进靠主区左侧，搜索居中；课程单行、方形色块，教师与学期保留在悬停提示；深色背景改为中性灰                                       |
| 资料、课程、收藏、最近、未分类：`WorkspaceCommandBar`、`LibraryWorkspace` | 标题偏小，详情压缩资料表格             | 28px 标题、计数徽标、24px 水平留白；详情抽屉覆盖画布，宽度 `min(320px, 44%)`，不改变列表宽度                                          |
| 计划列表：`TaskWorkspace`                                                 | 大卡片，没有固定详情栏                 | 紧凑状态/计划/执行/截止/操作列；右侧常驻 230–290px 详情；筛选在左，搜索在右                                                           |
| 周课表：`ScheduleWorkspace`                                               | 大标题、筛选及详情全部堆在顶部         | 左侧 48px 周次栏与时间网格；右侧 224–300px 选项和详情，月/周/日入口、底部新建计划；网格与选项分别滚动                                 |
| 月历、日程：`ScheduleWorkspace`                                           | 顶部命令栏占用日历空间                 | 日期导航在左侧上方；视图、筛选与所选日期内容在右侧；共享日期和视图记忆不变                                                            |
| 作业：`HomeWorkWorkspace`                                                 | 单行文件列表，没有日期与类型列         | 主操作在标题右侧；目录控制、面包屑和搜索分行；名称/修改日期/类型/大小列及底部项目数和路径。元数据来自真实目录                         |
| AI：`AIChatWorkspace`                                                     | 共用资料页的大标题与留白               | 18px 标题、20px 头部、24px 消息留白；模型设置直接进入 AI 设置标签                                                                     |
| 设置：`SettingsWorkspace`                                                 | 所有配置堆在一页                       | 外观/顶栏/资料库/备份/AI 助手/MCP/关于七标签；54px 标签按钮；内容区独立滚动；三种外观卡片实际保存主题；切换标签保留尚未提交的模型输入 |
| 教学网站：`TeachingWebsiteSheet`                                          | 登录、巡检、连接及读取长表单纵向堆叠   | 1000×660 上限窗口、顶部登录状态、225px 课程侧栏、右侧读取/连接/审核区域；巡检放在左侧；课程按钮关联实际连接详情                       |
| 编辑弹窗：`Editors`、`TaskEditor`                                         | 统一 480px                             | 课程 460px、导入 490px、计划 650px；仍限制在当前屏幕内并保留滚动和焦点保护                                                            |

主要改动位于 `desktop/src/views/`、`components/WebsiteDialog.vue`、`styles/native-layout.css`、`styles/app.css`。本轮不改变 JSON schema 或 IPC 权限。作业搜索、计划详情、设置标签和网站侧栏均操作现有真实数据；没有用静态页面代替业务。

## 验收方式

Browser 插件不可用，使用仓库现有 Playwright Electron 流程。测试路径为：临时资料库启动 → 新建课程并导入真实文件 → 逐页导航和切换视图 → 验证列宽、抽屉、主题与弹窗 → 在 1260×800 和 1020×680 窗口截图。

新增 `desktop/tests/page-layout.e2e.mjs`，纳入 `npm run test:e2e`。覆盖七设置标签、外观保存、模型草稿跨标签保持、作业元数据和搜索、计划详情及表头对齐、月份右侧筛选、周日期栏、网站分栏、编辑器宽度。既有回归继续检查文件改名/移动、重复计划、拖拽和边界调整、后台巡检、登录记忆、批量更新与竞态。设置测试改为点击实际分类；调课测试等待渲染卡片移除后再断言，避免把主进程保存完成误当作 Vue 已更新。

所有截图来自测试临时资料库。原生应用的真实课程截图只用于本地核对，不写入仓库。

## 明确保留的差异

- 使用跨平台 HTML 控件和 Lucide 图标；不声称与 AppKit 像素完全相同。窗口材质、系统菜单、滚动条与字体由操作系统决定。
- 现有计划列表入口及列表/网格显示偏好保留；并未强制重置已有用户到原版默认周视图。
- 网站登录继续在没有 preload、本地文件权限或 MCP 桥接的独立 Chromium 窗口，未嵌入主界面。资料历史和批量更新仍使用独立审核弹窗。
- 原版强调色编辑、明暗切换动画、Office 原生缩略图和 Quick Look 的视觉一致性不在本次布局调整中；未放置无效控件冒充实现。
- 本机验收为 macOS ARM64；Windows/Linux 原生窗口效果和真实校园账号未在本轮实机验证。macOS 本地 Release 使用 ad-hoc 签名，非 Developer ID 公证发行。

## 源码验收结果

- `npm run build`：通过 TypeScript/Vue 检查、Vite 构建和主进程打包；Keychain helper 有既有 Apple API 弃用警告。
- `npm test`：293/293。测试 HTTP/MCP 服务需要 localhost 监听权限；在授权环境重跑全部通过。
- 真实应用 UI：12 组共 111 项通过；独立 Chromium/登录宿主另 6 项通过。报告位于 [source](evidence/0.3.2/source)。完整流程中发现并修正旧测试的设置导航和作业路径读取选择器后，重跑受影响及剩余套件通过；没有删减业务断言。
- 页面身份、非空内容、框架错误遮罩、控制台异常、实际鼠标/键盘交互均通过。截图涵盖正常浅色与最小深色窗口；[截图目录](evidence/0.3.2/screenshots) 只包含合成测试资料。

Release 安装回执由构建流程写入 `desktop/release/installed-macos.json`；安装后的实际应用复验结果另行记录。

## 已安装 Release 与跨平台安装包

功能提交 `7b57dc6` 的 Teachshell 0.3.2 已从独立 Git 快照构建。正常退出旧 Teachshell、保存可恢复副本后安装到 `/Applications/Teachshell.app`，完成 Launch Services 注册并打开。应用 deep/strict 签名及 Keychain helper strict 签名均通过；为 ad-hoc 签名，未公证。

对**实际安装版**完整运行 `npm run test:e2e`：12 组 **111/111** 通过，所有报告无 renderer errors。命令使用 `TEACHSHELF_EXECUTABLE=/Applications/Teachshell.app/Contents/MacOS/Teachshell`，每组独立临时资料库；见 [安装版测试记录](evidence/0.3.2/installed/regression.txt) 和 [安装/运行/签名/保留原生应用证据](evidence/0.3.2/installed-7b57dc6.json)。

原生 `/Applications/课屿.app` 1.16.0 的可执行文件 SHA256、Info.plist SHA256 与应用目录修改时间均与操作前一致。旧 Teachshell 副本保存在 `/Applications/.Teachshell-backups/`，实际路径载于安装回执。后续仅证据提交仍执行 Release 流程；最终安装信息以 `desktop/release/installed-macos.json` 和 `installed-verification.json` 为准，并比较七份运行载荷与已验收版本完全一致。

本轮五个安装包均为 `7b57dc6` / 0.3.2，位于 `desktop/release/`：

- `Teachshell-0.3.2-arm64.dmg`、`Teachshell-0.3.2-arm64-mac.zip`
- `Teachshell Setup 0.3.2.exe`
- `Teachshell-0.3.2.AppImage`、`teachshelf-desktop_0.3.2_amd64.deb`

五个包的归档测试、版本/commit、主进程/preload/renderer、外置 MCP bridge 及 macOS helper 一致性全部通过：[清单](evidence/0.3.2/release-manifest.json)、[SHA256](evidence/0.3.2/SHA256SUMS.txt)、[验证日志](evidence/0.3.2/verification.txt)。Windows 未签名，Windows/Linux 只完成构建与包内验证，未执行安装器或实机 UI 验收。没有远程推送或发布。
