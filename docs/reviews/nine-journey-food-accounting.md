> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# 九人旅途食物账本独立审查

日期：2026-11-07。范围：`tests/helpers/nine-food-accounting.ts` 的 `journeyMeals` / `familyJourneyMeals` 接入，以及对应主集成测试。未改主 helper、引擎、真实模拟或存档。

## 结论

本轮没有发现阻断问题。新增独立测试 `tests/nine-journey-food-accounting-review.test.ts`，28 个测试全部通过。测试证据为人工构造的世界最小物理切片与收据，独立于主集成测试的引擎 fixture，不调用世界初始化、模型、数据库或运行时存档。主集成测试另外提供实际引擎事件和 SQLite 恢复路径，二者互补。

## 验证结果

- 家庭事务完整性：缺成员、重复、原始顺序重排、重复受益者、provider portion 回退、不一致 memberCount、definition、时间均原子拒绝；失败不推进游标、覆盖度、任何已有 slice，修正输入可在同一区间重试。
- 一分钟证据链：world、起止分钟、零步和跳步、初始九人集合改变均拒绝；集合相同但顺序不同可以接受。已接受的 journey eventId 或家庭 relocation/ration 事务在后续分钟重放仍拒绝。
- 跨切片身份冲突：journey eventId 与同一步 directEating 重复，以及与已接受旧步 directEating 重复，均拒绝且所有 collector 状态原子不变；修正 eventId 后同一区间可以接受。
- 公共来源伪装：journey 与 family 收据把 person 容器改成 `public:hall` 或 `public-reserve:review` 均拒绝且原子不变。公共库存纳入物理快照不等于这两个旅途契约允许公共供餐，publicDuty 仍未接入。
- 严格缺测：未 sample、无 observation、旧 observation 缺两个数组时，汇总为 unknown/null。后续明确空数组不修补前面的缺测；连续明确空数组只证明对应 slice 的零。
- 两种边界分别核算：外人供给九人计入九人摄入但不计九人库存扣减；九人供给外人反之。家庭整笔三人事务完整保留。水与食物分别累计，营养与饥饿缓解分别报告。
- 提供者库存范围 unknown 不污染明确的九人受益者摄入。外人受益份额的原营养 unknown 不污染九人营养；九人受益份额原营养 unknown 保持 null，不能用已知 hungerRelief 替代。
- 数组稀疏、错误数组类型、顶层/收据/数组元素 getter 均拒绝，getter 未被执行。冻结输入可接受。采样后输入变异以及 finish 返回值变异不影响已接受结果。
- 物理库存快照只读：冻结世界无需初始化；同一库存别名不重复累计；公共库存与固定九人合计，外人库存排除；库存数量 getter 不调用，数量改为 unknown。库存净减少不会自行产生旅途摄入。
- `completeFoodLedger` 仍为 false，foodConsumption 仍未知；publicDuty 和 emergencyCare 明确列入未覆盖范围，没有伪装为新接入 slice。

## 范围与限制

这是一份按受信引擎收据核算的审计 helper，不是从任意不可信世界对象重建历史的证明器。快照的库存数据属性安全读取、证据对象拒绝 accessor 已覆盖；任意 Proxy 或世界根字段恶意 getter 不属于本次新增收据契约。家庭事务校验要求引擎的 memberIndex 顺序，因此不接受任意重排的同一事务。公共库存本身纳入物理边界，但这两个旅途收据契约均限定 person 容器，未伪造公共直接供餐事件。未将未接入的 publicDuty/emergencyCare 计作零或完整食物账本。

## 命令

- `node --import tsx --test tests/nine-journey-food-accounting-review.test.ts`：28/28 通过。
- `./node_modules/.bin/tsc --noEmit`：通过，无 TypeScript 诊断。

仅新增上述测试文件及本审查文档；没有读取 `.env`、真实运行存档或密钥，没有使用浏览器、模型、npm，没有提交或推送。

## 后续公共与紧急供餐扩展

上文 publicDuty/emergencyCare 未接入的描述为本轮旅途审查时的历史边界。后续[独立审查](nine-public-care-food-accounting.md)覆盖这两个新增切片；本页对应测试只将旧 observation 中遗漏它们的断言更新为缺测/总量 null，不再断言报告没有这些字段。其余旅途范围和非完整账本限制不变。
