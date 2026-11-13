> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# 运行时逐人决策等待证据

本批为未来正式九人真实模型验收准备一个可选、外部、逐事件的证据入口。当前验证全部使用内存 SQLite、注入假模型和可控时钟；没有执行真实模型验收，没有读取密钥或真实存档。该入口不接入默认服务启动，不自动写磁盘、不联网，也不增加 World 字段。

## 为什么不能复用已有计数

隔离脚本直接调用世界引擎，没有运行时模型队列。`idleDecisionDue` 是分钟末状态采样，`chosenWait` 是居民主动停留，`decisionProtection` 是生理保护，均不能推导模型等待。隔离日报中的 `technicalOrModelWaitMinutes.value` 继续为 `null`。

运行时原 `waitingSince` 只服务调度优先级和停表保护，并不完整覆盖首次排队、成功回复、重试、停机和跨进程时段。本批独立观测这些边界，不修改该映射、排序、并发、配额、回退选择、保护期限或暂停规则。

## 开始与结束到底是什么

- `session_started`：调用 `ValleyRuntime.start()` 后开启新的观测会话。会话 ID 随机生成，只用于外部记录关联。
- `wait_started`：在 start、tick 或 schedule 的运行时边界，首次观察到此人满足原候选资格。覆盖尚未获得槽位、配额等待、重试冷却和在途请求；可在无模型配置时发生。`actorKind` 区分本地居民、境外候选和外贸人物，不能把后两者并入九人居民统计。
- 这不是从 `decisionDue` 反推的墙钟开始时间，更不是声称知道居民在上一 tick 内哪个瞬间获得资格。`origin` 为首次会话的 `session_start` 或之后的 `runtime_boundary`，`priorWaitMs` 一律为 `null`。会话前等待、停机间隔和两次边界之间未观察到的瞬态资格均未知。
- `request_started`：上下文准备与配额预留通过，原请求指标提交后，紧邻调用注入的模型函数之前。此前等待是真实观测到的排队/准入等待，但不能仅凭这段时长细分为并发槽位、CPU、网络或配额各花多少。
- `request_finished`：模型函数 resolve/reject 被运行时处理时，或 stop 中断时。`reply` 只表示函数返回，并不等于计划已接受。覆盖模型封装中的网络、流读取、解析与校验，不是供应商纯推理延迟；不使用 `ModelResult.latencyMs` 代替实测。
- `wait_finished.reason=accepted`：原有计划接受逻辑已成功提交。请求失败、超时、回复过期或计划不适用均不结束等待段。单纯接受 `wait` 后的主动停留不算技术等待；若原运行时另行赋予撤回照护等并行决策机会，则依原资格开启新段。
- `no_longer_eligible`：后续边界发现不再是候选，可能失去表达能力、死亡、行动变化等。本入口不推断具体原因，更不当成成功。`stopped` 表示停止观测。这两者均 `rightCensored=true`，只知道已观察的区间，未得到完整成功等待时长。
- 每个 request token 同时匹配 session、actor 和 wait ID。旧段晚到回复可保留请求结束记录，但不能结束或归因到新的等待段；stop 后晚到回复不再追加到关闭的会话。

## 失败、回退与未发出的请求

- 明确 `TimeoutError` 才标 `outcome=timeout`。原运行时将其他未知异常归为 `model_timeout_or_invalid_response`，本证据将其标为 `failed`，不据此编造超时次数。安全错误码保留白名单代码，绝不输出错误原文。
- `retry_scheduled` 表示原运行时已经设置重试延迟。`fallbackModel` 只表示此次回退待尝试，不证明实际发出；后续 `request_started` 的 `route`、`trigger` 和 `model` 才证明实际路由。`route` 相对于配置顺序：唯一配置的 DeepSeek 也是该实例的 primary。
- `preparation_failed` 表示未进入模型调用的上下文准备失败；`admission_deferred` 表示实际配额预留被拒。两者没有伪造 `request_started`，不会新增模型失败计数。
- `decision_rejected` 只记录固定枚举：人物版本变化、计划不适用、境外条件变化、外贸条件变化。不包含意图、动作内容、私人消息或模型反馈文本。

## 双时钟，不互相换算

每条事件带 `at.wallTimeMs`、`at.monotonicMs` 和 `at.gameMinute`。

- 墙上时间 `wallTimeMs` 来自 `Date.now()`，用于按真实日期定位。系统校时可能使它倒退，不据此算持续时间。
- 持续时间使用默认 `performance.now()` 的单调毫秒时钟，可通过 `monotonicNow` 注入测试时钟。`elapsedMs` 为同一观测会话内端点差。时钟抛错、非有限数或倒退会将本会话后续单调值和相应持续时间标为 `null`；不回退到 Date.now、不钳成零。早先已完整记录的有效区间不被改写。
- `gameMinutes` 是等待段或请求段端点的实际世界分钟差。停表时可为零，而墙钟持续增长。原 tick 仅推进最多 2000ms 对应的游戏时间，保护性停表不推进，重启不补时；因此不能按配置的“20 分钟一天”把墙钟等待简单换算为游戏等待。
- 游戏时间差不是该居民损失的行动机会、受伤、饥饿或保护时长，不能替代这些账本，也不能将多人的并行等待相加后当成世界停表时长。等待段已包含其请求和重试，禁止把三者时长重复相加。

## 接口与可靠性约束

`ValleyRuntime` 最后一个 options 可传 `decisionWaitEvidence: {observe, monotonicNow?}`。`observe(event)` 是受信任的同步回调，可将事件序列化为外部 JSON 行。未传入时 `decisionWaitEvidenceStatus()` 返回 `null`，表示没有观测，不能报零。

输出只包含会话/序号、模拟人物 ID、固定类型/错误码、模型枚举和时间数值。事件及时间对象被冻结，无 World、Resident、上下文、prompt、模型回复、意图、反馈、API key、姓名、位置或真实存档内容。仅内部内存保留当前开放段和请求，结束即移除；累计文件由调用者负责。

每次导出需同时保留 `decisionWaitEvidenceStatus()`。成功关闭应为 `phase=stopped`，同会话序号连续且有 `session_started/session_stopped`；`openWaits/openRequests` 应为零，但 `stopped` 的等待仍为删失观测，不能升级为成功。回调抛错或返回 Promise 会使状态成为 `failed` 并停止后续发出，原调度继续；异步回调不受支持。最后序号是已尝试发出的序号，不是持久化确认。即使同步回调未抛错，后续磁盘丢失也无法由 runtime 检出。调用者必须校验持久输出与状态，失败、缺序号、进程崩溃、缺少结束事件或没有观测均保持未知，不能解释为空记录或零等待。

观测不进入存档、公开 snapshot、事件年表或居民模型上下文。重载旧存档不需要迁移，也无法补回未保存的证据。新 runtime / 新会话从新起点取证；不要按人物 ID 将不同会话直接拼接并假定停机段已覆盖。

固定时钟下，回归逐项比较启用/禁用观测的正式九人完整世界、SQLite 重载、模型输入和请求顺序一致。同步回调仍会消耗真实 CPU/墙钟时间；它必须快、非重入，不得通过闭包修改或停止 runtime。这里不声称任意慢回调都对真实时序没有影响。原 runtime 在同实例仍有旧 promise 时 stop/start 的生命周期隔离并未在本批修复；正式重启应使用新的 runtime 对象。证据 token 的跨会话隔离不等于旧实例世界调度隔离。

## 离线复现与覆盖

```sh
node node_modules/typescript/bin/tsc --noEmit
node --import tsx --test tests/decision-wait-evidence.test.ts tests/runtime.test.ts tests/model-routing.test.ts
node --import tsx --test tests/*.test.ts
node node_modules/typescript/bin/tsc -p tsconfig.server.json
node node_modules/vite/bin/vite.js build
node scripts/acceptance-long-run.mjs 1 --daily-json
```

定向测试包括正式九人排队、并发槽位释放、接受后主动 wait、停表下双时钟、明确/含糊超时、反馈重试、限流与实际回退、预算等待、准备失败、过期/非法计划、资格丢失、停止/晚回、SQLite 内存重载、时钟缺失/倒退、无模型/无观测、失败和异步 sink、不可变输出与敏感标记排除、完整世界/上下文/请求顺序等价，以及旧段/跨人物/跨会话请求隔离。

真实模型十五日九人验收仍未执行。默认服务未启用外部持久证据 writer；已有[可选隔离 writer](acceptance-evidence-writer.md)提供严格结构校验、fsync和只读恢复。生产验收前仍需在获准的独立入口显式连接、保存状态并校验覆盖，另行验证真实模型故障与供应商行为。隔离多年脚本保持三位初始人物的确定性夹具，其日报不接入本入口、不报告技术等待为已测。

## 本批最终执行结果

2026-11-07，新增证据回归 19/19，包含原 runtime 与模型路由的定向组 39/39；全套 `tests/*.test.ts` 为 1,927/1,927 通过，0 failed、0 skipped。类型检查、服务端编译与 Vite 构建通过；构建仍提示既有超过 500 kB 的分块警告，没有将其描述为已修复。[独立复核](../reviews/decision-wait-evidence.md)另行实际执行了定向 39 项并确认关联问题修复。

一年隔离复验通过，113 条日记录覆盖 161,280 游戏分钟，1,325 次自主进食、15,908 营养值，与上一批确定性证据一致；逐行核对连续区间、每分钟覆盖、明细与总量/完成动作计数、年度重载通过。技术/模型等待与完整消费、产量仍为 `null`。这些结果只证明本批未改变该隔离夹具，不构成九人真实模型的等待或生存数据。
