# 文件监听：macOS CI 超时诊断与修复

日期：2026-10-28。修复前提交 `92c80ae`，应用版本 0.3.11；原生 Swift、课屿应用和用户资料不参与修改。参见[文档目录](../README.md)、[当前验证](validation.md)。

## 原始失败与证据

[通用 CI 40608971773](https://github.com/itsuki689/Teachshell/actions/runs/40608971773) 中 macOS job `122555507605` 仅 `watcher.test.ts` 的连续改名用例失败：等待第二个目录路径事件超过 5 秒；同一提交的 Windows/Linux job 成功，发布工作流的 macOS 也通过。原 CI 没有文件事件明细，因此不能证明当时精确触发了哪种系统时序。

本机普通重跑 80 次及四进程各 80 次均通过，延长超时没有诊断依据。进一步阅读锁定的 Chokidar 4.0.3 实现并注入慢扫描，复现了同样的事件丢失，且不只是等待稍慢：

1. `_handleRead` 对父目录建立 1000ms `readdir` 节流，并开始异步枚举。
2. `_handleDir` 在子目录扫描和 `fs.watch` 注册前发出 `addDir`；原测试把收到它误当成子树已经监听完成。
3. 父扫描未结束时再次改名，原始系统 `rename` 已到达，但被节流累计。
4. 将该次扫描的 `end` 保持 1200ms，节流定时器先清掉计数。扫描结束不再重新枚举，Chokidar 的父目录记录为空，真实最终目录仍存在。
5. 旧实现可能由前一次通知扫描出课程新名称，但后续已登记资料在该目录内移动时不再同步。

故障注入仅在测试中接触旧实现的 `_readdirp`，生产代码不修改依赖私有方法。新回归替换为原监听实现时在后续资料移动处失败；新实现同一业务序列通过。另有上游报告讨论扫描和逐目录注册的相邻竞态：[Chokidar #1471](https://github.com/paulmillr/chokidar/issues/1471)。此报告是补充背景，本次结论依据本地源代码及故障注入。

## 当前平台策略

| 平台 | 监听 | 约定 |
| --- | --- | --- |
| macOS ARM64 | Node `fs.watch(libraryRoot, {recursive:true})` | 一次注册稳定父目录，过滤到 `files/`；不依赖 Chokidar 的逐目录枚举和注册。替换 `files/` 后仍可观察变化。 |
| Windows x64 | Chokidar `usePolling:true` | 目录/文本 500ms、二进制 1000ms，避免子目录句柄妨碍资源管理器或应用改名。 |
| Linux | Chokidar 原生事件 | 保留现有后端，不在此任务宣称消除了所有平台/文件系统事件丢失可能。 |

系统事件只表示“需要核对”。主进程 500ms 合并后调用当前 Repository 的串行 `sync()`，读取真实目录、身份和内容大小来更新索引；不把事件名/路径当成移动事务。Windows/Linux 保留 350ms 写入稳定检查。macOS 缺少文件名时仍触发核对；已知索引、缓存和隐藏路径不会产生自身写入循环。监听注册后补一次核对，覆盖 Repository 打开到监听就绪间的变化。

macOS 注册错误异步报告，不能假报 ready；close 幂等且拦截迟到通知和错误。切库先关闭旧监听并清理定时器；主进程回调绑定 Repository，切库和退出阶段不写入已退役资料库。Renderer、网页没有获得文件系统新权限。

JSON schema、身份算法和文件事务保持不变。课程/已登记课件的改名与移动保留 UUID、备注、关联和原始内容；未知新文件不自动入库，隐藏文件/符号链接不参与 Repository 扫描。外部引用及作业挂载不属于 `files/` 监听范围。启动及手动刷新仍可核对本地数据；网络盘/移动卷、删除或搬走整个正在打开的资料库不属于此次验收。

## 回归与执行

在 `desktop/` 中运行：

```sh
node --experimental-strip-types --test tests/watcher.test.ts
npm test
npm run build
node tests/workspace-sync.e2e.mjs
npm run test:e2e
```

- `watcher.test.ts`：主机后端与 Windows 轮询连续改名；慢扫描故障注入；后续嵌套目录内移动及再次改名；UUID/原内容/源文件保留；无文件名与 Buffer 路径；索引/隐藏路径过滤；注册错误、close 后回调抑制；macOS 替换 `files/`。Windows 主机不重复跑相同后端，非 macOS 跳过平台专属目录替换用例。
- `workspace-sync.e2e.mjs`：真实 main/preload/Vue，外部连续课程改名后侧栏自动更新，已登记资料跨课程进入新目录并再次改名；直接等待可见资料行变化，不用手动同步，也不把跨上下文 Promise 当成已满足断言。切库后触发旧库变化并验证新库监听，原有未保存草稿/模态/迟到回复用例继续执行。
- 通用 CI 在 macOS runner 额外连续运行本专项 5 次。原始 5 秒监听等待上限未放宽，新增失败诊断包含合成事件路径与课程状态。测试只使用临时资料库，真实文件事件及 HTTP 需要允许系统服务/回环监听的环境。

2026-10-28 本机已验证：专项 5/5、全部业务 332/332、TypeScript 与生产构建通过；旧后端在新回归的故障注入场景失败，证实回归能检出原问题。构建有既有 Swift Keychain API 废弃警告，不是本次失败。完整源码窗口 22 个套件、专项工作区窗口 7/7 均通过，无相关 renderer 错误；专项在完整 UI 测试期间连续 5 轮（25 个检查）通过。截图与日志位于本机临时目录 `/private/tmp/teachshell-watch-source-qa`，不含真实用户资料。安装后的回执及该提交的 [GitHub Actions](https://github.com/itsuki689/Teachshell/actions/workflows/desktop.yml) 日志是部署和跨平台证据，不用本机结果替代。
