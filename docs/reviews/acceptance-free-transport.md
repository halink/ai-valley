# 单一免费候选 transport 离线契约独立审查

## 范围与边界

审查 `src/server/acceptance-free-transport.ts`，独立反例位于 `tests/acceptance-free-transport-review.test.ts`。全部使用本地合成价格、批准、响应、账单与时钟；没有读取 `.env`、凭据或正式 `runtime` 存档，没有联网、调用模型、提交或推送。

此模块尚未接入真实 runtime 或生产决策解析。只能发送固定合成 probe，使用内存 transport；固定 DeepSeek / SiliconFlow 精确端点不是可用性验证，也不构成发送游戏数据或真实运行的授权。真实费用始终 `null`，真实取消未确认，`readyForRealRun=false`，`acceptancePassed=null`。

## 发现并复验的缺口

初次独立测试证实三项失败，由实现者修复后原断言全部通过：

1. gate 持久化回调可以重入 execute，在 gate 确认保存前派发。现在 `starting` 阶段阻止该入口，收到同步确认后才进入 `ready`。
2. 请求定时器清理抛错后仍可返回成功决策。现在失败关闭，不增加接受计数。
3. 定时器清理回调重入停止后仍可返回成功决策。现在先撤销 armed 标志，清理后重新核对当前请求与阶段。

另独立验证响应头及正文含 `then` getter 时，内存 promise 不执行 getter，也不将其吸收为异步结果；分别失败关闭为响应或正文无效。

## 独立覆盖

- 伪造、克隆及 Proxy 包装不能冒充内存 transport 品牌。
- 输入、输出、推理、每请求及其他费用任一非零，均门前拒绝。
- 提供商、精确端点、模型、账户与数据范围不一致均拒绝。
- gate/派发证据先确认，响应模型与费用事实保存后才解析正文；证据失败不能返回成功决策。
- JSON 损坏、错模型及缺失账单字段不会把未知费用伪造为零；已知合成收费在失败时仍保留。
- 单并发、请求超时、晚到响应和重复执行不能触发第二次派发、重试或回退。
- 响应 getter 与 then getter 不执行。

## 复现

在 Linux 工作树、已安装本地依赖下：

```sh
NODE=$(command -v node)
env -i "$NODE" --import ./scripts/acceptance-offline-guard.mjs \
  --import ./node_modules/tsx/dist/loader.mjs --test \
  tests/acceptance-free-transport-review.test.ts tests/acceptance-free-transport.test.ts

env -i "$NODE" --import ./scripts/acceptance-offline-guard.mjs \
  ./node_modules/typescript/bin/tsc --noEmit
```

2026-11-08 专项结果：主测试25例、独立反例30例，合计 **55/55通过**，无跳过或取消。同次空环境、guard 预载的完整 TypeScript `tsc --noEmit` 检查退出0。本批未重跑全项目测试，不沿用历史测试计数充数，也未改动世界逻辑或生产路由。旧 acceptance 组会自行 mock `fetch`，与 strict guard 的不可改写属性不兼容；因此本报告仅对上列55例声明 strict guard 下通过，其他组由实现者单独记录执行结果。这不是全仓库测试通过声明。guard 是可信本地代码的防误用措施，不是恶意代码的操作系统沙箱；同步阻塞和远端取消仍不能由此契约证明。

## 实现者最终相关回归与构建

2026-11-08，最终源码快照后完成：

- 全部12个 `tests/acceptance-*.test.ts` 文件在空环境、`--test-concurrency=1` 下 **210/210通过**，0 failed、0 skipped、0 cancelled，86,673ms。覆盖原writer、集成、停止、外部进程、公开离线入口及本批55例，包含manifest新元数据与原Qwen方案不变断言。
- 旧组的网络保护沿用它们自己的禁网/假fetch与公开入口子进程guard。最初尝试为全部旧测试也预载不可重定义fetch的guard，得到160通过、48个测试夹具初始化失败（`Cannot redefine property: fetch`）；未修改或削弱guard。该失败尝试不记作通过。新契约55例另在严格guard下通过，如上所述。
- 完整 `tsc --noEmit` 通过；服务端 `tsc -p tsconfig.server.json` 在空环境+guard下通过。
- Vite API `build({envFile:false})` 在空环境+guard下通过，196模块、6.50秒。仅构建进程沿用安全的 `fs.realpathSync.native=fs.realpathSync` 别名以兼容guard，没有读取环境文件或移除路径/网络限制。既有500kB以上chunk警告仍在，主包约1,424.95kB，未声称解决。
- `git diff --check` 及新增文件行尾空白检查通过。

没有运行 `tests/*.test.ts` 的全项目全集，不把210项相关回归或历史4671项代称本批全量。未提交、推送或部署。本批只证明离线契约边界，不证明实际提供商免费、真实HTTP可用、远端取消或九人十五日生活验收。
