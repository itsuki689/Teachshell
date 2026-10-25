# 教学网站批量更新审核

实现依据是原 `TeachingWebsiteController.check/applySelected`、`TeachingUpdateProposal`、`TeachingUpdateReviewView` 与 `TeachingWebClient.load/read/fetch` 的实际行为。Swift 原代码未修改。

## 已实现

`desktop/electron/services/website/batch-sync.ts` 检查选定连接或全部未归档连接，逐门读取课程首页、按选项遍历资料、文件夹和作业。已忽略或本地删除的作业不重建；默认跳过历史作业；本地截止冲突保留显式二选一。

检查只读取页面和本地快照，不下载附件正文、不写计划或连接映射。资源模块先 HEAD 解析跳转，直链只记录名称与受限 URL。默认把已有文件列为“待下载核验”，不声称已知内容更新，也不默认勾选；新文件默认勾选，缺失修复默认不勾选。`includeExisting: false` 可跳过已有项，但仍计入未核验数量。

条目 ID 由连接 UUID、活动类型/ID 和文件 key 组成，同来源重复检查保持一致。清单有独立 UUID、资料库 revision 和 15 分钟期限。最多 100 门连接、1000 个活动、5000 个审核条目，页面并发数为 1。

确认只下载选中条目，附件先于计划。下载前核对当前课程活动、账号、课程和完整页面；下载后再次读取课程和活动；Repository 队列内复核库身份、连接选项与资料库 revision。服务自己的成功事务推进审核 revision；外部修改拒绝旧确认。

正文摘要比较和版本事务由 `website/material-sync.ts` 负责。发现本地修改时保留当前文件，审核行变为 `local-modified`；只有独立 `adoptLocalFileIDs` 批准后才采用网站版本，并保留本地旧版。缺失项只在明确勾选后补下载。每行清理下载临时目录；成功行移除，失败行带错误保留供重试。

作业合并继续保护人工标题、笔记和执行安排；截止选择与合并在同一事务完成。应用结果写入连接最近同步消息，选中行全部成功才更新最近同步时间。检查错误留在审核消息中，不冒充成功。

同活动本轮选中的附件失败、待补回或需要批准本地修改时，计划保留为等待附件，不提前完成。重试成功后再关联附件并提交计划，成功文件不重复下载、计划不重复创建。未选附件不阻塞本轮计划。

资料版本列表同时返回串行快照 revision 和仅在主进程保存的审核令牌；恢复必须携带两者。令牌绑定原 Repository 实例、当前版本和可选历史版本，切库清空，15 分钟过期。即使复制资料库的 JSON revision 完全相同，旧恢复确认也不能写入副本。

## Chromium 与传输边界

`WebsiteBrowser.readTeaching(url, {accountID, courseID}, signal)` 使用隐藏、sandbox、无 preload/Node 权限的 Chromium 窗口，复用当前库登录分区。每次读取关闭隐藏窗口，保留用户登录窗口。读取串行、35 秒超时；取消终止请求并销毁读取窗口。

隐藏窗口禁止 `/pluginfile.php/` 的 GET；资源直链通过 HEAD 发现。确认后的下载沿用官方 HTTPS 域、逐跳校验、大小、MIME、文件头和超时保护。页面 URL、标题、内容一次采样并复核导航。切库调用 `clear()` 取消网络和废弃审核；主进程也复核异步返回的库身份。

Electron 45 实测 `session.fetch({redirect:'manual'})` 遇到 302 抛出 `Redirect was cancelled`，不能提供跳转响应。现使用官方 `net.request` 的 `redirect` 事件返回未跟随的响应，调用者验证后才发下一次请求，并启用 `useSessionCookies`。普通正文通过 Readable Web Stream 流式传递；取消终止原请求。[Electron ClientRequest 文档](https://www.electronjs.org/docs/latest/api/client-request)、[官方问题记录](https://github.com/electron/electron/issues/43715)。

## 接入合同

构造：`new TeachingBatchService({ repository: () => repository, transport: () => website, cacheRoot })`。

- `check({ connectionIDs?, includeExisting? })` 返回 `BatchReview`：`id/revision/createdAt/expiresAt/connectionIDs/rows/messages/skippedFiles/unverifiedFiles/interrupted`。
- `apply({ reviewID, selectedIDs, deadlineChoices?, adoptLocalFileIDs? })` 返回 `{ review, snapshot, results, downloaded, interrupted }`。`deadlineChoices` 以行 ID 为键，false 保留本地、true 采用网站；有冲突但未选择会拒绝。
- `cancel()` 取消当前工作。`clear()` 取消并废弃清单。

精确类型以 `batch-sync.ts` 导出为准。Renderer 仅传 ID 和明确选择，不传任意下载地址、页面或本地路径。行 ID 包含最长 4000 字符 file key，IPC 上限应为 8192，不可当作 UUID。

## 验证与边界

`node --experimental-strip-types --test desktop/tests/teaching-batch.test.ts`：14/14 通过；`vue-tsc --noEmit` 通过。覆盖只读检查、稳定 ID、选择下载、附件先计划、局部失败重试、账号/页面变化、下载期间本地编辑、切库取消、显式缺失修复、删除忽略、本地正文二次批准、截止原子选择、多课程局部失败、只使用 HEAD 的直链发现，以及附件失败后重试的计划关联。`website-update-ipc.test.ts` 额外验证版本列表 revision 一致及复制库不能接受旧恢复令牌。

`node tests/website-browser.e2e.mjs`（desktop 目录）真实运行 Electron/Chromium，官方 HTTPS 地址由临时 session 拦截：验证真实课程解析、隐藏窗口隔离、附件 GET 阻断、真实 HEAD 重定向不下载正文、显式流式下载和外站跳转拒绝。全部通过；不使用真实校园账号，也不改用户 session。

后台定时更新、旧 WebKit/Keychain 登录迁移、Swift 的 7 天可选登录记忆策略不在本模块内。已有正文只有选中下载核验后才能判断变化。真实校园登录仍需独立验收。
