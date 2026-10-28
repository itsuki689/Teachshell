# 当前验证记录

0.3.12 发布将以下修复统一版本化。发布流程在 Windows x64 与 macOS ARM64 上运行完整源码回归和 9 组打包应用专项（包含新增按键响应、键盘归属、草稿选择、调课检查），校验包架构、版本、提交及 SHA-256 后才公开 Release。运行结果以该标签对应的 GitHub Actions 为准；以下本机审计记录对应 `0e35e3f`。

2026-10-28 响应排查续修：由三个 GPT-6.1-sol 子代理分别检查事件/动效、异步加载和主进程。实际复现并修复资料快捷键抢占按钮、收藏 Enter 冒泡打开文件、计划焦点外调时、丢弃草稿后首击失效、启动设置与预览读取误锁顶栏、慢作业枚举占用写队列，以及同步重复文件检查。实现约束见[界面状态说明](ui-sync-migration.md)。未改动原生课屿或真实用户资料。

反向验证：新增键盘套件在旧版有 5 项失败；新增启动设置与预览检查 3 项均失败；实际资料点击确认后未切换选中项。旧同步对单个索引文件重复 stat 4 次，26 个扫描条目访问身份 624 次；优化后单文件同步仅扫描一次，身份查找按条目数线性增长。旧作业目录枚举屏障会阻塞新读取和无关保存，修复后可在屏障未释放时完成。

本轮 macOS ARM64 业务测试 **346/346 通过，完整源码窗口套件 24/24 通过**，其中包含硬链接歧义、原位替换、挂载/目录/工作区变更和符号链接竞态。按键专项为 9 项，新增键盘归属套件 7 项，课表拖动及键盘 10 项，原生 UI 对齐 9 项。TypeScript、生产构建及修改代码格式检查通过。Browser 插件不可用，使用 Playwright Electron 的真实键盘/鼠标与临时资料库；截图、日志留在仓库外。窗口身份、非空页面、框架错误遮罩、控制台、截图与实际交互均已核对；覆盖标准 1260×800 及最小 1020×680、明暗模式。提交后安装核对结果记录在忽略的 `desktop/release/installed-verification.json`，不以旧版结果代替。

本机临时 1 字节文件样本的收藏操作：1,000 份约 212 → 135 ms，3,000 份约 640 → 320 ms；3,000 份的一次分段测量中 lstat 为 39,028 → 21,028 次。这些是观察值，测试不以固定时间判定通过，也不代表 Windows 实机性能。提交后的全新路径/身份验证仍保留；作业目录准备与挂载验证仍在串行队列内，系统 IO 等待没有被强行取消。

验证入口（`desktop/`）：`npm test`、`npm run build`、`node tests/input-response.e2e.mjs`、`node tests/keyboard-routing.e2e.mjs`、`npm run test:e2e`。安装版使用 `TEACHSHELF_EXECUTABLE=/Applications/Teachshell.app/Contents/MacOS/Teachshell` 重跑窗口检查。`0e35e3f` 本机审计结束时尚未运行 Windows/Linux 原生 CI；0.3.12 发布阶段再对版本提交运行跨平台验证，不混用历史提交结果。

前轮 `3009c34` 的按下反馈/刷新动画/只读状态修复已获准推送，[三平台 CI 40657230958](https://github.com/itsuki689/Teachshell/actions/runs/40657230958) 全部成功；Windows 333 项业务测试及 23 个源码、21 个打包窗口套件通过，6 项输入响应在两种应用中均通过。此结果只对应该提交，不代表本轮续修。原 macOS 监听根因与验证见[文件监听专项](filesystem-watch.md)。

本地 Release 由当前已提交快照构建，签名通过后正常退出旧版、备份替换、注册并打开 Teachshell。回执为忽略的 `desktop/release/installed-macos.json`；关于页显示版本、源提交和实际执行路径。日常只生成 `.app`；0.3.12 按用户授权通过标签流水线生成 DMG/ZIP/EXE，新增 Release 并保留历史版本。

CI 分别在 macOS、Windows、Linux 原生 runner 执行单元、生产构建、解包校验、源码及打包应用 E2E。最终状态应绑定本次 commit 查看，不能拿 0.3.11 发布工作流成功代替这次通用 CI。macOS 为 ARM64 ad-hoc 签名、未公证；Windows 未配置发布者签名。真实校园账号、网络盘以及用户桌面安装向导不在离线夹具验收范围。

## 历史证据

- [0.3.0](validation-0.3.0.md)、[0.3.1](validation-0.3.1.md)、[0.3.2 布局](page-layout-parity.md)、[0.3.3 外观](appearance-week-parity.md)、[0.3.4 控件](controls-parity.md)、[0.3.6 审计](detail-audit-0.3.6.md)。
- [计划工作区与后续交互](schedule-workspace.md)、[0.1.0](validation-0.1.0.md)、[0.2.0](validation-0.2.0.md)。
- [0.3.11 发布说明](../../desktop/release-notes/0.3.11.md)与[已发布版本](https://github.com/itsuki689/Teachshell/releases/tag/v0.3.11)。历史安装包和发布说明不被本次开发构建覆盖。
