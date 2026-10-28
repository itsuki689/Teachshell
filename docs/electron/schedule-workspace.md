# 计划页的统一日历工作区

2026-10-28 复核：月/周/日仍共享工作区；右上角刷新只重读当前页面的本地数据，不触发网站同步或重置日期。文件监听仅推进资料库快照，不改变日历选择。下文保留 10 月 26–27 日的交互验收；当前跨平台结果见[验证报告](validation.md)。

本次对照仓库中保留的 Swift `ScheduleWorkspace.swift`、`ScheduleSelection.swift`、`ScheduleMonthView.swift`、`ScheduleAgendaView.swift`、`ScheduleSideAgenda.swift` 和 `PlanPresentation.swift` 实现。Swift 文件和用户资料库不作修改，不改变 JSON schema。

## 视图结构

此前月历、日程位于 `PlansView.vue`，周课表位于 `TimetableView.vue`，各自拥有导航、筛选和右侧栏。切换时会重建整页，周课表还会把选中日期限制在学期内。

现在 `TimetableView.vue` 承担统一日历工作区：顶部 48px 日期导航、中央月/周/日内容、右侧连续的选项与所选日期安排、固定底部新建入口。`PlansView.vue` 专门负责完整计划列表、详情和变更历史。侧栏“计划”返回记忆的日历模式，列表另有明确入口。

| 原生职责                        | Electron 实现                                           | 行为                                                                                |
| ------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| ScheduleSelection               | `src/stores/workspace-ui.ts`、`shared/schedule.ts`      | 三种视图共享日期、学期、课程、状态与固定/活动筛选；切库重置内容选择，仅保存显示偏好 |
| ScheduleData / PlanDisplayEvent | `shared/schedule.ts`                                    | 复用现有计划发生项和课表引擎，统一课程、执行、全天和 DDL 的投影、时间与筛选         |
| ScheduleMonthView               | `src/components/PlanMonthCalendar.vue`                  | 周一开始的 42 格月历；只负责呈现和日期交互，默认显示 DDL，其他安排遵循月历开关      |
| ScheduleAgendaView              | `TimetableView.vue` 的日程区域、`ScheduleEventRows.vue` | 当天课程与计划按“全天计划、当天截止、时间安排”分组，左对齐标题、时间与说明          |
| ScheduleSideAgenda              | 共用右侧栏、`ScheduleEventRows.vue`                     | 三种模式在相同位置显示筛选、当天详情和待安排计划；内容独立滚动，新建入口保持可见    |
| 周课表                          | 原有时间轴与调课逻辑                                    | 保留固定安排锁定、拖拽、缩放、键盘调整、课程列表、停课及调课恢复                    |

## 日期和交互约定

- 月、周、日切换只改变显示范围。日期导航分别移动一个月、一周、一天；月末进入短月时落在该月最后一天，严格拒绝无效日期。
- 有开学日期的学期使用真实日期。跳到学期之外仍显示本地计划，不自动回到第一周或最后一周；课程仍由原课表引擎限制在有效学期内。日程切换日期后回到当天摘要，避免保留前一天的滚动位置。
- 无开学日期的学期保留独立周次和按星期排列的课程摘要，不虚构课程日期。设置开学日期后，课程才能进入真实月历和日程。
- 月历支持方向键跨日/跨周，并在跨月后保持键盘焦点；双击日期进入该日的日程。小窗口按单元格可用空间显示条目数量，六行始终留在内容区内。
- 跨午夜执行按每一天裁切显示，结束于次日零点显示 `24:00`。裁切片段不提供拖拽/缩放，以免将整条计划误写成当天片段；双击编辑完整计划时间。
- 日历底部新建沿用选中日期及课程筛选，默认待安排且不要求标记完成；更多菜单可创建“空”或全天安排。顶栏与完整列表仍保留通用新建入口。单次重复计划编辑、完成、取消继续通过原有主进程 API 落盘。
- 取消的发生项不投影到时间轴，可在右侧筛选结果或计划列表中查看；归档和变更恢复保留在完整列表中。

## 验证入口

在 `desktop/` 中运行 `npm test`、`npm run build`，以及 `node tests/schedule-workspace.e2e.mjs`。新单元用例使用原 Swift schema 9 fixture 验证停课、调课、课程月历开关、学期筛选及事件时间。窗口测试使用隔离临时资料库，验证实际 renderer、preload、主进程和 JSON 写入，不接触安装版的资料库。

窗口检查覆盖 1260×800 浅色及 1020×680 深色：月/周/日切换、公共栏位置与高度、42 格边界、日期记忆、共享筛选、学期外计划、跨午夜裁切、键盘跨月、选定课程新建、未关联日期的周次。相关既有测试继续覆盖重复计划编辑和恢复、分钟拖拽、布局、明暗模式及下拉框键盘操作。

2026-10-26 本机结果：业务测试 314/314 通过；8 组相关窗口测试合计 89 项通过，其中新增日历工作区 8 项、原有主流程 28 项、拖拽 9 项、页面布局 6 项、外观 10 项、状态记忆 8 项、下拉控件 9 项、顶栏反馈 11 项。`npm run build`、修改文件格式检查及 `git diff --check` 通过。窗口无相关运行时错误；编译仍有既有 Keychain 辅助程序的 macOS 废弃 API 警告。

以上为 2026-10-26 的历史验收；2026-10-27 已补齐自由课程详情、每周时段编辑与撤销，见下节。Windows/Linux 的原生日期选择器外观和窗口渲染未在本机验收。

## 2026-10-27：课程交互补齐

本轮额外逐项阅读 `ScheduleMeetingSheet.swift`、`ScheduleEditSheet.swift`、`ScheduleWeekView.swift` 和 `LibraryRepository+Timetable.swift` 的实际实现。保留月历单击选择、方向键导航和双击进入日程，不引入与原生不符的格内按钮。

- `ScheduleMeetingDetails.vue`：月、周、日共用完整课程详情；显示周次、教师、地点、课程编号、备注及原调课日期。可打开课程资料、新建关联作业、停课、还原调课、切换月历显示和设置时段颜色。关联作业默认待安排、需要标记完成，采用所选日期与课程。
- `ScheduleMeetingEditor.vue`：区分“仅这次课”和“每周时段”，两个范围的草稿独立保留。支持日期/星期、节次、地点和周次网格；空周次与无效节次不能保存。未定时及未关联日期课程仅提供每周编辑，不虚构一次上课。关闭有改动的表单会确认丢弃。
- `shared/schedule.ts`：自由课程遵循学期、周次、课程、固定来源与关键词筛选；三种模式右侧栏均可打开。无开学日期的星期摘要也可点击编辑。
- `TimetableView.vue` / `TaskEditor.vue`：新建待安排、“空”和全天安排使用各自的原生默认值；空白时间轴拖动创建十分钟网格对齐的时间段，跨列、Esc、失焦或资料库变化取消；键盘聚焦列后 Enter 也可新建。快捷调课/还原后选中实际目标日。计划颜色继承与月/日视图一致。右侧计划行可标记完成/恢复。
- 主进程课表服务：每周时段更新按 Swift 规则重设保留周次中的调课/停课源日期；调课目标、移出周次的例外及未知兼容字段保留。颜色同时更新主时段、调课与停课内的调课快照；恢复继承移除 override。删除仅移除该时段和调课、清空历史停课的恢复快照，保留课程/课件/计划。
- Repository / IPC / preload：新增操作均严格校验参数、发送窗口、资料库与 revision。课表修改保存一份主进程内的撤销快照；撤销只恢复课表字段，保留期间新增的计划/资料。检测到课表改变时拒绝过期撤销；此记录仅存在本次应用会话，不写入 Swift JSON。

### 可重复验证

```sh
cd desktop
npm test
npm run build
node --experimental-strip-types tests/schedule-interactions.e2e.mjs
TEACHSHELF_TIMETABLE_INTERACTIONS=/tmp/schedule-interactions.json node --experimental-strip-types --test tests/schedule-interactions.test.ts
python3 scripts/verify-swift-schedule-interactions.py /tmp/schedule-interactions.json
```

`verify-swift-schedule-interactions.py` 编译未修改的生产 Swift 核心，在临时资料库内执行五种实际 mutation，比较 TypeScript 和 Swift 的完整课表结果，而非只比较 UI 文字。Windows/Linux 上不运行此 macOS Swift 差分脚本。

本轮 macOS ARM64 全量业务测试 322/322 通过；生产 Swift 差分 5/5。9 组相关窗口测试共 101/101 通过（新增交互 12、日历工作区 8、拖拽 9、外观 10、主流程 28、逐页布局 6、状态记忆 8、下拉控件 9、顶栏反馈 11），检查 1260×800 浅色及 1020×680 深色，无 renderer 运行时错误。`npm run build`、修改文件格式检查和 `git diff --check` 通过。新增窗口用例覆盖详情、周次/单次草稿、时段颜色、未定时课程、关联资料/计划、移除及撤销、默认新建/全天/空档、拖动取消、未保存确认、IPC 非法/过期参数、未关联日期及最小深色窗口。Browser 插件不可用，采用实际 Electron + Playwright，所有测试资料均来自临时目录。

### 边界

课表撤销为本次会话的最近一次课表变更；计划的变更恢复仍通过原有列表/历史功能，此轮未新增日历侧栏统一撤销入口。未迁移 macOS 系统专属日期弹出控件或宣称像素级完全等价。真实学校账号与 Windows/Linux 桌面验收不属于本轮本机测试。Release 安装按 `AGENTS.md` 执行，仅更新 Teachshell，原生课屿和用户资料库不修改；安装回执位于被 Git 忽略的 `desktop/release/installed-macos.json`。
