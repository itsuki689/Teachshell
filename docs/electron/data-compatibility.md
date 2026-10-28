# Swift 数据兼容契约

2026-10-28 复核：以下第 1–8 节保持 Swift 基线契约。当前 Electron 延续 schema 9 与真实目录，额外使用 `.teachshelf-electron.json` 标记、`.desktop-observations.json` 身份缓存和 `.desktop-chat.json` 历史；未知字段保留。macOS 监听替换不修改 JSON 格式或身份算法；事件只触发全树核对，未索引新文件不自动入库。见[文件监听](filesystem-watch.md)、[当前验证](validation.md)、[文档目录](../README.md)。

分析基线：`24efb2d`，`Sources/TeachshelfCore`、`Sources/Teachshelf/AI` 及对应测试的实际实现。`example/` 未作为迁移依据。下述是原生版本的行为契约；Electron 完成度以迁移清单和测试报告为准。

## 1. 索引、版本和日期

资料库目录的主索引为 `library.json`，当前版本为 `schemaVersion: 9`。目录内还可能有真实课件、作业、备份、恢复日志和文件身份缓存，不应只复制 JSON。

| 项目 | Swift 实际行为 | 迁移要求 |
| --- | --- | --- |
| JSON 编码 | `JSONEncoder`，prettyPrinted + sortedKeys；可选值为 nil 时省略字段 | 保留未知字段和现有可选字段；不要把缺失值随意改成空字符串或空对象 |
| 日期数字 | 自 **2001-01-01T00:00:00Z** 起的浮点秒，保留亚秒 | JS `Date` 毫秒 = `(swiftSeconds + 978307200) * 1000`；写回保持 Swift 单位 |
| 早期日期 | 自定义 decoder 也接受带/不带小数秒的 ISO8601 文本 | 数字不能按 Unix 秒或毫秒解释 |
| 版本 1–5 | 解码先归一化为 6，物理整理成功后才写 9 | 不可仅改版本号便声称完成目录迁移 |
| 版本 6–9 | 当前验证器接受；版本 6 不允许非空 teachingConnections | 不支持的版本应拒绝并保留原文件 |
| UUID | Foundation 编码输出大写的标准 UUID 字符串 | 比较应统一规范；不要在保留物理目录时盲目把路径内 UUID 改小写 |
| 扩展字段 | Swift Codable 忽略未声明键 | Electron 应保留未实现模块字段；否则编辑课程也可能丢掉课表/教学绑定 |
| 错误恢复 | 主索引缺失且 `.bak` 存在时拒绝新建空库 | 不可自动覆盖损坏索引或静默回退到空库 |

来源：`Models.swift`、`LibraryRepository.swift`、`Repository/LibraryRepository+StorageMigration.swift`。

### 顶层字段

必备历史字段：`schemaVersion`、`courses`、`materials`、`tasks`、`customCategories`、`accentColor`、`appearance`。

解码兼容默认值：`materialFolders: []`、`teachingConnections: []`、`timetableTerms: []`、`showCourseBorders: true`、`appearanceTransition` 和 `toolbarSettings` 使用对应 Swift 默认值。外观为 `system | light | dark`。默认工具栏顺序为 `update, settings, import, create`，最多六项、不可重复。

## 2. 主要数据模型

| 模型 | 持久化字段 |
| --- | --- |
| Course | `id, name, semester, teacher, colorHex, isArchived`；可选 `homeworkFolder, materialSort, storageDirectory, materialRootName, isMissing` |
| MaterialRecord | `id, title, originalName, sourcePath, storedPath, isManaged, category, tags, notes, isFavorite, size, addedAt`；可选 `courseID, lastOpenedAt, folderID, customOrder, storageName, storageDirectory, isMissing` |
| MaterialFolder | `id, name, createdAt`；可选 `courseID, parentID, colorHex, storageDirectory, isMissing` |
| StudyTask | `id, title, content, kind, materialIDs, startsAt, isAllDay, showOnCalendar`；以及执行/截止时间、完成/归档/取消状态、关联课程快照、重复规则和例外（见下） |
| TimetableTerm | `id, name, weekCount, sectionTimes, meetings, cancellations, reschedules`；可选 `weekOneMonday, endDate` |
| TeachingConnection | `id, courseID, remoteCourseID, remoteTitle, accountID, timeZone, includeMaterials, includeAssignments, includeExperiments, includeHistory, messages, items, folders`；可选 `lastSyncAt` |

`tags` 是一个字符串，不是数组。`size` 是 Int64 字节数。`customOrder` 为非负整数；资料排序为 `name | time | custom`，缺失自定义序号排在已有序号之后，最终按添加时间倒序及 UUID 排序。名称排序有中文章节序号预处理，不能直接当普通字符串字典排序。

### 计划

`origin` 为 `activity | fixed`；`hasExecutionTime` 决定执行事件是否存在，截止事件由 `deadline` 派生；二者各有独立全天标记 `isAllDay`、`deadlineIsAllDay`。可选状态时间为 `completedAt`、`archivedAt`、`cancelledAt`，`courseNameSnapshot` 保留历史名称。`endsAt`、`location`、`showInMonth`、`completionRequired`、`colorHex` 需保留。

重复规则字段是 `{frequency: daily|weekly|monthly, interval: 1...366, until?}`。例外以 **originalDate 原发生时刻** 定位，不以移动后的时刻定位。`PlanException` 包含 `details`、独立时间覆盖、完成/取消信息；`details.overriddenFields` 表示局部修改，不能把未修改字段当作整个计划替换。`completedOverride: false` 显式恢复为未完成，不能与字段缺失混淆。`until` 为上海时区含末日在内的自然日。月重复会把不存在的月末日期压到当月最后一天。

旧计划缺字段时：`origin=activity`、`hasExecutionTime=(deadline==nil)`、`location=""`、`showInMonth=false`、`completionRequired=true`、`deadlineIsAllDay=isAllDay`、`exceptions=[]`。这一点决定早期“只有截止时间”的任务不能被重复显示成执行事件。

来源：`Models.swift`、`PlanModels.swift`、`Repository/LibraryRepository+Plans.swift`。

### 课表

`TimetableMeeting` 持久化 `id, courseID?, courseCode, title, teacher, classroom, weeks, weekday?, startSection, sectionCount, note, showInMonth?, startMinuteOverride?, endMinuteOverride?, colorHex?`。学期 `sectionTimes` 为 `{section,startMinute,endMinute}` 数组。星期一为 1，星期日为 7；学期/计划计算固定使用 `Asia/Shanghai`，不能随操作系统时区漂移。

教学网站本科课表导入 JSON 的键名与内部模型不同：`class_number, week_time, start_time, time_count, test_time, test_location`。其中 `time_count` 是结束节次的偏移量，**不是节数**；`start_time=3,time_count=1` 表示第 3–4 节，共两节。`cancellations` 和 `reschedules` 保存停课/调课与原时间快照，重导课表不能任意删除孤立快照。

来源：`TimetableModels.swift`、`Resources/Timetable/Sample-undergraduate.json`、`TimetableTests.swift`、`TimetableCancellationTests.swift`、`TimetableRescheduleTests.swift`。

## 3. 物理存储布局和安全边界

默认布局：

```text
<library>/
  library.json
  library.json.bak
  files/
    <规范化课程名称> [<COURSE-UUID>]/
      资料/
        <文件夹>/<MATERIAL-UUID>-<原文件名>
      作业/
    未分类/资料/
  .teachshelf.lock
  .file-observations.json
  .physical-storage.jsonl      # 仅事务进行中存在
  .material-relocation.json   # 早期迁移恢复日志
```

- 课程路径 `storageDirectory`、资料根名称 `materialRootName`、文件夹 `storageDirectory`、文件 `storageDirectory/storageName` 均有实际用途：保留 Finder 中的移动/改名结果。不能在每次保存时仅按课程标题重新计算全部路径。
- `isManaged=true` 的 `storedPath` 必须为库内 `files/` 下相对路径；`sourcePath` 保存最初来源。`isManaged=false` 为绝对路径引用，移动课程/文件夹时只改元数据，不移动外部原件。
- 旧 macOS 绝对路径跨系统后通常不可用，应保留并显示需重新定位；不得把它猜成 Windows 本机路径或静默复制其他文件。原生自己的路径验证只接受 `/` 开头外部路径，故 Windows 新增外部引用的反向 Swift 兼容性需要单独明确。
- 名称清理：控制字符、`/\\:` 替为 `_`，NFC 规范化，去除首尾空白/点；空名用“未命名”。课程名最多 120 UTF-8 字节；文件名最多 218 字节并尽量保留扩展名；UUID 前缀使文件名不超过常见 255 字节上限。
- Windows 还需处理设备名 `CON/PRN/AUX/NUL/COM1…/LPT1…`、`<>"|?*`、结尾空格/点、驱动器与 UNC 路径；修改路径前必须核验实际文件与冲突，保留原有名字/索引映射。
- 同目录文件夹名称按照大小写和变音符折叠判重；文件夹关系不可循环、不可关联到其他课程的父目录。
- 原生所有路径操作逐级 `lstat` 拒绝符号链接。扫描只处理普通文件/目录，不追随链接。Electron 主进程也必须逐级检查，不能只用字符串前缀或只检查最终文件。
- Linux 无法读取子树时应报错并停止本次同步；原生不会把访问错误错误地当成“全部文件丢失”。

来源：`MaterialStorageLayout.swift`、`Repository/LibraryRepository+FileSystem.swift`、`Repository/LibraryRepository+Materials.swift`、`MaterialStorageTests.swift`、`PhysicalFolderTests.swift`。

## 4. 文件操作业务语义

| 操作 | 原生行为 |
| --- | --- |
| 导入 | 递归收集普通文件；同课程按 sourcePath 去重；复制模式不移动原件；按文件累计错误；索引最终保存失败则回滚本次复制 |
| 移除资料记录 | 保留真实托管文件；同步不自动重新导入未索引文件，因此不会复活被移除记录 |
| 移入废纸篓 | 只移动托管副本；外部引用原件不动；失败恢复关联索引 |
| 课程重命名 | 物理移动整个目录（包括未索引内容和作业）；更新活动计划课程名快照，保留已归档快照 |
| 删除课程 | 资料变为未分类，不删除课件；清理课程绑定与文件夹；计划及课表解除课程引用而保留记录 |
| 文件夹改名 | 移动整个物理子树，保留空目录、未索引文件及 inode；不触碰同名作业工作区 |
| 解散文件夹 | 所有后代资料回到该文件夹的父层；不删除课件 |
| 重新定位 | 保持 id、标题、备注、收藏、添加/打开时间；托管缺失文件复制回库，外部引用只改路径 |
| 归档计划 | 存在开始/完成时序约束；已归档计划只读，需先恢复才能编辑 |

“移除记录”与“删除真实文件”必须在 UI 和 IPC 明确区分。类别内建值为“课件、教材、笔记、参考资料、其他”，自定义类别修剪空白、1–40 字符、禁止控制字符和保留名称“作业/全部类别/全部用途”，大小写不敏感复用已有拼写。

## 5. 同步身份与重命名

`.file-observations.json` 的键为 `course:<UUID>`、`root:<UUID>`、`folder:<UUID>`、`file:<UUID>`，值为 `{path, identity, size?}`。`identity` 在 macOS 为卷 UUID（降级为设备号）+ inode + 创建时间秒/纳秒。它是机器相关观察缓存，不能当可移植业务 ID，也不应作为跨平台固定格式覆盖。

原生同步规则：

1. 优先用身份定位；硬链接多个候选优先当前/上次路径，否则必须唯一。
2. 没有身份匹配时，未标记缺失的记录可采用预期路径，以兼容编辑器原子替换和复制资料库后 inode 变化。
3. 已标记缺失且有旧观察的记录，不能让新同名文件占据；缺失只设 `isMissing=true`，保留记录、关联和批注。
4. 扫描会推导已跟踪文件/文件夹所在的新增父目录；不自动导入磁盘上所有未索引文件。
5. 文件移动到别的课程后更新 `courseID/folderID`，保持 UUID、备注、收藏及计划关联，清除不再适用的 customOrder。
6. 物理改名仅当原标题等于原文件 stem 时同步改标题；用户自定义标题保留。改名后 `storageName` 保留实际磁盘名。
7. 启动与每次元数据变更前都同步，补偿监听事件遗漏；`FSEvents` 只是触发器，不是数据权威。

来源：`Repository/LibraryRepository+FileSystemSync.swift`、`FileSystemSyncTests.swift`、`LibraryFileWatcher.swift`。

## 6. 原子性、故障恢复和并发

原生每次写入在锁内修改值副本，**磁盘提交成功后才发布内存快照**。写临时索引并同步文件，先把原索引复制到临时备份并原子 rename 为 `library.json.bak`，再原子 rename 新索引。临时文件使用不覆盖创建。

物理操作采用 `.physical-storage.jsonl` 先写日志后操作。日志首条含目标索引 SHA-256 与 indexChanges；移动项保存 source/destination/device/inode。最后一行若未以换行结束则忽略，因为它不能代表已执行操作。是否已提交由 commit 标记或实际索引摘要判断；回滚逐步记录 undo 进度，第二次崩溃仍可恢复。重名绝不覆盖无关内容，大小写改名通过临时中转路径。只清理空目录，不递归删未索引内容。

旧 `.material-relocation.json` 按已提交索引中引用路径恢复，只有两份内容相同且另一份仍在时才清理重复副本。Electron 若未完整兼容此恢复逻辑，发现这两种 Swift 未完成日志应停止写入并要求先由原生恢复，不能忽略或删除日志。

原生单写者锁是 `flock(.teachshelf.lock, LOCK_EX|LOCK_NB)`。Node 的目录锁与它并不天然互斥。尚未通过跨进程互斥验证时，迁移入口应复制原库到独立目的地后编辑，拒绝覆盖非空目的目录，并保证复制期间源索引稳定；不能让两应用同时写同一库。备份应包含托管文件及空目录，外部引用保留引用；还原先保留当前文件到 History，再进行事务切换。

## 7. 教学网站和聊天数据

教学网站绑定 `TeachingConnection.items` 保存远端 item id、localID、title/content/digest/folderID、远端/已应用/待处理截止时间、ignored/submitted 状态。同步必须保留人工截止时间修改和忽略选择，不能无提示覆盖。URL 只允许 HTTPS 精确主机、默认 443、无内嵌账号；导航可到 `selearning.nju.edu.cn` 与 `authserver.nju.edu.cn`，下载还必须限定 `pluginfile.php` 的特定内容路径。下载验证普通文件、非空、≤512 MiB，并拒绝登录 HTML；PDF/Office/ZIP 检查魔数。

**本基线没有持久化聊天历史。** `AIChatController.items/history` 仅在内存，reset 清空，没有聊天 JSON 文件；因此不能声称从原版导入历史会话。原配置位于 UserDefaults 的 `aiAssistantConfiguration` 数据项（endpoint/model/reasoningDisabled），密钥位于 Keychain，service 为 `com.teachshelf.mac.ai-api-key`、account 为规范化后的 completion URL。密钥不属于资料库或备份。Electron 自己的会话落盘格式和安全凭据应单独存储，不能写进 `library.json`。原版客户端当前请求为非流式 complete；流式输出是迁移中的新增能力，需要自己的 SSE 分块/取消/工具调用测试。

## 8. 可重现的 Swift 夹具

运行：

```sh
python3 desktop/scripts/generate-swift-fixtures.py
```

脚本仅在临时目录编译/运行，不打开用户资料库，也不修改 `Sources/`。其 Swift 入口直接与生产核心源文件共同编译，使用生产 `LibraryRepository.encoder/decode`；不另造一份“看似兼容”的模型。

- `desktop/tests/fixtures/swift-schema9.json`：课程、托管课件、外部引用、嵌套/空文件夹、重复计划与例外、课表停课/调课、教学网站绑定、外观设置。
- `swift-schema6.json`：旧物理路径与逻辑文件夹，待升级到 schema 9。
- `swift-legacy-iso.json`：schema 1、ISO 日期以及缺失新增字段，验证生产 decoder 的兼容默认值。
- `swift-compatibility-contract.json`：文件原始内容、SHA-256、字节长度、日期换算、每个夹具被生产 Repository 打开和迁移后的路径。

这些内容是**生产 Swift 模型真实编码的合成测试样例**，不是用户私有数据导出。每个夹具均被写入独立临时库，并由生产 Repository 打开/迁移，断言 ID、备注、外部引用路径和托管文件字节保留。Electron 需再对同一夹具执行读取和写回验证；Swift 侧通过不代表 Electron 已兼容。

参考原生测试：`LibraryRepositoryTests`、`MaterialStorageTests`、`PhysicalFolderTests`、`FileSystemSyncTests`、`HomeworkStorageTests`、`PlanTests`、`TimetableTests`、`TeachingWebsiteTests`。测试应在独立临时目录模拟损坏索引、占用目标、符号链接、只读目录、索引备份写失败、事务中断、重命名和外部引用缺失，不接触用户真实资料库。
