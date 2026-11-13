> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# 野鸭按实际可食目标觅食

本项修复野鸭在岸边与种子食源间反复换目标的问题，不增加动物、食物、鱼群或繁育速度。基线为 `ffeb848`，狼的追猎、狐狸伏击、有限种群和共享警戒结构保持该基线，不携带曾试验但未接受的狼追猎改动。本文记录鸭单项阶段；当前候选另含经独立对照的[鹿真实浆果补缺](deer-berry-foraging.md)，最终联合验证见该文，不能把本文鸭单项结果当作最终版本结果。

## 原因与修复

旧逻辑看到岸边所在水域总鱼数大于零就走向岸边，但真正吃鱼还要求当前季节/时段有匹配鱼种、该种有库存、实际鱼群在四格连通水路内且没有洪水阻断。当这些条件不成立时，鸭会走向仍有种子的食源；下一步又被水域总数拉回，来回振荡，始终未接触种子。

`availableWildFishAt` 与真正取食共用上述实际条件。目标查询不扣鱼、不恢复库存，也不在缺少初始钓鱼规则的旧世界中补写定义；原正常钓鱼初始化恢复规则后才可选择鱼目标。真正吃鱼仍调用原 `takeFish(..., 'eaten')`，同时减少水域和分种存量、增加该种捕食账。

野鸭已选择且仍有存量的种子目标保持到实际接触，鱼窗口中途打开不会抢走仍有效的旅程。种子耗尽、路径失败或既有更高优先行为打断后可以重新选择。到达才扣种子；如果种子目标后来被阻断，而岸边确有可吃的鱼，鸭仍能放弃旧目标去取鱼。没有新增食物记忆状态或存档迁移。

## 守恒、失败与恢复

新增 `tests/duck-foraging.test.ts` 共11项：原振荡红灯反例、无窗口/无该鱼种/鱼群过远、跨窗口保持种子旅程、耗尽后的切换、普通世界及缺定义旧世界只读查询、两鸭竞争最后一条鱼、洪水、目的地后来阻断、SQLite重载和同刻重入。

原反例先在未修复源码上失败，再在修复后确认种子实际减少、饥饿缓解，鱼库存没有错误扣减。竞争测试验证最后一条鱼只供一只鸭进食，重复推进不重复取用。查询不会创造鱼或自动补种；既有捕食、饥渴和衰老死亡仍生效。该修复不改变[有限野生种群](wildlife-population.md)的登记、真实亲代与容量边界。

鸭单项冻结源码阶段验证：定向回归111/111、[独立复核](../reviews/duck-foraging.md)另10项、全仓5410/5410（零跳过）、类型检查、服务端编译、禁用`.env`加载的生产构建及差异检查均通过。构建仍有原有前端包超过500kB的提示。这些数字不冒充后续鹿补缺版本的全量验证。

## 三年默认世界对照

种子5401、5402、7777分别运行基线和鸭单项候选336游戏日。各对照的初始完整世界哈希相同，所有版本都只解除暂停，不为居民提供计划。每条轨迹推进483840个完整分钟tick、逐日SQLite重开336次，三文件源码指纹全程不变；鱼账、食源与种群会计、容量和野生动物非有限数检查均无异常。

| 种子 | 基线第336日：鸭 / 鹿 | 鸭修复第336日：鸭 / 鹿 | 候选实际籽食次数 | 候选实际鱼食次数 |
|---|---|---|---:|---:|
| 5401 | 0 / 1 | 4 / 1 | 680 | 194 |
| 5402 | 0 / 1 | 4 / 0 | 677 | 198 |
| 7777 | 0 / 1 | 2 / 1 | 682 | 190 |

基线三种子鸭的籽食均为0，全部在112日前因饥饿灭绝。单项修复在35日与112日均保留4鸭；种子和鱼仍由真实库存供给。三组候选鱼账分别为 `792 + 182 − 194 = 780`、`792 + 182 − 198 = 776`、`792 + 178 − 190 = 780`，其中迁入和迁出分别相抵268、283、256次，不算新增鱼。

边界同样重要：seed5402的鹿在92.045833日因饥饿灭绝，而基线保留一只鹿。随后逐分钟诊断确认：鸭位置改变使原版狼改追鸭而未袭鸡，狼提前饿死；鹿少了一次避狼绕行，实际浆果接触和有限browse分配随之改变。仅用原死亡API提前杀死基线同一只狼的反事实，到112日的145447分钟内，存活鹿完整状态与鸭单项候选零差异，七条鹿死亡ID、时刻和原因相同。首鹿分叉之前的鹿、泉、浆果和browse一致，因此证据指向捕食者位置介导的行为链，而非鸭直接抢走鹿食物或首个随机数分叉。该对照不改变生产逻辑，也不代表任意补足营养就能修复。后续鹿补缺与结果单独记录。

seed7777在333.547917日和335.642361日又有两鸭因饥饿死亡；修复没有赋予无敌或无限繁育。狼、狐、兔和野猪的既有长期失败也没有因此解决。

这些结果支持“鸭终于能取用实际可达食源”，不支持“整个生态已经平衡”。此前另测的鸭与狼追猎联合候选会让三种子的鹿均更早清零，因此未纳入本单项源码；本文不能作为该联合实验的验收结果。更改猎物营养预算、幼崽需求或避难机制需要独立设计和对照，未在此夹带实施。

## 离线长期复验

`scripts/wildlife-longevity.mjs` 从当前源码建立全新合成世界，只解除暂停，不下达居民计划，逐分钟运行完整 `stepWorld(w, 1)`。它拒绝复用输出目录，强制空环境和已有离线护栏，不读取真实存档或凭据，不调用真实模型。

夹具记录分种鱼账、食源生长与所有实际扣量（包括繁育使用）、出生死亡、有限容量、实际取食与追猎事件。被当前动物历史列表剪除的当刻死亡也保留唯一记录。鱼的水域间迁入与迁出需相抵，不能算新生；新个体记录只在本夹具初始野兽已经完整登记的新建世界边界内解释为出生。

逐日关闭并重开SQLite句柄、`loadForRuntime`后比较完整非账本状态；这不是进程崩溃测试，也不是裁剪前后完整事件与收据逐字一致性证明。35、112、224、336日输出检查点，336日为三个游戏年。未完成目标时长、发现会计异常或脚本列出的三份源码指纹改变会返回失败，不涵盖全部源码与依赖的变更检测。

物种灭绝会记录，但不会让夹具退出失败。`issues=[]` 与退出码0不能代替生态存续验收。鱼和种群会计在每日边界核对，食源扣量在逐分钟核对；它不证明任何中间状态都已穷尽检查。单餐饥饿下降是扣除该分钟代谢后的净值，不能拿它代替名义营养总额。

```sh
env -i "$(command -v node)" --import ./scripts/acceptance-offline-guard.mjs \
  --import ./node_modules/tsx/dist/loader.mjs ./scripts/wildlife-longevity.mjs \
  --seeds 5401,5402,7777 --days 336 \
  --output "$PWD/output/duck-foraging-new-run" --wall-seconds 1800

node --import tsx --test tests/duck-foraging.test.ts tests/frontier-wildlife.test.ts \
  tests/frontier-ecology.test.ts tests/predator-ecology.test.ts tests/fish-species.test.ts \
  tests/fish-shoals.test.ts tests/wildlife-population.test.ts
node scripts/test.mjs --test-concurrency=4
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc -p tsconfig.server.json
env -i "$(command -v node)" --input-type=module \
  -e "import {build} from 'vite'; await build({envDir:false});"
git diff --check
```

墙钟上限按种子分别计算，必须使用全新的项目内输出目录。这里验证实际资源、行为与所测时段的种群变化，不证明无限期存续；单一创始配偶、幼崽需求和各营养层供给仍有独立限制。

## English summary

This document preserves the **duck-only stage**, based on `ffeb848`. The current candidate also includes the separately reviewed [deer berry fallback](deer-berry-foraging.md). No experimental wolf pursuit code was retained.

Ducks previously alternated between stocked water and real seeds even when the stocked fish were not edible at that time or position. The pure availability query now applies the same species, time window, shoal reach and flood checks as actual fishing. Valid seed journeys remain selected until physical contact or invalidation. Queries neither deduct fish nor initialize missing rules; actual eating still deducts finite fish or seed stock exactly once. No new persistent state or save migration is needed.

The duck-only stage passed 111 focused tests, 10 additional independent tests, and 5410 full-suite tests with no skips, plus type checking and both builds. These are historical results, not the later deer candidate's full-suite count.

Three identical-initial-state, no-resident-plan worlds ran for 336 game days, with full minute ticks and daily SQLite handle reopen. Duck-only endpoints were 4/4/2 ducks for seeds 5401/5402/7777, versus zero in the original baseline. All meals consumed existing resources. However, seed 5402 lost all deer at day 92.045833. Controlled tracing established a predator-mediated route and food-allocation chain: changed duck position diverted the unchanged wolf away from a chicken meal; the wolf died earlier, removing a deer avoidance detour. Killing that same baseline wolf early through the normal death API reproduced all living deer states through day 112 and all seven deer deaths. This was not direct duck–deer resource competition, and it was not hidden from acceptance.

The later deer fallback addresses a missing way to reach existing berries; it does not make the ecosystem self-sustaining. Two ducks still starved near day 336 in seed 7777, and wolves, foxes, hares and boars still failed. Ledger checks and exit code zero do not prove species persistence. SQLite handle reopen is not process-crash recovery; only the explicitly listed source files are fingerprinted.
