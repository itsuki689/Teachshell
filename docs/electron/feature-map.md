# Swift 功能审计与 Electron 迁移映射

审计基线：Git `24efb2d`（`codex/in-app-ai-assistant`），2026-10-25。仅审计 `Sources`、`Resources`、`Tests` 和 Swift 包入口；`example/`（WPF）不参与迁移。本文记录读到的实际行为与目标边界，不代表对应 Electron 模块已经完成。各阶段的实测结果另见测试报告。

## 1. 原应用结构与界面

`Package.swift` 有四个生产 target：`TeachshelfCore`（业务、JSON 与文件）、`TeachshelfMCPKit`（协议/HTTP）、`TeachshelfMCP`（stdio 转发程序）、`Teachshelf`（SwiftUI/AppKit 应用）。包最低 macOS 14，Swift 6 工具链、Swift 5 语言模式；Core 仍使用 Darwin/CryptoKit，不能直接声称可在 Windows/Linux 编译。

| 功能               | 阅读的实现                                                                                                                                                         | 已有行为                                                                                                                                                                                                | Electron 映射及验收边界                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 窗口与导航         | `ContentView.swift`、`TeachshelfApp.swift`、`SidebarNavigation.swift`、`WorkspaceNavigation.swift`                                                                 | 默认 1260×800，最小 1020×680；侧栏宽 210–300，默认 235；学期选择、全部/收藏/最近/未分类/作业/待办六个快捷入口；计划与 AI 助手；当前/归档/全部课程；底部状态栏；最多 60 个会话导航历史（包含当前文件夹） | Vue 布局 + Pinia 导航；系统菜单用 `CmdOrCtrl`；课程/文件夹导航不能丢失选择与未保存编辑                                                           |
| 课程               | `CourseSidebarRow.swift`、`Editors.swift`、`Repository/LibraryRepository+Courses.swift`                                                                            | 新建、名称/学期/教师/颜色编辑、归档/恢复；改名同步实际课程目录；删除后保留资料和计划，并解除关联/保留课程名快照                                                                                         | 主进程课程 service；不能以删除目录替代删除课程记录                                                                                               |
| 资料列表和封面     | `LibraryWorkspace.swift`、`MaterialBrowser.swift`、`MaterialListView.swift`、`MaterialCoverCard.swift`                                                             | 列表/封面切换；搜索标题、课程、标签和备注；格式/类别过滤；全局最近添加/名称/最近打开/大小排序；课程内名称自然顺序/时间/自定义顺序；嵌套文件夹、面包屑、展开折叠；单选右侧信息抽屉不改变表格视口         | Vue 组件和纯数据排序；应测试中文数字自然排序、大小写和嵌套路径，而不只显示文件名                                                                 |
| 资料编辑与导入     | `MaterialManagement.swift`、`Editors.swift`、`Repository/LibraryRepository+Materials.swift`                                                                        | 复制入库或外部引用、批量导入、收藏、分类/标签/备注、显示标题与实际文件名分开；跨课程/文件夹移动；分组与解散；移除记录保留文件；导出；外部拖入和资料内拖动                                               | 主进程完成 dialog、文件操作、事务；preload 只暴露明确动作，Renderer 不接受任意路径读写能力                                                       |
| 预览、打开、显示   | `PreviewService.swift`                                                                                                                                             | Quick Look 预览与系统默认应用打开；QLThumbnailGenerator 缩略图缓存 48 项，键含路径/mtime/size                                                                                                           | PDF/图片/音视频限定 MIME 预览 + 系统 `openPath`/`showItemInFolder`；HTML/SVG 不得作为有本地 IPC 权限的页面执行；Office/Quick Look 等价性需另验收 |
| 作业文件夹         | `HomeworkWorkspace.swift`、`Repository/LibraryRepository+Homework.swift`                                                                                           | 独立真实目录浏览、上级/刷新、复制添加文件和目录、重命名、新建目录、打开/显示、课程外部目录挂载/取消挂载                                                                                                 | 不能用普通课件列表冒充作业 workspace；外部挂载路径在迁移到另一系统后需重新定位                                                                   |
| 文件监听           | `LibraryFileWatcher.swift`、`Repository/LibraryRepository+FileSystemSync.swift`                                                                                    | FSEvents 递归监听 `files/`，0.35 秒合并；AppStore 再 400ms 去抖，busy 时延后，失败最多重试 3 次；窗口激活时也同步；实际身份识别在 Repository                                                            | Node watcher 只发变更信号，Repository 负责扫描/身份映射；必须测试外部移动、重命名、缺失恢复和重复事件                                            |
| 计划列表           | `TaskWorkspace.swift`、`TaskEditor.swift`                                                                                                                          | 全部/待安排/未完成/已完成/取消/归档筛选、课程/文本筛选、多选删除、详情、关联资料、状态/归档、撤销；搜索包含重复计划例外内容                                                                             | 计划列表服务先保持字段，不将未排期计划伪造成有执行时间的事件                                                                                     |
| 周/月/日程         | `ScheduleWorkspace.swift`、`ScheduleWeekView.swift`、`ScheduleMonthView.swift`、`ScheduleAgendaView.swift`、`ScheduleEventEditing.swift`、`PlanPresentation.swift` | 三种日程视图，右栏学期/模式/日期/当天安排；执行和截止是独立事件；重复规则与单次/未来变更；固定计划/活动计划；拖动、键盘编辑、锁定调整、撤销                                                             | 需要完整时间/重复展开算法和冲突测试；仅展示 tasks 表不等于日历迁移完成                                                                           |
| 本科课表           | `NJUWebImporter.swift`、`NJUImportSheet.swift`、`TimetableModels.swift`、`Repository/LibraryRepository+Timetable.swift`                                            | 官方网页登录 DOM 解析或离线 JSON 导入；多表选择、学期/周一/周数/作息设置；课程时段和自由时间；调整/取消/恢复课程安排                                                                                    | 复用随包 JS 与 JSON 模型；Chromium 页面隔离；时区继续使用 Asia/Shanghai                                                                          |
| 全局搜索与快捷操作 | `WorkspaceSearch.swift`、`WorkspaceToolbar.swift`、`TeachshelfApp.swift`                                                                                           | 空格分词 AND 搜索课程/资料/计划，各最多 6 条，精确标题优先；跳转会清除遮挡筛选；自定义顶栏；⌘N 新建、⌘O 导入、⌘S 保存、⌘K 搜索、⌘[/] 前进后退、⌘Return 打开、⌘Y 预览                                    | 菜单与 Renderer action 用同一入口；Win/Linux 映射 Ctrl                                                                                           |
| 设置与备份         | `SettingsWorkspace.swift`、`AppearancePreference.swift`、`ToolbarSettingsControl.swift`、`Repository/LibraryRepository+Backups.swift`                              | 外观/顶栏/资料库/备份/AI/MCP/关于；切换资料库、复制迁移（原库保留）、备份含未索引库内文件；恢复前内容进入 `History`；外部引用仅备份路径                                                                 | 用户配置与资料库 JSON 分开；备份应验证文件内容与安全路径，不能只导出 library.json                                                                |

主要 AppKit 专属边界包括 NSOpenPanel/NSSavePanel、NSAlert、NSPasteboard、NSWorkspace、QLPreviewPanel、QLThumbnailGenerator、WKWebView/WKDownload、FSEvents、Keychain、窗口关闭守卫。所有系统侧替代均应留在 Electron main/preload 明确桥接中。

## 2. AI：实际格式与行为

读取 `AI/AIChatClient.swift`、`AIChatController.swift`、`AIConfiguration.swift`、`AISettingsModel.swift`、`AIToolArguments.swift`、`AIToolPresentation.swift` 与 `AppToolExecutor.swift`。

**重要差异：当前 Swift 并没有流式 Chat Completions，也没有聊天历史文件。**

- `AIChatClient.complete` 请求体固定 `stream: false`，URLSession.AsyncBytes 逐字节收集完整 JSON 后解析；不能把 AsyncBytes 当作已实现 SSE 流式 UI。
- `AIChatController.items`（用户/助手/操作/通知卡片）和 `history: [[String: Any]]` 仅在内存中。清空、切库、配置改变或失败会重置历史。未发现聊天 JSON 编码或磁盘保存路径，因此不存在可直接从此版本导入的聊天历史文件；Electron 新增持久化时应说明这属于新增能力。
- 仅配置 `endpoint`、`model`、`reasoningDisabled` 以 JSON Data 存入 UserDefaults 键 `aiAssistantConfiguration`，并不位于 `library.json`。
- 密钥在 macOS Generic Password Keychain：service `com.teachshelf.mac.ai-api-key`，account 为规范化后的完整 completion URL；不写资料库/备份。endpoint 只接受 HTTP(S)，禁止用户名/密码/query/fragment；去尾斜杠后补 `/chat/completions`。
- 空密钥允许（兼容本地服务）；非空密钥禁止 CR/LF，最多 8192 UTF-8 字节。禁止 HTTP 重定向转发密钥，清空 cookies/cache/credential storage。连接测试要求模型正确调用 `connection_test`，不是仅探测端口。
- 输入上限 20,000 字；请求体 1,500,000 字节；响应 2,000,000 字节；请求超时 300 秒、资源 360 秒。非 2xx 返回通用可操作提示，避免显示服务响应中可能含密钥/正文的内容。
- 回复必须为 `choices[0].message.role == assistant`；保留 `reasoning_content` 以兼容后续工具回合；`length`/`content_filter` 结束会拒绝执行。每回复最多 8 个调用、ID 不重复且 <=200 字、只接受 function；每用户回合最多 12 次模型请求、32 次工具执行，全回合 call ID 去重。
- AI 使用与 MCP 相同的 25 个 JSON Schema；`AIToolArguments` 在 schema 指导下规范化兼容模型输出（如字符串布尔/数字/数组），之后再次严格校验。不能把宽松转换扩展为任意隐式 coercion。
- 上下文只附当前库 ID、北京时间、选中课程/资料 ID 与标题。新增独立计划不先查询全部资料库。资料/备注/工具返回文本被当成不可信数据。
- 内置 AI **每项写工具先显示真实参数预览并等待确认**；拒绝不会执行。停止、切库、过期确认、正在编辑的对象都有守卫。工具执行成功才显示实际结果，计划变更支持结果卡撤销；失败工具也返回 `role: tool` 的错误对象继续对话。
- 现有工具明确不能读取 PDF/其他文件正文、访问网络、执行命令、导入任意路径或调用任意磁盘 API。

目标：Node 主进程 OpenAI 兼容 HTTP 客户端 + 增量 UTF-8/SSE 解码 + 有界工具调用循环；preload 只推送内容 delta、状态和确认请求。新增历史持久化需要版本字段与原子写，密钥使用操作系统安全存储；Linux 未提供安全后端时应明确拒绝持久化密钥，不能静默明文降级。

## 3. MCP 真实工具目录

`mcp-tool-catalog.json` 由现有 Swift `PlanMCPTools.definitions + LibraryMCPTools.definitions` 编译执行导出，含**完整描述、字段、required、additionalProperties 和 annotations**，便于 TypeScript 对照测试。共 25 项，其中 11 读、14 写。下表中的名字均省略 `teachshelf_` 前缀。

所有 object schema 均禁止未定义字段；分页 `offset` 为 0..1,000,000，`limit` 为 1..100（服务默认 50）。UUID 还需业务层校验。nullable 与省略语义不同：省略筛选表示全部，`null` 表示未分类/根层。

| 工具                       | 权限 | 参数/关键语义                                                                                                                              |
| -------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `context`                  | 读   | 无参数；库 ID、北京时间、课程与工具规则；应用入口合并 `library_revision` 和类别                                                            |
| `list_plans`               | 读   | query/course_id/status/offset/limit；默认 active，返回 id/revision/摘要                                                                    |
| `get_plan`                 | 读   | id 必需，可选 original_date；返回整组 revision 与该次有效内容                                                                              |
| `list_occurrences`         | 读   | from/to 必需，含端点，最多 31 天；可选 course_id；展开执行/DDL 与临时变更                                                                  |
| `search_materials`         | 读   | query 必需，可选 course_id；只返回可关联资料 ID，不返回文件内容/磁盘路径                                                                   |
| `create_plan`              | 写   | library_id/request_id/fields 必需；fields.title 必需；request_id 为新计划 ID；默认没有执行时间；返回 change_id                             |
| `update_plan`              | 写   | library_id/id/expected_revision/patch 必需；scope 默认 all；thisOccurrence/thisAndFuture 需要 original_date；单次不可改 repeat_rule/origin |
| `set_plan_status`          | 写   | 上述目标 + action；complete/reopen/cancel/restore/archive/unarchive；每种 action 允许的范围不同                                            |
| `delete_plan`              | 写   | library_id/id/expected_revision；scope all/thisOccurrence/thisAndFuture；仅本次相当于取消该次                                              |
| `undo_change`              | 写   | library_id/change_id；当前会话最近 50 次计划变更；若对象后续改变则拒绝覆盖                                                                 |
| `list_courses`             | 读   | query/archived/offset/limit；默认含归档，返回数量统计与 library_revision                                                                   |
| `get_course`               | 读   | id 必需；课程详情与资料/文件夹计数                                                                                                         |
| `create_course`            | 写   | 库 guards + request_id/fields；fields.name 必需；重复 request_id 拒绝，不重复创建                                                          |
| `update_course`            | 写   | 库 guards + id/patch；name/semester/teacher/color_hex/archived；物理目录随改名                                                             |
| `delete_course`            | 写   | 库 guards + id；解除教学连接、资料移未分类、保留计划与真实文件；不能用计划 undo 撤销                                                       |
| `list_materials`           | 读   | query/course_id/folder_id/recursive/category/favorite/missing/offset/limit；默认当前层，可递归                                             |
| `get_material`             | 读   | id 必需；完整元数据与关联计划 ID；不泄露外部原文件路径                                                                                     |
| `update_material`          | 写   | 库 guards + id/patch；title/category/tags/notes/favorite/filename；title 仅显示标题；filename 仅库内非缺失文件，必须保留扩展名             |
| `move_materials`           | 写   | 库 guards + ids/course_id/folder_id；原子批量 <=100 个，非空无重复；引用文件原地保留                                                       |
| `remove_materials`         | 写   | 库 guards + ids；移除记录并解除计划关联，保留文件；不能计划 undo                                                                           |
| `list_material_folders`    | 读   | course_id/parent_id/offset/limit；路径、层级、直接和递归计数                                                                               |
| `get_material_folder`      | 读   | id 必需；详情与 revision                                                                                                                   |
| `create_material_folder`   | 写   | 库 guards + request_id/name/course_id 必需；parent_id/color_hex 可选                                                                       |
| `update_material_folder`   | 写   | 库 guards + id/patch；name/color_hex/course_id/parent_id；子树一起移动，换课程且未指定 parent 则移新课程根；禁止循环/同层重名              |
| `dissolve_material_folder` | 写   | 库 guards + id；整个子树解散，资料回上层，真实文件保留                                                                                     |

库 guards 指 `library_id` + `expected_library_revision`。计划编辑是单计划 revision；课程/资料/文件夹编辑是整库相关数据 revision。库 ID 是规范化、解析符号链接后的根路径 SHA-256；revision 是规范化 JSON 的 SHA-256（`overriddenFields` 排序）。整库 revision 包含课程、资料、文件夹、计划、类别、网站连接、课表，忽略 UI 偏好和 `lastOpenedAt`。跨语言实现若改变 canonical JSON 的数字/Unicode/可空字段，必须明确 revision 不承诺跨进程缓存可复用，客户端需重新查询。

`AppToolExecutor` 是外部 MCP 与内置 AI 共用执行入口，调用 live Repository，不开第二写入者。先检查当前库、busy 和编辑冲突，再在后台执行物理事务，提交后刷新 UI。

### 传输与权限

- `MCPProtocol.swift` 为无状态 JSON-only Streamable HTTP，支持 `2025-11-25`、`2025-06-18`、`2025-03-26`；没有 SSE。支持 initialize、ping、tools/list、tools/call。
- 通知无响应，且通知不能调用工具；JSON-RPC ID 只允许字符串/有限整数，拒绝布尔；不接受 batch 数组；业务错误以 `result.isError` 返回。
- 默认只监听 `127.0.0.1:53141/mcp`；仅 POST；Bearer token 必需；Host 限 localhost/127.0.0.1 + 实际端口，Origin 若存在也必须同源。每连接一个请求，最多 32 连接、15 秒超时、16KiB 头、1MiB body；拒绝 chunked、重复头、Expect 和额外帧，防止歧义请求。
- `MCPConfiguration` 默认 `~/Library/Application Support/TeachshelfMCP/config.json`，目录 0700、文件 0600、当前用户所有，拒绝符号链接；token 随机 32 字节的 64 位 hex，支持旋转。Windows 需要 ACL 等价保护。
- `TeachshelfMCP/main.swift` 是 newline JSON-RPC stdio→HTTP bridge，stdout 只输出协议；stderr 才输出诊断。每请求重读配置、禁止重定向，避免复制 token 到不可信地址。
- 外部 MCP 在已启用并提供正确 token 后直接调用受校验的工具；**不是每次都弹 UI 确认**。逐次写入确认是内置 AI controller 的行为。迁移不要混淆两种授权边界。

## 4. 教学网站与课表解析

### 可复用的实际 JS

1. `Resources/TeachingWebsite/parser.js` 是 `(doc, href) => JSON.stringify(page)`，只读当前 DOM，无网络/cookie/登录表单访问。精确限制 `https://selearning.nju.edu.cn` 与四种路径：`/course/view.php`、`/mod/folder/view.php`、`/mod/assign/view.php`、`/mod/resource/view.php`。
2. `Resources/Timetable/njubksjw2.js` 为 IIFE；只在 `https://ehallapp.nju.edu.cn/jwapp/sys/wdkb/` 下读 DOM。返回 `encodeURIComponent(JSON.stringify(...))`；多个不同可见课表时返回 tables 列表，下一次调用以局部 `teachshelfSelectedTableID` 选择。禁止把选择变量写成全局。保留旁边 Apache 2.0 LICENSE/NOTICE 与原作者归属。

Moodle 输出 `TeachingPage` 的 `kind/accountID/courseID/title/activities/files/intro/deadlineText/submitted`。账号从用户 profile 链接数字 ID 识别；活动仅 folder/assign/resource；忽略论坛与站外链接；标题 <=500、章节 <=100、简介 <=80,000；活动和文件各 <=3000。课件路径从 pluginfile URL 解码并拆子目录，抛弃 `.`/`..`，移除原查询参数，只保留 `forcedownload=1`。作业读取 intro 与提交状态/截止行，缺失关键 DOM 时抛错，不能返回空结果覆盖现有数据。

本科解析读取实际学期和最近容器的可见表格；过滤嵌套/隐藏/冻结列镜像，按完整行内容识别重复表，解析中文/全角数字标点、单双周、范围、单节和自由时间，周次限制 1..60、节次 1..30，无法解析的行提供 warnings。导出 `time_count` 是末节减首节（单节为 0），不是节次数。离线 JSON 上限 5MiB、课程时段 1..5000。

### 登录与 session

`TeachingWebClient` 导航仅允许 HTTPS 默认 443 上的 `selearning.nju.edu.cn`、`authserver.nju.edu.cn`，禁止 URL 用户密码。`TeachingLoginRecovery` 每个目标最多尝试一次官方 `?authCAS=CAS`；CAS 回 dashboard 后一次返回目标页面；从不自动填密码或提交认证表单。WKWebsiteDataStore 依库路径 hash 隔离。

可选“记住登录”只保存 `MoodleSession[A-Za-z0-9_-]*` 且域严格为教学网站（可带前导点），不存 CAS、密码、用户名 cookie。Keychain service 为 `com.teachshelf.mac.teaching-session`，account 为库路径 SHA-256。version 1 保存包最多 8 cookies，7 天有效，最多允许 5 分钟未来偏差，恢复强制 Secure 并保持 HttpOnly/session-only/expiry；不安全域/键名/格式整包拒绝。Keychain 出错没有明文 fallback；读取权限失败不能删除已有 secret。Electron 应独立安全 session 分区并明确旧 WebKit cookie 不会自动成为 Chromium session，需重新网页登录或显式受保护迁移。

### 检查、审核、下载、同步

`TeachingWebsiteController.check` 先只读页面和现有 mappings，**不下载附件、不改 library**；生成 `TeachingUpdateProposal`。课程绑定含 remoteCourseID/accountID，任何响应都验证账号和课程一致；忽略归档课程。作业/实验/课件/历史有单独开关，已提交/过期历史默认不导入。

缺失副本可生成 repair 项，但默认不勾选；已忽略/已删除本地映射不会自动重新下载。所有课程统一检查可部分成功、逐课程报告错误。确认清单有效期 15 分钟；应用时重新验证连接设置、当前库、课程归档、本地计划与检查快照，再只下载用户勾选的项目。附件先于计划应用，可部分失败并保留未完成清单重试；本地自改截止与网站截止冲突需要明确选择。

下载只允许 HTTPS 教学站 `/pluginfile.php/` 下的 mod_folder/content、mod_resource/content、mod_assign/introattachment、mod_assign/intro；每次重定向仍校验，禁止转登录页当附件。资源模块发现阶段先 HEAD 以免确认前下载。文件名必须 basename，无反斜杠/NUL，写临时目录，最多 512MiB、120 秒；完整后检查普通文件、非符号链接、非空、排除 HTML/密码页，PDF 检查 `%PDF-`、Office/ZIP 检查 PK。Repository 计算 SHA-256，依据 connection.items/folders mapping 做去重、文件夹组织、计划关联。只有成功事务才能更新本地映射。

目标 Electron：无 preload/Node 的独立 BrowserWindow 或 WebContentsView；`contextIsolation/sandbox`，禁止权限与任意弹窗/下载；网页不能直接调用本地文件或 MCP。仅可信 main 在用户触发时执行随包 parser，拿回结构化结果后做独立验证、预览、确认和导入。**能打开登录页不等于登录/课表/资料同步功能通过验收。**

## 5. 现有测试行为与迁移验收样例

以下已阅读实现与测试断言，并非声明这些测试已在本次审计运行：

- `LibraryMCPServiceTests`：25 唯一工具；没有 read_material_text/import_materials；课程改名/删除保留文件与计划；批量移动引用原地；索引写失败物理回滚；子树移动保留未索引内容；移除保留文件；revision 排除外观/打开时间；未知字段/危险文件名拒绝。
- `PlanMCPServiceTests`：局部修改保留其他字段；错误库与重复创建不写；重复计划本次/未来拆分；撤销冲突拒绝；归档需先恢复。
- `MCPTransportTests`：真实 HTTP 401/403/400/202/405；私有配置权限/符号链接；stdio subprocess 经 HTTP 写入库并读取已提交材料名称；未知版本协商；通知不执行。
- `AIChatTests`：最小上下文直接创建独立计划；确认后执行与撤销；拒绝/取消不变更；旧确认与编辑器防覆盖；切库拒绝晚到工具；未知工具错误；reasoning_content；重复/截断调用拒绝。
- `AIChatClientTests`：实际 HTTP 请求编码和工具能力探测；字符串布尔兼容；服务错误不暴露响应 body；超时提示；重定向不泄露认证。
- `TeachingPageParserTests`：真正 WKWebView DOM fixture；课程标题、站外/论坛过滤、嵌套路径、去查询参数、作业附件排除学生提交、未完整页拒绝。
- `TeachingUpdateFlowTests`：检查只读零下载；部分选择/错误/重试；账号变化、配置变化、本地编辑阻止未审阅覆盖；缺失文件显式选择、ignored 不下载；截止冲突两种选择；直接资源不预取。
- `TeachingLoginSessionTests`：仅 Moodle session opt-in、7天失效、域/键名防注入、保存与禁用竞争、Keychain 错误无明文 fallback、读失败保留原 secret、库 profile 隔离。
- `NJUImporterTests`：解析仅官方 origin；选择安全 JSON quote且局部变量；离线预览无需登录，关闭清除。

本审计额外把两份 Swift 工具定义实际编译执行，校验数量、唯一性和 object schema 后导出 `mcp-tool-catalog.json`。全量 Swift/UI 与三平台 Electron 的执行结果应在阶段测试报告中逐项记录，不能用源码审阅代替运行通过。

## 6. 完整替代版仍须验证的边界

- 课程/资料闭环通过后，计划重复展开与例外、课表拖动/撤销、作业挂载、完整备份恢复仍各自需要业务和 UI 测试。
- 真实学校账号登录、校园网络/VPN、页面现状无法由离线 fixture 证明，必须由已授权的实际账号环境执行；未测时明确标注。
- macOS Keychain 旧项目访问控制与 Chromium session 不会跨平台自动继承；密钥和 session 重设路径需要明确。
- Windows 保留名/盘符/UNC/大小写/原子替换与 Linux 目录权限/安全存储需要各平台 CI 与运行验证；macOS 构建成功不足以证明三平台可运行。
- 发布产物必须分别验证构建、安装、签名/公证状态。迁移期间不要替换或删除 Swift 源和现有用户资料库；新 app 使用独立标识、显式选择资料库。

## 7. 本轮已实施的 AI/MCP 模块（2026-10-25）

`desktop/electron/services/ai/` 实现了真正的 Chat Completions SSE 增量解码，覆盖跨 UTF-8 字节、CRLF、事件和 tool arguments 分块；同时接受兼容服务返回的普通 JSON。支持停止、逐项写入确认、工具参数校验、请求/响应/循环上限、重定向拒绝，以及 `.desktop-chat.json` 原子持久化。保存消息/工具结果与完整 wire context，失败或中断丢弃不完整 wire 交换，保留已执行操作的可见记录；不保存 API 配置或密钥。旧 Swift 的内存聊天无法在重启后提取，不伪造导入记录。

`desktop/electron/services/mcp/` 实现了回环 HTTP JSON-RPC 与真实 Repository 适配。原 Swift 工具目录保留为 catalog.json 基线，当前实际公开全部 **25 项**，schema 逐项与 Swift 导出值比较通过。`list_occurrences` 支持包含端点的 1–31 个上海自然日、最多 2000 个事件；执行和截止分别返回，保留整组 revision 与原始发生日。`get_plan original_date` 返回单次有效内容。计划写入接入已实现的日/周/月重复和 all/thisOccurrence/thisAndFuture 范围；单次禁止修改重复规则/类型，归档只允许整组，非取消状态禁止 thisAndFuture，与 Swift 协议一致。

适配使用 Repository 的 `withMutationGuard`，在资料库串行事务内完成文件同步后再次检查 revision，避免 AI 等待确认期间或其他界面写入后覆盖新内容。整库 revision 排除外观偏好和 lastOpenedAt。返回 revision 使用 `desktop-v1:` 命名空间，复制迁移后客户端须重新查询，不能重用 Swift 缓存 revision。计划撤销仅保存本次服务会话最近 50 项；拆分操作保存全部受影响计划的 before/after，逐条比较当前内容，仅恢复这些 ID，保留其他计划的后续修改。撤销本身返回可再次撤销的 change_id。before 在实际事务检查时捕获，避免把排队期间无关 UI 修改错误纳入撤销。MCP stop 会等待已开始的工具事务结束。

验证命令：`node --experimental-strip-types --test desktop/tests/ai.test.ts desktop/tests/mcp.test.ts`。测试覆盖真实本地 HTTP 流式工具回合、确认/拒绝/停止、历史重载/损坏/符号链接、secret 不落历史、Host/Origin/token/version/长度/重复头/通知防护、真实文件重命名/移动/移除保留内容、颜色清除、过期 revision/重复 request_id、RFC3339 时间、普通计划状态与冲突安全撤销。运行环境限制本地监听时需要在允许回环监听的测试环境运行，不能把 EPERM 当作业务测试通过。

本轮安全复核另增加 `desktop/tests/security.test.ts`：验证 HTML/XHTML 登录结果拒绝、下载地址与每次重定向限制、失败临时文件清理及目标不覆盖、系统打开文件格式白名单、IPC sender/结构字段校验，以及 API Key 绑定完整规范化 Chat Completions endpoint（换 host/path 清除旧密钥）。`SettingsService` 串行保存设置与资料库路径，密钥绑定不匹配时不解密且保留原设置提示处理。测试只使用临时目录与模拟凭据，不访问真实钥匙串。AI、MCP、安全三个文件合计 **32/32 通过**；普通计划另实际关闭并重新打开 Repository 验证已保存内容，撤销历史按设计不跨服务重启。

高级计划接入后的组合回归为 **100/100 通过**：AI 13、MCP 20、plans 26、Repository 25、作业 9、安全 7。新增覆盖包括原始发生日查询、单次移期后的定位、未来系列拆分、批量撤销/重做、任一拆分记录后改导致撤销拒绝、范围删除/状态规则，以及 AI 写入确认等待期间的真实 Repository revision 冲突保护。上述数量是该次组合命令的结果，不替代后续全套测试报告。

最终 Swift 行为复核补充了目录操作的幂等保护：向已有文件夹重复设置原课程不改变父目录；重复移动资料到原容器保留手工排序与原存储路径；文件夹颜色修改保留已观测路径，重命名仍位于原物理父目录。新增 2 项真实 MCP 回归检查 `changed: false`、文件内容、inode、嵌套关系和未索引文件保留；MCP 测试文件现为 22 项，Repository 25 项单独复跑通过。

## 8. 本轮已接入的教学作业同步（2026-10-25）

`website/teaching.ts`、`website/assignment-sync.ts`、`main/teaching-ipc.ts` 与 `WebsiteDialog.vue` 已接入课程来源绑定、当前作业预览与确认、本地修改保护、截止冲突选择、同步选项和断开连接。主进程限定来源 URL、账号和远端课程；应用前重新解析当前页面，检查库身份、15 分钟期限和整库 revision，并在串行事务内复核。选项局部补丁在事务中读取当前连接，避免并发开关丢失其他设置。切库清除网页和作业预览，网站窗口使用独立会话分区。

页面身份与内容在一次 isolated-world 执行中采集；开始、采集和完成 URL 必须相同。解析加载期间或结果返回前发生导航会拒绝旧结果，不能将另一作业的内容错误标记成旧 URL。新增 6 项执行与解析回归覆盖导航竞态、教学 JSON、课表 URI 编码和大小限制。

作业合并已用未修改的生产 Swift Core 完成 12 组解码/再编码和实际合并差异对照。教学同步 14 项、网页观察 6 项、下载 3 项，组合 **23/23** 通过。这是当前作业逐项确认流程的验证；后续批量审核和文件版本模块见下节。真实校园登录仍需独立验收。

## 9. 教学网站批量审核与增量文件接入

`TeachingBatchService` 已对照 Swift 实际检查/应用流程实现多课程活动遍历、稳定审核 ID、只读检查、已有正文待核验项、显式缺失修复、附件先计划、截止选择、部分失败重试和同步记录。已有正文仅在选中后下载比较摘要，本地修改须独立批准；版本保存由 `material-sync.ts` 原子事务负责。下载前后重读账号/课程/页面，事务复核库 revision；服务自己的写入推进 revision，其他编辑使旧审核失效。

Chromium 使用隐藏 sandbox 读取窗口和当前库 session；资源模块先 HEAD，读取窗口禁止附件 GET，正文只在确认后下载。读取并发 1、35 秒超时，读取结束销毁窗口，取消/切库终止请求。批量测试 14/14、TypeScript 检查和独立真实 Chromium HEAD/下载隔离验收通过。接口与边界见 [批量审核说明](teaching-batch-migration.md)。

## 10. 原生交互保留与版本恢复

`WorkspaceSearch.vue` 复用原按词 AND 匹配、每类最多 6 项及精确标题排序规则，能定位课程、目录内资料和计划编辑器。`stores/library.ts` 提供最多 60 步的前进/后退，保存文件夹位置并裁剪失效位置。计划状态筛选包含重复发生项的例外状态。编辑器注册 beforeunload，主进程提供默认返回编辑的原生对话；资源清理在 will-quit 后执行，取消退出后库仍可保存。真实 Electron 已验证取消退出、继续保存和重启恢复。

`MaterialVersions.vue` 从真实索引列出同来源所有版本，显示缺失状态，预览真实文件并明确确认恢复；恢复产生新 UUID，保留当前/所选历史字节和用户元数据。Swift 生产 Core 已解码、验证并往返保存 Electron 创建的三个版本及课程来源映射。旧物理路径作为恢复副本保留，文件监听与重启不会重新收录它们。


## 11. 分钟交互、顶栏、登录记忆与后台巡检（0.3.0）

已读取原 `ScheduleWeekTimeline`、`ScheduleEventEditing`、`ToolbarSettings`、`TeachingLoginSession` 与实际测试样例。分钟网格保留原始发生日和时长，支持课程/计划拖动、两边缩放、键盘微调、锁定与并发取消；重复计划只改本次，截止与其他日期不变。自定义顶栏按原有 10 个枚举保存，默认 4 项，最多 6 项，可为空。详见 [原生交互迁移](native-interactions-migration.md)。

登录默认关闭，使用资料库内存分区及独立系统安全存储，只恢复官方 Moodle cookie，验证实际页面账号后才保存。宏观状态没有账号凭据；macOS helper 可禁止认证交互，Linux 不可无交互读取时要求明确重试。详见 [登录记忆迁移](login-session-migration.md)。

Swift 原版并无定时巡检；新增调度默认关闭、30 分钟，只读生成审核。与手动批量服务共用实例，前台接管先等待自己的后台检查取消；关闭审核保留清单，明确丢弃/全部完成后等待下一周期。切库、休眠、退出、登录状态变化均接入生命周期。详见 [后台巡检迁移](background-sync-migration.md)。完整替代的尚未验收边界以最新验证报告为准。
