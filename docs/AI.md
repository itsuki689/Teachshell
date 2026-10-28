# Teachshell AI 助手

适用于 `desktop/` 当前实现；[文档目录](README.md) · [当前验证](electron/validation.md)。

在设置 → AI 助手填写 OpenAI 兼容 Chat Completions 地址、模型和可选 API Key，保存后到 AI 助手发送消息。支持 SSE 流式输出、停止、工具调用；没有内置模型。当前设置未实现 Swift 的独立工具连接测试及推理兼容开关，不应按下方历史说明寻找这些控件。

`electron/services/ai/stream.ts` 负责分块 UTF-8/SSE 和普通 JSON 响应，`chat.ts` 管理多轮、取消及写入确认，和 MCP 共用 `mcp/tools.ts` 的 25 个工具。查询直接执行，每个 AI 写工具都必须在应用内确认；过期 revision 或切库后不能执行旧确认。工具不能读取 PDF/Office 正文、运行 shell 或任意访问本地路径。停止不打断已经提交中的磁盘事务，退出等待工具回执与聊天落盘。

每份资料库的历史写入 `.desktop-chat.json`，原子更新并保留备份；损坏/超限数据报错并保留原件。切库切换对应会话，不能把原生 Swift 的内存聊天记录当成可导入的历史文件。聊天和工具返回的元数据会发给用户配置的模型服务；只打开页面不会发起对话。

API Key 由 Electron `safeStorage` 使用系统后端加密，按完整规范化 endpoint 绑定；更换地址不沿用旧密钥。配置存入独立应用数据目录的 `desktop-settings.json`，不写入资料库。Linux 无安全后端时拒绝保存，不回退明文。此存储与教学网站 Cookie 的专用 macOS Keychain helper 不同，也不读取原生课屿的凭据。

验证（在 `desktop/`）：`node --experimental-strip-types --test tests/ai.test.ts tests/mcp.test.ts tests/security.test.ts`，窗口通过 `npm run test:e2e` 覆盖输入、确认、草稿和退出。HTTP 测试使用回环夹具，不需要真实模型密钥。

<details>
<summary>原生 Swift 历史说明（保留作行为对照，不作为 Teachshell 操作指引）</summary>

# 内置 AI 助手

课屿 1.15.0 在侧栏提供 **AI 助手**；自 1.15.2 起与 **计划** 并排显示。用自然语言查询计划、课程和资料，调整计划内容、资料元数据及物理文件夹。它与外部 MCP 共用 25 个工具及 `AppToolExecutor`，保持相同的参数校验、资料库标识、版本检查、编辑窗口保护、物理文件事务和界面刷新。

## 连接模型

1. 打开 **设置 → AI 助手**；聊天页的 **模型设置** 也会跳转到这里。
2. 所有模型统一使用 OpenAI 兼容 Chat Completions 接口。填写 API 基础地址（通常以 `/v1` 结尾）或完整的 `/chat/completions` 地址。
3. 填写服务中的模型 ID 和 API Key。无鉴权的本地服务可以留空密钥。
4. 点击 **测试连接**，成功后点击 **保存配置**。

自 1.16.0 起，连接配置集中在独立的 AI 助手设置页，原有地址、模型和钥匙串密钥自动沿用。切换设置分页会保留未保存的草稿；点击 **还原** 可恢复最近保存的配置。测试连接不会自动保存，切换页面或修改参数会取消测试，迟到的结果不会覆盖新状态。MCP 页只管理外部客户端的工具连接。

测试只向配置的服务发送一条测试消息，要求返回 `connection_test`，不访问资料库。能聊天的模型不一定支持工具调用；测试不通过时，应检查模型、工具模板及服务配置。部分服务需要将 `reasoning_effort` 设为 `none` 才能调用工具，此时展开 **高级兼容选项**，启用 **关闭模型推理**；其他服务保持关闭。课屿不内置模型，也不下载模型权重。

服务器部署的本地模型只需提供兼容 API。例如本机转发端口可填写 `http://127.0.0.1:8000/v1`。应用允许本机、RFC1918 私有 IPv4、100.64.0.0/10 私有组网地址和 IPv6 ULA 的 HTTP 连接；公网地址请使用 HTTPS。HTTP 会明文传输对话和密钥。课屿不跟随 API 重定向，请直接填写最终地址。

模型只返回工具调用建议，Mac 上的课屿负责实际执行。**不需要向模型服务器开放课屿 MCP 端口，也不需要把课屿 MCP 令牌交给模型。** 关闭设置中的外部 MCP 服务不影响内置助手。

## 对话与操作

- 进入助手时，当前课程和已选资料会显示在输入框上方。可以清除上下文；这些内容是辅助范围，工具仍能查询其他课程。
- 输入问题，点击发送或按 `⌘ Return`。示例问题只填入输入框，不会立即发送。
- 每条消息附带当前资料库标识、时间和时区，不自动附带课程列表或计划内容。新增独立计划可直接进入确认；关联课程/资料、查找或修改已有内容时按需查询相关对象，不再要求每轮先读取资料库概况。
- 查询直接执行。所有写入都会展示操作卡片，列出对象、字段和作用范围，点击 **确认执行** 后才修改。拒绝或停止不会执行待确认操作。
- 结果卡片显示“已保存”“内容未变化”或实际错误；可点击课程、资料和计划名称定位到对应页面。每张卡片最多显示 12 个定位链接。
- 计划修改可点击 **撤销这次计划修改**。若计划后来又被编辑，撤销会拒绝覆盖新内容。撤销记录与 MCP 共用，仅本次应用会话中最近 50 次有效。
- 课程删除、资料记录移除及文件夹解散保留实际文件，但不能用计划撤销恢复分组或记录，确认卡片会说明影响。
- **停止**会取消网络请求和待确认操作，阻止后续调用。已经进入磁盘事务的操作会完整结束并显示真实结果，不会中断到一半。
- 切换资料库会结束当前对话；旧请求不能向新资料库写入。更换模型配置也会清空对话。

可以尝试：“今天有哪些待完成的计划？”、“每门课各有多少份资料？”、“把数据库复习计划的地点改为教118”、“在当前课程下创建一个复习资料文件夹”。同名对象和重复计划范围应明确后再修改。

## 数据与边界

发送时，消息、选中的课程/资料标识，以及工具查得的课程、计划、资料标题、标签、备注等元数据会传给用户选择的模型服务。仅打开助手页面不会发送资料。对话仅保存在内存中，退出应用后清空；模型服务可能按其自身规则留存请求。

API Key 单独保存在 macOS 钥匙串，按完整 API 地址隔离；不会进入资料库、备份、对话、工具参数或配置 JSON。更换地址会清空密钥输入，需要重新填写。配置中的地址、模型名称和推理选项保存在本机应用偏好中。

当前不读取 PDF、Word 等文件正文，不支持正文总结、任意磁盘读写、Shell 命令或文件导入。工具没有节次时间表，按“第八节”等描述安排时间时助手需要先确认具体时刻。接口协议采用非流式 Chat Completions，等待完整回答后显示；支持多轮对话及停止等待。为适配本地模型较慢的首轮预填充，请求允许连续等待最多 5 分钟（单请求总时限 6 分钟），期间可以随时停止。每轮最多 12 次模型请求、32 次工具调用、单响应最多 8 个工具调用，写入不自动重试。

部分兼容服务会把工具参数中的布尔值、整数或嵌套 JSON 编码成字符串。课屿仅按工具 schema 转换明确的 `True`/`False`、整数和 JSON 容器；文本字段保持原样，缺失字段、未知字段、越界值及错误类型仍然拒绝执行。上下文窗口和 MTP 由模型服务控制，无需在课屿另行填写。

本地 HTTP 支持依据 Apple 的 [NSAllowsLocalNetworking](https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowslocalnetworking) 和 [NSExceptionDomains](https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsexceptiondomains) 配置，不关闭全局 ATS。

## 实现与验证

- `AIChatClient`：Chat Completions 消息与工具调用、连接探测、响应体大小上限、超时、取消、拒绝重定向、错误信息脱敏。
- `AISettingsModel` / `AISettingsView`：统一连接配置、草稿与保存、钥匙串读取失败保护、连接测试取消和设置导航。
- `AIChatController`：多轮对话、每次写入确认、结果卡片、计划撤销、会话与资料库隔离。中断后清除未完成的协议消息，保留实际操作结果。
- `AppToolExecutor`：内置助手与外部 MCP 共享的实际执行边界，调用原有 Core 服务，不直接修改 `library.json`。
- 测试使用隔离资料库、脚本化模型和 URLProtocol HTTP 夹具，覆盖真实请求编码、工具往返、修改/拒绝/撤销、取消后的迟到回复、版本/编辑冲突及物理文件夹创建；未使用用户资料或实际第三方模型凭据。

消息格式参考 [Chat Completions API](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) 和 [Function calling](https://developers.openai.com/api/docs/guides/function-calling)。不同兼容服务仍可能存在参数差异，以连接测试为准。

</details>
