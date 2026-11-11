# 普通物物交换持续授权

## 原规则与缺口

普通 `offer` 由本人向已知且真实可见、可接近的人提出给出和换入物品，完成只保存原报价，不代接收者同意，也不预留或转移任何库存。接收者必须另选 `accept`，到实际位置核对原当事人、期限、实物和接触条件后才双方交付。正式模式原有年龄白名单要求提出、接受交换的行动本人满18岁且有决定与表达能力；验证模式原有的年龄行为不变。

修复前年龄只在 `submitPlan` 检查接受者本人。真实编号菜单接受之后，任一方的出生资料变为 `null`、`NaN` 或未来时间，排队动作和最后0.25分钟仍可能完成扣料。新菜单不能授权，不等于已排队动作会自行重新核验。仅按 `offerId` 查当前条款也不能证明那些条款就是接收者曾选中的报价。

## 限定修复

- `src/world/barter.ts` 用已有 `knownAgeYears` 核实正式模式成年人身份，并检查在地、存活、生命值大于零、决定与表达能力。`offer` 检查提议人，`accept` 检查接收者和原提议人。不将“向未成年人提出非约束性报价”改成新权限，也不代未成年人接受。
- 原计划中的待执行交换、开始、途中、每步工时及原子结算前都重验。先等待、后接受的多步计划在等待期间发现资格失效也会走既有失败路径，取消该旧计划；恢复出生资料或能力不自动恢复旧劳动或成交。只有本人另行选择才可能继续。
- 工时检查覆盖该步开始及完成时点；末0.25分钟开始仍未成年，不能因在结束时满18岁而追认已经执行的旧行动。正常运行预检不会把没有推进的时钟视为已经劳动一分钟：区间起点不早于原计划真实选择时间，因此恰满18岁的新选择仍正常通过。
- `OfferTerms` 绑定原 ID、提议人、接收者、给出/换入物品与数量、到期时间和定义版本。最终编号菜单保存快照，迟到回复不能把旧“同意”用在改动后的条款上；提交时已有快照不被重新生成替换。原有直接 API 调用在新提交时绑定当前报价。
- 旧存档的待执行 `accept` 若没有快照，不能从当前报价倒推当时的同意，安全失败后须重新选择。仍有效的历史报价本身、期限和已完成状态保持原样；有完整快照的正常在途接受通过 SQLite 继续核验，不迁移补造年龄或同意。
- 报价袋子只接受已知物品的正整数1–100；条款身份和定义须为非空字符串，期限须有限。损坏记录不能因为双方同样缺字段而被当作匹配的授权。
- 菜单只对既有可见人物提供当前交换资格标记，不暴露隐藏库存或放宽认人、视线、室内权限、围栏与路径。库存仍在真正接触和原子交付前检查，其他人先用掉库存时双方都不部分扣料。食品路由和实际库存转移继续使用原有事务。

资格失效本身不改写、删除、续期、撤销或标记接受原报价。原期限自然到期和原提议人死亡的既有过期规则继续执行；其他生理、死亡、腐败等独立模拟不会因此停止。合法已完成交易不回滚，其他人、账户、资产和关系不因本修复重分配。

普通物物交换现有动作只有 `offer` 和 `accept`，没有另外的本人拒绝/撤回动作。本修复没有虚构新的取消权限，也没有用成人门槛过滤其他流程原有的拒绝或停止入口。没有触及商铺、外贸、家庭共同赠与或其他非普通交换结算。

## 离线验证

`tests/trade-authority.test.ts` 从真实最终编号菜单经 `parseChoice → submitPlan → stepWorld` 建立并接受报价，主测38项；最初30项在修复前有27项失败、3项保持原有合法行为。覆盖双方未知年龄在排队、途中、最后0.25分钟和等待后续步骤时失效，能力失效、恢复须新选择、SQLite、满18岁与原未成年限制、错收件人、重复结算和末刻缺料。合法成年接受另经两次内存SQLite提交重载，核对原食品批次期限、双方实物和第三人所有权，只成交一次。

[独立审查](../reviews/trade-authority.md)另测原报价字段替换、迟到回复、并发扣料、旧待执行记录、损坏条款和恰满18岁预检，并发现和验证了上述预检时间区间修正。

当前38项主测、40项独立审查及80项邻近回归共158/158通过，零失败、取消或跳过；类型检查通过。专项命令：

```sh
node --import tsx --test tests/trade-authority.test.ts tests/trade-authority-review.test.ts tests/world.test.ts tests/decisions.test.ts tests/observed-target.test.ts tests/social-target-visibility.test.ts tests/social-target-visibility-review.test.ts tests/household.test.ts tests/food.test.ts
node node_modules/typescript/bin/tsc --noEmit
git diff --check
```

与普通照护修复共同冻结后，2026-11-07 UTC 的同一最终版本首轮统一验证：

- 326个测试文件，4245/4245通过，0失败、取消、跳过，198.37秒；没有用复跑替换失败结果。
- `tsc --noEmit`、服务端 `tsc -p tsconfig.server.json`、显式 `configFile:false, envFile:false` 的 Vite 构建和 `git diff --check` 全部通过。Vite保留主包超过500 kB的体积警告，不是构建失败。
- `node --import tsx scripts/acceptance-nine-food-chain.mjs --offline` 通过。4次SQLite关闭重开，229项选定且完成，0待完成、0失败；末态9人存活。根菜45+12−1−48=8，钱款1295守恒，家庭赠与领取2份后独立吃1份、余1份。
- 粮链 `realModelExecuted=false`，完整食物账、模型自主性与长期生存验收仍未声明通过。

完整复验命令另包括：

```sh
node node_modules/typescript/bin/tsc -p tsconfig.server.json
node --input-type=module -e "import {build} from 'vite'; await build({configFile:false,envFile:false,base:'/ai-town/'});"
node --import tsx --test tests/*.test.ts
node --import tsx scripts/acceptance-nine-food-chain.mjs --offline
```

所有验证仅使用合成世界和测试SQLite，不读取密钥或真实存档，不调用真实模型、浏览器或 npm，不提交推送，不等同真实模型自主或长期生存验收。
