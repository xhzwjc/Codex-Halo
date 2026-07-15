# 已知限制

- Codex 数据来自非公开只读接口，字段或认证方式可能变化。
- 当前发布包未签名、未公证；Windows 可能触发 SmartScreen，macOS 可能触发 Gatekeeper。
- macOS Universal 包由 GitHub Actions 的 `macos-latest` runner 构建，不能在 Windows 本机直接生成。
- Claude provider 在 v1 中未启用。
- 重置机会只读取数量和到期时间，不能在应用内兑换。
- 真实额度准确性依赖 Codex 后端返回的窗口数据；应用不会根据本地 token 消耗自行估算额度。
- 使用统计来自本机 Codex JSONL 中已有的时间、模型和累计 Token 字段，不等同于账单或剩余额度；首次建立索引的耗时取决于历史记录体积，后续仅增量读取。
- 额度自动刷新最低允许 10 秒；高频配置会增加请求量、CPU 与电量消耗，服务异常时仍会由 30 秒至 30 分钟的失败退避接管。使用统计不跟随该周期扫描。
- 单个会话内若多个不同模型的代理并发交错，而 Token 事件本身没有模型字段，模型归属会采用该事件之前最近一次 `turn_context`；总 Token 不受此限制。
- CSS 毛玻璃效果在 Windows WebView2 中对桌面背景的支持有限；当前设计优先保证透明圆角悬浮球的一致外观。
- 公开分发前建议补齐 Windows 代码签名、macOS Developer ID 签名和 notarization。
