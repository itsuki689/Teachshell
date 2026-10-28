# 作业文件夹迁移与验证

2026-10-28 复核：默认作业目录随课程改名；外部挂载不属于 `files/` 的监听范围，作业页读取/刷新仍通过 `withWorkspace()` 检查真实路径。未知作业文件不会变成课件索引。监听机制见[说明](filesystem-watch.md)，下文测试数为模块历史验收，当前结果见[验证](validation.md)。

实现依据为 `Sources/TeachshelfCore/Repository/LibraryRepository+Homework.swift`、`LibraryRepository+StorageMigration.swift`、`LibraryRepository+PhysicalStorage.swift`、`LibraryRepository+FileSystem.swift`、`LibraryRepository+Courses.swift` 以及 `HomeworkStorageTests.swift` 和 `LibraryRepositoryTests.swift` 的作业目录测试。原 Swift 文件没有修改。

## 已实现

`desktop/electron/services/resource/homework.ts` 导出 `HomeworkService`。构造参数为 `() => Repository`，所有访问在 `Repository.withWorkspace()` 队列内先同步文件，和课程改名、挂载修改、切库关闭使用同一写入队列。

| 方法 | 行为 |
| --- | --- |
| `list(courseID?, relative = '')` | 返回目录、挂载状态和条目；文件夹优先，自然排序，隐藏文件与符号链接不显示 |
| `createFolder(courseID, relative, name)` | 建立真实目录，同名按 `名称 2`、`名称 3` 编号 |
| `rename(courseID, relativePath, newName)` | 改名真实文件或目录，已有目标拒绝覆盖；保留文件正文 |
| `importFiles(courseID, relative, sources)` | 复制文件和目录树，保留源文件、隐藏内容和空目录；同名自动编号；逐项报告成功和失败 |
| `resolve(courseID, relativePath)` | 重新检查路径并返回主进程使用的绝对路径 |
| `mountPath(courseID, candidate)` | 仅校验候选外部目录，不写索引 |
| `Repository.setHomeworkFolder(courseID, candidate?)` | 在索引事务内再次验证并保存；省略 candidate 时恢复默认位置 |

默认位置沿用 Swift：`courseDirectory/作业` 和 `files/未分类/作业`，不创建课件记录。已有外部挂载保留原 `homeworkFolder` 值；课程其他字段的修改不会覆盖挂载。挂载目录不存在时报告错误，不重新建立目录或清空挂载字段。外部卷不支持硬链接时，文件导入使用排他复制。

## 文件保护边界

- 拒绝绝对子路径、`..`、反斜杠、驱动器前缀、NUL、Windows 保留名称，以及任意层符号链接。
- 挂载必须在资料库之外，不能包含资料库，也不能与其他课程挂载相等或互相包含。已断开的挂载继续保留路径占用。
- 拒绝目录导入自身或后代；导入树中的符号链接、特殊文件、大小写或 Unicode 归一化冲突会导致该项失败。
- 文件复制在隐藏临时目录内完成，检查源文件身份、大小和修改时间，失败清理本次临时副本，保留源文件。
- 不提供删除或移入废纸篓操作。只有大小写/Unicode 形式不同的改名明确拒绝，用户可先改为中间名称再改为目标名称。
- 旧版目录自动迁移在资料库副本内执行，具体行为见下节；原资料库和副本内的旧树均保留。

## 旧版目录自动迁移

`storage/legacy-homework.ts` 按原 Swift 的真实迁移逻辑扫描 `HomeworkFiles/<课程 UUID>`、`HomeworkFiles/Unassigned` 和旧课程名称对应的 `files/<旧名> [UUID]/作业`。目标分别为当前课程目录的 `作业` 和 `files/未分类/作业`。有外部挂载的课程只迁移内部备用目录，挂载路径和外部文件不变。

目录同名时合并内容；普通文件内容相同时按 SHA-256 去重；不同内容保留两份，新副本使用 `answer 2.txt` 等编号。隐藏文件、空目录、二进制正文和 POSIX 文件执行权限保留。大小写和 Unicode 归一化后的名称参与冲突判定，避免迁移结果到 Windows 后互相覆盖。Windows 不支持的名称、符号链接、特殊文件或已被文件占用的作业根目录会阻止迁移并报告原因；索引和原件不变。

所有 `copy`、`mkdir` 与 schema 升级进入同一个 `Repository` 事务。文件先暂存和同步磁盘，校验规划时的 SHA-256；源文件在规划后变化时中止。事务在日志、文件完成、索引完成三个断点均可恢复。失败回滚仅移除本次事务拥有且内容未变的副本，允许保留空目录。成功后在 `library.json` 增加 `desktopLegacyHomeworkMigration: { version: 1, sourceRoots: [...] }`，防止下次启动将旧件重新覆盖或重复导入；Swift 会忽略此扩展字段。原目录继续保留，不自动清理。

该流程也修复已经升级为 schema 9、但尚未迁移旧作业的 Electron 副本。迁移不创建课件或资料文件夹索引记录。事务副本需要支持硬链接的本地文件系统，与课件事务相同；外部作业挂载的普通导入仍支持排他复制回退。

## 本次验证

`node --experimental-strip-types --test desktop/tests/homework.test.ts`：**9/9 通过**。

覆盖：默认/未分类目录、嵌套与隐藏文件、重复导入编号、文件和目录改名、名称冲突保留、遍历与符号链接、挂载持久化与解除、课程改名保留挂载、重叠和断开的挂载、失败临时树清理、课程改名并发、排队操作遇到切库、无硬链接卷的排他复制。全部使用临时目录，不读取或修改真实作业资料。

旧版迁移夹具由 `python3 desktop/scripts/generate-homework-fixture.py` 直接编译未修改的 Swift 核心生成。`swift-homework-migration.json` 包含真实 Codable schema-8 索引、输入目录树和原生迁移的 14 个目标条目；Node 测试逐项比较目标路径、正文和 SHA-256。

`node --experimental-strip-types --test desktop/tests/legacy-homework.test.ts`：**12/12 通过**。覆盖原生夹具等价性、冲突与原件保留、schema-9 补迁与幂等、外部挂载备用目录、备份写失败回滚、符号链接与占用拒绝、大小写冲突、不可移植名称、源文件变化、POSIX 执行权限，以及三个事务恢复断点。

原生基线：`swift test --skip-build --disable-sandbox --scratch-path /private/tmp/teachshelf-electron-swift-baseline --cache-path /private/tmp/teachshelf-electron-swift-cache --config-path /private/tmp/teachshelf-electron-swift-config --security-path /private/tmp/teachshelf-electron-swift-security --filter HomeworkStorageTests`，**9 个测试通过**（含一个两参数用例）。本次沿用此前编译的未修改 Swift 测试产物；全新环境应先执行不带 `--skip-build` 的构建测试。
