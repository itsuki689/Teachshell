# Teachshell 0.3.0 交付与验证

2026-10-28 文档复核：本文为标题所示版本的历史验收，测试数、平台限制和安装包名称均保留原记录。当前 macOS 仅支持 Apple Silicon；开发、部署和最新回归以[文档目录](../README.md)与[当前验证](validation.md)为准，不能将历史安装命令用于替换原生课屿。

日期：2026-10-25。分支：`codex/electron-migration`。本轮完成后台定时巡检、登录记忆、课程与计划的分钟拖动/缩放/键盘微调，以及自定义顶栏。实际应用已构建、安装并验收；没有用静态页面代替功能。历史报告见 [0.2.0](validation-0.2.0.md)。

**原生 `/Applications/课屿.app` 始终保留。** 已把这一要求写入 `AGENTS.md`。自动安装仅正常退出并备份、替换、注册 `/Applications/Teachshell.app`；不推送、不发布。本轮前后原生课屿的版本 1.16.0、可执行文件 SHA256、Info.plist SHA256 和 bundle 修改时间完全相同，见 [保留证据](evidence/0.3.0/native-app-preserved.json)。本轮没有修改 `Sources/`、原 `Tests/`、`Package.swift`，也没有处理 `example/`。

## 实际模块和提交

| 模块               | 提交      | 文件与结果                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 原生交互和安全登录 | `046b730` | `shared/schedule-drag.ts`、`TimetableView.vue`、`course/plans.ts`、Repository 与受保护 IPC：完整分钟网格、拖动、双边缩放、键盘微调、固定安排锁定、冲突分列和单次发生项保护。`shared/toolbar.ts`、`WorkspaceToolbar.vue`、`ToolbarSettings.vue`：原 10 种操作、最多 6 项、排序/清空/恢复默认、课程/计划/连接新建菜单。`website/login-*.ts`、`browser.ts`、Swift Keychain helper、登录控件和构建脚本：默认关闭的七天记忆、内存分区、官方 cookie 白名单、系统安全存储及重试。 |
| 后台巡检和审核接线 | `43e09cb` | `website/background-sync.ts`、`main/website-update-ipc.ts`、主进程生命周期、`WebsiteSyncSettings.vue`、`WebsiteBatchReview.vue`、`App.vue`：按库开关/间隔、真实定时检查、休眠/离线/前台接管、失败退避、待审暂停、清单过期和实时失效。补齐退出时登录清理、网络失败可重试和延迟结果保护。                                                                                                                                                                                    |

两次功能提交都经过相关测试，再从提交快照构建 Release、验证签名、正常备份安装和打开。后续验证报告提交不改变功能代码；设置页显示实际安装的 commit 和执行路径，最新安装回执位于 `desktop/release/installed-macos.json`。

## 对照 Swift 的业务与安全行为

- `ScheduleWeekTimeline` / `ScheduleEventEditing`：默认锁定固定安排；拖动保留 111 分钟等实际时长和原始发生日。方向键调整 10 分钟或 1 天，`+/-` 微调 1 分钟；上下边缘支持鼠标和键盘调整，保持正时长且不越出当天。重复计划只改本次，保留 DDL、资料、备注及下一次安排。Esc、越界、切库或并发修改取消过时操作。
- `ToolbarSettings`：原四项默认顺序、最多六项、可为空、不重复。非法 JSON 拒绝，缺省读取不会重写原数据，未知字段保留，更新有 revision 保护。
- `TeachingLoginSession` / Recovery：只保存官方域名 MoodleSession cookie，最多七天；恢复强制 Secure，保留 HttpOnly 和 session-only，排除统一认证及课表 cookie。恢复 cookie 不等于账号已验证，必须经过实际官方页面解析。Mac helper 可禁止交互，Windows 使用 DPAPI，Linux 拒绝明文后端且不隐瞒钥匙环限制。原生课屿的凭据不读取、不迁移、不覆盖。
- Swift 没有后台定时器。本轮新增策略默认关闭、默认 30 分钟，允许 5–1440 分钟。应用运行时才巡检，开启后约 30 秒首查，仅对当前确认账号的活跃连接生成待审清单。检查不下载附件正文、不写入库；显式选择后才应用。关闭审核窗口保留清单，明确丢弃才移除；同 ID 广播保留勾选、DDL 选择和本地文件批准。
- 前台与后台共用批量实例。前台接管先等待后台取消；切库、退出先停止巡检并等待在途前台操作。失败退避、登录变化、休眠恢复均不会造成重叠请求或一串补发。

实现说明：[原生交互](native-interactions-migration.md)、[登录记忆](login-session-migration.md)、[后台巡检](background-sync-migration.md)。

## 已运行的验证

| 验证                                       | 结果                                                                         | 证据                                                                                                                                   |
| ------------------------------------------ | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 全量 Node 核心/事务/安全/网络测试          | **284/284**，失败和跳过均 0                                                  | [完整日志](evidence/0.3.0/node-tests.txt)                                                                                              |
| 已安装应用主闭环                           | **28/28**                                                                    | [报告](evidence/0.3.0/teachshelf-electron-e2e.json)                                                                                    |
| 已安装批量更新及版本恢复                   | **12/12**                                                                    | [报告](evidence/0.3.0/teachshell-website-batch-e2e.json)                                                                               |
| 已安装拖动、缩放及键盘                     | **9/9**                                                                      | [报告](evidence/0.3.0/teachshell-schedule-drag-e2e.json)                                                                               |
| 已安装自定义顶栏                           | **8/8**                                                                      | [报告](evidence/0.3.0/teachshell-toolbar-e2e.json)                                                                                     |
| 已安装登录记忆及立即退出清理               | **7/7**，系统安全存储可用                                                    | [报告](evidence/0.3.0/teachshell-login-ui-packaged.json)                                                                               |
| 已安装真实定时巡检                         | **9/9**，两轮等待实际 30 秒，禁用后实际等待 31 秒                            | [报告](evidence/0.3.0/teachshell-background-e2e.json)                                                                                  |
| 已安装审核实时变化                         | **7/7**                                                                      | [报告](evidence/0.3.0/teachshell-review-live-e2e.json)                                                                                 |
| Swift 教学更新 / 顶栏与分钟编辑 / 登录基线 | **17 + 9 + 15 = 41** 项通过；附带课表解析器 15 项通过                        | [教学摘录](evidence/0.3.0/swift-teaching.txt)、[原生摘录](evidence/0.3.0/swift-native.txt)、[登录日志](evidence/0.3.0/swift-login.txt) |
| 版本升级的安全存储兼容                     | 旧实际 helper 写入，新实际 helper 无交互读回完全相同的合成会话；测试项已删除 | [报告](evidence/0.3.0/login-upgrade.json)                                                                                              |
| TypeScript、构建、格式、diff               | 通过                                                                         | `vue-tsc --noEmit`、`npm run build`、Prettier、`git diff --check`                                                                      |

实际安装版总计 **80/80**，运行命令指定 `/Applications/Teachshell.app/Contents/MacOS/Teachshell`，[完整输出](evidence/0.3.0/installed-tests.txt)。Browser 插件不可用，因此使用 Playwright Electron 控制真实主窗口、preload 和主进程；拖动用实际鼠标，键盘用实际按键。后台等待不注入调度器或假时钟；实时审核事件由实际公开业务操作产生，没有伪造状态事件。所有课程、Cookie 与学校页面均为临时隔离夹具，没有使用真实校园账号或修改用户资料库。

截图已检查：[边缘缩放](evidence/0.3.0/screenshots/teachshell-timetable-resize.png)、[顶栏](evidence/0.3.0/screenshots/teachshell-toolbar-settings.png)、[登录恢复](evidence/0.3.0/screenshots/teachshell-login-restored-packaged.png)、[后台审核](evidence/0.3.0/screenshots/teachshell-background-review.png)。

## 复核中实际修复的问题

1. 非整节拖动的定位、浮动选择栏影响落点、Vue 代理不能跨 IPC 的问题；验证跨日后时长和身份不变。
2. 网络超时或取消后 `checking` 状态永久阻止后续巡检的问题；使用令牌恢复原稳定状态，旧请求不能覆盖新的认证或关闭状态。
3. 勾选“关闭登录记忆”后立即正常退出可能打断密文删除；关闭等待已授权删除，失败保留禁用/待清理状态，成功重试才清除警告，不重新恢复旧密文。
4. 打开的审核窗不能接收后台完成/账号变化/清单替换；现订阅权威状态、保留同一清单选择，失效立即禁止应用，替换需明确加载。
5. 后台全并发测试的等待原用固定 setImmediate 次数，可能早于真实 I/O；改为有界墙钟等待，保留全部业务断言。

## 安装包与构建验证

五个安装包均由 `43e09cb` 的同一次工作区源码构建生成，包内 `release-info` 为 0.3.0 / 对应完整 commit。完整解包并比较主进程、preload、全部 renderer 文件及外置 stdio 桥接脚本；Mac helper 仅在 Mac Resources 中，架构与签名校验通过。安装用的隔离 Git 快照构建与工作区构建仅有 esbuild 依赖来源标签差异，严格限制在注释/来源标签行归一后完整代码一致。

| 平台        | 文件（`desktop/release/`）           | 大小     |
| ----------- | ------------------------------------ | -------- |
| macOS ARM64 | `Teachshell-0.3.0-arm64.dmg`         | 126.9 MB |
| macOS ARM64 | `Teachshell-0.3.0-arm64-mac.zip`     | 122.9 MB |
| Windows x64 | `Teachshell Setup 0.3.0.exe`         | 126.1 MB |
| Linux x64   | `Teachshell-0.3.0.AppImage`          | 123.2 MB |
| Linux x64   | `teachshelf-desktop_0.3.0_amd64.deb` | 130.9 MB |

[完整载荷清单](evidence/0.3.0/release-manifest.json)、[SHA256](evidence/0.3.0/SHA256SUMS.txt)、[归档验证](evidence/0.3.0/verification.txt)。全部通过 7zz 完整性检查；DMG 额外通过 `hdiutil verify`，NSIS 内层 7z 和 DEB 内层 tar 也已验证。Mac App 和 helper 通过 `codesign --verify --deep --strict` / `--strict`，为 ad-hoc 签名，未公证；Windows 无发布签名证书。自动化 CI 仍分别在三平台原生 runner 构建和运行应用，配置不代表本轮已执行远端 CI。

## 仍需验证或保留的差异

- Windows/Linux 已生成并校验真实安装包，但本轮没有这些系统的桌面实机，不声称其鼠标交互、安全密钥环和安装运行已验收。Intel Mac helper 要在 Intel 主机生成，不能用当前 ARM CLT 强行链接。
- 真实学校登录、校园网络/VPN、服务器页面变更与会话过期需在实际账号环境验证。离线官方 URL 夹具不能替代这一步。
- 像素级布局、Office 原生缩略图、系统原生 Quick Look 等仍有平台差异；课程/计划 Delete 键的原生快捷删除未扩展。本轮拖动、缩放、方向键和加减微调已完成。
- 巡检仅在应用进程运行时工作，开机自启动、应用退出后的系统任务和系统通知未实现。采用当前登录会话，不后台填写密码或处理验证码。
- 已安装两版 helper 相同，本次升级无须重新授权；未来 helper 内容或签名变化时，系统可能要求用户主动重试授权。不能为了免提示放宽钥匙串 ACL。
- 保留既有文件事务边界：优先本地支持硬链接的文件系统，不允许 Swift 与 Electron 同写原库；网络/移动卷和外部挂载迁移仍须对应环境验收。
