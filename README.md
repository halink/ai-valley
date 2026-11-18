# 栖谷 / AI Valley

[English](README.en.md)

一个只供观察、由居民自主生活逐步长大的山谷。**新版唯一交付目标是 Godot 3D 浏览器版**，采用手绘风格材质；不交付原生桌面游戏，不考虑移动端。Godot 编辑器是开发和导出工具，不是玩家的安装要求。

每批生活功能与视觉、UI、交互同步交付。

## 当前版本：小世界工程 MVP

当前预览包含四位居民，浏览器可观察山谷全景和建筑内部。Node 后台负责行动与存档。本机有临时与持久两种规则演示；本轮季节世界、避雨与谷灵客观手记均不需模型，当前不启用季节模型外发。[版本、验证范围与后续计划](docs/godot-migration.md#当前版本与证据)

## 本机开发演示

构建需要 Node.js **22.13+**、Godot **4.6.3 stable** 和匹配的官方 Web 导出模板，`godot` 须在 PATH 中。

```sh
npm ci
npm run build:godot:web
npm run demo:godot:web
```

在运行后台的同一台电脑上用浏览器打开 <http://127.0.0.1:3414>，页面自动读取同源世界快照；连接失败时可点击“连接／重连”。这是本机演示地址，不是公开部署地址。浏览器需要 WebAssembly 和 WebGL 2；不要求访问者安装 Godot。详细环境、模板、导出和故障边界见 [Web MVP 说明](docs/godot-web-mvp.md)。

### 持久规则小山谷（无模型）

在已导出 Godot Web 的同一台电脑用专用演示存档启动（不要复用正式存档）：

```sh
VALLEY_MVP_RULES_DB="$PWD/runtime/rules-demo/world.sqlite" npm run dev:web:rules:persistent
```

浏览器打开 <http://127.0.0.1:3416>，可选居民查看当时本人户外感受、行动及共屋情况。下雨时，部分本来无事且有余力、能在原闲等时间内完成行走和短候的居民可能步行入内避雨。页面仅供观察，不派遣居民；规则演示不是模型决定，室内也不展示臆造的本人户外体感。

`npm run dev`、`npm run dev:web` 与 `npm run demo:godot:web` 是同一规则 Web 服务入口，不必同时启动。`npm run build` 仅做 TypeScript 检查与后台编译，之后 `npm start` 启动编译后的同一服务；Web 资源仍须单独执行 `npm run build:godot:web`。这些命令都不是持久模型启动入口。

## 当前验收约定（2026-11-16）

当前每个增量由开发侧驱动规则模式实际运行 30 分钟，未发现问题则按实际覆盖范围验收通过；不再进行模型驱动测试，不铺设无用或重复的测试套件；关键问题可保留必要的最小复现与验证，但不能替代实际 30 分钟规则运行或另列的浏览器核查。记录起止时间、真实时长、推进速度及覆盖范围。浏览器画面另行核查；加速规则推进、构建成功或分段浏览器观察都不能冒称浏览器连续运行 30 分钟，也不代表长期稳定性。

## 线上运维与验证记录

持久服务使用 Linux 本地 SQLite。配置优先级、停模核验、存档备份和版本回滚见[运行配置](docs/configuration.md)及[线上运维手册](docs/deployment.md)。各批构建、浏览器与规则运行的实测范围见 [Web MVP 记录](docs/godot-web-mvp.md)。

## 开发与设计

- [贡献指南](CONTRIBUTING.md) · [架构](docs/architecture.md) · [美术与许可](docs/art.md)
- [小版本路线](docs/godot-migration.md) · [设计资料](docs/design/README.md)

先完成最小可行闭环，再逐版增加玩法和地图。用户提供的概念图保留为参考，不强制沿用旧 2D/2.5D 方案。每批同步代码、构建结果、review 与文档，核实提交和远程同步状态。

密钥、实际存档、日志、缓存和导出产物不得提交；项目源码采用 [MIT](LICENSE)，第三方字体等遵循各自许可。
