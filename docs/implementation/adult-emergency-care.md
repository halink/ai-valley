# 成人紧急基础照护与童年监护历史

## 复现与既有设计

旧 `careAuthority` 在失能成人健康为 19、童年 `guardianIds` 中有能力者实际在场时，返回“有可及时决定的代理，应使用普通授权”。普通 `care` 提议又要求本人具备完整决定与表达能力，最终菜单因此既没有紧急照护，也没有可完成的普通授权路径。

[居民设计](../design/people.md)明确成年后未成年监护关系结束；完整失能成人代理仍未实现。`advanceLife` 在人生阶段实际转为成年时会清空监护列表，但已经标记为成人的旧档可能保留列表。不能依靠一次性成长清理判断当前权限，也不能把历史亲属或监护身份解释成新的成人代理授权。

## 最小修复与边界

- 唯一生产逻辑改动位于 `src/world/social.ts`：基础 `care` 的及时监护检查只对实际未成年人适用。实际年龄至少 18 岁时，残留 `guardianIds` 不再阻断原有的紧急入口。正常成长清理与存档数据结构不变，不删除旧历史或补造代理关系。
- 本人已明确拒绝、该施助者本次提议已有效停止，仍不能使用紧急照护绕过。普通已接受的照护继续绑定具体 `proposalId`，旧绑定失效不换用新的同意，未绑定旧活动不自动获得当前同意。
- 本人同时具备决定与表达能力时仍须独立同意；只有表达能力不等于恢复完整决定能力，也不授予接受新协议或其他行动权限。既有的本人停止入口保持：[一次照护撤回](care-withdrawal.md)与[长期照护撤回](long-care-withdrawal.md)分别核验原授权。
- 原紧急阈值保持健康不高于 20，且没有完整决定与表达能力。健康高于 20 的失能成人不会因此获得新的无同意喂养路径，即使历史监护人在场也一样。
- 合格施助者仍须实际到场、有合法室内接触权和基础照护技能，自愿消耗自己的一份餐食与清水，实际完成一次工作。事件保留 `emergency` 与 `basic-care` 依据，不扣受助者钱货、不产生债务、住房、财产权、代理、永久监护或长期照护合约。
- 当前未成年人的及时监护检查不变；六岁以下现有监护人的原照护权限不变。无关成年人不会因此获得儿童照护权限。
- 菜单、工作推进和完成沿用同一个实时判定；拒绝、完整能力恢复、紧急状态消失、离场或资源失效都阻止继续完成。健康 19 的无伤病隔离用例完成后为 27，再次无同意执行即被拒绝。
- 医疗 `health` 的护送、稳定、预约与长期照护规则未修改。医疗护送中相似的历史监护判定不在本切片内，不能把本项写成完整医疗代理修复。天气调度继续默认关闭。

## 隔离证据

主回归 [adult-emergency-care.test.ts](../../tests/adult-emergency-care.test.ts) 在旧实现 **8 项中 6 项失败**，包括真实最终菜单缺项和错误的代理判定；两个原权限边界用例通过。最小修复后 **8/8** 通过。独立测试与结论见 [独立审查](../reviews/adult-emergency-care.md)。

覆盖 `decisionContext → decisionChoices → parseChoice → submitPlan → stepWorld` 实际链路、在场历史监护人自己/第三人施救、18 岁边界、正常成长清理与旧成人/老人数据、儿童现有权限、19/20/20.001 健康阈值、本人独立接受、有效拒绝、执行最后四分之一分钟失效，以及内存 SQLite 重载后继续或保守失败。重载不补造同意、钱货或身份。

既有 `society` 与住宅社会互动测试曾把成年人的 `guardianIds` 当作有效代理；已改为明确的成人历史关系反例，并保留 13 岁当前监护反例。没有放宽普通授权或重写历史断言为无条件成功。

## 离线验证

```sh
node --import tsx --test tests/adult-emergency-care.test.ts tests/adult-emergency-care-review.test.ts tests/society.test.ts tests/care-withdrawal.test.ts tests/care-withdrawal-review.test.ts tests/emergency-care.test.ts tests/health.test.ts tests/residential-social-integration.test.ts
node --import tsx --test tests/*.test.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc -p tsconfig.server.json
node --input-type=module -e "import {build} from 'vite'; await build({envFile:false});"
node scripts/acceptance-long-run.mjs 3
git diff --check
```

仅使用新建合成世界、内存/测试临时数据库和本地测试替身。未读取密钥、环境文件、真实存档或私人运行日志，未调用外部模型、浏览器或 npm，未提交或推送。显式关闭 Vite 环境文件读取。离线回归不代表真实模型长期选择或正式世界已经应用修改。

### 最终验证结果

- 主回归 **8/8**，独立反例 **18/18**；与 `society`、普通撤回、儿童紧急照护、医疗和住宅互动联合回归 **109/109**，零失败、取消或跳过。
- 首次全仓 **1766/1767**，唯一失败是住宅互动仍把 25 岁成人的历史监护记录视为代理的旧断言。拆为成人历史/13 岁当前监护后，独立复核 **26/26** 通过；没有额外生产逻辑修改。历史失败保留，不与最终结果混淆。
- 最终全仓 **1767/1767**，零失败、取消或跳过，用时 **99.64 秒**。
- 完整 TypeScript 检查、服务端编译、显式 `envFile:false` 的 Vite 生产构建、最后测试调整后的 TypeScript 复验与 `git diff --check` 均通过。Vite 只保留原有大于 500 kB 的分块提示。
- 额外 **3 模拟年**隔离生命周期验收通过，每年内存数据库存取后继续运行，共 **16478** 份计划、**1** 次出生；每次检查总钱数保持 **1290**。这是自建小地图与预设控制器的生命周期/账目证据，不是正式世界或模型自主生活的长期验收。
- 独立审查无未解决阻断项。医疗转运中的同类历史判定、非危重成人无同意照护和完整成人代理仍不属于此次交付。
