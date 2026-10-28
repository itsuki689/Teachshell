# Teachshell MCP 接入

适用于 Electron 应用；[文档目录](README.md) · [功能与工具映射](electron/feature-map.md) · [当前验证](electron/validation.md)。

MCP 默认关闭。在 Teachshell 的设置 → MCP 启用，确认显示实际运行状态，再复制 HTTP 或 stdio 配置。默认只监听 `http://127.0.0.1:53142/mcp`，与原生课屿的 53141 分离；应用必须保持运行。HTTP 配置包含随机 Bearer token，拒绝浏览器 Origin、错误 Host 和非法协议请求。不能将令牌提交到仓库或交给模型 API。

stdio 配置由应用生成，使用当前 Teachshell 可执行文件、随包 `mcp-stdio.cjs`、`--config <userData>/desktop-settings.json` 和 `ELECTRON_RUN_AS_NODE=1`，不要求用户安装 Node.js。请复制实际配置，不能使用下方 Swift 历史示例的 `TeachshelfMCP` 路径。更换安装位置后重新复制配置。

内置 AI 与 MCP 共享 25 个工具：计划查询/重复发生项/修改/撤销，以及课程、资料元数据和物理文件夹操作。工具名和 schema 对照见 `desktop/tests/fixtures/mcp-tool-catalog.json`；实现位于 `desktop/electron/services/mcp/`。查询先获取当前资料库 ID 与 revision，再提交写入；不要沿用 Swift 客户端缓存的 revision。文件事件重新核对索引后也可能改变 revision，冲突时应重新读取。资料移除保留真实文件，计划撤销不撤销课程和资料文件事务。

外部客户端拥有已启用服务的令牌后可直接调用受校验的写工具；逐次弹确认属于内置 AI 的流程。服务没有任意 shell、文件正文读取或外部文件导入能力；网页没有调用 MCP 的本地权限。服务保存和重启使用串行配置事务，失败回滚；显示“已启用”不等于监听成功。

验证（在 `desktop/`）：`node --experimental-strip-types --test tests/mcp.test.ts`；完整入口为 `npm test`。真实 HTTP/stdio 回归需要允许本地回环监听；安装版 E2E 校验实际桥接脚本。配置、构建和限制以[开发说明](../desktop/README.md)为准。

<details>
<summary>原生 Swift 历史说明（保留作行为对照，不作为 Teachshell 操作指引）</summary>

# 用 LLM 操作课屿计划与课程资料

也可以直接使用课屿侧栏的 **AI 助手**：在 **设置 → AI 助手** 配置 OpenAI 兼容模型 API 后，在应用内自然语言操作。它复用同一工具目录和执行层，不要求开启外部 MCP 服务，也无需向服务器开放本机端口。见 [AI 助手指南](AI.md)。

课屿 1.12 起内置 MCP 服务，1.13 增加课程、资料信息与物理文件夹管理，共提供 25 个工具。支持桌面客户端和部署在服务器上的 MCP 客户端/Agent。模型需要由具备 MCP 工具调用能力的客户端或 Agent 驱动；只有模型推理 API 本身不能直接调用 MCP。

自 1.16.0 起，MCP 页按工具服务、客户端连接和当前会话分组；端口、令牌及远程客户端说明默认折叠。内置聊天的模型地址与 API Key 统一放在 **AI 助手** 设置页，MCP 继续使用标准 stdio / Streamable HTTP 工具协议。

## 本机客户端：stdio

打开课屿，在 **设置 → MCP** 确认服务已启用，在 **连接客户端** 选择 **本机 · stdio**，点击 **复制 stdio 配置**。安装在默认位置时配置如下：

```json
{
  "mcpServers": {
    "teachshelf": {
      "command": "/Applications/课屿.app/Contents/MacOS/TeachshelfMCP"
    }
  }
}
```

将这段配置合并到客户端的 MCP 配置中（保留已有服务器），再重新连接。不同客户端的配置文件位置、字段和导入方式可能不同。stdio 入口自动读取本机私有配置，不需要把令牌写入客户端配置。应用必须保持打开；退出课屿后，调用会返回连接错误，不会后台启动第二个资料库写入进程。

## HTTP 客户端

在 **设置 → MCP → 连接客户端** 选择 **HTTP 客户端**，点击 **复制 HTTP 配置**，其中包含地址和真实访问令牌。默认地址 `http://127.0.0.1:53141/mcp`，使用 **Streamable HTTP**，不是旧版 SSE 传输。通用配置示例：

```json
{
  "mcpServers": {
    "teachshelf": {
      "url": "http://127.0.0.1:53141/mcp",
      "headers": { "Authorization": "Bearer <从课屿设置复制的访问令牌>" }
    }
  }
}
```

如果客户端单独选择传输类型，选 Streamable HTTP / HTTP，并填写同一个 URL 和 Authorization 请求头。服务采用静态 Bearer 令牌，不提供 OAuth 自动发现；仅支持 OAuth、不能配置请求头的客户端可使用本机 stdio 入口或自己的 MCP 网关。

令牌保存在 `~/Library/Application Support/TeachshelfMCP/config.json`，目录权限 0700，文件权限 0600，与资料库和备份分离。不要把真实配置提交到 Git 或放入聊天记录。更换令牌后，HTTP 客户端需要更新；stdio 入口会在下一次请求读取新配置。

## 服务器上的 MCP 客户端

仅接入服务器的模型 API 时，请使用 **设置 → AI 助手**；以下步骤用于远程 MCP 客户端或 Agent，可在 MCP 页展开 **远程 MCP 客户端** 查看。

在 **Mac 终端** 执行（替换服务器账号和地址；端口以课屿设置为准）：

```sh
ssh -o ExitOnForwardFailure=yes -N \
  -R 127.0.0.1:53141:127.0.0.1:53141 user@server
```

保持 SSH 和课屿运行。然后把上面的 HTTP 配置加入**服务器上的 MCP 客户端/Agent**；该客户端访问服务器自己的 `127.0.0.1:53141`，SSH 会将请求转发至 Mac。Authorization 令牌仍然必需。服务器同一用户/管理员控制的进程能访问转发端口，因此只连接你信任的服务器。

- 远端端口被占用时，可把 `-R` 的第一个 `53141` 改成其他空闲端口，并相应修改客户端 URL。课屿会核对 Host，请让客户端或受信任的反向代理设置 `Host: 127.0.0.1:<课屿本机端口>`，或者使用同端口转发。
- SSH 服务端必须允许 TCP 转发；服务器仅运行模型推理服务时，需要在调用模型的 Agent 中集成 MCP。
- 客户端在 Docker 容器中时，容器的 localhost 不是宿主机。可在同一网络命名空间建立隧道，或用受控网关连接；不要直接把课屿端口暴露到公网。
- Mac 休眠、应用退出或 SSH 断开后连接不可用。恢复连接后，先查询当前状态和版本再重试写入。

## 可以怎么说

- “列出本周未完成的计划，按课程整理。”
- “新建高等数学复习计划，明晚 19:00 到 20:30，内容分成三个步骤。”
- “把这周五的实验报告截止时间改到下周一 23:59，仅修改这一次。”
- “将刚才的计划标记完成。”
- “撤销刚才的计划修改。”
- “给高等数学创建一个「期末复习」文件夹，把标记为复习的资料移进去。”
- “把这份资料的标签改为「重点」，并收藏。”
- “把「第一讲.txt」重命名为「极限与连续.txt」，显示标题改为「第一讲：极限与连续」。”
- “把整个「实验讲义」文件夹移到物理课程，保留子目录。”

## 计划工具

原有 10 个工具及其参数保持兼容：

| 工具 | 用途 |
| --- | --- |
| `teachshelf_context` | 当前资料库标识、北京时间、课程 ID、资料分类及 `library_revision` |
| `teachshelf_list_plans` / `teachshelf_get_plan` | 搜索摘要、读取正文和版本 |
| `teachshelf_list_occurrences` | 1–31 天内的执行和截止事件，包括重复例外 |
| `teachshelf_search_materials` | 查找可关联的资料 ID，不读取文件正文 |
| `teachshelf_create_plan` | 新建计划，支持正文、课程、关联资料、执行时间、DDL、重复规则 |
| `teachshelf_update_plan` | 局部更新，仅改传入字段；可空字段传 null 清除 |
| `teachshelf_set_plan_status` | 完成、未完成、取消、恢复、归档和取消归档 |
| `teachshelf_delete_plan` | 删除指定范围的计划 |
| `teachshelf_undo_change` | 按 change_id 撤销计划修改 |

写入前调用 context 获取 `library_id`，从查询结果获取计划 `id` 和 `revision`，更新时将版本传为 `expected_revision`。冲突时会拒绝保存，应重新读取、合并，不应盲目覆盖。新建必须提供 UUID `request_id`；网络重试复用同一个 ID，已存在时会拒绝重复创建，可用这个 ID 查询是否已成功。

重复计划通过 `scope` 选择 `all`（默认整组）、`thisOccurrence`（仅本次）、`thisAndFuture`（本次及以后）。非整组操作需要 `original_date`，即移动前的原始发生日。list_occurrences 会返回这个日期。仅本次不能修改重复规则。完成、未完成、恢复只支持整组/本次；归档仅支持整组。恢复取消保留其他修改，不清空整条例外。

时间必须是带时区的 RFC3339，例如 `2026-10-23T19:00:00+08:00`；日期参数按 `Asia/Shanghai` 解释。新计划默认没有执行时间，执行与截止时间默认为非全天（全天需显式设置对应字段），填写 `starts_at` 会开启执行时间。修改开始时间时须自行调整已有结束时间，否则结束早于开始会被校验拒绝。返回中的 `starts_at: null` 表示未安排执行时间；通过 `has_execution_time: false` 取消执行时间。

计划修改会刷新正在打开的资料库，并进入界面的计划撤销记录。MCP 的 `change_id` 撤销记录保留本次会话最近 50 次修改，重启或切换资料库后失效；如果同一计划后来被修改，旧撤销会被拒绝。编辑窗口正在打开的计划不能通过 MCP 修改，以免覆盖未保存草稿。

## 课程、资料与物理文件夹工具

新增 15 个工具：

| 工具 | 用途 |
| --- | --- |
| `teachshelf_list_courses` / `teachshelf_get_course` | 搜索课程、查看信息和资料数量，支持归档筛选 |
| `teachshelf_create_course` / `teachshelf_update_course` | 创建课程、修改名称/学期/教师/颜色/归档状态；改名同步物理目录 |
| `teachshelf_delete_course` | 删除课程及教学网站连接，资料移为未分类；保留计划和实际文件，解除课程文件夹分组 |
| `teachshelf_list_materials` / `teachshelf_get_material` | 按关键词、课程、文件夹、分类、收藏及丢失状态查询，读取元数据、备注和关联计划 ID |
| `teachshelf_update_material` | 局部修改显示标题、分类、标签、备注、收藏或实际文件名 |
| `teachshelf_move_materials` | 原子批量移动资料，支持跨课程、嵌套文件夹，单次最多 100 份 |
| `teachshelf_remove_materials` | 移除记录并解除计划关联，实际文件仍保留 |
| `teachshelf_list_material_folders` / `teachshelf_get_material_folder` | 查询物理文件夹、层级、路径和资料数量 |
| `teachshelf_create_material_folder` / `teachshelf_update_material_folder` | 创建、改色、改名或移动文件夹，连同子目录和资料一起移动 |
| `teachshelf_dissolve_material_folder` | 解散整个文件夹子树，资料移回上一级，实际文件保留 |

课程资料写入需要 `library_id` 和 **`expected_library_revision`**。先调用 context 或课程资料查询工具，将返回的 `library_revision` 原样传回；每次写入后使用最新返回版本。版本涵盖课程、资料、文件夹及计划关联，Finder 对账也会使版本变化。冲突时先重新查询再合并；仅打开资料或调整外观不会造成版本冲突。它与计划工具的单计划 `expected_revision` 不同。

创建课程和文件夹也要提供 UUID `request_id`，此 ID 即新对象 ID。重试复用同一 ID；若已存在，先按 ID 查询结果，避免重复创建。更新通过 `patch` 只修改传入字段，同名课程用 ID 区分。列表默认返回 50 条，`limit` 为 1–100，使用 `next_offset` 继续分页。

- 查询中的 `course_id` 不传表示所有课程，传 `null` 表示未分类。`folder_id` 不传表示所有层级，传 `null` 表示根目录；`recursive: true` 包含该位置下所有子文件夹。文件夹列表用 `parent_id: null` 查询根层。
- 移动资料时必须明确 `course_id` 和 `folder_id`；目标文件夹必须属于指定课程，`folder_id: null` 表示课程根目录。所有资料一起校验和提交，任何 ID 无效或文件名冲突都会拒绝整批操作。外部引用只改归属，原文件保持原位置。
- `title` 只修改界面显示标题；`filename` 修改库内实际文件名，必须保留扩展名，不支持外部引用或位置丢失的文件。名称碰撞不会覆盖已有文件。
- 文件夹改名及移动对应磁盘操作。跨课程移动时，未提供 `parent_id` 会落到目标课程根目录；禁止移入自身/子目录，也不允许同层重名。
- 删除课程、移除记录和解散文件夹会保留文件，但会改变分组或关联关系。**课程资料修改不进入计划撤销记录，也不能通过 `teachshelf_undo_change` 撤销。**

应用正在导入、保存或切换资料库时，工具返回稍后重试。课程、资料详情、文件夹整理或计划编辑窗口仍打开时，课程资料写入会被拒绝，请先保存并关闭编辑窗口；查询仍可使用。修改成功后界面立即刷新。

本次工具只提供资料信息和物理结构管理，不读取 PDF/文档正文、不导入外部目录文件、不提供永久删除文件的工具。查询结果不包含外部原文件绝对路径。

## 实现与限制

- 仅绑定 IPv4 `127.0.0.1`；校验 Host、Origin、访问令牌，拒绝跨站请求。不支持局域网直接监听。
- 暴露计划、课程、资料信息与物理文件夹操作，不暴露 shell、任意文件内容访问或磁盘文件删除。
- 服务使用正在运行的应用仓库及原有原子保存、校验、重复投影和物理目录事务；文件移动与索引保存失败时回滚，不直接写 JSON 索引。
- 支持 MCP `2025-11-25`、`2025-06-18`、`2025-03-26`，更新版本初始化时协商至支持的版本。实现参考 [MCP 2025-11-25 传输规范](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) 和 [工具规范](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)。
- HTTP 无会话、无 SSE：POST 返回 JSON 或 202；GET/DELETE 返回 405。请求使用 Content-Length（stdio 桥接自动设置），暂不支持 chunked request、压缩请求体、HTTP 批量 JSON-RPC。单请求最多 1 MiB、最多 32 个并发连接、15 秒连接超时。
- `--data-dir` 隔离启动默认不启动 MCP，避免测试资料库抢占正式端口。开发测试可创建独立 `MCPController` 并提供临时配置路径。stdio 入口也支持 `--config /absolute/path/config.json`。

</details>
