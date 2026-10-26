# Teachshell

独立维护的 Electron + Vue 3 + TypeScript 跨平台课程资料应用，主实现位于 [`desktop/`](desktop/)，开发、启动和测试方式见 [Teachshell 开发说明](desktop/README.md)。

本目录使用自己的 `.git/`，不再作为 Teachshelf 的 worktree，不共享 Git 对象库，也不配置原版仓库的远程。保留已有提交历史用于追溯；原生 Teachshelf 仅作只读参考。本仓库内保留的 Swift 源码、资源和测试用于行为对照与数据兼容性验证。

两版应用及资料库继续独立：Teachshell 使用 `com.teachshelf.desktop` 与 `teachshelf-desktop` 数据目录；原生课屿使用 `com.teachshelf.mac` 与 `Teachshelf` 数据目录。

## 原生 Teachshelf 参考说明

以下保留原生 macOS 实现的历史说明；当前 Teachshell 的功能、命令与限制以 [`desktop/README.md`](desktop/README.md) 为准。

原生 macOS 课程资料管理器。按课程组织文件、作业与计划，文件留在本机，无需 Teachshelf 账户。

使用 **SwiftUI、AppKit、WebKit 和 Swift**，通过 Swift Package Manager 构建。`example/` 是独立的 Windows WPF 参考项目，不参与 macOS 构建；两版资料库格式不同，原始文件可重新导入。

### 主要功能

| 功能 | 支持内容 |
| --- | --- |
| 课程与资料 | 课程归档、复制入库或引用原文件、嵌套物理文件夹、标签、收藏、搜索、批量管理、ZIP 导出 |
| 作业文件夹 | 每门课程的普通磁盘目录，可使用 Finder 管理，也可挂载资料库外的已有目录 |
| 计划与 DDL | 月／周／日视图、执行时段与截止时间、重复计划、单次调整、完成状态与撤销 |
| AI 助手 | 内置自然语言对话、独立 AI 设置与统一 OpenAI 兼容模型接入、复用 25 个 MCP 工具；修改确认、结果定位、计划撤销和停止生成 |
| MCP 操作 | 通用 stdio / HTTP 连接、LLM 编辑计划、管理课程与资料信息、批量移动资料和物理文件夹；版本冲突检查、计划撤销及远程 MCP 客户端 SSH 连接 |
| 本科课表 | 南京大学官方页面或本地 JSON 导入，学期作息、调课、停课与重复导入 |
| 教学网站 | 南京大学 Moodle 课程连接、更新清单、选择性下载、作业与 DDL 同步、本机钥匙串登录恢复 |
| 外观与导航 | 全局搜索、后退／前进、可配置顶栏、统一的七页设置、明暗主题、强调色和可选过渡动画 |
| 资料库 | 本地 JSON 索引、完整备份、恢复与迁移、保存失败回滚 |

操作细节、快捷键和文件管理规则见 [使用指南](docs/usage.md)。内置助手配置见 [AI 助手指南](docs/AI.md)，外部 LLM 连接方式与工具说明见 [MCP 指南](docs/MCP.md)。

### 本机启动

需要 **macOS 14+** 和包含 **Swift 6+** 的 Xcode 或 Command Line Tools。尚未安装开发工具时，运行 `xcode-select --install`。

```sh
./scripts/run-macos.sh
```

首次启动会构建 Release 版本并生成 `build/Teachshelf.app`；也可双击 `Start.command`。已有应用包时，启动脚本直接打开它，因此修改源码后需先重新构建：

```sh
./scripts/build-macos.sh
./scripts/run-macos.sh
```

构建脚本打包图标、网页解析器和课表示例，并进行 ad hoc 签名与签名校验。生成的应用可在本机运行；对外发布需要另行配置 Developer ID 签名和公证。

### 开发与验证

```sh
./scripts/test-macos.sh     # Swift 回归；检测到 Node.js 时同时运行课表解析测试
./scripts/build-macos.sh    # Release 构建、资源打包与签名校验
```

脚本将构建缓存写入 `.build/`，并处理 Command Line Tools 的测试框架路径。Swift 测试包含真实 AppKit 窗口和本地 WebKit HTML 夹具，需要 macOS 系统服务；限制 WebKit 子进程的沙箱可能导致测试无法完成。未安装 Node.js 时，脚本会明确提示跳过 JS 测试。

**最近完整回归：2026-10-24，395 项 Swift 测试、49 个测试套件和 15 项本科课表 JS 解析测试通过。** 覆盖 AI 对话与确认、取消及迟到响应隔离、模型 HTTP 请求与工具能力检测、共享工具执行、MCP 协议与鉴权、真实 HTTP/stdio 调用、令牌更换与服务重启、计划并发冲突和撤销、课程资料及文件夹 MCP 编辑、批量移动回滚、Finder 改名与跨课程移动、丢失标记和重新定位、真实文件事件监听、物理文件夹与旧分组迁移、原子保存与中断恢复、备份恢复、计划与课表、网站更新流程、登录恢复、原生布局和工具栏交互。自动回归不代表重新完成学校登录或真实附件下载验收。

单独运行解析器测试或筛选 Swift 测试：

```sh
node scripts/test-nju-parser.js
./scripts/test-macos.sh --filter TeachingUpdateFlowTests
```

手动检查界面时可使用独立资料库：

```sh
open -n "$PWD/build/Teachshelf.app" --args --data-dir "$PWD/build/QA/manual-library"
```

该参数覆盖本次启动的资料库位置，不改写应用记住的正式资料库位置。独立测试输出位于已忽略的 `build/QA/`。

### 代码导航

| 位置 | 职责 |
| --- | --- |
| [Package.swift](Package.swift) | Core 库、原生应用、MCP 服务与桥接，以及三个测试 target，无第三方包依赖 |
| [Sources/TeachshelfCore](Sources/TeachshelfCore) | 数据模型、计划投影、课表、排序与配色等业务规则 |
| [LibraryRepository.swift](Sources/TeachshelfCore/LibraryRepository.swift) | 资料库独占锁、状态快照、事务、索引兼容及原子保存 |
| [Repository/](Sources/TeachshelfCore/Repository) | 按职责拆分的资料库操作，见下表 |
| [Sources/Teachshelf](Sources/Teachshelf) | SwiftUI 页面、AppKit 控件与系统集成；入口为 `TeachshelfApp.swift`，共享界面状态为 `AppStore.swift` |
| [Sources/TeachshelfCore/MCP](Sources/TeachshelfCore/MCP) | 计划/课程/资料/文件夹工具定义、参数校验、版本检查与原子编辑 |
| [Sources/Teachshelf/AI](Sources/Teachshelf/AI) | 内置对话、兼容模型客户端、钥匙串配置、确认与结果卡片 |
| [Sources/TeachshelfMCPKit](Sources/TeachshelfMCPKit) | MCP JSON-RPC、受令牌保护的本机 HTTP 服务与私有配置 |
| [Sources/TeachshelfMCP](Sources/TeachshelfMCP) | 随应用打包的 stdio 桥接入口 |
| [Resources/](Resources) | 应用信息、图标、本科课表与教学网站解析脚本 |
| [Tests/TeachshelfCoreTests](Tests/TeachshelfCoreTests) | 数据、文件管理、迁移及业务回归 |
| [Tests/TeachshelfLayoutTests](Tests/TeachshelfLayoutTests) | 原生布局、交互、WebKit 解析及网站更新流程回归 |
| [Tests/TeachshelfMCPTests](Tests/TeachshelfMCPTests) | 协议、鉴权、HTTP / stdio 实际调用、计划及课程资料修改、冲突和文件事务回归 |
| [scripts/](scripts) | 构建、启动、测试及图标生成 |

`Repository/` 中的文件扩展同一个 `LibraryRepository`，共享事务边界，不创建独立的资料库状态：

| 文件 | 职责 |
| --- | --- |
| `LibraryRepository+Courses.swift` | 课程保存、归档、删除及关联清理 |
| `LibraryRepository+Materials.swift` | 资料导入、引用、类别、排序、分组、废纸篓与 ZIP 导出 |
| `LibraryRepository+Plans.swift` | 计划、重复例外、完成状态、归档与撤销 |
| `LibraryRepository+Timetable.swift` | 本科课表导入、固定时段、调课与停课 |
| `LibraryRepository+TeachingWebsite.swift` | 课程连接、来源映射、文件与作业合并、截止冲突 |
| `LibraryRepository+Homework.swift` | 作业目录、外部挂载与目录操作 |
| `LibraryRepository+Backups.swift` | 备份、恢复、资料库复制与失败回滚 |
| `LibraryRepository+Preferences.swift` | 外观、过渡、强调色、边框与工具栏偏好 |
| `LibraryRepository+PhysicalStorage.swift` | 物理目录、写前日志、文件移动及可续接的失败回滚 |
| `LibraryRepository+FileSystemSync.swift` | 文件标识跟踪、Finder 移动和改名对账、丢失状态 |
| `LibraryRepository+StorageMigration.swift` | 文件布局计算、旧迁移日志恢复与旧作业目录迁移 |
| `LibraryRepository+FileSystem.swift` | 路径边界、符号链接检查、安全复制与原子重命名 |

修改资料库逻辑时，元数据变更通过 `commit` 提交；需要同时操作文件和索引时，在 `withLock` 内完成。共享快照只在核心文件内替换，索引成功保存后才更新内存状态。跨文件辅助方法仅在 Core 模块内可见，领域内部辅助方法保持私有。

### 数据与兼容性

默认资料库位于 `~/Library/Application Support/Teachshelf`，保存 `library.json`、上一份索引 `library.json.bak`、库内文件副本及作业目录。课程资料按 `files/<课程名> [<课程UUID>]/资料/<文件夹层级>/` 组织，作业独立存于同一课程下的 `作业/`。空文件夹也会创建真实目录；文件夹改名整体移动目录，资料移动同步更新磁盘与索引，浏览和搜索继续使用索引。恢复前的内容保留到 `History/`。

旧资料库首次打开时自动迁移到格式 9，保留文件内容、资料编号及分组层级；旧版应用会拒绝打开，避免把目录压平。文件操作使用写前日志及同卷重命名，索引提交失败或进程中断时可恢复。外部引用仍保留原位置。

Finder 中移动、重命名 `files/` 内已入库的资料、课程目录或文件夹后，课屿通过 macOS 文件事件自动更新路径和层级，跨课程移动保留资料编号、备注、标签与关联计划；未自定义的资料标题跟随文件名更新。连续操作合并处理，只扫描文件属性，不读取文件内容。关闭应用期间的更改会在下次启动时对账。

移出 `files/` 的资料保留记录并显示“位置丢失”，不会删除记录或把外部文件搬回。原文件移回后自动恢复，也可在资料详情中选择“重新定位文件…”将选中的文件复制回库内。移入 Finder 新建目录的已入库资料会补齐文件夹层级；其他新文件不自动导入。外部引用不参与库内移动跟踪。`.file-observations.json` 保存本机文件标识，完整复制资料库后会按现有路径重新建立标识。

- 当前资料库使用格式 9；可读取并迁移旧格式 1–8，旧版应用会拒绝打开格式 9。
- `.teachshelfbackup` 是 macOS 文件包，包含索引与库内文件。**外部引用资料和挂载的外部作业目录只保存路径，不备份其内容。**
- 通过设置迁移整个资料库时保留原库；移除资料记录与删除磁盘副本是分开的操作。
- 可选的网站登录恢复只把 Moodle 会话存入本机钥匙串，不保存密码或统一认证凭据，不进入资料库备份，也不通过 iCloud 同步。

### 当前限制

- 教学网站同步采用仅新增策略，不检测教师在原地址替换同名文件的内容；首次连接前手动导入的资料不自动合并。
- 自动读取限于支持的 Moodle 文件夹、资源和作业类型；论坛通知、第三方外链等不自动推断成计划或 DDL。
- 课表导入只支持南京大学本科系统；页面改版可能需要更新解析器。
- 学校会话失效时仍需手动登录；ad hoc 构建更新可能触发钥匙串重新授权。
- 真实拖曳动画等界面验收仍有历史自动化限制，详见验收记录。

### 更多文档

- [使用指南](docs/usage.md)：完整功能、快捷键、目录与备份规则。
- [教学网站实施与验收记录](docs/web-in-progress.md)：按版本记录的实现进度、验收范围与已知限制。
- [教学网站初始设计](docs/web-in-plan.md)：早期方案与需求背景，当前行为以实现和使用指南为准。
- [历史验收记录](docs/validation-history.md)：从旧 README 归档的测试与界面验证记录。
- [本科课表解析器说明](Resources/Timetable/README.md)：解析器来源、修改说明及授权。
