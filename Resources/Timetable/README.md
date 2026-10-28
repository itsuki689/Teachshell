# 本科课表导入资源

Electron 复用此解析资源，当前入口为“计划 → 导入课表”；构建复制脚本与授权声明，运行在隔离 Chromium 中。文件监听变更不影响解析协议。当前用法与回归范围见[使用指南](../../docs/usage.md)及[验证报告](../../docs/electron/validation.md)。

`njubksjw2.js` 是随应用打包的南京大学本科课表 DOM 解析器，修改来源及授权见 `NOTICE.txt`、`LICENSE-APACHE-2.0.txt`。仅在官方本科课表地址执行；不发起网络请求，不读取账号、密码或 Cookie。

`Sample-undergraduate.json` 是人为编写的公开示例，不对应任何学生。可通过「课表 → 导入本科课表 → 选择 JSON 文件」离线体验预览、导入与重复导入。

解析结果遵循 ZIP 中原字段：`weeks`、`week_time`、`start_time`、`time_count`。其中 `time_count` 是末节与首节编号的差值，单节课为 0。`warnings` 是本项目新增的预览诊断字段。无法识别星期的时段跳过并显示警告；自由时间保留到「待安排」，不推断上课日期；缺少周次的自由时间不会自动补造周次。

学校网页变更可能影响解析。离线回归测试：`node scripts/test-nju-parser.js`。未使用真实学生账号验收登录与网页 DOM；应用保留人工预览确认。

表格定位会排除外层布局、冻结操作列及通过自身或祖先 CSS/`hidden`/`aria-hidden` 隐藏的副本，只读取各表自身行列。内容完全相同（仅空白不同）的课表副本会合并；不同周次、教室与时段不会合并。仍有多份不同的可见列表时，返回 `{name,courses:[],warnings:[],tables:[{id,rowCount,preview}]}` 交给界面选择。界面通过解析器词法变量 `teachshelfSelectedTableID` 传回选择；ID 由规范化行内容生成，与 DOM 序号无关，内容变化使旧选择失效。
