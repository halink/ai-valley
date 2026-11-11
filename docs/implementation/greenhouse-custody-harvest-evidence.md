# 温室与受保护代管收获的有限食物来源证据

## 实际新增与归属

沿用默认关闭的 `directEatingEvidence` / `stepWorldWithFoodEvidence`，只在两种已有行动真实完工、增加食品库存时添加 `source_added`：

- `harvest_house` 对应 `industry.harvestHouse`。原床作物成熟、本人仍有作物权且实际完成室内劳动后，原 `industry.ts` 增加本人随身食品并清空该床。本回执保留原 `bed.id`、楼房、床序号和作物主人；`container` 是 `person:<居民 ID>`，`ownerId` 必须等于实际行动居民。
- `custody_harvest` 对应 `production.custodyHarvest`。原 `protected-custody.ts` 先核验原有限委托、当事人接受、独立复核、期限、原资产与未重放工作序号，再实际收获。产物在田地原址创建 `custody-stock:<委托 ID>:<原 workSerial>` 包；保留真实代管人、亡者遗产所有者、孩子、受保护份额、委托、原田地和原工作序号。它不进代管人或孩子的背包。份额中的 inventory 是权益摘要，不能再算一次实物。

两条分支均不经过普通 `harvest` 完成分支，故分别新增一次，不重复普通田地收获。本次没有改变任何产量、成长、工作时长、技能、土壤、许可、报销、监护或产权规则；温室仍取原作物的 yield，代管田地仍取 `cropYieldAt` 的实际结果。

种植、浇水、留种、预留、报价、购买、继承和所有权交接均不是本次来源新增。`harvestFruit`、`collectAnimal`、`custodyCollectAnimal` 移动已存在的水果或畜产品原批次，不能再次计生产。纤维、药草、饲料等非食品作物收获保持原物理行为，但不进入本切片。

## 原版本、原批次与未知

回执 `definition` 来自被收获作物的原 `crop.definition`，不是当前激活作物版本或行业动作定义。数量来自该次真实变更，不由库存端点、动作数或未来预测倒推。已有完成事件和已接受计划提供 `eventId` / `planId`，没有新增世界事件、序号或假批次 ID。

新食品批次由同一个既有 `foodTransaction` 实际创建，观察钩子只接收本次新增量。旧同种库存、旧批次初始化或修补不会被追认成新产物。`producedAt`、`expiresAt`、食品定义和营养均沿实际 fresh lot；没有营养或批次不能完整证明时保留 `null`，不以当前默认值补齐。食品批次没有额外 UUID，原元数据不应被描述成全局批次身份。

观察不调用初始化、盘点或修补函数，不添加世界/存档字段，不进入居民知识、决策输入或预测副本。采集仍绑定一次同步 World 调用；抛错调用没有成功观测，并清理临时采集器。它不是另一套物理回滚器。

## 覆盖、日报、九人范围

当前 `foodFlowCoverage` 为 `gather_harvest_cook_fish_hunt_growth_craft_employment_house_custody_v1`。此前 employment/craft/growth/fish-hunt 标记或缺标记记录仍可读，明细保留，但不能证明新增两条路径被观察，当前范围总量保持未知。完整当前覆盖与空数组才证明本步没有这些已覆盖操作。

严格 schema 检查纯数据属性、精确字段、合法身份、非负整数床序号/工作序号、个人或代管包容器的一致性、一种正食品产物及批次数量/营养/新生产时点。它不凭一条形状正确的回执证明历史授权；真实性仍来自原引擎与持久提交链。

运行时 audit、日报与九人收集器对 `custodyId + workSerial` 排重，不能通过换事件 ID 重放同次收获。床 ID 不是一次性生产身份，同床之后真实再种再收必须允许。日界沿 `(fromMinute,toMinute]`，午夜完成归刚结束的一日；旧覆盖/漏采使当日总量未知，新日重新累计。

固定九人 helper 仍以开局九个实际 ID 加公共实物为范围。代管产物按 `estateOwnerId` 分类，而不是代管人或孩子；外人替九人遗产劳动不把产物排除，九人替范围外遗产劳动也不把它拉入。端点归属与回执冲突保持 unknown。原份额摘要不重复统计，完整 `foodProduction` / `foodConsumption` 继续为 `null`。

## 持久提交与离线限制

运行时仍先 durable commit，再安装世界和发布冻结回执。物理动作已在草稿完成但 SQLite 提交或版本竞争失败时，草稿与观察均不发布；成功重试仅发布一次。未完成活动可恢复后继续劳动，已完成活动重载不重播；新观察会话不回填历史。默认关闭、打开与观察器失败都不改变模拟权限或保存状态。

本次没有覆盖全部食品来源、留种、原型试制、未列生产/转移/消费路径，因此不是完整生产账、净收支账或持续供应证明。既有加工切片可能记录它原先已覆盖的食物相关留种配方，不意味着本次把普通 `saveSeed` 纳入。

离线验证仅使用合成世界、真实编号菜单和引擎、临时或内存 SQLite，以及明确离线模型替身：

```sh
node --import tsx --test tests/food-flow-harvest*.test.ts
node --import tsx --test tests/food-flow*.test.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc -p tsconfig.server.json
node --input-type=module -e "import {build} from 'vite'; await build({envFile:false});"
node --import tsx --test tests/*.test.ts
node --import tsx scripts/acceptance-nine-food-chain.mjs --offline
node scripts/acceptance-long-run.mjs 1 --daily-json
```

独立反例与边界见[独立审查](../reviews/greenhouse-custody-harvest-evidence.md)。未读取密钥或真实存档，未调用真实模型、浏览器或 npm，未提交或推送。离线九人脚本与年度合成生命周期都不代表真实模型验收。

## 实物范围与长程核对（2026-11-07）

- 新增固定九人边界回归使用九个真实不同居民对象，外部参与者另行保留，不冒称未经改造的 seed5401。真实菜单执行两种收获，每分钟采集；代管交叉场景覆盖「外部代管人/孩子、九人遗产所有者」及相反情况。新增实物恰为 12 根菜，份额摘要中的另 12 不二次计数；劳动中与完成后 SQLite 重载，随后继续三分钟没有重播，权限及产权未改。
- 原 seed5401 九人离线 CLI 原样复验：229/229 个菜单动作完成、6242 游戏分钟、四次 SQLite 重开；根菜 `45 + 12 − 1 − 48 = 8`，种子 24，货币 1295。此主链只有普通田地收获，没有温室或代管收获；新增路径由上面的独立合成规则夹具证明。
- 一年隔离生命周期现确实记录温室来源：96 次温室收获、1152 根菜、23040 营养；另有264 次浆果、1320 份、15840 营养。共 360 条来源回执、38880 营养，113 条日报连续覆盖 161280 游戏分钟，逐日份数、批次数量/营养、新生产时点及事件唯一性核对一致，年度内存 SQLite 重载成功。
- 年度夹具没有代管收获，也没有普通 cook / craft / employment 转换；不能将年度温室证据冒充代管长期发生或完整加工账。所有完整生产/消费字段仍为 `null`。

## 最终离线结果（2026-11-07）

- 新增收获专项 **51/51** 通过：真实菜单/引擎/运行时 24 项、真实固定九人范围 4 项、严格 schema/日报 7 项、sealed writer/readback 2 项、独立反例 14 项。全食物流组 **182/182** 通过。
- 最终全库 **3132/3132** 通过，无失败、跳过或取消。最终类型检查、服务端编译、明确禁用环境文件读取的 Vite 构建、`git diff --check` 通过。Vite 保留已有大分块警告。
- 独立审查推动补严三种不可能的代管身份相等；最终检查另发现新分类读取必须容忍损坏旧作物的未知物品值，已用可选读取确保不新增异常。两个真实引擎反例确认观察开关下物理结果完全相同，未知物品不被计为食品。
- 两种收获均经真实 SQLite trigger 中止与版本竞争，在实际完成草稿后拒绝提交，核对八张持久表、运行时世界及证据状态不变；恢复各只发布一次。writer 重读保留原回执与新覆盖，篡改源实体使总量未知。
- 最终构建的一年隔离日报与原九人 CLI 再次执行并核对，结果与上节一致。未执行真实模型验收，未提交或推送。


## 后续本人留种转换覆盖

[本人留种加工证据](seed-saving-food-flow-evidence.md)新增真实 `production.saveSeed` 的 `processed/saveSeed` 回执：根菜1份投入、非食品种子2份输出（零营养、无食品批次）。当前覆盖更新为 `gather_harvest_cook_fish_hunt_growth_craft_employment_house_custody_seed_v1`，此前标记可读但不能证明留种已观察。日报与九人主链只计加工两侧，不算新增粮食或摄入；原批次未知保持null，plantCrop及未列路径仍在范围外，完整生产/消费账仍未知。
