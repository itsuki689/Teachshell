# Teachshell

2026-10-28 响应排查续修：资料行的 Enter/Space 不再抢占按钮和菜单，计划调时限制到事件卡片/边界的焦点；丢弃资料草稿后首个点击继续完成选择。启动设置及预览使用带失效守卫的只读状态；慢作业枚举不再占用写入队列；同步按本次扫描更新文件身份，减少重复 stat 与全量匹配。新增 `node tests/keyboard-routing.e2e.mjs`，配合 `input-response`、`schedule-drag`、`e2e-ui-parity` 和存储/作业业务回归。详细安全边界见[异步状态说明](../docs/electron/ui-sync-migration.md)。

2026-10-28 按键响应修复：刷新按钮按实际操作完成状态恢复，不再等待装饰动画；设置和作业目录的只读加载仍显示进度，但允许搜索快捷键和顶栏导航。针对 Windows 按下反馈慢的补充：按钮按下态立即显示，悬停/松开过渡保留；不将点击提前到按下时执行。保存、同步和未保存草稿保护继续生效。专项回归：`node tests/input-response.e2e.mjs`，包含鼠标/空格键按下反馈、取消操作、暂停动画、延迟真实 IPC、键盘输入和迟到回复检查；实现约束见[异步状态说明](../docs/electron/ui-sync-migration.md)。

2026-10-28：macOS 改用系统递归文件监听，处理连续目录改名、`files/` 替换和无文件名事件；监听就绪后主动核对一次索引。Windows 保留无目录锁的轮询，Linux 保留 Chokidar 原生监听。见[诊断与回归](../docs/electron/filesystem-watch.md)、[当前验证](../docs/electron/validation.md)、[全部技术文档](../docs/README.md)。版本仍为 0.3.11，开发更新按提交编号区分；既有 GitHub Release 不会自动被覆盖。

本工程属于独立的 Teachshell Git 仓库，主目录为 `desktop/`。原生 Teachshelf 仅作只读参考；两者不共享 worktree、Git 对象库或远程配置。仓库内保留的 Swift 实现用于对照与兼容性验证。

Electron + Vue 3 + TypeScript 的跨平台课程与资料应用，当前版本 0.3.11。保留原 Swift 工程及原生课屿应用，使用独立应用标识 `com.teachshelf.desktop`。跨平台实现已对照 Swift 补齐学期筛选、分词搜索、视图和日期记忆、键盘选择，并修复切库、并发草稿、聊天及网站审核的界面同步问题，详见[界面同步说明](../docs/electron/ui-sync-migration.md)。后台巡检、受控登录记忆、分钟拖动/缩放、教学资料增量同步与版本审核继续保留。应用更名后继续使用原 `teachshelf-desktop` 用户数据目录下的 `Library`；实际验收范围与剩余平台差异见末节及验证报告。

0.3.3 对照 Swift 同步计划默认周视图、无课表本地周计划、强调色编辑和十条色带明暗动效。外观设置随资料库保存；十二色预设、取消恢复、课程色边框、日夜开关、减少动态效果及切库同步见[周视图与外观验收](../docs/electron/appearance-week-parity.md)。

0.3.4 统一各页下拉框的实底弹层、键盘导航、勾选和长标题排版，校正侧栏、导入及设置图标，并加入与实际顶栏同步的图标预览。见[图标与控件同步](../docs/electron/controls-parity.md)。

0.3.5 移除日夜开关左侧多余的同步图标和侧栏底部设置入口；手动同步保留在“视图 → 同步文件”（⌘/Ctrl R），设置保留在顶栏、“视图”菜单及 ⌘/Ctrl ,。

0.3.6 完成一轮前后端细节复核：保护设置草稿和未配置模型时的输入；修复 MCP 配置并发、失败回滚及实际运行状态；聊天退出等待回执落盘；加固并发切库与事务恢复日志预检。修复依据、验证范围和剩余差异见[细节复核报告](../docs/electron/detail-audit-0.3.6.md)。

0.3.7 细化侧栏与顶栏：重绘四本书标识、刷新箭头与齿轮，区分实心品牌标识和描边菜单图标，并补齐新建计划的加号徽标；顶栏采用 36px 点击区域，恢复刷新/设置旋转、导入箭头滑动及新建菜单旋转反馈，遵循减少动态效果。刷新等待期间的重复点击、操作切换与资料库切换均会正确处理；计划页右上角新建沿用所选日期。新增真实窗口反馈回归，并继续保留单个刷新按钮与无侧栏底部设置入口。

计划页进一步统一为月、周、日工作区，共用日期导航、学期/课程/状态筛选和右侧详情。日程包含课程、全天安排及截止事项；月历适应窗口高度并支持键盘跨月，学期外的本地计划不会被周视图跳回学期内。实现映射、边界处理与验证入口见[计划工作区说明](../docs/electron/schedule-workspace.md)。

开发分支的侧栏品牌直接复用打包应用图标；顶栏明暗按钮与快捷操作胶囊垂直居中。全局搜索可直接在顶栏输入，结果在栏下显示，支持分词、键盘选择、中文输入法及 ⌘/Ctrl K 定位，无搜索模态弹窗。

## 开发

需要 Node.js 24 和 npm；macOS 仅支持 Apple Silicon（M 系列），构建需使用 ARM64 Node.js 和 Apple Command Line Tools 编译随包附带的 Keychain helper。首次安装需要联网；安装后本地资料管理完全离线。

```sh
cd desktop
npm ci
node node_modules/electron/install.js
npm run dev
```

`npm run dev` 同时启动 Vite 和 Electron；修改主进程/preload 后重新运行。正常生产运行：

```sh
npm run build
npm start
```

若 GitHub 下载在当前网络不可达，可以使用 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/electron/install.js`。Electron 安装器仍使用官方 npm 包内置 SHA256 校验。不要关闭 TLS 验证或校验和检查。

## 迁移资料

1. 在原版中保存并退出，确保没有未完成的文件事务。
2. 在 Desktop 设置中选择「复制导入原版资料库」，选择包含 `library.json` 的文件夹。
3. 指定新的空目录作为副本。复制覆盖 `files`、旧 `HomeworkFiles`、`History`、孤立文件和索引；逐个校验文件并检查索引在复制期间未变化。
4. 成功后切换到副本。原目录不会被打开写入。再次打开副本使用「打开跨平台资料库」。恢复备份时，同样把备份目录复制导入到新位置，再切换到恢复后的副本。

不允许直接以 Electron 写入没有 `.teachshelf-electron.json` 标记的原版资料库：两端的写锁协议不同。不要手工加标记绕过复制流程，也不要让 Swift 与 Electron 同时写同一个副本。原版 schema 1–9 可以复制导入；未知 JSON 字段保留。原版聊天只保存在内存，无法导入不存在的历史文件。新的聊天记录保存在副本 `.desktop-chat.json`。

外部引用不会随库复制，也不会随课程移动而修改原文件；换设备后需重新导入引用。旧作业挂载路径原样保留；副本中的旧 `HomeworkFiles` 自动合并到新的作业目录，同内容去重、冲突编号，保留旧树并记录完成标记。作业工作区支持文件浏览、文件夹创建、复制导入、重命名及外部目录挂载。遇到损坏主索引、备份存在但主索引丢失、未完成原版事务、符号链接或复制中变化，程序拒绝导入并保留源数据。

## 操作

- 创建、编辑、归档和删除课程；删除课程保留资料并移到未分类。
- 批量导入文件/文件夹或拖入文件；可复制到库内或保持外部引用。
- 课程内物理文件夹、嵌套目录、改名和跨课程移动；资料多选移动、收藏、标签、备注、搜索及列表/封面视图。
- 文件实际改名保留扩展名。移除记录保留实际文件，不清空磁盘。导出副本支持批量选择，同名文件自动编号，保留目的地已有文件。
- 本地文件监听与启动扫描跟踪改名/移动；文件丢失时保留记录、批注和身份，不把新同名文件冒充旧文件。
- PDF、图片、音视频和文本在受限预览中打开；常见文档可用系统应用打开，未知/程序格式只能显示文件位置。
- 计划支持每日/每周/每月重复、间隔、截止日、单次例外、“本次及以后”拆分、完成/取消/归档/恢复、关联资料及临时变更历史；提供列表、日程和月历。
- 本科课表提供周视图、学期和节次设置、单次停课/恢复、调课/还原及月历显示。课表 JSON 可离线导入。
- 作业独立浏览真实目录，支持文件与文件夹复制、新建、重命名、系统打开、挂载外部目录。
- AI 设置支持 OpenAI 兼容 Chat Completions 地址、模型及 API Key，SSE 流式输出、停止、工具调用确认、持久化对话。工具写入必须确认，过期 revision 会拒绝。
- 教学网站使用独立且按资料库隔离的 Chromium 登录会话；原解析脚本读取当前页面，资源页可选择文件下载导入。
- 读取课程首页后可绑定本地课程，再打开作业页预览标题、内容和截止日期变化。确认前重读网页并核对账号、课程、内容和库 revision；保留手工修改，截止日期冲突可选择保留本地或采用网站。断开连接保留本地资料和计划。
- 绑定课程后进入「批量更新审核」，选择课程并检查。检查不下载附件正文；新增资料默认选中，已有资料标记「待下载核验」，缺失资料需明确勾选恢复。只下载选中项，相同摘要跳过，改变内容创建新版本。成功行移除，失败行保留错误，可重试。
- 本地正文被修改时先停止该项，只有单独批准后才保存本地历史版本并采用网站正文。手工标题、备注、分类和移动位置保留。截止冲突明确选择保留本地或采用网站。
- 资料信息中的「版本历史」支持离线浏览、预览和恢复；恢复创建新 UUID，当前及所有历史文件均保留。未归档计划与例外跟随新版本，归档计划保留原引用。旧来源映射继续有效；本地移除或跨课程转移的条目不自动复活。
- 周课表分钟网格支持课程与计划的单次拖动、上下边缘缩放；固定安排默认锁定。选中后方向键调整 10 分钟或 1 天，`+/-` 调整 1 分钟；边缘焦点微调 1 分钟。保留原发生日、重复系列其他日期及截止时间，遇并发修改拒绝覆盖。
- 计划月、周、日共用课程详情，支持每周时段编辑、自由课程排课、颜色继承、关联资料/作业及本次会话的课表撤销；默认新建待安排，更多菜单提供“空”和全天安排，周网格空白处可拖动新建。详见[计划页迁移和验证](../docs/electron/schedule-workspace.md)。
- 设置中的自定义顶栏最多 6 项，可排序、清空及恢复默认，随资料库保存。右上角刷新重新读取当前页面的本地数据，保留所在课程、目录、日历日期、筛选和聊天输入，不依赖网站登录。加号菜单提供新建课程、新建计划和“连接教学网站…”；网站入口打开已有教学网站工具，可登录、管理课程连接和导入资料，批量更新仍需预览审核。
- 教学网站工具中的“记住此资料库的教学网站登录”默认关闭，最多保留 7 天的官方 Moodle 会话。关闭记忆不退出当前网页；恢复失败可主动重试安全存储。原生应用的凭据不会被迁移或修改。
- “启用后台定时巡检”默认关闭、默认 30 分钟，可改 5–1440 分钟。开启后约 30 秒首查；离线、未登录、前台操作或已有待审清单时暂停。状态栏与网站工具进入同一审核清单；关闭窗口保留清单，明确丢弃才安排下一次检查。睡眠恢复不会补发一串请求。
- 全局搜索按词同时匹配课程、资料和计划；支持最多 60 步会话导航历史（含文件夹）、完整计划状态筛选和未保存编辑的离开/原生退出保护。

## 安全边界

Renderer 没有 Node.js；`contextIsolation` 和 `sandbox` 开启，preload 仅导出具体业务方法。IPC 校验发送窗口、主框架、精确页面 URL 和严格参数 schema。教学网页没有 preload，不能调用本地 API；权限与弹窗受限。预览仅通过随机令牌解析当前库中已登记材料，拒绝任意路径；不把 HTML 或 SVG 当内嵌活动网页运行。

API Key 使用 Electron safeStorage 的操作系统加密，密钥按规范化 API endpoint 绑定；更换 endpoint 后不沿用旧密钥。Linux 无安全密钥环时拒绝保存密钥，不回退明文。本地离线功能不依赖钥匙串是否可解锁。

MCP 默认关闭，启用后只监听 `127.0.0.1:53142/mcp`（与原版端口分开），要求随机 Bearer token，拒绝浏览器 Origin、错误 Host、超限及非法请求。设置页可复制 HTTP 或 stdio 配置；stdio 使用随应用分发的桥接脚本，不要求另装 Node.js。25 个工具与原版目录一致，包括重复发生项查询、单次/未来计划修改和冲突安全撤销。使用复制迁移后的新 revision，不能继续使用 Swift 缓存的 revision。

## 测试

```sh
npm test
npm run build
npm run test:e2e
```

测试必须允许本地回环监听；限制监听的沙箱会让真实 HTTP 测试报 `listen EPERM`，不代表协议测试可以跳过。E2E 顺序运行主应用、批量/历史版本、拖动/缩放/键盘、顶栏、登录记忆、真实定时巡检和独立 Chromium 传输测试，所有文件及学校页面均来自临时目录或明确的离线 fixture，不读写真实用户资料库或登录会话。Linux E2E 需要桌面会话或 `xvfb-run --auto-servernum npm run test:e2e`。

右上角刷新专项可运行 `node tests/page-refresh.e2e.mjs` 和 `node tests/toolbar-feedback.e2e.mjs`：覆盖真实文件改名后的索引、月周日日期及筛选保留、当前作业子目录、设置草稿确认、聊天输入、离线无连接刷新、慢 IPC 重复点击和失败重试；新建菜单覆盖课程、计划和教学网站三项；教学网站入口另验证已连接课程、设置草稿的取消与丢弃确认，以及不自动启动登录或批量更新。`toolbar.e2e.mjs` 验证自定义顶栏和旧设置兼容，`settings-lifecycle.e2e.mjs` 与 `website-background.e2e.mjs` 验证关联功能。2026-10-27 本机 macOS ARM64 验证：328 项业务测试、上述 5 组窗口测试共 45 项、生产构建、修改文件格式检查与差异检查均通过，窗口测试无 renderer 错误。本轮刷新实现独立使用 Electron 本地服务，未参照或修改原生课屿实现；Windows/Linux 未在本轮重新运行窗口测试。

Swift 兼容夹具可重新生成：

```sh
python3 desktop/scripts/generate-swift-fixtures.py
```

在仓库根目录运行，需要 macOS Swift 6；编译未修改的 `Sources/TeachshelfCore`，生产编码器生成 JSON，生产 Repository 验证读取。差分验证先生成 TypeScript 测试输入，再由未修改的生产 Swift 核心解码、验证并比对。以下在 `desktop/` 中运行（macOS）：

```sh
TEACHSHELF_PLANS_ROUNDTRIP=/tmp/plans.json TEACHSHELF_TIMETABLE_ROUNDTRIP=/tmp/timetable.json TEACHSHELF_TEACHING_ROUNDTRIP=/tmp/teaching.json node --experimental-strip-types --test tests/plans.test.ts tests/timetable.test.ts tests/teaching-sync.test.ts
python3 scripts/verify-swift-plans.py /tmp/plans.json
python3 scripts/verify-swift-timetable.py /tmp/timetable.json
python3 scripts/verify-swift-teaching.py /tmp/teaching.json
TEACHSHELF_MATERIAL_ROUNDTRIP=/tmp/materials.json node --experimental-strip-types --test tests/material-sync.test.ts
python3 scripts/verify-swift-materials.py /tmp/materials.json
```

详情见 [兼容契约](../docs/electron/data-compatibility.md)、[功能映射](../docs/electron/feature-map.md)、[验证报告](../docs/electron/validation.md)。

## 构建

```sh
npm run package:dir
npm run package -- --publish never
npm run test:packaged
```

输出在 `desktop/release/`，应用名为「Teachshell」。macOS 生成 DMG/ZIP，Windows 生成 NSIS EXE，Linux 生成 AppImage/DEB。`.github/workflows/desktop.yml` 在各平台原生 runner 安装依赖、测试、构建安装包，再用打包后的应用重复主界面及批量/版本窗口验收并上传产物和截图。每次必须核对本次源提交的工作流结果；历史成功不代表当前提交已通过。见[验证报告](../docs/electron/validation.md)。

每次修改并通过相关编译和测试后，自动本地提交，再运行 `npm run release:mac`，无需重复确认。该命令从当前 Git 提交创建临时快照、构建 Release `.app`、验证签名和内嵌 commit/version；正常退出 `/Applications/Teachshell.app`，保留旧 bundle 于 `/Applications/.Teachshell-backups/`，替换后注册 LaunchServices、打开并核对进程路径及应用摘要。日常更新不生成 DMG/ZIP 等分发安装包，除非用户要求。未保存退出被取消时停止替换，不强制结束进程；安装失败恢复旧 bundle。`release/installed-macos.json` 保存安装回执。`npm run install:mac` 可只安装已构建且签名有效的应用。原 `/Applications/课屿.app` 和用户资料库保留。

macOS helper 和应用均为 ARM64，打包前验证架构；从 0.3.10 起不再支持 Intel Mac，Intel 和 Universal 打包目标会被拒绝。本地构建为 ad-hoc 签名；没有开发者证书和公证凭据，正式分发仍需 Apple Developer 签名/公证及 Windows 代码签名。自动流程不推送、不对外发布。设置页显示版本、源提交和当前执行路径，可核对是否运行新版。

## 当前边界

- 日历已有月历、周课表和日程；课程与计划的分钟拖动、边缘缩放、键盘微调、固定安排锁定及自定义顶栏已迁移。像素级布局与 Office 原生缩略图仍有差异。
- 教学资料增量/版本与批量审核、可选七天登录记忆、默认关闭的后台定时巡检已实现。后台只在应用运行时检查并生成审核，不自动下载或应用；开机启动、应用退出后的系统任务和系统通知未实现。真实账号登录受校园网络与学校页面影响，离线自动验收不能替代真实账号验收。
- 安全文件复制暂使用同一资料库卷内的硬链接完成无覆盖提交；不支持硬链接的卷会明确拒绝并回滚。优先使用本地 APFS/NTFS/ext4，网络/移动卷未验收。
- 同一用户下其他恶意进程可绕过任何应用级锁/权限；不支持两端同时修改同库。
- Windows/Linux 的原生 runner 自动化与用户桌面安装体验分别验收，结果见验证报告；真实学校账号登录仍需对应环境验证。没有凭据时只做离线解析和受限下载测试，不声称真实登录已通过。

## Windows / macOS GitHub Releases

发布流程位于 `.github/workflows/release.yml`。在用户明确要求发布时，先更新 `package.json` / `package-lock.json` 版本和 `release-notes/<版本>.md`，验证并提交后推送同版本 `v<版本>` 标签。标签版本必须与包版本一致。

流程分别在 Windows x64、macOS ARM64 原生 runner 上测试、编译和打包，解开安装包验证代码、源提交及架构，再对打包应用运行月周日、课程交互、页面刷新、顶栏反馈和登录记忆测试。登录测试使用合成账户夹具及真实系统安全存储，覆盖操作互斥、请求失败回滚、重启恢复和关闭清除。只有两个目标全部通过，才上传完整资产并将草稿转为公开 Release；已公开版本不会被覆盖。附件含三个安装包（Windows x64 EXE、macOS ARM64 DMG/ZIP）、SHA256SUMS 和 manifest。

本地构建命令：

```sh
npm run release:mac -- --installers --windows # Mac：从同一提交构建/验证两平台，并备份更新本机
npm run package:mac
npm run verify:release -- darwin arm64 # 仅支持 Apple Silicon
npm run package:win
npm run verify:release -- win32 x64
```

Windows 安装包可在 Mac 交叉构建并解包校验，但实际 Windows 运行验收由 Windows runner 完成。Mac helper 与应用均为 ARM64，不再构建或发布 Intel 版本；本地更新仍使用 `npm run release:mac` 备份替换 Teachshell，不修改原生课屿。发布版本 0.3.8 起附件名称包含平台和架构。macOS 当前为 ad-hoc 签名、未公证；Windows 未配置发布者证书。

Windows 文件监听使用 500ms 目录/文本轮询与 1000ms 二进制文件轮询，避免系统子目录监听句柄阻止应用内改名或资源管理器移动。大型资料库的 CPU/磁盘开销可能高于原生事件监听；Windows/Linux 保留 Chokidar 的 350ms 写入稳定检查，所有平台由主进程 500ms 合并后扫描。macOS 不依赖逐目录扫描注册，不把事件路径当作改名事实。

Windows 本机执行 `verify:release` 需要完整 7-Zip（默认 `C:\Program Files\7-Zip\7z.exe`，可用 `TEACHSHELL_7ZIP_PATH` 指定）。校验会先检查 NSIS 格式支持，再解包对比；electron-builder 自带的 Windows 精简版 7za 不包含该读取器。GitHub Windows runner 已提供完整版本。
