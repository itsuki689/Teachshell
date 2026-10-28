# Teachshell 0.2.0 交付与验证

2026-10-28 文档复核：本文为标题所示版本的历史验收，测试数、平台限制和安装包名称均保留原记录。当前 macOS 仅支持 Apple Silicon；开发、部署和最新回归以[文档目录](../README.md)与[当前验证](validation.md)为准，不能将历史安装命令用于替换原生课屿。

日期：2026-10-25。分支：`codex/electron-migration`。功能代码提交：`594305b`。本次要求的教学资料增量同步、历史版本保留与恢复、多课程批量更新审核，以及搜索、导航和编辑保护已经形成实际可运行的 Release。

原 Swift 工程保留：相对审计基线 `24efb2d`，`Sources/`、原 `Tests/` 和 `Package.swift` 无改动，`example/` 未参与迁移。测试均使用临时资料库和明确的离线学校页面。按本次用户指定名称安装 `/Applications/Teachshell.app`，原 `/Applications/课屿.app` 保留。未推送或对外发布。上一阶段内容见 [0.1.0历史报告](validation-0.1.0.md)，未完成项以本报告更新为准。

## 模块、文件和提交

| 模块               | 提交      | 实际变化                                                                                                                                                                                                                                                                                                                                             |
| ------------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 原生交互和安装流程 | `7b9a12e` | `WorkspaceSearch.vue`、`src/composables/`、`stores/library.ts`、各编辑器、`PlansView.vue`、`SettingsView.vue`、主进程。按词搜索、每类六项、60步前进后退含目录位置、发生项状态筛选、草稿离开保护；原生退出默认返回编辑，取消后仍可保存。`scripts/release-macos.mjs`、`install-macos.mjs` 实现提交快照构建、签名验证、正常退出、备份、注册和启动核对。 |
| 增量与历史核心     | `3400a11` | `website/material-sync.ts`、`storage/repository.ts`、`storage/atomic.ts`。来源/目录映射、相同摘要跳过、新UUID版本、历史恢复、本地修改保护、缺失修复、活动引用迁移及归档引用保留；真实文件与JSON事务和失败恢复。                                                                                                                                      |
| 批量审核完整链路   | `594305b` | `website/{batch-sync,browser,resource-head,session-fetch}.ts`、`main/website-update-ipc.ts`、preload/API、`WebsiteBatchReview.vue`、`MaterialVersions.vue`。多课程检查、选中下载、截止二选一、逐项失败重试、取消和过期；版本恢复令牌绑定原资料库；已绑定课程的导入入口转到审核。                                                                     |

最终测试与报告提交不改变上述功能代码。设置页显示实际 Release 的版本、源提交和执行路径；最新安装回执在 `desktop/release/installed-macos.json`。

## 数据行为及复核修复

- 检查读取课程与活动列表，不下载附件正文、不写入网站计划或来源映射。直链用 HEAD 发现，隐藏 Chromium 禁止附件 GET。已有资料显示“待下载核验”，不会误报已经是最新正文。
- 只下载选中项；相同正文跳过，变化创建新UUID及历史记录。手工标题、备注、标签、收藏、分类和移动位置保留。历史和原物理文件均保留，同步及重启不会重新收录未索引恢复副本。
- 本地正文修改需单独批准后才能采用网站版本；缺失项默认不选，明确勾选补回。用户移除或跨课程转移的条目不自动复活。
- 历史恢复创建新版本，当前及所选历史均保留；活动计划跟随新版本，归档引用不变。列表和revision来自同一串行快照，主进程令牌绑定原Repository和版本。修复了相同JSON复制库可误接受旧库恢复确认的问题。
- 附件失败时，同活动本轮已选计划保留等待；重试后恰好提交一次并正确关联。修复了计划提前成功导致后续附件漏关联的问题。未选附件不阻塞计划。
- 下载前后重读账号、课程与活动，提交前再次校验库、连接、revision、取消状态和文件摘要。外部索引抢写保留冲突与恢复日志，不覆盖新索引。不支持两端同时写入原版资料库。

## 已运行验证

| 验证                                                        | 结果与证据                                                                                                                                     |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 全量Node测试                                                | **229/229**，失败/跳过0；[日志](evidence/0.2.0/node-tests.txt)                                                                                 |
| TypeScript/Vue/Vite/main/preload/stdio、提交快照Release构建 | 全部通过                                                                                                                                       |
| 格式与补丁                                                  | `npm run format:check`、`git diff --check` 通过                                                                                                |
| 已安装macOS应用桌面验收                                     | **28/28**，renderer错误0；[报告](evidence/0.2.0/installed-e2e.json)                                                                            |
| 已安装应用批量/版本验收                                     | **12/12**，renderer错误0；[报告](evidence/0.2.0/installed-batch-e2e.json)                                                                      |
| 独立真实Chromium传输                                        | **3项通过**，真实解析/隔离、HEAD跳转及附件GET阻断、明确流式下载/外域拒绝；[日志](evidence/0.2.0/browser-tests.txt)                             |
| 新版本专项                                                  | 20项通过，含相同摘要、手工修改、缺失/移除、归档引用、恢复、路径冲突、重启、3事务断点、回滚、取消和外部索引抢写                                 |
| 新批量专项                                                  | 14项通过，含零正文检查、选择下载、部分失败重试及附件关联、账号/页面/库变化、缺失修复、二次批准与截止选择                                       |
| 原Swift教学基线                                             | 原 `TeachingWebsiteTests` **17/17**通过                                                                                                        |
| Swift真实格式往返                                           | 未修改的生产Core成功解码、验证、往返保存3个Electron版本、目录、同一来源、当前绑定和元数据；[结果](evidence/0.2.0/swift-material-roundtrip.txt) |

窗口测试实际启动 `/Applications/Teachshell.app/Contents/MacOS/Teachshell`。Browser插件不可用，按前端测试技能使用Playwright Electron；没有模拟preload，学校HTTPS由临时隔离session提供明确的离线DOM和真实流式响应，文件事务实际执行。截图已检查：[审核清单](evidence/0.2.0/screenshots/batch-review.png)、[截止选择](evidence/0.2.0/screenshots/batch-deadline.png)、[版本历史](evidence/0.2.0/screenshots/material-versions.png)。

首次安装版过期测试出现 `TargetClosed`，保留[首次记录](evidence/0.2.0/initial-clock-test.json)。诊断发现测试在原生interval创建后才安装虚拟时钟，推进不驱动已有interval，造成混合计时依赖；现改为只调整Date、保留真实timer的 `setFixedTime`，有界等待5秒，并记录退出/关闭/崩溃。对同一个已安装二进制12项复验全通过。未发现应用崩溃证据，原失败也未抹去。

## 构建、安装与恢复

五个0.2.0安装包均实际生成：macOS ARM64 DMG/ZIP、Windows x64 NSIS EXE、Linux x64 AppImage/DEB。逐包归档、内嵌源提交及main/preload/外置MCP桥接的校验见[发行清单](evidence/0.2.0/release-manifest.json)。Windows/Linux为本机交叉构建，未声称已在其系统启动验收。

五包的实际main/preload/外置stdio摘要一致。安装版使用隔离快照构建，其main内esbuild依赖路径标签与工作目录构建不同，所以原始main摘要不同；规范化该标签后逐字节一致，stdio字节也一致。清单分别保留两套原始摘要，没有把安装版和分发包的原始main摘要混同。

每个模块提交后均构建macOS Release并验证签名，正常退出上版、保存旧bundle、替换、注册LaunchServices并打开。安装过程中修复了JXA零参数 `terminate` 桥接调用，没有强制终止应用。安装失败恢复旧版；用户未保存退出被取消时停止替换；脚本不操作用户资料库。

`codesign --verify --deep --strict` 通过；Info.plist及内嵌版本均为0.2.0，进程路径确认为 `/Applications/Teachshell.app/Contents/MacOS/Teachshell`。见[功能验收版本记录](evidence/0.2.0/release-verification.json)、[该次安装回执](evidence/0.2.0/installed-macos.json)。最后文档/测试提交的重建不会改变功能代码，最新回执位于忽略目录 `desktop/release/installed-macos.json`，不要把历史回执当作当前PID。旧bundle在 `/Applications/.Teachshell-backups/`。

macOS签名为 **ad-hoc，未公证**；未配置Apple Developer或Windows发行证书，没有把本机签名描述为正式发行签名。

## 剩余差异与独立验收

1. 真实校园账号及当前校园网络未验收；旧WKWebView cookie和Keychain登录信息不自动转移。离线DOM/HTTP验收不能证明真实登录成功。
2. Windows/Linux原生运行、权限、密钥环、安装/卸载仍需实机或CI。三平台CI已包含源码测试、安装包构建及打包后40项窗口验收，本次未远程触发。
3. 后台定时巡检、Swift可选七天记住登录、拖动调课、自定义顶栏、Office/Quick Look原生缩略图仍有差异。搜索、导航历史、状态筛选、资料版本及批量审核现已完成。
4. 文件事务要求支持硬链接的本地库卷；网络卷/FAT/exFAT未验收。目录rename竞争新建空目录的窄竞态仍是此前记录的存储边界，不支持两端同时写同库。

操作、复制迁移及构建命令见 [README](../../desktop/README.md)，审核规则见[教学批量审核](teaching-batch-migration.md)。本次三个模块已完成可运行、可恢复的Release闭环，独立平台、联网及其他原生差异保持明确记录。
