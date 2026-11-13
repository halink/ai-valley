> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# 成人历史监护记录与一次基础急救：独立审查

## 范围

仅审查 `src/world/social.ts` 的 basic care 紧急授权：成人仍保有童年 `guardianIds`，其中具备能力的人实际在场，不应被当作已经实现的成人代理。独立审查只编辑 `tests/adult-emergency-care-review.test.ts` 与本报告，没有修改实现或他人的测试。

设计依据是 `docs/design/people.md` 的“成年后，未成年监护关系结束”以及“完整多资产遗嘱和失能后代理仍待后续实现”。此次不清除历史字段、不引入成人代理，不扩展医疗、转运、长照、天气或非危重照护。

## 精确故障与修复边界

修复前 `careAuthority` 在健康不超过 20、缺少完整决定与表达能力、无有效拒绝等条件之后，无年龄限制地遍历 `target.guardianIds`。在场且有能力的历史监护人使其返回“有可及时决定的代理，应使用普通授权”。`formal-opportunities.ts` 用同一函数生成菜单，而失能成人不能提出或接受新同意，因此真实最终菜单没有 basic care。

修复应只在未成年对象上考虑该及时监护条件。既有排序必须保留：本人有效拒绝、具体停止、完整能力恢复及非危重状态仍拒绝未获同意的行动；既有具体同意必须绑定；不满六岁本人的监护照护分支保留；未成年人在场监护优先不改变。

## 独立反例

18 项独立测试包含：

- 真实 `decisionContext → decisionChoices → parseChoice → submitPlan → stepWorld` 完成一次成人急救，消耗施助者各一份餐食和水，产生 emergency/basic-care 审计，不生成同意、永久监护、住房、亲缘、资金或财产权限。
- 5、17、18、65 岁边界，儿童在场监护优先和幼儿直接监护照护；历史监护人本人也不能给有能力、非危重或明确拒绝的成人无同意照护。
- basic care 原有部分恢复语义保留：仅决定或仅表达恢复不等于两者完全恢复。本次没有套用医疗撤离的不同判据。
- 开工后拒绝、完整恢复、health=21、离开现场、施助者失能、缺水、缺技能、具体提议撤回，均不能消耗物资或完成照护。
- 内存 SQLite 重载继续有效急救，但重载后完整能力恢复阻止旧工作。保留历史 guardianIds 不代表新授权。
- 伪造或空 proposalId、模型注入目标/guardianIds/authority 失败；真实成人既有同意仍要求其具体 proposalId。
- 合法共屋室内菜单执行；历史监护关系不能代替私人室内使用权限。

## 验证记录

修复前完整独立测试 **18 项：3 通过，15 失败**，失败包含真实菜单缺项和成人被历史监护记录错误拦截。旧实现下普通同意绑定、拒绝和非法室内空间反例仍通过。

修复后核实唯一对应生产条件为 `const timelyProxy=!adult(w,target)&&target.guardianIds.some(...)`，18 项独立测试全部通过。当前审查范围内未发现阻断缺陷。

执行命令与结果：

- `node --import tsx --test tests/adult-emergency-care-review.test.ts`：18/18 通过。
- `node --import tsx --test tests/adult-emergency-care-review.test.ts tests/care-withdrawal-review.test.ts tests/emergency-care.test.ts`：55/55 通过。
- `node node_modules/typescript/bin/tsc --noEmit`：退出码 0，无输出。

测试全部使用自建隔离世界和 `WorldStore(':memory:')`，未访问真实存档、密钥或外部模型，未进行浏览器或线上验收。全量测试由实施者统一执行，本报告不声称独立执行全量回归。

## 全仓首轮遗留断言复核

实施者报告首次全仓 1767 项中 1766 项通过，唯一失败为 `tests/residential-social-integration.test.ts` 原第 63 行附近的 `proxy` 参数情形。该 fixture 显式将全部居民设为 25 岁；给失能屋主补入在场者的 `guardianIds` 后仍要求租客急救失败，其预期正是本次修复要消除的成年后历史监护阻塞，不是应保留的成人代理授权。

独立复核当前修正：原参数拆为 `adult-history` 与 `child-guardian`。两者保留同一实际同室、健康 19、缺少决定与表达能力的场景；仅后者明确把受助者设为 13 岁。前者要求执行成功、餐食消耗及 `emergency` 审计，后者要求失败且全部物资不变；能力恢复、非危重和明确拒绝的拒绝断言仍保留。因此该修正没有删除儿童监护边界，也没有把历史监护包装成本人同意，不构成掩盖真实回归。

独立复验命令 `node --import tsx --test tests/residential-social-integration.test.ts tests/adult-emergency-care-review.test.ts`：**26/26 通过**。其中租约过期、私人空间、短路径、本人使用权等既有反例仍通过。未修改该集成测试或任何生产代码。首次全仓数字来自实施者报告，本审查未自行重复全仓执行；修正后的全量结果由实施者另行记录。
