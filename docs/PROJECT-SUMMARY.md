# Codex Halo 项目简介

## 一句话定位

Codex Halo 是一个 Tauri 2 桌面额度与本地使用统计工具，用本机 Codex Desktop 登录态只读查询 Codex 额度，并通过 macOS 菜单栏、详情面板和悬浮窗同步展示接口当前提供的额度窗口、重置时间、重置机会和会员类型；按需统计本机 Codex 已记录的日期、模型和 Token 计数，提供 Overview 热力图与 Models 趋势页。

## 当前技术栈

- 前端：React 19、TypeScript、Vite、Phosphor Icons。
- 桌面壳：Tauri 2、Rust。
- 网络：Rust `reqwest` 调用 ChatGPT 后端只读额度接口。
- 测试：Vitest 覆盖前端格式化与快照合并逻辑；Rust 覆盖 Codex 响应解析逻辑。

## 主要功能

- macOS 菜单栏：按接口实际窗口直接显示紧凑的 `W` 或 `5h / W` 剩余比例，右侧 `↻` 可直接刷新，点击额度主体打开详情面板；Windows 使用托盘图标、tooltip 和原生菜单降级。
- 悬浮额度卡片：100×100 透明窗口承载 84×84 悬浮球，悬停后展开为 344×364 透明窗口内的 328×348 卡片，动态展示 Codex 当前返回的额度窗口、重置时间、重置机会和明确状态。
- 详情与设置：支持刷新、额度刷新周期预设/自定义/仅手动、显示/隐藏悬浮窗、置顶、鼠标穿透、开机启动、语言切换和退出；详情面板任一页面的手动刷新会同时更新额度与本地统计。
- 统一数据流：Rust 持有唯一额度状态、刷新锁和调度器，菜单栏、面板及悬浮窗通过同一事件同步，前端不创建独立轮询。
- 自适应刷新：默认 5 分钟，支持 10 秒、30 秒、1/5/10/30 分钟预设、10 秒至 24 小时自定义以及仅手动模式；较慢周期在重置边界附近加速到 1 分钟，失败采用 30 秒至 30 分钟的有界指数退避；手动刷新 5 秒防抖且请求串行。修改周期从保存时重新计时，不立即发起请求。
- 本地使用统计：Overview 提供总 Token、峰值日、会话、连续使用与 Daily / Weekly / Cumulative 活动图；Models 提供 7 天、30 天、全部时间的模型曲线、精确悬停值及输入/输出占比。本地统计无后台定时器，打开超过 60 秒后按需增量更新，或随详情面板手动刷新更新。
- 跨平台构建：同一套前端 UI/动效代码输出 Windows unsigned 包和 macOS Universal unsigned 包。
- 状态兜底：接口失败时保留上次成功数据并标记 stale；超过 30 分钟后停止展示旧数值；登录失效、限流、接口变形会给安全提示。
- 重置卡到期提醒：摘要展示最早到期时间，并对剩余 3 天、2 天、1 天逐级调整文案和提示色；详情逐张展示使用期限，缺失日期时明确标记未知。
- 偏好保存：悬浮窗可见性、锁定状态、置顶状态、固定 provider、轮播间隔、额度刷新周期和语言写入 Tauri app config 目录，带 `.bak` 备份恢复；旧配置缺少刷新字段时自动使用 5 分钟默认值。
- 预留扩展：类型层已有 `codex | claude` provider 结构，但当前只启用 Codex。

## 关键文件

- `src/App.tsx`：订阅 Rust 统一状态，处理启动 hydration 竞态，并把相同数据分发给悬浮窗和详情面板。
- `src/components/FloatingWidget.tsx`：悬浮窗展开、收起、拖动和窗口几何命令协调。
- `src/components/MenuPanel.tsx`：菜单栏详情面板及桌面设置。
- `src/components/QuotaCard.tsx` / `QuotaMetrics.tsx`：悬浮球、展开卡片、额度指标和完整异常状态。
- `src/lib/bridge.ts`：Tauri command/event 桥接；正式入口在非 Tauri 环境中明确失败，不伪造额度。
- `src/lib/format.ts`：额度百分比、健康档位、重置时间和 stale 过期格式化。
- `src/lib/snapshots.ts`：前端事件合并的兼容保护。
- `src/lib/usage.ts`：本地统计的日期范围、每日/每周/累计活动序列及模型汇总派生。
- `src/components/UsageStatsPanel.tsx`：Overview / Models 统计视图、键盘导航和精确悬停提示。
- `src-tauri/src/codex.rs`：读取本地 Codex auth、拼接请求头、调用额度与 reset credits 接口、解析响应。
- `src-tauri/src/usage_stats.rs`：只读增量扫描本机 Codex JSONL，保存不含正文的聚合索引。
- `src-tauri/src/lib.rs`：唯一额度状态、刷新节奏与锁、菜单栏/托盘、详情面板、窗口生命周期和偏好持久化。
- `src-tauri/src/geometry.rs`：多显示器、负坐标、工作区、边缘吸附和展开/收起几何。
- `.github/workflows/release.yml`：生成 Windows unsigned 和 macOS Universal unsigned 发布包。

## 数据与安全边界

- 只读取本机 Codex 登录文件，默认路径来自 `CODEX_HOME` 或用户目录 `.codex/auth.json`。
- 不复制 token，不上传 token 到第三方，不记录原始接口响应。
- 请求头里的 token 与账号 ID 视为敏感信息。
- 接口响应限制为 1 MB，auth 文件限制为 256 KB。
- 不兑换重置机会，不修改账号设置。
- Codex 额度接口不是公开稳定 API。字段或认证变化时应显示不可用，不应猜测额度。
- 额度窗口按响应中的时长优先识别；临时仅提供周窗口时不渲染虚假的 5 小时占位，后续 5 小时窗口恢复后自动回到双窗口展示。

## 运行与验证

```bash
npm install
npm run dev
npm run test
npm run build
npm run tauri dev
```

正式入口不会使用 mock 数据；仅开发环境的 `?designer` 视觉工作台包含显式 fixture。真实额度读取只能在 Tauri 桌面环境中验证。

## 维护重点

- 用真实 Codex Desktop 登录态做 Tauri 集成验证，尤其是登录过期、401/403/429、断网、响应字段变化。
- 确认菜单栏文本、详情面板定位、悬浮窗锁定穿透、多显示器恢复、开机启动在 Windows/macOS 的实机行为。
- 后续视觉调整默认只改共享 React/CSS，不维护 Windows/macOS 两套 UI。
- 若启用 Claude provider，先补 provider adapter、类型收敛、轮播/固定逻辑和失败隔离测试。
- 发布前补齐签名、公证、安装包扫描和日志隐私审计。
