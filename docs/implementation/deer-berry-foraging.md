> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# 鹿的有限浆果觅食 / Bounded deer berry foraging

## 范围

基线为 `ffeb848147ebd883e678258a9bbb204d25b8c092`。本候选将[野鸭真实食源选择](duck-foraging.md)与鹿的有限浆果补缺组合。只修补可达食物没有被有效取用的行为缺口，不调整食物生成、营养、代谢、亲缘、妊娠、种群容量或初始数量，不含被放弃的狼追猎实验。

鹿曾经只机会性吃相邻浆果，已知browse耗尽后不会主动走向附近真实浆果。鸭行为修正还揭示了该弱点：seed5402的鸭位置改变使原版狼未吃到鸡、提前饿死，鹿不再避狼绕路，浆果接触和browse分配改变，最终全部饿死。逐分钟反事实复现了完整存活鹿状态与七条死亡记录。这不是补库存的理由，而是验证真实觅食缺口的依据。

## 最小实现

- 保持原饥饿门槛38、邻格机会性浆果优先级、每份浆果19点营养、实际 `amount--` 和 `lastHarvest` 更新。
- 原browse有量且原移动可以到达时，继续使用原browse；仅缺失、耗尽或原寻路失败时，才查找当前位置曼哈顿距离9格内有至少一份的真实浆果。
- 实际四向路径最多12步，每次行动只走一格，沿路排除活动灾害。移动前重查完整路径，包括缓存路径前方的新障碍、围栏与灾害。
- 已有效选择的浆果路线使用原 `activity.targetId` 和 `path`，不会因browse刚恢复一份就来回换目标。目标耗尽、删除、阻断或危险后释放旧路线，优先重新尝试有效browse。
- 到原可接触距离才扣量和给营养，不预留浆果、不提前喂食。两鹿竞争最后一份，只有实际先吃到的一只获益。危险浆果不供鹿取用；野猪的原机会性取食不变。
- 不增加持久化字段或迁移，不修改狼/狐行为、攻击距离、捕猎冷却、繁育资格或资源再生。不复活灭绝种群，缺粮仍会饿死。

## 验证与可重现性

初始22条合成反例在未补缺的鸭单项源码上先运行，15条失败、7条既有边界通过。经审查的补丁随后通过83项隔离测试，其中包含两条对历史鸭源码的逐步差分；另有独立22项反例与类型检查。历史源码差分作为实验审计保留，不向正式测试引入历史源码副本或 `output` 依赖。

正式新增 `tests/deer-berry-foraging.test.ts` 23项、`tests/wildlife-berry-observer.test.ts` 2项。覆盖真实行走/扣量、缺失与耗尽、有效browse、目标保持与失效、9格发现和12步实际路径、灾害与竞争、饥饿死亡、SQLite同刻重入/续跑、非鹿行为边界，以及透明观察器不改变世界的七日对照。

最终主仓库定向81/81通过，独立复跑这81项加22项反例，共103/103通过；全仓 **5435/5435通过，零失败、零跳过**。类型检查、服务端编译、禁用`.env`加载的Vite生产构建及差异检查通过，构建仅保留原有超过500kB的包体提示。全仓测试使用合成本地夹具，部分既有HTTP测试使用本机loopback，不调用外部网络或真实模型。最终独立审查记录见[复核报告](../reviews/deer-berry-foraging.md)。长期实验业务源码与提升后的源码逐字节相同，SHA256为 `fa7be3ec72879e38a6acac531f1100a4d3fe73ffb80330b16fb4a80f7091d36e`。

主仓库可移植莓果预载另经独立七日冒烟：10080个tick、7次SQLite重开，全部莓果事件及主要生态/资源状态与隔离长测前七日相同，确认只是导入路径提升。没有重复把同一份三年数据说成新的主仓库三年运行。

## 三年对照

复用已完成的原版与鸭单项轨迹，候选分别从相同完整初态运行seed5401、5402、7777。每组336游戏日，即三个游戏年、483840个完整分钟tick；只解除暂停，不下达居民计划，每日提交并重开SQLite句柄。三条候选共1451520个tick和1008次重开，未观察到鱼账、种群/容量、食源、非有限数、持久化状态或指定源码指纹异常。

| seed | 原版鹿 / 鸭 | 鸭单项鹿 / 鸭 | 鸭＋鹿补缺鹿 / 鸭 | 候选鹿出生 / 死亡 |
|---|---|---|---|---|
| 5401 | 1 / 0 | 1 / 4 | 6 / 4 | 4 / 1 |
| 5402 | 1 / 0 | 0 / 4 | 2 / 4 | 3 / 4 |
| 7777 | 1 / 0 | 1 / 2 | 6 / 2 | 3 / 0 |

三组候选非鹿个体的出生、死亡ID/分钟/原因、最终数量、鱼账和非鹿食源账与鸭单项完全相同。这只描述这三个合成轨迹，不能外推为所有seed或居民采集竞争下都无影响。

### 真实资源账

额外离线观察器将浆果每次赋值的正增与负减分别记录，不把同一tick吃一份又再生一份误算为零消费。它原样透传数值，未新增持久化字段；有无观察器七日完整世界状态及SQLite续跑相同。`wildlife` 消费是鹿与野猪合计，不能全部归给鹿。原版和鸭单项没有对应累计浆果账，保持未知，不当作零。

| seed | 初始浆果＋原正常再生−真实野生动物消费＝终值 | 鹿browse消费 | 鸭seeds消费 | 鱼实际消费 |
|---|---|---:|---:|---:|
| 5401 | 1778＋1071−1084＝1765 | 1010 | 680 | 194 |
| 5402 | 1378＋229−229＝1378 | 746 | 677 | 198 |
| 7777 | 2146＋1022−1027＝2141 | 1011 | 682 | 190 |

三组浆果账的其他增加/移除均为零。鱼分别仍是 `792＋182−194＝780`、`792＋182−198＝776`、`792＋178−190＝780`，池间迁移不算新生。没有通过加食物或降低需求换取存活。

### 必须保留的限制

- seed5402终点的两只鹿均为创始雌鹿，无雄鹿、无妊娠。它不是已建立的跨代繁育闭环。
- seed7777一只创始雌鹿饥饿100、健康约21.45，另一只饥饿约97.43、健康约65.99；seed5401也有健康约52.73的鹿。更多存活不等于全部健康，也不保证336日后的存续。
- 狼、狐、野兔和野猪仍在三组长期世界中灭绝；seed7777仍有两只鸭在末期饿死。本项没有解决整体食物预算、创始亲缘或幼崽需求问题。
- 只测固定三seed、无模型居民计划；不是实际存档、真实模型、居民采集竞争、无限时长或更广种子分布的验证。
- SQLite检查是同一Node进程内关闭/重开，不是崩溃或进程重启。完整非账本状态一致不代表被正常裁剪的事件/收据逐字一致。
- 长测退出0仅表示完成和指定会计检查通过，物种灭绝不会触发失败。源码哈希检查只覆盖脚本明确列出的文件，不是整个仓库或依赖树证明。

## 离线命令

从仓库根目录运行，使用已安装依赖；输出必须是项目内全新目录。莓果预载仅用于本合成观察，不接入正常生产启动：

```sh
mkdir -p output
env -i "$(command -v node)" --import ./scripts/acceptance-offline-guard.mjs \
  --import ./node_modules/tsx/dist/loader.mjs \
  --import ./scripts/wildlife-berry-preload.mjs \
  ./scripts/wildlife-longevity.mjs --seeds 5401,5402,7777 --days 336 \
  --output "$PWD/output/duck-deer-new-run" --wall-seconds 7200

env -i "$(command -v node)" --import ./scripts/acceptance-offline-guard.mjs \
  --import ./node_modules/tsx/dist/loader.mjs --test \
  tests/deer-berry-foraging.test.ts tests/wildlife-berry-observer.test.ts \
  tests/duck-foraging.test.ts tests/frontier-wildlife.test.ts tests/wildlife-population.test.ts
env -i "$(command -v node)" scripts/test.mjs --test-concurrency=4
env -i "$(command -v node)" node_modules/typescript/bin/tsc --noEmit
env -i "$(command -v node)" node_modules/typescript/bin/tsc -p tsconfig.server.json
env -i "$(command -v node)" --input-type=module \
  -e "import {build} from 'vite'; await build({envDir:false});"
git diff --check
```

观察器使用此Node/tsx源码栈区分正常再生和野生动物实际扣量，限本实验的固定资源集合，不是通用在线世界账本；未识别来源保留在其他增减项，不隐藏它。`berry-changes.jsonl`、`berry-summary.json`与长期夹具的逐日/检查点/最终记录共同提供复验依据。观察脚本不改变正常生产逻辑，不能将观察器的会计检查表述为所有中间状态已穷尽验证。

## English

### Scope and mechanism

This candidate combines the duck's actual-food selection fix with a **bounded deer berry fallback**, based on `ffeb848`. It changes access to existing finite food, not food supply, metabolism, nutrition, population caps, kinship, pregnancy, initial stock or predator pursuit. No discarded wolf experiment is included, and no save migration is required.

Deer previously ate adjacent berries opportunistically but did not deliberately reach nearby berries when their known browse failed. The duck-only seed 5402 regression exposed this weakness: changed duck position diverted an unchanged wolf from a chicken meal; its earlier death removed a deer avoidance detour, changing berry contact and finite browse allocation. A controlled early death through the original API reproduced all living deer states and all seven deer deaths through day 112. This was not a license to add resources.

The fallback preserves the original hunger threshold of 38, adjacent berry priority, actual one-unit deduction, harvest timestamp and 19-point meal. Available reachable browse retains its old behavior. Only missing, depleted or unreachable browse opens a search for real berries within Manhattan distance 9 and an actual path of at most 12 steps. Each action moves one tile and rechecks the route against obstacles and active disasters. A valid berry journey persists across a browse refill; invalid targets are released. Food is consumed only at physical contact. Competing deer cannot duplicate the final unit, and animals without food still die.

### Evidence

The isolated candidate first had 15 failing reproduction cases on duck-only source, with seven existing boundaries already passing. After the patch, 83 isolated tests and 22 independent cases passed. Two historical-source differential tests remain audit evidence rather than shipping output-dependent tests. The formal additions are 23 deer cases and two observer cases. The promoted source passed 81 focused tests, an independent 103-test run (the same 81 plus 22 reviewer cases), and **5435/5435 full-suite tests with zero failures or skips**. Type checking, server compilation, Vite production build with environment-file loading disabled, and diff checks passed; the existing large-bundle warning remains. Existing full-suite HTTP tests use local loopback fixtures, not external services or real models.

Promoted runtime source is byte-identical to the three-year candidate, with SHA256 `fa7be3ec72879e38a6acac531f1100a4d3fe73ffb80330b16fb4a80f7091d36e`. An independent seven-day smoke test of the portable main-repository preload matched the isolated run's berry events and principal ecological/resource states, with 10080 ticks and seven SQLite reopen cycles. This validates the path-only promotion; it is not a second set of three-year runs.

All three 336-day candidates started with exactly the same full world hash as the matching original and duck-only runs. Each advanced 483840 full minute ticks and reopened SQLite 336 times without resident plans. The table above gives the complete endpoint comparison: deer improved to **6/2/6**, versus original **1/1/1** and duck-only **1/0/1**; ducks stayed **4/4/2**. Non-deer individual birth/death records, endpoint counts, fish ledgers and non-deer food-patch ledgers exactly matched duck-only for these trajectories.

The transparent offline observer separates each positive and negative berry write, including consumption and regrowth in the same tick. Seven-day whole-world comparisons and SQLite continuation show no trajectory change from observation. Total wildlife berry consumption was 1084/229/1027, with only original regrowth and no other additions or removals; these totals include boars and must not be attributed entirely to deer. Baseline and duck-only cumulative berries were not measured. Fish still obeyed their original finite balances.

### Limits

This is a local foraging and observed survival improvement, **not a self-sustaining ecosystem**. Seed 5402 ends with two females and no pregnancy, so it has no demonstrated reproductive continuation. Seed 7777 includes a deer at hunger 100 and health about 21.45, plus another at hunger 97.43; survival count does not mean healthy animals or survival beyond the measured period. Wolves, foxes, hares and boars still go extinct, and two ducks still starve late in seed 7777.

The evidence covers three fixed synthetic seeds with no model-driven resident plans, not real saves, resident harvesting competition or all possible seeds. Daily SQLite handle reopen is not crash/process-restart recovery. Successful exit and balanced ledgers do not assert species persistence, and fingerprints cover only named source files. The optional berry preload is an experiment-only instrument with source-stack classification for this Node/tsx layout, not a production accounting system. The commands above use existing dependencies, empty environment for long runs, the offline guard, and a fresh project-local output directory.
