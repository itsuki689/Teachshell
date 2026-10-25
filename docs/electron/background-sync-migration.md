# 教学网站后台巡检

本模块只生成教学网站审核清单，不下载附件正文，不调用 `apply`，不修改课程、资料、计划或同步映射。前台确认继续使用原 `TeachingBatchService`，保留 revision、账号、课程、页面、缺失修复、本地修改二次批准及截止冲突检查。

## 原 Swift 行为核对

实际阅读 `AppStore.swift`、`TeachingWebsiteController.swift`、`TeachingWebsiteSheet.swift`、`TeachingLoginSession.swift`、`TeachingUpdateFlowTests.swift` 和 `ToolbarTeachingUpdateTests.swift`：

- `AppStore.teachingWebsiteSession()` 按资料库复用控制器，切库关闭旧会话；工具栏更新按钮仅打开全局更新界面，并检查 busy、编辑器、sheet 和资料库身份。
- `TeachingWebsiteSheet` 的“检查全部课程”和连接行的“检查更新”按钮调用 `check`。`onAppear` 只恢复已有审核，没有首次打开自动检查。
- `TeachingWebsiteController.check` 只检查未归档连接，串行读页面，保持只读；发现账号不符或登录过期时停止对应流程并交给用户。
- `applySelected` 需要显式选择，审核期限为 15 分钟。缺失文件不默认选择，deadline 冲突需要确认，人工编辑及本地删除保持受保护。
- 原代码没有教学网站后台定时器、默认巡检间隔或启动自动巡检。本模块的调度是 Electron 新增能力，不能表述为复现原 Swift 的定时策略。Swift 的 200ms 延时仅用于登录 cookie 保存去抖。

## 新增调度策略

默认关闭，间隔默认 30 分钟，可设 5–1440 的整数。按资料库路径摘要单独持久化到应用设置目录的 `background-sync-<SHA256>.json`；只包含版本、开关和间隔。原子写入并备份，不保存账号凭据或审核正文；损坏、过大或符号链接配置会阻止自动运行，保留原文件。

开启或重新载入已开启的资料库后，首查至少延迟 30 秒。网络离线、前台忙碌、没有适用连接、未确认登录时暂停，60 秒重新评估；网络恢复、登录变化或应用唤醒可立即调用状态通知。只检查当前官方页面已确认账号的未归档连接，最多 100 门；页面及审核数量沿用批量服务上限。

登录记忆服务仅在有效 cookie 成功恢复后提供 `canProbe`。将其映射为 `allowSessionProbe` 后，未知身份可进行一次只读账号探测：先使用首个活跃连接的绑定账号组，实际官方页面解析成功后才发布审核。错误账号、过期 cookie 或仍然未知身份不能产生可用审核。后台不会打开登录窗口或向用户索要凭据。自身页面加载的 `checking/renewing` 过程不会错误取消检查。

同一实例最多一个检查。前台接管先取消并等待自己的后台检查结束，随后才执行手动操作，避免旧取消误杀前台请求。停止、关开关、账号改变及资料库变化都会使旧结果失效；切库前必须等待 `stop()`。

未处理审核在 15 分钟有效期内阻止下一次巡检；到期先清空旧清单，再按正常间隔重新检查。新文件、缺失修复、DDL 冲突和“已有正文尚未核验”均如实交给前台，不声称未下载的正文已更新。部分失败保留成功清单和错误消息。完全失败按 `间隔 × 2^(连续失败数−1)` 退避，通常最多 6 小时；用户设置长于 6 小时时不缩短其间隔。成功重置退避。睡眠期间错过的周期不会补发一串请求。

## 主进程接入

`BackgroundTeachingSyncService` 及 DTO 位于 `desktop/electron/services/website/background-sync.ts`：

```ts
new BackgroundTeachingSyncService({
  settingsRoot,
  repository: () => repository,
  batch, // 与手动检查共用同一个 TeachingBatchService
  readiness: () => ({
    online,
    idle,
    loginState: browser.loginStatus().loginState,
    accountID: browser.loginStatus().accountID,
    allowSessionProbe: browser.loginStatus().canProbe,
  }),
  onChange: (status) => sendToTrustedRenderer(status),
});
```

- `start()` 按当前资料库加载偏好；`getStatus()` 返回独立副本。
- `updatePreferences({ enabled?, intervalMinutes? })` 校验并原子保存；并发部分修改串行合并。
- `notifyReadinessChanged()` 处理登录、联网、忙碌、唤醒变化；`idle` 不应把该服务自己的后台检查算作前台忙碌。
- 手动检查或应用前 `await pauseForForeground()`；完成后 `resumeAfterForeground(remainingReview)`。若已有未处理清单，要传回该清单。
- `setReview(remainingReview)` 用于更新应用后的剩余行；明确关闭审核后传 `undefined`。不能在普通状态轮询时反复清空，否则会重置下次检查时间。
- 切库和退出前 `await stop()`，然后才清理批量服务和浏览器；新库再 `start()`。

状态包含 `preferences / phase / reason / failureCount / lastCheckedAt? / nextCheckAt? / review?`。有效 phase 为 `disabled / waiting / checking / review / paused / blocked / backoff / error`。`review` 是原 `BatchReview`，不能跳过原批量服务直接据此写入。状态事件去重；UI 由主进程转发，教学网页没有本地 IPC。

## 回归验证

`background-sync.test.ts` 的 16 项测试使用真实临时 Repository、可控时间和批量服务，覆盖默认与跨重启设置、隔库、登录探测、账号过期、网络/忙碌/归档阻止、前台互斥、晚到结果丢弃、到期重查、退避上限、睡眠恢复、部分错误、并发配置、损坏及符号链接保留。

最后一项移植 Swift `checkingDoesNotDownloadOrMutateAndConfirmationIsIncremental` 的真实课程/作业/附件结构，通过实际 `TeachingBatchService` 生成两条审核行：课程→作业→课程身份复核，附件 fetch 零次，`library.json` 字节完全不变，课程资料及计划记录未写入。定时调度自身不模拟 Swift 没有的后台行为。

验证结果：`cd desktop && node --experimental-strip-types --test tests/background-sync.test.ts tests/teaching-batch.test.ts`，30/30 通过；`npx vue-tsc --noEmit` 通过。原 Swift 基线 `scripts/test-macos.sh --filter 'TeachingUpdateFlowTests|ToolbarTeachingUpdateTests'` 的 17 项测试通过（其中一个含两种 deadline 选择），脚本附带 15 项课表解析测试也通过。该脚本处理 Command Line Tools 的 Swift Testing 宏插件路径，直接调用当前 `swift test` 会因默认构建器未加载 TestingMacros 而失败。

此模块不负责菜单栏、系统通知、开机自启动或应用退出后的系统服务。调度只在桌面应用进程存活时工作；真实校园认证仍需在官方页面单独验收。

主进程现已接入休眠/唤醒、窗口聚焦、联网状态变化、切库和退出。`website-update-ipc.ts` 统一前台互斥，停库等待在途操作退出；登录记忆操作也在同一受控生命周期内。网站工具提供开关、间隔和状态；状态栏显示待审数量，关闭审核不清除 pending，显式丢弃才移除。审核无论是否开启定时器均按期限失效。

真实 Electron 验收 `website-background.e2e.mjs` 已验证首轮 30.475 秒、第二轮 30.640 秒，禁用后 31.375 秒零读取（运行时间每次不同）。等待期间仅观察公开事件/HTTP 夹具，不修改时钟或注入调度器。检查时附件 GET 为零且原 JSON 字节相同，显式应用后才下载；关闭重开保持同一审核，手动接管隐藏网页不重叠，偏好跨重启/切库隔离。独立 IPC 生命周期测试验证退出等待前台结束、不发布退役结果。
