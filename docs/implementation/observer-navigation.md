# 观察状态与渲染器的最小边界

本批为后续贴图式2.5D展示准备接口，不实现新美术、贴图加载或新场景。原2D仍是默认；旧等距观察、房间、跟随与回退保留。世界、行动、模型、存档与观察协议均未改动。

## 分工

- `ObserverNavigation` 是主页面创建的内存状态：保留已提交的观察房间、原 `ResidentFollow` 状态、可选展示 resolver，以及房间/跟随订阅。不依赖 Phaser、DOM、网络或存储。每个观察页面使用独立实例。
- `ObserverRendererPort` 只提供取镜头位置、定位、停止跟随、切换 resolver 和遮盖/恢复渲染。`currentTile` 与 `frame` 使用谷内逻辑格，不能传入屏幕像素或室内格；观察室内时沿用原建筑门点。真实像素镜头、缩放、室外镜头备份和插值仍由 renderer 管理，避免假设新旧投影能共用物理坐标。
- `createObserverMap` 组合原快照源、共享导航状态、固定 renderer 端口和页面选择回调。它不创建连接、缓存第二份世界或加入行动命令。`ObserverSelection` 定义移到这个边界，旧 `SceneSelection` 仅保留兼容类型别名。
- `main` 仍是唯一初始世界 GET 和 SSE 所有者。原版本核对、增量合并、重连及 `snapshot=next` 先于场景处理的顺序不变。档案/历史等独立只读查询也不受影响。

`ValleyScene` 接收同一 `ObserverNavigation`。场景内部的 `roomId` 只表示已经准备的绘图坐标空间，完成原房间准备后才把实际房间 ID 交给共享状态并通知；导航状态拒绝当前世界不存在的房间。跟随事实仍由原 `ResidentFollow` 和原快照解析，不从住处、计划、目的地或概念图推断。

## 顺序与回退

普通跨房间跟随保留「准备房间 → 房间通知 → 跟随通知 → 快照通知」。新世界重置另行保留原有「清跟随 → 清房间」顺序。原场景负责在新世界清理渲染资源与页面导航；单独使用导航对象的新 renderer 也必须实现这一步，不能把它当作自动世界生命周期管理器。

清除可选 resolver 必须经过 renderer 端口，立即按当前真实快照重验原2D跟随并恢复对应镜头。死亡、离谷、位置未知、房间不可用、主动停止等判定仍用原逻辑；已停止的目标不会因重新出现或切回2D而自动恢复。遮盖时原场景循环睡眠、交还时唤醒以及工作反馈清理均保留。

跟随 getter 和各通知消费者分别收到状态副本；跨端口的镜头坐标和选择也复制，防止调用者改写共享导航或输入坐标。初次订阅抛错会撤销该订阅，取消订阅可重复执行。快照仍是原只读共享对象，不额外深拷贝世界。普通更新的 listener 异常传播保留旧行为；这不是不可信插件隔离机制。

## 明确未完成

- 不是完整的 renderer 替换：主界面部分地图命令仍直接调用旧场景，房间绘图与物理镜头也仍在旧场景。下一批可以用这个端口接新 renderer，但须另行迁移这些入口。
- 不提供运行中热替换 renderer、自动故障转移管理器或跨刷新持久化镜头。端口为固定绑定，不承诺在两个场景同时写共享导航时保持一致。
- 没有新共屋、成人/少年素材、图集、手绘视觉、生产帧动画或性能结果。图片与新设计尚未完整集成本地，不能据本批宣称视觉方案完成。
- 没有浏览器、触摸、GPU或真实存档验收。未重试已拒绝的浏览器/IPC或操作系统隔离路径，也不推送。

## 验证

新增 `tests/observer-navigation.test.ts` 覆盖无 Phaser renderer 端口、同源快照/断线、房间与跟随事实、不可变输入、状态副本、取消订阅、原场景接线和无新增网络入口。独立的 `tests/observer-navigation-review.test.ts` 覆盖通知顺序、原 resolver 撤回、死亡保护、新世界重置及边界副本。详见[独立审查](../reviews/observer-navigation.md)。

所用夹具均为合成世界；执行真实场景方法的测试使用绘制替身，不是浏览器验收。最终专项、类型与构建结果见本文件末尾。本批不运行全仓历史测试：当前无法为全套提供要求的无网/敏感路径操作系统隔离，不降低门槛或把专项当成全仓通过。

本批所有工具临时资料、日志和构建输出均在本仓库已忽略的 `output/observer-state-decoupling/`。现有 `.gitignore` 已覆盖，无新增项目副本。原5个未提交赠食候选在改动前后分别核对 SHA-256，保持原样。

### 2026-11-11 最终专项结果

- 7个文件共77项测试全部通过，无失败、取消或跳过：两个新 navigation 测试，及 `resident-follow`、`isometric-follow-route`、`isometric-formal-entry`、`isometric-observer`、`isometric-observer-review`。
- `node node_modules/typescript/bin/tsc --noEmit` 通过，包含新增独立测试。
- `node node_modules/typescript/bin/tsc -p tsconfig.server.json --outDir output/observer-state-decoupling/server-build` 通过，不启动服务。
- 通过 Vite API 构建，显式 `configFile:false`、`envFile:false`、`base:'/ai-town/'`，输出到 `output/observer-state-decoupling/client-build`，不读取环境文件。仍有既有的超过500 kB分块警告，不能据此声明性能达标。
- `git diff --check` 与5个原赠食候选的 SHA-256 核对通过。未提交、推送、运行正式入口或读取真实存档。

定向测试的可复现命令（先创建仓库内工具目录）：

```sh
mkdir -p output/observer-state-decoupling/tools
TMPDIR="$PWD/output/observer-state-decoupling/tools" \
TMP="$PWD/output/observer-state-decoupling/tools" \
TEMP="$PWD/output/observer-state-decoupling/tools" \
node --import tsx --test \
  tests/observer-navigation.test.ts tests/observer-navigation-review.test.ts \
  tests/resident-follow.test.ts tests/isometric-follow-route.test.ts \
  tests/isometric-formal-entry.test.ts tests/isometric-observer.test.ts \
  tests/isometric-observer-review.test.ts
```
