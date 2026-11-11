# Runtime 请求恢复计量独立复核

## 结论

本次 `src/server/runtime.ts` 最小修复未发现阻断问题。终态结果与本请求的持久 `inFlight` 清理属于同一 world 事务；内存终态标志只在提交返回后设置。重入的 tick、新请求开始与 stop 不会把已记账请求重新列为未完成。原 provider journal 的响应确认和故障封锁仍独立生效。

本结论仅针对合成、离线测试，不是正式模型、真实账号、正式验收通过或可上线证明。

## 核对范围

- 对照 runtime、ModelBudget、production-model-runtime、production-model-price-runtime 的提交、预算和 observer 契约。
- 成功与拒绝结果均在同事务中结束本地等待；其他并发请求不清除。
- 已调用模型的失败若已持久记账，则不在重启时重复计失败。缺失用量仍保留 unknown 计数及预算条目，不视作免费或退款。
- 终态 subscriber 抛错不再被计成第二次模型结果。普通模式保留原错误向上传播，受控模式仍以 runtime_failed 停止。没有将 observer 故障静默视为成功。
- `finally` 仍按精确 request token 清理，未提前释放调度槽位。
- 未发送取消分支未变。价格桥接仍要求取消回执对应的持久 `inFlight` 包含当前 actor；不应把该分支顺手并入本次终态清理。
- world 写入或包装 checkpoint 失败不设置内存终态标志。world/journal 不一致仍由已有桥接恢复约束阻断。

## 写入失败边界

需区分两种情形：

1. 结果事务失败，后续旧 catch 路径成功持久写入失败/unknown 账目：本请求可以随该账目清除 `inFlight`。它已经被记为失败，重启不应再次增加 unknown。
2. 结果及后续失败账目均无法写入：数据库仍保留原 pending 和预算预留，重启按未知用量处理。

收到结果后，既有代码会先将预算估算替换为报告用量，再尝试持久结果。情形 1 保留该预算条目，不是恢复原最大估算，也不构成退款。本次未扩展内部持久化故障的重试或停机策略。

`commit()` 在终态回调前调用 acceptance 的 committed-minute 校验。正常合法决策不会改变 minute，因而此处不会在设置标志前额外触发停止；本次没有为外部恶意篡改 world minute 重排通用提交顺序。

## 独立反例测试

新增 `tests/runtime-recovery-independent-review.test.ts`，最终 **4/4 通过**：

1. A 成功终态 subscriber 内 tick 后立即 stop，只把仍未完成的 B 记为 unknown；A 不重新写回，B 迟到结果不能生效。
2. 受控成功提交后 subscriber 抛错：runtime_failed 停表，成功数、tokens 均只计一次，重启不增加失败。
3. 内存 SQLite 真实触发器拒绝一次结果事务，后续失败事务成功：success=0、failures=1、unknown=1，预算条目保留，重启不增计。
4. A 终态 subscriber 将第三人设为 due 并 tick，触发第三请求开始事务：持久等待仅包含 B 与 C，stop 仅增加两次 unknown。

旧实现曾运行前两个普通模式反例，均失败，分别暴露残留等待和重复失败计量。实现完成后第二例改为受控模式，以核对 fail-closed 而不制造未处理的普通模式异步拒绝。

运行命令使用仓库内 HOME/USERPROFILE/TMPDIR/TMP/TEMP、`TSX_DISABLE_CACHE=1` 和 `--import ./scripts/acceptance-offline-guard.mjs --import tsx --test`。无真实模型、账号、网络或运行存档访问。

## 桥接回归状态与限制

额外执行了 production runtime、price runtime 及两套 review 文件。首次并发批次出现 price-runtime 文件级失败，未提供具体断言，并有一个独立测试临时错误模型名导致的测试夹具失败；后者已改用 `GLM_MODEL`，最终独立四例全部通过。首次批次报告 57 项通过，不能称整批通过。

随后串行运行 price runtime 与 budget cancellation 两文件，输出已覆盖取消仅移除本人预算、停止/异常不等于未发送证明、取消事务失败保留预算、已发送未知请求保留预算等成功结果。因与主任务的重型回归同机竞争，按主任务要求中断该批次（exit 130），不计整批通过。最终完整回归结论由主任务的串行复验结果给出。

主任务补记：price-runtime 文件后续单独串行复验 30/30 通过，含 8 个子进程退出边界。首次文件级失败的根因未确认，未把并行批次改记为通过，也未执行全量 CI。

独立复核仅新增上述测试与本文档，没有修改产品文件、用户未提交视觉/赠食文件，也没有 commit 或 push。
