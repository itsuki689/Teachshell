# Teachshell 0.3.4 图标与控件同步

2026-10-28 文档复核：本文为标题所示版本的历史验收，测试数、平台限制和安装包名称均保留原记录。当前 macOS 仅支持 Apple Silicon；开发、部署和最新回归以[文档目录](../README.md)与[当前验证](validation.md)为准，不能将历史安装命令用于替换原生课屿。

本轮只修改 `desktop/` 与迁移文档。原生 `/Applications/课屿.app`、Swift 源码、原生测试和 `example/` 保留。安装目标仅为 `/Applications/Teachshell.app`，替换前正常退出并保留可恢复的旧版。

## Swift 对照与实际改动

已阅读 `ChoiceMenu.swift`、`SolidChoicePopup.swift`、`SidebarNavigation.swift`、`WorkspaceCommandBar.swift`、`SettingsComponents.swift`、`SettingsWorkspace.swift`、`ToolbarSettingsControl.swift` 及 `TeachshelfCore/ToolbarSettings.swift`；通过当前运行的课屿打开“课程”下拉框作只读对照，随后关闭菜单，未改动原生资料或设置。

| 对照项 | Electron 实现 |
| --- | --- |
| ChoiceMenu 的 13pt / 紧凑 12pt 文字、10pt 水平内距、7pt 圆角、下箭头 | `src/directives/choice.ts` + `styles/controls.css`；各页单选框共用，不改变 JSON 或 IPC |
| SolidChoiceList 的实底、勾号、30pt 行、2pt 行距与滚动 | 原生相同浅色 `#F5F5F5` / 深色 `#292B2D`，200–360pt 宽、最高 330pt，独立高亮与已选状态 |
| 弹层打开、取消和定位 | 鼠标、上下键、Home/End/PageUp/PageDown、回车/空格、Esc/Tab、外部点击、失焦、窗口边缘避让；长标题省略和完整提示；同步更新选项 |
| 课程、资料、作业、计划、导入/移动、文件夹、网站及批量审核 | 26 个单选框接入统一控件；重复计划的原有禁用条件和选择后的业务处理保留 |
| SF 图标的语义和光学尺寸 | `AppSymbol.vue` 原创 SVG；书架、资料托盘、未分类、作业文件夹、清单、日历、星标、时钟、AI、设置、更新、导入和新建统一；装饰图标不重复朗读 |
| 设置导航图标 | 外观调色板、资料库硬盘、备份历史、MCP 连接、关于信息；纠正原有显示器/数据库/归档箱/地球的含义差异 |
| 顶栏设置与快捷新建 | 使用同一符号映射；已选操作编号/图标/文字对齐，实时胶囊预览，快捷新建的方向键导航及 Esc 焦点恢复 |
| 控件中文排版 | 固定按钮和表单行高、常规选择文字字重、图标居中、紧凑侧栏、说明文字换行；统一 Lucide 线宽 |

真实 `select` 保留表单关联、禁用状态与 Vue 数据绑定，弹层只替代其展示和选择交互。用户选择通过原有 input/change 流程写入业务状态；多选资料列表、可输入的计划类型 datalist 和日期时间编辑器继续使用各自原有实现。所有选项以 textContent 写入，不解释资料中的 HTML。Renderer 不增加 Node 权限。

## 验证入口与范围

`tests/controls-parity.e2e.mjs` 使用独立临时资料库和真实 Electron，覆盖：图标语义、学期真实筛选、键盘选择/取消、菜单尺寸及勾号、长中文课程名、真实计划保存、重复计划禁用、动态课程同步、快捷新建焦点，以及七个设置页和主要业务页面在明暗及最小窗口下的渲染。该套件已加入 `npm run test:e2e`。

发布前另执行核心测试、现有顶栏、逐页布局和界面交互回归。安装版执行完整 UI 回归；签名、原生应用保护、安装路径、版本及构建提交均单独核验。发布前已通过 TypeScript/生产构建、299/299 核心测试、31/31 定向 UI 回归（新控件 9、顶栏 8、逐页布局 6、界面交互 8）。安装后结果与证据记录在本文件后续验收段。

## 明确差异

跨平台图标是原创矢量重绘，并非逐像素复制 SF Symbols；字形渲染仍随系统字体变化。系统级文件选择器、日期时间编辑、多选列表保留平台差异。未声称完成 Windows/Linux 真机 UI 验收，也未声称开发者公证签名或真实校园账号验收；既有迁移报告中的业务待办继续有效。


## 0.3.4 安装后验收

功能提交：`7febd7e002f7a23acbe23026c1cf693dfbfd4ce5`。TypeScript、生产构建、定向 Prettier 及 `git diff --check` 通过。核心 **299/299**；源码定向 UI **31/31**；直接运行已安装 `/Applications/Teachshell.app/Contents/MacOS/Teachshell` 的全套 UI **130/130**，14 套报告均无 renderer 错误。所有自动化验收均使用独立临时资料库。

- [汇总与各套件计数](evidence/0.3.4/summary.json)
- [核心测试日志](evidence/0.3.4/node-tests.txt)、[发布前 UI 日志](evidence/0.3.4/source-ui-tests.txt)、[安装版完整日志](evidence/0.3.4/installed-tests.txt)
- [本轮控件专项报告](evidence/0.3.4/controls-parity-report.json)
- [浅色排序菜单](evidence/0.3.4/controls-sort-popup-light.png)、[长标题课程弹层](evidence/0.3.4/controls-plan-course-popup.png)、[快捷新建](evidence/0.3.4/controls-quick-create.png)、[深色顶栏设置](evidence/0.3.4/controls-settings-顶栏.png)、[深色网站下拉框](evidence/0.3.4/controls-website-dark-popup.png)

通过 CUA 再次打开正常安装版，确认页面 URL 位于 `/Applications/Teachshell.app/Contents/Resources/app.asar/dist/index.html`；实际打开排序菜单、用方向键浏览后 Esc 取消，当前排序保持“最近添加”。已检查新图标、勾号、灰色实底与文字对齐。

Release 应用 `codesign --verify --deep --strict` 和 Keychain helper `codesign --verify --strict` 均通过，为 **ad-hoc 本地签名，未公证**。安装器正常退出旧版，完成备份、替换、LaunchServices 注册及启动；已核对实际 PID 可执行路径、版本、构建提交、安装包和受测功能文件哈希一致。[安装与原生保护结果](evidence/0.3.4/installed-verification.json)。

升级前 0.3.3 的可恢复副本保留于：
`/Applications/.Teachshell-backups/2026-10-25T13-21-26-727Z-0622b1b3-64f6-4f4a-9128-1b9d0b3a0c88/Teachshell.app`。
原生课屿 1.16.0 的应用目录时间、Info.plist 与可执行文件 SHA-256 均与升级前一致。

五个安装包已实际生成，逐个解包核对版本、提交、主进程/preload/renderer、外置 MCP stdio 及 macOS helper；未运行 Windows/Linux 安装器。[包清单](evidence/0.3.4/release-manifest.json)、[SHA-256](evidence/0.3.4/SHA256SUMS.txt)。文件位于 `desktop/release/`：

- `Teachshell-0.3.4-arm64.dmg`
- `Teachshell-0.3.4-arm64-mac.zip`
- `Teachshell Setup 0.3.4.exe`
- `Teachshell-0.3.4.AppImage`
- `teachshelf-desktop_0.3.4_amd64.deb`

证据提交仅包含文档和验收记录。按仓库约定仍会从该提交重建并安装 Release，再逐字节比对受测功能文件；最终安装收据与核验结果保留于不入库的 `desktop/release/installed-macos.json`、`installed-verification.json`。
