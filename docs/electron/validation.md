# 当前验证记录

2026-10-28 Windows 反馈补充：确认反馈来自 Windows，继续移除按钮按下态的 120 ms 颜色过渡；保留鼠标拖出取消、空格键松开执行与悬停过渡。新增两项旧版失败、修复后通过的真实输入回归，当前专项共 6 项。此补充在本机 macOS ARM64 通过生产构建、按键/顶栏/控件/外观 4 组窗口回归、修改代码格式和差异检查；尚未在 Windows 原生环境验收，不能据此认定测试者的所有延迟原因已排除。

2026-10-28：按键响应修复，版本沿用 0.3.11，以 Git 提交标识开发构建。刷新按钮不再等待装饰动画；设置和作业目录只读加载不阻塞顶栏与快捷键。实现与异步守卫见[界面状态说明](ui-sync-migration.md)。原生课屿与真实用户资料不参与测试。

本轮 macOS ARM64 本机结果：335/335 业务测试、23 个完整源码窗口套件通过，其中新增 4 项按键响应检查。旧版在暂停刷新动画、延迟设置与作业目录读取时失败，修复后全部通过。TypeScript、生产构建、修改代码的格式和差异检查通过；窗口身份、非空界面、错误遮罩、控制台和交互检查通过。Browser 插件不可用，采用 Playwright Electron，截图与日志保存在仓库外的临时目录。测试通过事件屏障复现，未放宽时间阈值。

验证入口（`desktop/`）：`npm test`、`npm run build`、`node tests/input-response.e2e.mjs`、`npm run test:e2e`。安装版使用 `TEACHSHELF_EXECUTABLE=/Applications/Teachshell.app/Contents/MacOS/Teachshell` 重跑相关窗口检查；所有业务样例均在临时资料库。本轮未在 Windows/Linux 实机执行，也未推送或触发新的远程 CI；先前 CI 结果不代表此次改动。原 macOS 监听根因、原始 CI 失败链接和重复验证见[文件监听专项](filesystem-watch.md)。

本地 Release 由当前已提交快照构建，签名通过后正常退出旧版、备份替换、注册并打开 Teachshell。回执为忽略的 `desktop/release/installed-macos.json`；关于页显示版本、源提交和实际执行路径。只生成 `.app`，本次不更新既有 GitHub Release。

CI 分别在 macOS、Windows、Linux 原生 runner 执行单元、生产构建、解包校验、源码及打包应用 E2E。最终状态应绑定本次 commit 查看，不能拿 0.3.11 发布工作流成功代替这次通用 CI。macOS 为 ARM64 ad-hoc 签名、未公证；Windows 未配置发布者签名。真实校园账号、网络盘以及用户桌面安装向导不在离线夹具验收范围。

## 历史证据

- [0.3.0](validation-0.3.0.md)、[0.3.1](validation-0.3.1.md)、[0.3.2 布局](page-layout-parity.md)、[0.3.3 外观](appearance-week-parity.md)、[0.3.4 控件](controls-parity.md)、[0.3.6 审计](detail-audit-0.3.6.md)。
- [计划工作区与后续交互](schedule-workspace.md)、[0.1.0](validation-0.1.0.md)、[0.2.0](validation-0.2.0.md)。
- [0.3.11 发布说明](../../desktop/release-notes/0.3.11.md)与[已发布版本](https://github.com/itsuki689/Teachshell/releases/tag/v0.3.11)。历史安装包和发布说明不被本次开发构建覆盖。
