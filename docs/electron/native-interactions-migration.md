# 原生交互与登录记忆迁移

当前跨平台边界：macOS 仅 Apple Silicon。文件事件后端与 Swift FSEvents 调度不同，保留业务身份核对；见[文件监听说明](filesystem-watch.md)。本机安装只更新 Teachshell，当前验收见[验证报告](validation.md)。

## 对照的实际实现

- `ToolbarSettings.swift` / `WorkspaceToolbar`：10 种操作，默认更新、设置、导入、新建；最多 6 个、不重复，可为空。跨平台版按原 JSON 保存 `toolbarSettings.actions`，保留未知字段；缺省读取不会把默认值写回旧库。修改受资料库身份和 revision 保护。
- `ScheduleWeekTimeline` / `ScheduleEventEditing`：按真实分钟显示、压缩短课间、保留午休、固定安排默认锁定；移动一次发生项保留原始发生日与时长。重复计划只更改本次例外，保留截止时间、资料、备注及其他日期。列表入口继续供详细管理及缺少节次时间的课程使用。
- `TeachingLoginSession.swift` / Recovery：默认不记忆；只保存官方教学域名的 MoodleSession cookie，限制条数、大小和最长 7 天，恢复时强制 Secure，保留 HttpOnly 与会话 cookie 属性。学校统一身份认证与课表 cookie 不持久化。只有官方解析页面确认账号后才保存；cookie 本身不是账号验证证据。

## 独立应用和凭据

原生 `/Applications/课屿.app` 始终保留，安装器只备份并更新 `/Applications/Teachshell.app`。应用标识、设置、密钥链服务和资料库副本与原生版本独立。不会读取或覆盖原生登录凭据。

网站使用按资料库隔离的内存 Chromium 分区。关闭资料库/退出时清空内存会话；勾选登录记忆后，仅允许的 cookie 经系统安全存储在后续启动恢复。取消勾选删除保存的会话，当前网页仍保持登录。旧版 Electron 的当前资料库持久分区会清除，避免没有选择记忆却残留登录；其他库与原生数据不受影响。

macOS 随包包含小型 Swift Keychain helper，读写时明确控制是否允许认证界面，后台不弹解锁窗口；失败显示状态并由用户重试。Windows 使用 DPAPI，Linux 使用 Electron 安全后端；Linux 无法保证无交互解锁时要求主动重试，不回退明文。后台定时策略另见 `background-sync-migration.md`。

## 构建和验收界限

macOS 开发构建需要 Apple Command Line Tools。从 0.3.10 起仅支持 Apple Silicon，要求 ARM64 Node.js 和 helper；打包前验证 Mach-O 架构及签名，拒绝 Intel 和 Universal 目标。不使用缺少 Intel Swift 兼容运行库的 ARM CLT 强行交叉链接，也不移除运行时检查。安装后用户不需要 Swift 工具链。

测试使用真实临时资料库、实际 Electron 窗口、原解析脚本和官方 URL 的本地响应替身。真实校园账号的交互登录、学校服务器策略与 Windows/Linux 桌面实机行为仍需对应环境验证；不能把隔离测试等同于真实校园认证成功。
