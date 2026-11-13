> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# 家庭共同赠与交付前权限重验

## 原有规则与竞态

`family/shared@1` 的共同赠与记录保留原提议人、另一位批准人、接收者、各自成本、批准时间和期限。批准时预留双方实际份额，接收者仍须独立选择并到原储物处实际领取。

修复前的 `advanceHousehold` 已明确对 `proposed` 和 `ready` 同时应用以下失效规则：原期限到期、共同账户不再开放、任一出资人不再是在地且具决定与表达能力的成年人、接收者死亡，以及已经预留的完整实物不足。失效后的剩余实物和钱款分别退回各原出资人的原址份额。这里沿用的是原规则，而不是将临时失能凭直觉解释为本人主动撤回，也不是给所有已签合同新增能力条件。

原 `acceptGift` 只检查 `ready`、接收者身份、知情和期限。引擎先完成个人活动、再运行 `advanceHousehold`，因此领取剩最后 0.25 分钟时，即使另一位成年人已经失去决定能力，也会先交付，随后失效清理因状态已变成 `delivered` 而跳过。

## 最小改动

- `giftValidityReason` 提取原有待交付赠与失效条件，由选择、批准、通知、每步相关活动、实际交付和状态推进共同使用。完成事务仍再次校验，不依赖菜单时的旧判断或事后清理。
- 独立审查同时复现了出资人生命值已为零、但同一步尚未轮到其死亡登记的顺序漏洞。赠与校验也按引擎现有死亡阈值拒绝这种当前状态，不依赖接收者和出资人的数组顺序；不预判未来疾病或饥饿扣血，也不全局改变成年资格函数。
- 领取、拒绝明确绑定原赠与的 `poolId`；旧 `giftId` 不会因为另有新提议而替换接收者、份额、期限或批准证据。
- 原先要求批准人亲自与提议人在场同意不变。双方批准后，无需一直在储物处或接收者身边；仍然有效的同意不能仅因成年人离开现场而撤销。
- 途中使用窄的 `householdGiftActivityReason` 复核原记录、身份、资格、期限与实物。已经选定的储物地址不会因绕路暂时超过八格而遗忘，也不要求两位批准人在走向储物处的每一步都近身；首次选择和实际完成仍进行原来的完整现场校验。
- 失效不改写 `approvedAt`、`costs`、原到期时间，也不伪造本人撤回。状态按原规则成为 `expired`；恢复能力不自动复活旧赠与。
- 只返还实际剩余份额，仍留原储物处，不移动到成年人的随身库存。不造物、不代少年接受、不自动装备或捕鱼，不新增存档字段或迁移补偿。

取消与交付仍按实际已完成事务的顺序处理。已经完成的取消立即阻止旧领取；已经完成的交付不回滚。尚在执行中的取消不假装已经完成，也不凭数组顺序推断未来意愿。

## 离线验证

`tests/family-gift-authority.test.ts` 从正式 seed5401 的最终编号菜单经 `parseChoice → submitPlan → stepWorld` 建立、接受共同账户、提议并批准赠与，再推进到领取最后 0.25 分钟。测试中的成人套装仅用于隔离权限夹具；真实原材料制造与出生后空库存来源链由 `tests/teen-fishing-supply*.test.ts` 另行验证。

10项专项覆盖决定能力、表达能力、离镇，接收者先后顺序，纯菜单不写状态，直接完成和内存 SQLite 重载，已取消旧提议不能替换成新提议，实物不足只退剩余，以及已批准者离开现场仍可交付。分别核对钱款总额、原份额、随身实物、批准证据与恢复后不复活。

独立审查见[审查记录](../reviews/family-gift-authority.md)。

冻结前验证：本专项10项、独立审查11项及相邻家庭、口粮可达性、九人实物链共73项通过；最终生产版本另复跑少年来源链17项通过。两组均无失败、跳过或取消。独立审查发现的死亡登记顺序与合法绕行回退均已关闭。

```sh
node --import tsx --test tests/family-gift-authority.test.ts tests/family-gift-authority-review.test.ts tests/household.test.ts tests/household-food-options.test.ts tests/household-food-options-review.test.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc -p tsconfig.server.json
node --input-type=module -e "import {build} from 'vite'; await build({configFile:false,envFile:false,base:'/ai-town/'});"
node --import tsx --test tests/*.test.ts
node --import tsx scripts/acceptance-nine-food-chain.mjs --offline
git diff --check
```

与少年来源链改动一起冻结后的统一验证：

- 305个测试文件，3601/3601通过，0失败、0取消、0跳过，约207.1秒。
- 类型检查、服务端编译、显式关闭环境与配置文件的Vite构建、diff空白检查通过。Vite仍有主包超过500 kB的体积警告，不是构建失败。
- 独立九人粮链脚本通过：4次SQLite关闭重开，229项选定且完成，0待完成、0失败；末态9人存活。根菜45+12−1−48=8，钱款1295守恒；家庭赠与实际领取2份，随后独立吃1份、余1份。
- 九人脚本的 `realModelExecuted` 为false，完整食物账与长期自主生存验收仍未声明通过。

仅使用合成世界和内存 SQLite，不读取密钥或真实存档，不调用模型、浏览器或 npm，不提交推送。结果不代表真实模型自主或长期生存验收。
