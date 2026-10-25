# 课屿 Desktop

Electron + Vue 3 + TypeScript 的独立跨平台版本。保留原 Swift 工程，使用独立应用标识 `com.teachshelf.desktop`，默认使用 Electron 用户数据目录下的 `Library`。**当前是可运行的迁移预览版，尚不能替代原版全部功能。**

## 开发

需要 Node.js 24 和 npm。首次安装需要联网；安装后本地资料管理完全离线。

```sh
cd desktop
npm ci
node node_modules/electron/install.js
npm run dev
```

`npm run dev` 同时启动 Vite 和 Electron；修改主进程/preload 后重新运行。正常生产运行：

```sh
npm run build
npm start
```

若 GitHub 下载在当前网络不可达，可以使用 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/electron/install.js`。Electron 安装器仍使用官方 npm 包内置 SHA256 校验。不要关闭 TLS 验证或校验和检查。

## 迁移资料

1. 在原版中保存并退出，确保没有未完成的文件事务。
2. 在 Desktop 设置中选择「复制导入原版资料库」，选择包含 `library.json` 的文件夹。
3. 指定新的空目录作为副本。复制覆盖 `files`、旧 `HomeworkFiles`、`History`、孤立文件和索引；逐个校验文件并检查索引在复制期间未变化。
4. 成功后切换到副本。原目录不会被打开写入。再次打开副本使用「打开跨平台资料库」。恢复备份时，同样把备份目录复制导入到新位置，再切换到恢复后的副本。

不允许直接以 Electron 写入没有 `.teachshelf-electron.json` 标记的原版资料库：两端的写锁协议不同。不要手工加标记绕过复制流程，也不要让 Swift 与 Electron 同时写同一个副本。原版 schema 1–9 可以复制导入；未知 JSON 字段保留。原版聊天只保存在内存，无法导入不存在的历史文件。新的聊天记录保存在副本 `.desktop-chat.json`。

外部引用不会随库复制，也不会随课程移动而修改原文件；换设备后需重新导入引用。旧作业挂载路径原样保留；副本中的旧 `HomeworkFiles` 自动合并到新的作业目录，同内容去重、冲突编号，保留旧树并记录完成标记。作业工作区支持文件浏览、文件夹创建、复制导入、重命名及外部目录挂载。遇到损坏主索引、备份存在但主索引丢失、未完成原版事务、符号链接或复制中变化，程序拒绝导入并保留源数据。

## 操作

- 创建、编辑、归档和删除课程；删除课程保留资料并移到未分类。
- 批量导入文件/文件夹或拖入文件；可复制到库内或保持外部引用。
- 课程内物理文件夹、嵌套目录、改名和跨课程移动；资料多选移动、收藏、标签、备注、搜索及列表/封面视图。
- 文件实际改名保留扩展名。移除记录保留实际文件，不清空磁盘。导出副本支持批量选择，同名文件自动编号，保留目的地已有文件。
- 本地文件监听与启动扫描跟踪改名/移动；文件丢失时保留记录、批注和身份，不把新同名文件冒充旧文件。
- PDF、图片、音视频和文本在受限预览中打开；常见文档可用系统应用打开，未知/程序格式只能显示文件位置。
- 计划支持每日/每周/每月重复、间隔、截止日、单次例外、“本次及以后”拆分、完成/取消/归档/恢复、关联资料及临时变更历史；提供列表、日程和月历。
- 本科课表提供周视图、学期和节次设置、单次停课/恢复、调课/还原及月历显示。课表 JSON 可离线导入。
- 作业独立浏览真实目录，支持文件与文件夹复制、新建、重命名、系统打开、挂载外部目录。
- AI 设置支持 OpenAI 兼容 Chat Completions 地址、模型及 API Key，SSE 流式输出、停止、工具调用确认、持久化对话。工具写入必须确认，过期 revision 会拒绝。
- 教学网站使用独立且按资料库隔离的 Chromium 登录会话；原解析脚本读取当前页面，资源页可选择文件下载导入。
- 读取课程首页后可绑定本地课程，再打开作业页预览标题、内容和截止日期变化。确认前重读网页并核对账号、课程、内容和库 revision；保留手工修改，截止日期冲突可选择保留本地或采用网站。断开连接保留本地资料和计划。
- 资源文件当前支持选择性首次导入，同一远端 key 再导入会跳过；文件增量更新、历史版本和全量批量审核尚未实现。已导入的旧连接记录会保留。

## 安全边界

Renderer 没有 Node.js；`contextIsolation` 和 `sandbox` 开启，preload 仅导出具体业务方法。IPC 校验发送窗口、主框架、精确页面 URL 和严格参数 schema。教学网页没有 preload，不能调用本地 API；权限与弹窗受限。预览仅通过随机令牌解析当前库中已登记材料，拒绝任意路径；不把 HTML 或 SVG 当内嵌活动网页运行。

API Key 使用 Electron safeStorage 的操作系统加密，密钥按规范化 API endpoint 绑定；更换 endpoint 后不沿用旧密钥。Linux 无安全密钥环时拒绝保存密钥，不回退明文。本地离线功能不依赖钥匙串是否可解锁。

MCP 默认关闭，启用后只监听 `127.0.0.1:53142/mcp`（与原版端口分开），要求随机 Bearer token，拒绝浏览器 Origin、错误 Host、超限及非法请求。设置页可复制 HTTP 或 stdio 配置；stdio 使用随应用分发的桥接脚本，不要求另装 Node.js。25 个工具与原版目录一致，包括重复发生项查询、单次/未来计划修改和冲突安全撤销。使用复制迁移后的新 revision，不能继续使用 Swift 缓存的 revision。

## 测试

```sh
npm test
npm run build
npm run test:e2e
```

测试必须允许本地回环监听；限制监听的沙箱会让真实 HTTP 测试报 `listen EPERM`，不代表协议测试可以跳过。E2E 用真实 Electron 窗口，所有文件位于临时目录，测试结束退出应用；从不读写真实用户资料库。Linux E2E 需要桌面会话或 `xvfb-run --auto-servernum npm run test:e2e`。

Swift 兼容夹具可重新生成：

```sh
python3 desktop/scripts/generate-swift-fixtures.py
```

在仓库根目录运行，需要 macOS Swift 6；编译未修改的 `Sources/TeachshelfCore`，生产编码器生成 JSON，生产 Repository 验证读取。差分验证先生成 TypeScript 测试输入，再由未修改的生产 Swift 核心解码、验证并比对。以下在 `desktop/` 中运行（macOS）：

```sh
TEACHSHELF_PLANS_ROUNDTRIP=/tmp/plans.json TEACHSHELF_TIMETABLE_ROUNDTRIP=/tmp/timetable.json TEACHSHELF_TEACHING_ROUNDTRIP=/tmp/teaching.json node --experimental-strip-types --test tests/plans.test.ts tests/timetable.test.ts tests/teaching-sync.test.ts
python3 scripts/verify-swift-plans.py /tmp/plans.json
python3 scripts/verify-swift-timetable.py /tmp/timetable.json
python3 scripts/verify-swift-teaching.py /tmp/teaching.json
```

详情见 [兼容契约](../docs/electron/data-compatibility.md)、[功能映射](../docs/electron/feature-map.md)、[验证报告](../docs/electron/validation.md)。

## 构建

```sh
npm run package:dir
npm run package -- --publish never
npm run test:packaged
```

输出在 `desktop/release/`，应用名为「课屿 Desktop」。macOS 生成 DMG/ZIP，Windows 生成 NSIS EXE，Linux 生成 AppImage/DEB。`.github/workflows/desktop.yml` 在各平台原生 runner 安装依赖、测试、构建安装包，再用打包后的应用重复窗口验收并上传产物和截图。该工作流已配置不等于三平台已通过验收；实际本地结果见验证报告。

开发构建没有开发者证书和公证凭据。正式发布需配置 Apple Developer 签名/公证及 Windows 代码签名；不要把本机 ad-hoc 签名当作正式签名。自动流程不推送、不发布，也不替换 `/Applications/课屿.app`。

## 当前边界

- 日历已有月历、周课表和日程，原版像素级布局、拖动调课、全局键盘导航、顶栏自定义及 Office 原生缩略图仍有差异。
- 教学网站全量文件版本增量同步、批量更新审核和自动巡检仍需继续迁移；当前已完成逐项作业预览/同步/截止冲突处理。真实账号登录受当前校园网络与学校页面影响。
- 安全文件复制暂使用同一资料库卷内的硬链接完成无覆盖提交；不支持硬链接的卷会明确拒绝并回滚。优先使用本地 APFS/NTFS/ext4，网络/移动卷未验收。
- 同一用户下其他恶意进程可绕过任何应用级锁/权限；不支持两端同时修改同库。
- Windows/Linux 安装和真实学校账号登录需在对应环境验收。没有凭据时只做离线解析和受限下载测试，不声称真实登录已通过。
