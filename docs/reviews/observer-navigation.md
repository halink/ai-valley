# 观察导航边界独立审查

2026-11-11，审查未提交的 `ObserverNavigation`、通用 `ObserverRendererPort`、`main` 接线、`ValleyScene` 和选择类型解耦候选。未修改生产文件或原赠食候选。

## 结论

本轮未发现阻断合入的行为回归。该候选是页面内观察状态和固定 renderer 端口的最小拆分，不是东方山居手绘素材、新 renderer 或视觉验收，也不支持热替换 renderer。2D 仍是默认视图；唯一 GET/SSE 数据源的所有权仍在原客户端，未新增传输、存储或模拟写入。

- 普通跨房间跟随先完成原2D房间准备、记录并通知房间，再通知跟随，最后由主客户端发布快照。可选观察器仍读取同一最新快照。
- 新世界重置保留原有 `follow(null) → room(null)` 顺序，而非普通路径的 `room → follow`。审查提出的注释范围建议已修正：生产注释现限定普通跟随路由，并明确新世界先清跟随、再清房间，避免依赖错误的全局顺序。
- 清除可选 resolver 仍通过 scene 立即按真实快照重验2D跟随并重新居中；死亡或已停止状态不会被 resolver 恢复。房间 ID 只在 renderer 准备后提交，仍不从计划或目的地推断进入。
- 跟随 getter 和逐 listener 通知各自复制状态，adapter 复制坐标与选择，减少观察消费者意外污染。冻结合成世界回归通过。
- scene 仍拥有物理镜头、房间绘制与控制动作；主界面的若干跟随入口仍直接调用 scene。这是此次有限边界，不应声称完全 renderer 无关。外部 resolver 是受信任的本页展示代码，并非可运行不可信插件的隔离边界。
- 普通更新时 listener 抛错仍可能打断后续通知，维持原行为；初始订阅抛错现在清理订阅。这不是本次新回归，也未增加事件异常隔离承诺。

## 独立验证

新增 `tests/observer-navigation-review.test.ts`，执行6项并全部通过：冻结世界与状态复制、失败订阅清理和取消订阅、无效房间拒绝、端口坐标/选择复制和停止顺序、真实 scene 的房间/跟随通知及去重、resolver 退出和死亡保护、新世界重置顺序。

命令为 `node --import tsx --test tests/observer-navigation-review.test.ts`；HOME/TMPDIR/TMP/TEMP 均指向本仓库 `output/observer-state-decoupling/review-tmp/`，日志在同级 `observer-navigation-review.log`。

scene 验证使用真实源码转译和轻量绘制替身，仅证明所测控制流，不代表 Phaser、DOM、浏览器或截图像素验收。未跑全仓测试，未运行浏览器、bwrap、模型或网络请求，未读密钥、环境文件或真实 runtime 存档。父任务最终集成报告：7套定向测试77/77通过（含本次6项），`tsc --noEmit`、服务端 TypeScript 编译及禁用配置文件和环境文件加载的 Vite 构建通过；仍有500kB包体警告。全仓测试因无法满足所要求的操作系统级无网与敏感路径隔离而明确未运行。上述集成结果由父任务提供，本审查未重复执行。
