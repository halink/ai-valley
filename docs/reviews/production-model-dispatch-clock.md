# 合成请求派发时间观察修复

## 远端证据

CI `43085889459` 第3分片共1434项，1433通过、1失败。`production-model-continuity-review.test.ts:52` 的 sustained 段在 `worker_rehearsal` 被 `request_timing` 拒绝：16笔请求和双账ack完成、runtime已封段、九人覆盖511，但最后一笔 `observedFromCutoffMs=147`、单调钟偏移147.274191毫秒；报告结束为截止后1423毫秒，仍在硬截止前。

旧 worker 在20毫秒 `respond()` 轮询回调中记录请求时间，实际含义是“准备假响应时才观察到已存在请求”。计划20毫秒间隔不是调度上限。它无法区分真正迟派发和合法请求的延迟轮询，因此并非派发时刻证据。该日志没有实际 invoke 时刻，不能断言此次 invoke 必定在截止前；sealed也不是这种证明。

## 最小改动与边界

- 仅在 `createMemoryProductionHttp` 的同步 invoke 入口采样 `Date.now()` 与 `process.hrtime.bigint()`，早于流构造，不读取任何用户时钟、ID或回调参数。
- 私有 WeakMap 将冻结观察记录绑定原请求对象。只读查找不能通过克隆、同ID伪造或跨factory请求取得记录；重复读取/延迟回包不改变时间。
- worker要求对应记录存在，再沿用原请求hash、两账pending、居民身份和单槽验证。没有当前时间回退或倒填。
- `checkSyntheticRehearsal`、真实HTTP路径、准入/价格/预算、30秒预留和恢复条件未改。墙钟/单调钟任一到达准入截止，或者ack顺序/报告期限不符，仍拒绝。

最终准入check与invoke之间虽没有await，仍可能被系统抢占。新记录如证实真正invoke已迟到，原门槛会继续失败；该补丁不掩盖此情况，也不宣称消除了所有CI调度问题。

## 确定性回归

- 原生采样24999毫秒，延迟到25147毫秒再查询/回包，观察仍为24999；冻结、对象身份、跨factory隔离和第二次独立请求均校验。
- 真实价格runtime与两账：截止前1毫秒派发，准入关闭后147毫秒回包，原时间不变、双账完成并封段。
- 原验证器对上述及时派发/晚ack组合通过；用晚轮询时间替代，或墙钟/单调钟任一等于/超过截止，都仍在request_timing拒绝。
- durable intent失败没有内存请求或伪造观察。

新增API前定向用例因缺少观察API失败，记录保留于 `output/continuity-dispatch-clock-fix/before-fix.log`；改用原生观察后4项定向通过，日志 `after-fix.log`。这是功能红绿记录，不冒称复现了远端真实派发时刻。

## 独立审查

独立审查实际补丁及HTTP→worker→ack顺序，确认观察先于流创建，report在resolve headers前插入，后续Promise回调才触发ack；缺失/克隆/跨factory请求没有回退记录，验证器没有变化。4个定向用例独立重跑通过，另6个独立反例覆盖有效基线、墙钟/单调钟ack早于invoke、ack晚于finish，以及下一笔invoke早于前一笔ack，全部通过。日志位于 `output/continuity-dispatch-independent-review/targeted.log` 和 `ack-boundaries.log`，未发现阻断问题。

## 构建与组合验证

仓库内 `output/continuity-dispatch-clock-fix/snapshot` 仅包含HEAD已提交源码与本补丁，不包含 `.env`、真实runtime或其他未提交改动。Linux / Node v24.22.1 的 `npm run build` 通过（类型检查、服务端、Vite），共享工作树的 `npm run check` 也通过。对应日志 `build.log`、`current-tree-typecheck.log`。

9文件组合共115项，114通过、1失败、0取消、0跳过。原远端失败的continuity review及截止/篡改反例通过；三期continuity主链首段被另一已知保守边界阻断：worker/watchdog均零退出、最终组absent，但TERM结果unknown导致signal_failed。证据为快照内 `output/continuity-rehearsal/case-wh69j5/run/watchdog-1.json`，组合日志 `regression.log`。未删除issue、放宽门槛或把重跑通过作为解决；截至该单项组合阶段，三期完整验证尚未完成。

独立生命周期实验另证明：tsx unregister只停用hook，主线程esbuild.stop不关闭loader thread中的编译服务，而stop返回的Promise也不等于子进程已回收。同loader realm提前initialize并持有ChildProcess，stop后等待实际close，才观察到编译服务零退出后允许worker结束，见 `output/tsx-lifecycle-diagnostic/owned-result.log`。可靠后续方向是有界的编译服务收尾，不是放宽signal/helper/guardian；该单项补丁当时未包含独立生命周期改造。

本地验证不是远端Node22 CI、全仓、浏览器或真实模型验证；未提交、未推送。

## 联合整合验证

2026-11-11，与[loader生命周期修复](production-model-process-loader-lifecycle.md)合并后，在 Linux / Node v24.22.1 下首次运行完整476文件套件：`node scripts/test.mjs --test-concurrency=2`，**6207/6207通过，0失败、0取消、0跳过**，约1056.2秒。原三期continuity及第四次响应崩溃保留预算链、八次正常恢复、缺确认等到外部SIGKILL和派发/回包截止边界均通过。此前单项组合的114/115与失败产物继续保留；这次通过是在明确加入生命周期修复之后，不是忽略旧失败或降低门槛。

`npm run build -- --configLoader native` 完成类型检查、服务端编译和Vite生产构建，退出0，保留既有大包提示。使用原生配置加载器避免向只读依赖目录写缓存，没有改构建配置。guardian、watchdog、supervisor、信号适配器及时间验收器五个文件仍与整合前HEAD逐字节相同。

这是 `d6ef7e9` 加两项12文件修复及原有十个视觉设计/赠食未提交文件的混合工作树验证，不是只含本修复的纯提交树验证。构建和测试前后1392个非环境源码文件路径与SHA256一致，十个保护文件保持不变；检查后只补充两份审查文档的整合记录。运行使用空环境、只读源码/依赖、只有回环网络的独立网络命名空间，真实 `.env`、runtime与`.git`不挂载，所有可写产物在仓库output下。

完整日志、计时、隔离脚本及哈希清单保留在被忽略的 `output/integration-dispatch-loader-20261111/`，不随提交提供完整证据包。两项修复共享worker，因此本地合成一个精确提交；未推送。以上不代表远端Node22 CI、所有调度竞态已消失、浏览器或真实模型验收。
