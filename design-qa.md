# Codex Halo 使用统计视觉 QA

## Source visual truth

- `artifacts/source-weekly.png`：用户提供的 Codex Weekly 状态图。
- `artifacts/source-cumulative.png`：用户提供的 Codex Cumulative 状态图。
- `artifacts/source-overview-models.png`：用户提供的 Codex Overview / Models 产品方向参考。

## Implementation evidence

- `artifacts/usage-stats-overview.jpg`
- `artifacts/usage-stats-weekly-hover-stable.jpg`
- `artifacts/usage-stats-cumulative-hover-stable.jpg`
- `artifacts/usage-stats-models-hover-stable.jpg`

## Viewport and state

- Viewport：`420 × 704`，覆盖真实 `384 × 668` 详情面板及外部画布。
- Locale：English，用于逐字比对截图中的日期、范围和 tooltip 结构；中英文文案均有单元测试覆盖。
- Data state：开发环境专用确定性 fixture；正式入口不会注入 fixture 或伪造数据。
- Overview：Weekly 与 Cumulative 分别选中并悬停有效周。
- Models：Last 30 days 选中并悬停有数据日期。

## Full-view comparison evidence

同一视觉检查输入中依次放入每组 source 与 implementation：Weekly、Cumulative、Overview/Models。完整面板截图确认标题栏、一级/二级标签、摘要指标、图表、输入/输出汇总和隐私说明在窄面板中均未裁切、溢出或相互遮挡。

## Focused region comparison evidence

- Weekly：确认 53 个周列、每列 7 个离散格、从底部向上填充、Aug–Jul 月份轴和 `tokens on week of …` 精确提示。
- Cumulative：确认包含可视区之前的历史 Token，周累计只增不减，阶梯形从底部填充，并使用 `tokens through week of …` 精确提示。
- Models：确认折线、纵向十字线、模型点、当日总量和逐模型精确数值同时出现；图例和输入/输出汇总颜色一致。

## Findings

- Typography：沿用项目现有 macOS 系统字体、紧凑字号与字重层级；无新字体依赖。
- Spacing and layout：窄面板中五项摘要采用 3+2 网格，图表与汇总卡片保持统一 10px 间距；无横向滚动或裁切。
- Color：保留 Codex Halo 既有克制蓝灰色，而非复制参考图的高饱和蓝；正常信息仅使用两种模型色和一套中性色。
- Content：仅展示本地索引能够证明的总 Token、峰值日、会话、连续天数、模型、输入和输出；未伪造 longest task、插件或 skills 数据。
- Responsiveness：420×704 通过；组件宽度使用容器布局，在当前 Tauri 详情面板宽度内完整显示。
- Accessibility：Overview/Models 使用 tab 语义，Daily/Weekly/Cumulative 使用 pressed 状态；Models 图表支持 Tab 聚焦以及左右方向键、Home、End 浏览日期。
- Interaction：Weekly、Cumulative、Models 范围切换与 pointer tooltip 均通过；浏览器控制台无 warning 或 error。
- Intentional adaptation：参考图是宽屏统计页，本实现是 macOS 菜单栏窄面板，因此保留数据结构和交互语义，不照搬宽屏留白与高饱和配色。

## Comparison history

1. P2：首次 Overview 截图中，可视年份开头的部分月份标签与下一个完整月份过近。已调整月份标签生成规则，跳过不足四周的首个部分月份；复查后 Aug–Jul 间距清晰。
2. P0/P1/P2：复查 Weekly、Cumulative 和 Models 完整状态后无剩余问题。浏览器首次截图偶发黑色捕获块属于截图工具重绘现象；在 DOM、状态与控制台均不变时二次捕获恢复正常，最终证据使用稳定截图。

## Primary interactions tested

- Overview / Models 标签切换。
- Daily / Weekly / Cumulative 状态切换。
- Weekly 与 Cumulative 活动列悬停。
- Models 日期点悬停。
- Models 键盘焦点、左右方向键、Home 与 End。
- 详情面板统一刷新入口的 loading/disabled 状态。

## Console check

- Errors：0
- Warnings：0

final result: passed
