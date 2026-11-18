> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# Godot Web 架构

## 职责边界

新版唯一用户入口是浏览器中的 Godot 3D 客户端。浏览器负责画面和观察操作；Node 后台负责世界状态、行动合法性与结算。Godot 编辑器用于制作与导出，不代表原生桌面交付。

| 目录 | 当前职责 |
| --- | --- |
| `godot-client/` | 3D 场景、材质、中文 UI、只读快照显示和 Web 导出配置。 |
| `src/world/` | 复用的模拟与行动执行，包括寻路、需求和资源结算。旧有功能不自动计入 MVP。 |
| `src/shared/` | 后台与观察客户端之间的数据契约。 |
| `src/server/` | MVP 世界、只读 HTTP、Web 静态入口，以及独立的存档/模型接线。 |
| `scripts/` | 构建、Web 导出与运行辅助工具。 |

## 当前规则 Web 入口

`npm run build:godot:web` 导入 Godot 源资源并产生 `output/godot-web/`。Web preset 使用 Compatibility、单线程和 WebAssembly，关闭 PWA；不依赖 SharedArrayBuffer 或跨域隔离响应头。

`npm run demo:godot:web` 启动 `godot-web-main.ts`，创建独立的四居民规则世界。HTTP 服务只监听 `127.0.0.1:3414`，提供白名单内的导出文件及同源 `/ai-town/api/world` 快照。客户端根据页面地址读取快照。接口只读，公开文件范围限于 Web 导出。

规则选择提出行动，`submitPlan` 和 `stepWorld` 验证并执行路程、耗时、资源与需求变化。Godot 读取实际移动记录、行动及房间位置；缺失或不连续的移动不由客户端猜测。刷新页面不重置后台，后台重启则重建临时世界。

默认 `dev` / `dev:web` 也指向规则 Web 服务。`build` 只进行 TypeScript 检查与后台编译，`start` 运行编译后的该服务；Web 资源的导出是独立的显式步骤。

## 持久化与模型：独立、同源只读 Web

`godot-mvp-persistent.ts` 使用 `WorldStore`、`ValleyRuntime` 及显式主/备用模型配置边界。该服务与规则 Web 演示不同，不应通过默认演示命令隐式加载真实模型或存档。

持久服务在后台 Linux 主机使用独占存档锁。启动时先检查 Web 导出，再打开存档和启动模型。线上由 Caddy 通过 HTTPS 提供固定版本的 Godot 导出，并在同一公开路径下代理只读快照。模型凭据只留在服务端。[线上部署拓扑与运维](deployment.md)

## 证据边界

当前证据涵盖有限浏览器互动、公开 HTTPS、原存档重启接续及线上真实模型成功响应。完整浏览器覆盖、异常断电恢复、长期生活平衡及正式访问控制仍待验证。既往环境和分项结果见各批记录。[当前版本与证据](godot-migration.md#当前版本与证据)

详见 [Web 入口](godot-web-mvp.md)、[Godot 客户端](../godot-client/README.md)、[移动协议](completed-movement-protocol.md)和[迭代路线](godot-migration.md)。
