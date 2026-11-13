> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# 普通一次照护：施助者成年资格持续核验

## 已复现的问题

本切片只修改 `src/world/social.ts` 的普通 `care`，不改变长期照护、医疗护送或其他权限流程。

`submitPlan` 原先通过通用年龄门槛核验成年身份，但 `careActionReason` 和 `careAuthority` 只持续核验决定、表达、在场及受助者授权，没有持续核验施助者年龄。真实2岁受助者的 `guardianIds` 包含施助者时，经 `decisionContext → decisionChoices → parseChoice → submitPlan → stepWorld` 合法选择普通照护，再把施助者 `bornAt` 改为 null、NaN 或未来日期，排队阶段和最后0.25分钟的六条复现均实际完成 `guardian` 供餐：扣一份本人餐食、一份清水，并记录原批次营养与22点饥饿缓解。修复前六条全部失败，不是夹具或菜单缺失造成的失败。

反向问题是：真实2岁孩子健康15、无法完整表达决定时，身边出生记录未知或真实未成年的历史监护人，仍被当作可及时决定的代理，阻止另一位合格成人使用严格紧急依据。历史ID不能证明当前合格代理。

## 最小修改

- `careAuthority` 增加当前成年资格，最终菜单与直接权限查询不能授予未知年龄或未成年施助者任何普通 `care` 权限。
- `careActionReason` 在具体同意、监护或紧急分支之前持续重验当前成年资格。已有 `targetFor`、`processActivity` 和 `executeSocialAction` 均调用该判断，因此开始前、行路中、工作中、最后0.25分钟与直接完成都拒绝失格施助者。没有修改共享引擎，也没有新增持久字段。
- 可及时决定的代理同时必须是已知成年人。正常、能决定并实际在场的成年代理仍优先；未知或未成年历史监护人不能阻断另一位成年人的真实紧急帮助。
- 复用原 `adult` 判断，其 `ageYears >= 18` 等价于 `knownAgeYears` 已知且至少18岁。未知记录返回兼容值0只用于拒绝成年资格，不作为幼儿豁免；不改写出生记录、生命周期或能力状态。

不增加儿童施助权限。所谓年龄无关的危急帮助，是受助者出生未知时仍可依据真实危急与失能事实获得有限救助，不是取消施助者原有成年门槛。真实0岁、2岁目标的合法监护照护保持可用；本人真实同意和严格紧急依据也不要求猜测受助者年龄。

## 原同意、撤回和旧档

保留既有一次照护具体 `proposalId` 绑定和立即停止流程：

- 具体提议被拒绝、撤回或过期后，排队动作不能获得后来的新同意，也不能改用幼儿监护或紧急依据。
- 旧无绑定动作不能接纳后来出现的 `accepted` 提议；明确 `refusesCare` 和仍有效的本人拒绝继续阻止绕行。
- 本人可表达的停止不要求施助者保持成年，也不会因停止者出生未知而被剥夺。提供者本人仍按原有决定和表达能力条件停止自己的参与。
- 没有年龄修复、旧档迁移或自动补造同意。旧队列及旧活动经内存SQLite重载后照常重验；失效后恢复出生记录不会重启已失败活动。
- 停止未完成工作不改写原提议ID、签署状态、创建和期限，不扣或退原食品批次，不改监护、父母、住处、财产或已经完成的历史照护。

独立审查的跨依据反例在修改前即已通过，因此未为这项修复新增 `guardian`/`emergency` 持久绑定字段；证据见[独立审查](../reviews/caregiver-age-revalidation.md)。这不声称所有其他行动已完成跨依据审计。

## 定向验证

主专项 `tests/caregiver-age-revalidation.test.ts` 为39项，内部组合覆盖七种非法出生值、三种依据、排队/行路/末0.25分钟、两种居民排序；另核验直接完成、真实最终菜单、原批次和历史不变、内存SQLite旧队列/旧活动、本人停止与回执重放、0岁和2岁合法目标，以及未知目标的真实同意和危急救助。

独立专项81/81通过；主专项、独立专项与九个既有邻接文件最终合跑 **259/259通过，0失败、0跳过**。直接 TypeScript 类型检查与本轮修改文件空白检查通过，独立反例结论见[独立审查](../reviews/caregiver-age-revalidation.md)。以下检查使用离线合成世界与内存数据库，不启动时钟服务或模型，不读取真实存档或密钥，不使用浏览器或npm，不提交或推送：

```sh
node --import tsx --test \
  tests/caregiver-age-revalidation.test.ts tests/caregiver-age-revalidation-review.test.ts \
  tests/care-withdrawal.test.ts tests/care-withdrawal-review.test.ts \
  tests/care-meal-evidence.test.ts tests/care-meal-evidence-review.test.ts \
  tests/adult-emergency-care.test.ts tests/adult-emergency-care-review.test.ts \
  tests/unknown-age-residual-authority.test.ts tests/unknown-age-residual-authority-review.test.ts \
  tests/social.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

这是普通照护切片的定向验证，不代表全量测试、全仓年龄权限审计或真实模型长期验收。
