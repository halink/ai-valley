# 精确面对面社交目标边界独立审查

## 范围与结论

本次有限修复覆盖通用 `talk / offer / accept`，以及基础 `formalOpportunities` 的 `care / propose / respond` 对象筛选。文化活动、借款、收养/家庭与专门照护有各自规则，不在本次统一审计范围。历史解释、远方发信、尸体证明、本人撤回和结束关系保留独立路径。

最终独立复跑 **45/45通过**：

- `tests/social-target-visibility-review.test.ts`：15项独立边界测试。
- `tests/social-target-visibility.test.ts`：14项主实现测试。
- `tests/funerary.test.ts`：6项。
- `tests/observed-target.test.ts`：3项。
- `tests/rooms.test.ts`：7项。

此前另行复跑成人急救独立测试18/18通过，TypeScript `--noEmit`退出码0。此处不将主实现仍在进行的全仓测试与构建记为通过。

仅使用离线源码、合成世界、现有 Node/tsx 和内存 SQLite。未读取真实存档或密钥，未调用模型、浏览器或网络，未安装依赖或发布。审查只新增测试和本报告，没有修改生产代码。

## 原问题及独立反例

原 `decisionContext` 用 `coLocated(...,10)` 构造 people，再以 knownPeople/alive 标记 talkEligible。距离与同室不是视线或通路证明；barter peers 原先也未使用 talkEligible。最终编号菜单还为这些对象附上 observedTarget，因此是精确目标泄露，不仅是宽泛的“附近有人”。

独立测试覆盖：

- 完整贯穿地图的水列：视线透明，但不能走到合法接触位置。
- 对角 cliff：可绕行不等于可直接看见。
- 相邻围栏：`findPath(adjacent)` 的空路径不能证明跨栏接触；没有合法门路时排除，有门路时保留。
- unknown identity、残留室内坐标、缺坐标、错误door锚点、不同房间相同door。
- 室内桌障碍、对角家具拐角、双方使用权限与建筑损坏。
- 隔 cliff 发言仍产生既有范围内 witness 和记忆，但不提供精确面对面选项，也不改关系分数。
- 内存 SQLite 重载与重复菜单不恢复隐藏目标；菜单读操作不改世界。
- 正例保留户外已知可达对象的三种语气与barter，以及真实室内对象。

审查发现并推动修复了两个首版实现问题：

1. 室内 A=(5,6)、B=(6,5)，桌障碍(6,6)。两步绕行使 canObserveBody 为真，但不代表对角视线存在。现使用独立视线走廊，反例通过。
2. 相邻围栏另一侧可见目标，门口可走到，但原 adjacent 空路径使合法绕门方案被整体删除。现菜单和引擎共用 socialApproachPath，原邻接终点不合法时按真实通门路径停在目标前一步；开放门正例与封闭门反例均通过。

## 最终室内边界

室内看见与靠近保留十格范围，并核验真实 rooms、正确door锚点、合法非缺失roomAt、视线、双方原有使用权限和房间通路。实际完成接触仍限两格。

本次原审查曾要求关系摘要继续受 canObserveBody 两格限制，第15项因此锁定“空旷五格可接近但不摘要”。后续正常睡床与厨房链发现，这会使本人持久看法在眼前熟人仍可交流时消失；[室内关系记忆修订及独立审查](indoor-relationship-memory.md)有意替换该规格。当前第15项确认五格可见且双方有权使用房间时保留本人关系，但实际接触仍受两格限制；同距离桌后目标仍隐藏。此前测试数量和结论是原审查记录，不冒充这次修订的结果。

clearSightCorridor 仅抽出原室外循环，原步进、对角两侧和floor/ceil检查保持不变。

## 主测试与执行路径审阅

主14项不是仅检查菜单：

- 三模型prompt测试使用真实最终编号，不访问模型。
- 三语气各自真实靠近并说出选择者填写的原话，关系分值保持原值，SQLite重载保留结果。
- 围栏正例逐步验证实际步行边合法，确认绕门后才发言。
- 旧编号选择开始后新增封栏，talk、offer、accept均不能完成；无发言/交易事件，库存、报价和关系保持原状态。
- 已收到的隐藏发言仍可成为本人历史interpret的依据。
- 远方商行不在people中，仍通过真实编号完成foreignTrade.propose的独立寄信/预留路径。

代码审查确认通用三类动作完工会重新核验当前接触；迟到选择按保存位置找路，室内只在重新真实看见且可接近时刷新目标，不因同室距离而追踪隐藏位置。没有修改emitEvent听觉/witness规则。

## 旧fixture修改是否掩盖问题

确认这些修改是在构造合法初始观察，而非放宽通过断言：

- 成人急救室内例补initializeRooms，继续使用真实entry并分别验证公共允许、私有拒绝、完成状态与耗粮。
- observed-target室内例补房间初始化与对象使用权限，将原落在桌障碍的入口纵向偏移改为四格空旷走廊。仍要求迟到选择走向原室内位置、不能追踪另一建筑内目标，并失败而不交谈。
- rooms交谈例改为五格空旷走廊，仍要求首步不产生发言、有剩余室内路径、最终实际到场才产生一次发言。
- funerary存放例原说话人在(13,5)，首轮搬运者在(3,12)，实际距离17且跨障碍。旧实现误把共享door当距离。现改五格空旷走廊，保留实际走近交谈、随后死亡、两处bodyBay不能覆盖既有遗体等原断言。
- 原语气预算测试布置三个真实可见对象，仍严格检查中间32行截断、最终完整三语气和其他选项不丢失；无效y=2室内坐标改为真实可行走区，不作为旧行为保留。

未发现通过修改上述fixture掩盖当前范围内的行为缺陷。全部文化/照护等共址机制、真实模型自主行为、声学模型与长期生存并未由本审查证明。

## 复现命令

`node --import tsx --test tests/social-target-visibility-review.test.ts tests/social-target-visibility.test.ts tests/funerary.test.ts tests/observed-target.test.ts tests/rooms.test.ts`
