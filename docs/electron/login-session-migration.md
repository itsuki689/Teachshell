# 教学网站登录记忆迁移

实现依据是原项目 `Sources/Teachshelf/TeachingLoginSession.swift`、`TeachingWebClient.swift`、`TeachingLoginRecovery.swift` 及相应两个测试 suite，未修改这些 Swift 源文件。

## 保留的规则

- 默认关闭，每个资料库独立记录开关。资料库标识由主进程使用规范化真实路径摘要生成。
- 只有官方教学页面解析出有效账号后，才允许保存 Cookie。匿名 Cookie、Cookie 存在或资源 HEAD 返回均不能证明已登录。
- 白名单为 `^MoodleSession[A-Za-z0-9_-]*$`，域名必须恰好为 `selearning.nju.edu.cn` 或 `.selearning.nju.edu.cn`。不保存密码、CAS 票据、`MOODLEID1_` 用户名或父域 Cookie。
- 最多 8 个 Cookie，记录最多 96 KB；保存时间最多未来 5 分钟、保留时间严格少于 7 天，每个已过期 Cookie 都会导致恢复拒绝。重复保存未变化的 Cookie 不延长有效期。
- 恢复强制 HTTPS Secure，保留 HttpOnly、原有效期和 session-only 属性。恢复后为“等待网站验证”，仅允许只读探测，账号仍为空。
- 禁用记忆删除安全存储副本并保存关闭偏好，保留当前页面的内存登录。显式退出登录或已恢复/已验证的会话失效会清理副本。安全存储初次读取失败不等于会话失效，不会据此删除已有记录。
- Cookie 更新延迟 200 ms 合并保存；轮换、禁用、关闭会取消过时的捕获。关闭幂等，准备恢复期间关闭不能在之后重新创建窗口。
- 每次导航最多尝试一次学校官方 CAS 入口，必要时回到最初课程页面；不填写表单、不保存 CAS 凭据、不重复循环登录。

## 平台存储与隔离

教学及课表网页使用不带 `persist:` 的内存 Chromium partition。切库关闭后清理该库内存 Cookie、网站存储、缓存、HTTP 认证缓存和连接。旧版 `userData/Partitions/teachshelf-<scope>-{teaching,timetable}` 仅按当前资料库精确清理，不打开旧 Cookie 数据库，也不遍历或清除其他资料库。原生 `/Applications/课屿.app` 和它的钥匙串服务不受影响。

macOS 使用独立 Swift Security 辅助程序，只能访问 `com.teachshelf.desktop.teaching-session` 服务，按资料库 profile 保存。请求经 stdin JSON 传递，秘密不进入 shell 参数或日志。自动恢复使用禁止交互的 Keychain 查询；手动开启、重试和关闭才允许系统授权。辅助程序不能访问原 Swift 应用的 `com.teachshelf.mac.teaching-session` 条目，新应用需要首次手动登录。

Windows 使用 Electron `safeStorage` 的操作系统加密，把带 profile 绑定的密文原子写入应用配置目录。Linux 拒绝 `basic_text` 和无效安全后端，没有明文退路。Electron 无法保证 Linux 密钥环操作不弹授权框，所以 Linux 后台不会初始化、读取或写入安全密钥环；用户可点击重试完成恢复，Cookie 轮换后需手动重试保存。界面会明确显示此状态。

macOS helper 必须为目标应用架构编译并随应用签名，放在 `process.resourcesPath/teaching-session-keychain`。开发位置是 `desktop/dist-electron/teaching-session-keychain`。后台拒绝权限、锁定、损坏或辅助程序缺失时保持手动网页登录可用，不退回持久 Chromium Cookie 或明文文件。

## 服务接口

`WebsiteBrowser(scripts, scope, { sessionRoot?, keychainHelper?, onLoginState? })` 提供：

- `prepareLogin()`：首次请求前共用一次恢复，返回状态。
- `loginStatus()`：返回 `enabled/status/hasIssue/loginState/accountID?/canProbe`，不返回 Cookie。
- `setRememberLogin(boolean)`、`retryLogin()`：用户操作入口。
- `flushLogin()`：退出或切库前保存已验证会话，默认不允许系统交互。
- `cancelTeaching()`：取消页面读取及 SSO，保留当前登录。
- `close()`：共用同一个关闭 Promise，停止捕获、取消辅助程序并清理内存会话；调用方应先 `await flushLogin()`。

## 验证

- `node --test desktop/tests/login-session.test.ts desktop/tests/login-storage.test.ts`：14 个测试，包含日期和白名单边界、锁定模拟、取消竞态、加密文件隔离、符号链接拒绝及 Linux 后端规则。
- 原 Swift `TeachingLoginSessionTests` 与 `TeachingLoginRecoveryTests`：15 个测试通过。使用已有未修改测试构建，测试命令中的模块缓存、scratch/cache/config/security 路径均位于临时目录。
- `node desktop/tests/website-login.e2e.mjs`：真实 Electron Cookie jar 与 macOS 独立随机 Keychain profile，验证重启、Secure/HttpOnly/session-only、库隔离、禁用不登出、旧 partition 清理及关闭竞态。仅使用合成账号/Cookie，结束删除测试钥匙串项。
- `node desktop/tests/website-login-ui.e2e.mjs`：实际应用 main/preload/Vue 界面验证默认关闭、非法 IPC 参数拒绝、开关按资料库持久化、切库清理及重启。支持 `TEACHSHELF_EXECUTABLE` 指定已打包应用。
- 既有 `website-browser.e2e.mjs` 验证 Chromium 解析、隔离世界、未选择资料禁止正文 GET，以及 HEAD 重定向限制。

本机已验证 macOS；Windows/Linux 运行验证由对应 CI 主机执行，不能用本机测试替代这些系统的实际结果。
