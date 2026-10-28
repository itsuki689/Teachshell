# Electron 迁移阶段交付与验证报告

2026-10-28 文档复核：本文为标题所示版本的历史验收，测试数、平台限制和安装包名称均保留原记录。当前 macOS 仅支持 Apple Silicon；开发、部署和最新回归以[文档目录](../README.md)与[当前验证](validation.md)为准，不能将历史安装命令用于替换原生课屿。

日期：2026-10-25。版本：0.1.0。发行代码提交：`5b2b17f`。分支：`codex/electron-migration`。

本次已交付实际可运行的迁移预览版，以及 macOS、Windows、Linux 安装包。**尚未达到原版全部功能的替代验收标准**：完整教学资料版本同步、部分原生交互和 Windows/Linux 实机运行仍有未完成项，见末节。

原仓库位于 `/Users/theself/Codx/Teachshelf`；独立 Git 工作树位于 `/Users/theself/Codx/Teachshell`，新应用全部位于 `desktop/`。相对审计基线 `24efb2d`，`Sources/`、原 `Tests/` 和 `Package.swift` 无改动；`example/` 未参与迁移。未替换 `/Applications/课屿.app`，未打开或修改用户真实资料库，也未推送远程分支或发布 GitHub Release。

## 分阶段实际交付

| 阶段             | 主要文件                                                                                                                                       | 已实施与验证                                                                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 分析与数据契约   | `docs/electron/data-compatibility.md`、`feature-map.md`；`desktop/scripts/GenerateSwiftFixtures.swift`；`tests/fixtures/`                      | 阅读生产 Swift/UI/JS/AI/MCP 实现；以真实 Swift Codable 生成 schema 9、6 和旧 ISO 日期夹具，校验 ID、未知字段、路径和物理文件保留                                  |
| 课程与课件闭环   | `electron/services/storage/{repository,atomic}.ts`、`filesystem/paths.ts`、`src/views/LibraryView.vue`、`src/components/MaterialInspector.vue` | 创建、归档、重命名、删除课程；批量导入/拖入；嵌套目录、移动、改名、收藏、备注、中文自然排序、导出、受限预览和监听同步；真实文件与重启验收通过                     |
| 系统隔离与设置   | `electron/main/`、`electron/preload/`、`storage/settings.ts`                                                                                   | Renderer 无 Node；sandbox、contextIsolation、发送者/主框架/URL/参数校验；教学网页无本地桥接；操作系统密钥加密、endpoint 绑定、资料库切换和独立会话                |
| AI 与 MCP        | `electron/services/ai/`、`electron/services/mcp/`                                                                                              | SSE 流式输出、取消、写工具逐项确认、聊天持久化；原版 25 个 MCP 工具、版本/身份/Host/Origin 校验、事务内 revision、重复计划及撤销；真实 HTTP 和随包 stdio 桥接通过 |
| 计划与课表       | `shared/{plans,timetable}.ts`、`services/course/`、`src/views/{PlansView,TimetableView}.vue`、`PlanMonthCalendar.vue`                          | 每日/周/月重复、月末行为、本次例外、未来拆分、状态、临时变更历史；月历/日程/周课表、停课/恢复、调课/还原、月历显示；Swift 差分和窗口验收通过                      |
| 作业与旧目录迁移 | `resource/homework.ts`、`storage/legacy-homework.ts`、`src/views/HomeworkView.vue`                                                             | 真实作业目录、挂载、创建/复制/重命名；旧 HomeworkFiles 自动合并、内容去重、冲突编号、源树保留和事务恢复；原 Swift 14 个目标条目逐项匹配                           |
| 教学网站         | `services/website/`、`main/teaching-ipc.ts`、`src/components/WebsiteDialog.vue`                                                                | 原 JS 在隔离 Chromium 中解析；课程绑定、选择性资料首次导入、当前作业变更预览、确认与截止冲突；保留人工编辑，账号/页面/库改变拒绝旧确认                            |
| 构建与证据       | `desktop/package.json`、`scripts/test-packaged.mjs`、`.github/workflows/desktop.yml`、本报告和 `evidence/`                                     | 三平台安装包实生成；macOS 发行应用运行验证；三平台 CI 包含测试、构建及打包后应用验收，尚未远程执行                                                                |

## 自动化测试结果

| 验证                                                  | 结果                                                                                                                                          |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`，Node.js 24.22.1                           | **194/194 通过**，失败/跳过均为 0；[完整日志](evidence/node-tests.txt)                                                                        |
| `npm run build`                                       | 严格 TypeScript / Vue 类型检查、Vite 生产资源与 Electron main/preload/stdio 打包通过                                                          |
| `npm run format:check`、`git diff --check`            | 通过                                                                                                                                          |
| `npm run test:packaged`，macOS arm64、Electron 45.0.0 | **25/25 通过，renderer 运行错误 0**；[机器报告](evidence/packaged-e2e.json)                                                                   |
| 计划 Swift 差分                                       | 10 组、42 日；TS 状态由未修改的生产 Swift 解码/验证/重编码无损；实际 Swift 修改后发生项一致                                                   |
| 课表 Swift 对照                                       | 2 个学期、8 个日期；实际生产模型解码/验证/再编码与投影一致                                                                                    |
| 教学作业 Swift 差分                                   | 12 组生产 `syncTeachingAssignment` 结果一致，包括人工编辑、截止冲突、归档、删除忽略和历史规则                                                 |
| 旧作业 Swift 夹具                                     | 14 个目标路径、文件正文和 SHA-256 一致；源树保留                                                                                              |
| 原生专项基线                                          | Plan/PlanTimeEditing **23** 项、Timetable/Cancellation/Reschedule **40** 项、HomeworkStorage **9** 项通过；不等于声称全量 Swift/UI 测试均执行 |

25 项发行版窗口验收实际启动 `release/mac-arm64/课屿 Desktop.app`，并使用临时资料库。覆盖 Unicode 文件导入、Finder 外部改名、真实文件移动/导出、备注与计划并发编辑拒绝覆盖、文本预览、重复单次修改与下一次保留、月历、课表调课、作业目录、重启持久化、主题/最小窗口，以及真实 MCP stdio 配置启动随包脚本并读取真实资料库。

教学网站窗口测试通过隔离 session 的 HTTPS 协议处理器提供明确的离线 Moodle DOM，仍运行原解析脚本和生产主进程完整流程。它证明解析、绑定、审核、账号变化拒绝及安全边界，**不能证明真实校园账号、当前学校页面或校园网络登录已通过**。没有注入假 preload 或以静态页面代替业务。

已人工查看 [资料界面](evidence/screenshots/library.png)、[月历](evidence/screenshots/month.png)、[作业目录](evidence/screenshots/homework.png)、[网站变更审核](evidence/screenshots/website-review.png) 和 [最小窗口深色主题](evidence/screenshots/minimum-dark.png)。

## 安装包

产物位于 `desktop/release/`，SHA-256 和字节数见 [发行清单](evidence/release-manifest.json)；目录内另有 `SHA256SUMS.txt`。

| 平台                | 文件                                                                 | 本次验证                                                                                     |
| ------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| macOS Apple Silicon | `课屿 Desktop-0.1.0-arm64.dmg` / `课屿 Desktop-0.1.0-arm64-mac.zip`  | 生成成功；两份归档完整性检查通过；app 深度严格 codesign 校验通过；发行应用 25 项窗口验收通过 |
| Windows x64         | `课屿 Desktop Setup 0.1.0.exe`                                       | NSIS 生成成功、归档校验通过；内部主程序确认 PE32+ x86-64；未在 Windows 启动或安装            |
| Linux x64           | `课屿 Desktop-0.1.0.AppImage` / `teachshelf-desktop_0.1.0_amd64.deb` | 生成成功、归档校验通过；主程序为 x86-64 ELF、Debian 包结构正常；未在 Linux 启动或安装        |

三个包中的 main bundle 与随包 MCP bridge 已逐一校验与当前构建 SHA-256 相同，避免把较早的包作为最新版本交付。

macOS 为 **ad-hoc 签名、未公证**；Windows **未配置代码签名证书**。这些是迁移预览安装包，不应描述为已完成正式发行签名。当前本地产物不包含 Intel Mac、Windows ARM 或 Linux ARM 版本；工作流会使用对应 runner 的默认体系结构构建，增加其他架构还需执行各自验收。

构建曾遇到下载网络和 Apple Silicon 工具兼容问题，实际解决为保留校验的 Electron 镜像下载、官方 ARM 原生 NSIS/AppImage 工具集，以及 DEB gzip 压缩。一次自动审批因额度不足未执行 Windows/Linux 命令；用户要求继续后经原流程重新审批，最终两个构建均成功，未绕过审批。

## 数据保护与已修复问题

- 原 Swift 与 Electron 写锁不互通，所以迁移必须复制到新目录。源库只读核验；同库同时写入明确不支持。备份包含未索引文件，恢复采用复制到新库并切换，当前库继续保留。
- JSON 使用已刷新临时文件、原子替换、备份和恢复日志；文件导入与索引同一事务。普通文件移动使用排他硬链接，恢复过程也不覆盖竞争出现的文件。
- 回滚检查文件身份和内容；用户随后改写、替换的导出文件保留并报告。资料移除只移除记录；删除课程保留课件。
- 文件内容 SHA-256 采用流式读取，避免以整段内存读取大型课件。跨平台名称、大小写/Unicode 冲突、符号链接和路径逃逸均有拒绝/保留测试。
- 修复课程不变的目录补丁意外移出父目录、同目标移动清除自定义排序、元数据编辑重置物理路径；补了真实 MCP 文件系统回归。
- 网站解析在同一次隔离执行采集 URL、标题与结果，并校验导航前后身份；连接选项在队列内局部合并；预览确认在真正写入前检查 revision。计划和资料编辑器拒绝过期表单覆盖。

## 尚未完成及后续验收

1. **教学资料增量版本同步**：当前新下载按稳定来源去重，同一资源更新后再导入会跳过；尚未实现新附件连接映射、版本保留、缺失附件修复、整门课程批量更新审核和自动巡检。用户应继续使用原版处理这些工作；后续实现需要内容摘要、用户本地修改保护与历史版本事务的专项验收。
2. **原生交互差异**：未完全复刻拖动调课、全局搜索/导航历史、全部计划筛选、自定义顶栏和 Office/Quick Look 缩略图。当前已有可用的表单调课、资料搜索、计划列表/日程/月历及系统应用打开。
3. **真实联网验收**：学校登录与下载需实际账号/校园网络；旧 WKWebView Cookie 和 Keychain API Key 不自动转移。应重新登录、重新填写密钥；原版聊天本来只有内存记录，不能导入不存在的历史文件。新的聊天会在副本持久化。
4. **平台与发行验收**：需 Windows/Linux 实机运行安装包、权限/密钥环/路径与系统集成测试，并实际运行已配置 CI。当前没有伪称这些环境通过；正式发行还需证书、公证及目标架构验证。
5. **存储边界**：库内安全事务要求支持硬链接的本地卷，网络共享和 FAT/exFAT 库未验收；外部作业导入另有排他复制回退。目录移动仍受 Node 的 rename 接口限制，存在竞争创建空目标目录的窄竞态；非空目标内容不会被替换。后续需原生 no-replace 目录移动辅助以彻底消除该边界。原目录/外部引用跨机器位置变化时需重新定位，不自动复制外部引用。

以上未完成项意味着本版本可以用于独立副本上的实际本地课程管理与迁移试用，但不能宣称已全面替代原 macOS 应用。
