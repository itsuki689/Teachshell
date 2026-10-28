# 当前验证记录

2026-10-28：macOS 文件监听修复，版本沿用 0.3.11，以 Git 提交标识本次开发构建。原因、原始失败链接、可复现回归与验证结果见[文件监听专项](filesystem-watch.md)。原生课屿与真实用户资料不参与测试。

本机结果：332/332 业务测试、22 个完整源码窗口套件、专项 7/7 工作区检查及 5 轮监听重复检查通过；TypeScript、生产构建、代码格式、Markdown 本地链接和差异检查通过。详见专项中的范围说明。

验证入口（`desktop/`）：`npm test`、`npm run build`、`node tests/workspace-sync.e2e.mjs`、`npm run test:e2e`。安装版使用 `TEACHSHELF_EXECUTABLE=/Applications/Teachshell.app/Contents/MacOS/Teachshell` 重跑相关窗口检查；所有业务样例均在临时资料库。

本地 Release 由当前已提交快照构建，签名通过后正常退出旧版、备份替换、注册并打开 Teachshell。回执为忽略的 `desktop/release/installed-macos.json`；关于页显示版本、源提交和实际执行路径。只生成 `.app`，本次不更新既有 GitHub Release。

CI 分别在 macOS、Windows、Linux 原生 runner 执行单元、生产构建、解包校验、源码及打包应用 E2E。最终状态应绑定本次 commit 查看，不能拿 0.3.11 发布工作流成功代替这次通用 CI。macOS 为 ARM64 ad-hoc 签名、未公证；Windows 未配置发布者签名。真实校园账号、网络盘以及用户桌面安装向导不在离线夹具验收范围。

## 历史证据

- [0.3.0](validation-0.3.0.md)、[0.3.1](validation-0.3.1.md)、[0.3.2 布局](page-layout-parity.md)、[0.3.3 外观](appearance-week-parity.md)、[0.3.4 控件](controls-parity.md)、[0.3.6 审计](detail-audit-0.3.6.md)。
- [计划工作区与后续交互](schedule-workspace.md)、[0.1.0](validation-0.1.0.md)、[0.2.0](validation-0.2.0.md)。
- [0.3.11 发布说明](../../desktop/release-notes/0.3.11.md)与[已发布版本](https://github.com/itsuki689/Teachshell/releases/tag/v0.3.11)。历史安装包和发布说明不被本次开发构建覆盖。
