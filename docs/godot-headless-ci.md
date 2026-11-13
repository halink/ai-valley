# 构建检查与已退出的测试流水线

2026-11-13 按项目所有者要求，TypeScript / Godot 自动化测试、测试夹具和专属测试脚本已移除。旧 `test` / `test:godot` 命令及 headless 合成测试 CI 不再适用。

CI 保留 `verify` 名称，但仅执行 `npm ci` 和 `npm run build`，成功只代表后台编译通过。它不验证 Godot Web 画面、交互或真实模型。

Godot Web 导出仍使用 `npm run build:godot:web`。安装与导出说明见 [浏览器 MVP](godot-web-mvp.md)，日常开发见 [贡献指南](../CONTRIBUTING.md)。长期运行由项目所有者验证。
