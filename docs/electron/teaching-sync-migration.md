# 教学网站连接与作业截止同步

2026-10-28 复核：本地文件监听可能推进资料库 revision，网站预览/确认仍需复核版本，不能因界面已自动刷新而沿用旧审核。当前测试入口和平台状态见[验证报告](validation.md)。

依据原 Swift `TeachingWebsite.swift`、`LibraryRepository+TeachingWebsite.swift` 与 `TeachingWebsiteTests.swift` 的实际实现迁移。原 Swift 代码未修改。

## 已迁移的核心

- 连接保留原 `TeachingConnection` JSON 字段，账号与远端课程组成来源身份。同一来源重复连接返回既有连接，保留选项、历史与映射；不能静默改绑本地课程或账号。
- 作业生成固定、默认无执行时间的计划。合并时只更新仍等于上次远端值的标题和正文；保留用户修改的名称、笔记、执行安排、完成状态、颜色和其他计划字段。
- 解析显式时区和指定时区的日期，区分全天与午夜。模糊或非法日期保留原截止并提示核对；明确空值可清除未被本地修改的截止。
- 本地截止改动或用户增加重复规则后，远端新截止保存为 `pendingDeadline`，需明确选择采用网站或保留本地。保留本地后相同远端值不会反复提示；再次变化才产生新冲突。
- 用户删除、转移或忽略的映射不自动重建；显式恢复忽略项后才允许重新导入。归档计划不更新，新历史作业默认跳过；用户开启历史后导入的已提交作业标记完成。
- 已有附件映射仅关联同课程且未忽略的资料，并保留手工关联。作业合并本身不下载附件正文；新增批量文件模块另行负责经确认的下载与版本事务。
- 断开连接保留已导入计划和资料。设置修改保留来源映射、历史与上次同步时间。

单作业界面已接入“读取课程首页 → 绑定本地课程 → 打开并读取具体作业 → 预览差异 → 确认应用”，并可管理连接开关、断开连接和处理待确认截止。该入口只更新当前作业；多课程遍历、下载核验和失败重试由新增 [批量审核模块](teaching-batch-migration.md) 提供。

教学网站没有 preload 或本地 IPC 权限。主进程将页面 URL、标题和解析数据在一次 isolated-world 执行中采集，检查开始/采集/结束 URL 一致；发生导航后必须重新读取。页面账号、课程或内容变化、切换资料库、预览超过 15 分钟、本地 revision 变化都会拒绝旧确认。前端按钮禁用只是提示，主进程和事务内检查负责实际拒绝。

## 主进程接入 API

`AssignmentSyncService` 位于 `desktop/electron/services/website/assignment-sync.ts`，构造为 `new AssignmentSyncService(() => repository)`。

| 方法                                                               | 输入与结果                                                                                                                                                     |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preview(connectionID, activity, page, sourceURL)`                 | 主进程实际解析的作业页；返回 proposalID、before/proposed、待处理截止、message、reviewable、revision 和 15 分钟期限。预览不写计划或映射，也不下载。             |
| `apply(proposalID, currentPage, currentURL)`                       | 必须传主进程重新读取的当前页；比较活动 ID、官方 URL、完整页面数据、库身份、期限及库 revision，再在 Repository 事务内复核并写入。返回 snapshot/change/message。 |
| `resolveDeadline(connectionID, key, useWebsite, expectedRevision)` | 用当前 snapshot.revision 明确处理冲突；本地在对话期间发生改动则拒绝旧选择。                                                                                    |
| `clear()`                                                          | 切库或取消整个审核流程时清除内存预览。                                                                                                                         |

Repository 提供 `connectTeachingCourse`、`saveTeachingConnection`、`updateTeachingOptions`、`disconnectTeachingWebsite`、`restoreIgnoredTeachingItems`、`finishTeachingUpdate`、`previewTeachingAssignment`、`syncTeachingAssignment` 与 `resolveTeachingDeadline`。所有写入进入现有串行事务和原子 JSON 更新。UI 应通过 service 的预览/确认流程应用网页数据；`syncTeachingAssignment` 是队列内业务方法，不能直接暴露给网页或任意 renderer 参数。`updateTeachingOptions` 只在事务中合并本次提交的开关，并发修改不同开关不会相互覆盖。

连接更新输入保留 id、courseID、remoteCourseID、accountID，并提供要更新的标题、时区或 include 开关。内部忽略调用方试图替换的 items/folders/messages/lastSyncAt。`connectTeachingCourse` 返回 `{snapshot, connection, created}`；重复连接不会重写索引。

## 验证

`node --experimental-strip-types --test desktop/tests/teaching-sync.test.ts` 覆盖日期解析、绑定身份、人工编辑保护、截止冲突两种选择、不反复提示、已移除项保护、历史和归档、账号变化、失败回滚、只读预览、当前页重读、超时、切库、revision 竞争、既有附件关联与确认失败后的重试。

最后一次定向回归：`teaching-sync.test.ts` 14 项、`website-observation.test.ts` 6 项、`website.test.ts` 3 项，共 **23/23** 通过；`vue-tsc --noEmit` 通过。网页观察测试在 Node VM 中执行真实包装逻辑，不将它等同于真实校园账号登录验收。

真实 Swift 差异对照命令（从 desktop 目录执行）：

```sh
TEACHSHELF_TEACHING_ROUNDTRIP=/private/tmp/teaching.json node --experimental-strip-types --test --test-name-pattern='exports generated teaching' tests/teaching-sync.test.ts
python3 scripts/verify-swift-teaching.py /private/tmp/teaching.json
```

已执行 **12 组**：TypeScript 产生的状态由未修改的生产 Swift Core 解码、验证、再编码无损；同一初始状态实际运行 Swift `syncTeachingAssignment`，与 TypeScript 合并结果一致。对照包括新作业、自动截止更新、本地编辑、截止冲突、模糊/删除日期、全天、历史跳过、提交完成、删除忽略、归档保留和重复计划冲突。只使用生成的临时资料库。

## 仍需独立验收

旧 WebKit/Keychain 登录 cookie 不自动迁移到 Chromium；可选七天登录记忆已由[登录模块](login-session-migration.md)实现，默认关闭的[后台巡检](background-sync-migration.md)只生成审核。真实校园账号仍需独立在线验收。已移除记录保持忽略，不会批量自动重建。增量正文核验、版本保存与缺失修复现由独立批量文件模块实现；作业/DDL 合并与文件事务边界仍分开，不能静默覆盖用户编辑的副本。
