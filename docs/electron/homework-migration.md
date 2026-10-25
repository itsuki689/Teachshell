# 作业文件夹迁移与验证

实现依据为 `Sources/TeachshelfCore/Repository/LibraryRepository+Homework.swift`、`LibraryRepository+FileSystem.swift`、`LibraryRepository+Courses.swift` 以及 `HomeworkStorageTests.swift` 和 `LibraryRepositoryTests.swift` 的作业目录测试。原 Swift 文件没有修改。

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
- 旧版 `HomeworkFiles/` 目录仍按现有迁移流程保留；本模块不隐式搬动此旧目录。其自动合并/迁移仍需独立事务实现。

## 本次验证

`node --experimental-strip-types --test desktop/tests/homework.test.ts`：**9/9 通过**。

覆盖：默认/未分类目录、嵌套与隐藏文件、重复导入编号、文件和目录改名、名称冲突保留、遍历与符号链接、挂载持久化与解除、课程改名保留挂载、重叠和断开的挂载、失败临时树清理、课程改名并发、排队操作遇到切库、无硬链接卷的排他复制。全部使用临时目录，不读取或修改真实作业资料。
