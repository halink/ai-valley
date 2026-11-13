# Godot Web 架构

## 职责边界

新版唯一用户入口是浏览器中的 Godot 3D 客户端。浏览器负责画面和观察操作；Node 后台负责世界状态、行动合法性与结算。Godot 编辑器用于制作与导出，不代表原生桌面交付。

| 目录 | 当前职责 |
| --- | --- |
| `godot-client/` | 3D 场景、材质、中文 UI、只读快照显示和 Web 导出配置。 |
| `src/world/` | 复用的模拟与行动执行，包括寻路、需求和资源结算。旧有功能不自动计入 MVP。 |
| `src/shared/` | 后台与观察客户端之间的数据契约。 |
| `src/server/` | MVP 世界、只读 HTTP、Web 静态入口，以及独立的存档/模型接线。 |
| `scripts/`、`tests/` | 构建、隔离测试及回归工具。 |

## 当前规则 Web 入口

`npm run build:godot:web` 导入 Godot 源资源并产生 `output/godot-web/`。Web preset 使用 Compatibility、单线程和 WebAssembly，关闭 PWA；不依赖 SharedArrayBuffer 或跨域隔离响应头。

`npm run demo:godot:web` 启动 `godot-web-main.ts`，创建独立的两居民规则世界。HTTP 服务只监听 `127.0.0.1:3414`，只提供导出文件白名单及同源 `/ai-town/api/world` 快照。客户端从页面 origin 读取快照，不把访问者的 localhost 当远程服务器地址。它不开放行动控制接口或通配 CORS，不静态暴露仓库、密钥或存档。

规则选择提出行动，`submitPlan` 和 `stepWorld` 验证并执行路程、耗时、资源与需求变化。Godot 读取实际移动记录、行动及房间位置；缺失或不连续的移动不由客户端猜测。刷新页面不重置后台，后台重启则重建临时世界。

默认 `dev` / `dev:web` 也指向规则 Web 服务。`build` 只进行 TypeScript 检查与后台编译，`start` 运行编译后的该服务；Web 资源的导出是独立的显式步骤。

## 持久化与模型：独立、同源只读 Web

`godot-mvp-persistent.ts` 使用 `WorldStore`、`ValleyRuntime` 及显式主/备用模型配置边界。该服务与规则 Web 演示不同，不应通过默认演示命令隐式加载真实模型或存档。

现有持久服务使用 Linux 专用存档锁；只在后台 Linux 主机上要求这些能力，不能把此限制称为 Mac 浏览器不兼容。持久入口通过与规则服务相同的白名单提供同源页面和快照；启动前检查导出，失败时不打开存档或发起模型请求。实际浏览器验收、公开部署与访问控制尚待完成。模型凭据只留在服务端，不进入快照、浏览器包或日志。

## 证据边界

Web 导出、HTTP 契约、规则短测和 headless 检查分别证明工程中的一部分，不互相替代。当前实际浏览器连接另一执行会话中的 loopback 服务被拒绝，尚无真实 WebGL、中文显示与交互验收。真实模型与长期运行也未完成验收。

详见 [Web 入口](godot-web-mvp.md)、[Godot 客户端](../godot-client/README.md)、[移动协议](completed-movement-protocol.md)和[迭代路线](godot-migration.md)。
