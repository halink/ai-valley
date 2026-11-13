> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# 合成价格期与持久续期状态机

本组件是**纯离线、合成证据专用**的协议骨架。它不获取官方价格，不验证真实来源，不接 HTTP、runtime、世界存储或正式入口，不读取密钥、真实存档或账单。它也不启动计时器或自动运行片段。所有时间和世界 checkpoint 都由受信任的合成调用方提供。

`production-model-price-evidence.ts` 与 `production-model-price-session.ts` 是独立组件，没有修改现有 `production-model-policy`、`production-model-admission`、`production-model-http`、`production-model-journal`、runtime 或 `main.ts`。原生产入口仍默认阻断，真实价格最多15分钟的新鲜度与原有授权要求均未放宽。

## 证据不等于来源真实性

- 合成工厂仅接受 scope hash、顺序、前一证据 hash、fixture 名称和观察/过期时刻。输入是封闭结构，拒绝 getter、额外字段、签名、URL、自选信任根或 live 开关。
- 每个价格期最长 `900000ms`。在 `validUntilMs` 的精确边界已经过期，不以重开或读取状态重置年龄。
- 工厂内部的 WeakMap 品牌用于防止误传伪造对象或反序列化对象。任何调用方都可创建合成 fixture，**这个品牌不是可信来源证明**，也不抵抗同进程恶意代码。
- 持久记录可解析和重放，但不能还原 capability。其输入、输出和其他费用字段固定为合成零值；未知或非零价格、替代模型/端点、真实来源声明都会被拒绝。
- 输出始终包含 `sourceAuthenticityVerified=false`、`liveExecutionEnabled=false`、`realModelExecuted=false`、`actualProviderCostCny=null`、`readyForProduction=false` 和 `acceptancePassed=null`。合成零值不是供应商零账单，也不能通过现有真实 HTTP 准入。

将来真实续期必须独立解决可信的官方数据取得、准确计费范围、证据来源与采集时刻校验、固定信任策略及与准入/派发的绑定。本批不引入可选 verifier 或公钥来绕过这些工作。

## 不变的会话边界

创建时固定 run/world 身份、源码指纹与 fixture 范围指纹、模型/端点、全局请求数、原始绝对截止时刻、超时/提交宽限、审计/片段/价格期上限。整个规范化契约的 SHA-256 是证据 scope。重开必须交入同一契约及最近持久记录的世界指纹，不接受重新生成额度或延后截止时刻。

上限为20000请求、6小时绝对会话窗口、720片段、720价格期、60002审计行；每段预留完整30000ms，单槽、零重试、零回退，每段最多128个请求。预留从不返还。绝对时间与预留总量都受限，空段同样消费预留。请求超时与提交宽限都是正数且合计必须严格小于30000ms，这仅是新合成协议的要求，不改变旧生产契约。

worldId 与世界指纹分别验证。`acknowledgeWorldCommit`、`checkpointWorld`、`finishSegment` 都需要 `{worldId, fingerprint}`，不能用别的世界身份替代相同 hash。这里仍然只是合成调用方的断言，不证明真实世界发生了事务，也不证明 sourceFingerprint 对应实际源码。

## API 与提交顺序

1. 调用方提供空的、独占的 SQLite 句柄，或仅包含本协议表的重开句柄。创建 `SyntheticPriceSession` 后，初始为 `awaiting_price`。
2. `installPrice` 仅在没有片段和 pending 的干净边界接受下一价格期。sequence 必须连续，前一 hash 必须相同，观察时刻严格推进，证据 scope 和新鲜度必须匹配。错误的续期进入持久 blocked，不替换旧证据或未决状态。
3. `beginSegment` 固定本段证据 hash/epoch 并消费不可退还的时间预留。本段最晚结束为片段30秒、全局截止、价格到期三者最早值。准入截止进一步减去请求超时与提交宽限。缺少价格或价格余量不足仅等待续期，不创建片段；全局额度或时间耗尽锁停。
4. `beginRequest` 先 FULL 提交 intent，累计计数与本段计数各增一次，记录唯一请求序号、请求 hash、段、价格期、证据 hash 和请求截止。返回值仅为合成序号，不授权真实派发。
5. `recordResponse` 仅接受匹配 intent 的序号与响应 hash，必须在请求截止前。`acknowledgeWorldCommit` 仅接受该 response 的相同序号及世界身份，在请求截止加宽限之前持久确认。普通 `checkpointWorld` 绝不清 pending。
6. `beginDrain` 或到准入截止时的 `poll`/`beginRequest` 关闭新请求。已经 pending 的响应/确认只能在原边界内完成。`finishSegment` 要求 draining、无 pending、同一世界身份及完全匹配的最近世界指纹，再持久封段。只有封段后才能续期/开始下一段。

每个时间驱动 API 都要求安全整数且不早于已持久观察时刻。请求、价格、片段或全局时间的精确硬边界均拒绝。时间检查不依赖收到响应块，但**需要调用方实际调用 API**。`status()` 只是快照，不推进时钟。`requiresExternalTimer=true` 明确缺少真实 watchdog；本组件不能证明无人调用时按时停止，也不证明远端请求可取消。

## 持久化、失败与恢复

每个事件在 DELETE journal、FULL synchronous、EXCLUSIVE locking 的 SQLite 事务中提交后才更新内存或返回成功。独立连接不能接管活动句柄，模式降级、记录 tip 改变或写失败令当前对象不可再使用。调用方必须在成功/构造失败后关闭句柄，不应在同一个句柄创建第二所有者。

审计是严格字段/schema、连续序号和 SHA-256 链，并重放所有预算、时间、身份与状态约束。它能检测意外损坏或不匹配的历史；**它不是防恶意重写的签名日志**，不能识别某人替换整个数据库或提供伪造源码/世界指纹。调用方负责目录选择、文件安全、单会话路径和 SQLite 以外的资源所有权。

- 干净封段或仅装入价格后退出，可在相同世界指纹、原截止与原累计额度下重开。过期价格只能变为等待状态，不能直接派发。
- 重开时存在 intent/response：持久 `unresolved_request_no_retry`，保留 pending 和计数，不重发。
- 重开时有未封片段但没有 pending：持久 `segment_unsealed_no_resume`。即使 ack 已完成，也不推断片段正常结束。
- runtime、证据、未知账单、非零费用、来源未知或主动放弃均可写入单向 blocked。续期、重开、普通 checkpoint 都不能清除它。恢复不是自动修复。
- 最后一条审计容量预留给失败。读写/提交本身失效时只报告不可用，不声称失败标记已经持久；重开仍依据最后成功提交的事实。失败前已存在片段/请求会锁停。若在原本干净边界连第一条新事件都未写入，则数据库无从证明那次未持久操作曾发生，本组件不据此声称终态或外部动作发生过。
- 独立合成日志和未来世界存储之间没有原子事务，也没有 exactly-once、真实 billing reconciliation、进程监督或跨机器恢复承诺。

所有正常操作、检查、checkpoint 和封段都消费有限审计容量。20000请求是天花板，不保证能在60002行内完成；长时间高频 poll 会提前耗尽容量，不能通过续期清日志来规避。

## 离线验证与后续范围

正式实现测试为 `tests/production-model-price-session.test.ts`，覆盖严格输入、价格精确边界、两个价格期的连续预算、错序/重复请求、世界身份、并发句柄、数据库写失败、持久异常、不可清 pending、损坏重放，以及7个实际子进程 `process.exit` 点。它们不是断电或 SIGKILL 测试，不代表真实 API/账单或长期运行验收。

测试使用仓库 `output/test-tmp/` 下自有合成数据库、空环境和离线 guard；没有网络、key 或真实存档。执行命令如下，HOME/TMP 先创建到仓库输出目录：

```sh
env -i PATH="$PATH" HOME="$PWD/output/price-session-development/home" \
  TMPDIR="$PWD/output/price-session-development/tmp" \
  TMP="$PWD/output/price-session-development/tmp" TEMP="$PWD/output/price-session-development/tmp" \
  node --import ./scripts/acceptance-offline-guard.mjs \
  --import ./node_modules/tsx/dist/loader.mjs --test --test-concurrency=1 \
  tests/production-model-price-session.test.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc -p tsconfig.server.json --outDir output/price-session-development/build
```

后续可先离线接入既有合成 runtime 桥，证明终止/世界提交/封段的原子边界、独立 watchdog 与原始契约的兼容性，然后再评估真实证据取得和真实入口。不能将本协议的合成工厂直接接到 live transport，也不能把新会话创建用作自动清除旧未决/异常的恢复路径。
