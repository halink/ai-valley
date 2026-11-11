# 雇佣食物加工完工证据

## 真实签约、预留与完工

沿用默认关闭的 `stepWorldWithFoodEvidence` / `directEatingEvidence`，仅在 `employmentWorkError` 原完工事务将成品加入商店、增加原考勤完成计数、发出原事件并移除在制批次时，记录独立 `processed / employment_processing`。普通 `cook`、本人 `industry_craft`、受雇者工作分开，不把成品计入 `sourceAdded`，不称为净生产或完整消费账。

招聘与履约仍走原 `open → post → apply → select → accept → work`。招聘时绑定的历史配方是原约定，当前激活配方不会改约；新批次投入/产出与合同快照的引用隔离沿用[已有守恒修复](employment-conservation.md)。食品腐败或实际库存、产出、耗时、进度不符时，原引擎取消批次并只退回实际余料，不补造物资。观察代码不修配方、不改变劳动或退款逻辑。

开工把商店原料转入 `employment:<contractId>` 是预留，不是完成加工。分次工作、等待、拒绝、材料/工位竞争、腐败取消、辞职、解雇及退料均不生成转换。损失只由独立 `foodLosses` 在原实物过期扣减处记录。工资依原实际劳动分钟结算，与证据及完成数量无关；原料与成品仍归商店，工人的工资账户不被误当食品容器。

## 每条事实的范围

- 原游戏时点、完成事件 ID、当前实际工作计划 ID、工人 `residentId`、雇主 `employerId`、合同、商店和实际工位 ID。
- 投入容器 `employment:<contractId>`，产出容器 `business:<businessId>`。
- `day` 是引擎原考勤日 `floor(at / DAY)`，`batchNumber` 是原考勤当天已完成批次计数。合同没有持久批次 ID，因此不创造一个存档字段；三者 `(contractId, day, batchNumber)` 共同识别实际完工，跨计划、重载或新日不会混为同一批。
- 原签约 `recipeDefinition` 及配方机器快照 `id/input/output/minutes/station/skill/minimum`，不携带名称、招聘文本、事件正文、意图、prompt、错误正文或世界副本。
- 完工前真实批次全部 `inputs` 和原事务交付的全部 `outputs`。雇佣守恒要求它们与原配方严格一致，不沿用 craft 对额外历史实物的宽松输入规则。水、木材等非食品腿照实保留，营养为 0。

原配方任一正数量投入或产出的 `goods[item].life > 0` 即属于本切片，包括不能直接食用的猎肉、各鱼种、谷物、奶及留种等食品转非食品。纯木板、布料、金属等不涉及易腐食品的工作不记录。多批完工可属于同一 work 计划，每批有独立原事件和当天序号，不按计划去重，也不以动作次数推断产量。

## 原批次、未知与不变性

投入只在真实完工前读取当前在制容器的原 ledger，保留数量、生产/到期时间、原食品定义及该定义中可核实的营养。缺失、损坏、未来或不能覆盖实物数量的批次保持 `lots:null`、`nutrition:null`；同次捕获中的原引擎初始化修补不被认证为原来源。有效批次缺少营养定义时保留批次、营养未知，不回退到当前定义或商品默认值。

输出只在原 `foodTransaction` 真正创建新鲜批次时补上批次。商店已有同品成品不能混入；同一食品同时作为输入和输出时，原交易可保留/转移其批次而仅创建净新增批次，无法证明完整毛输出的新批次时保留实际数量、批次和营养未知，不假装刷新保质期。

收集绑定单次 World 对象的 WeakMap，预测副本不会混入；不调用额外盘点或初始化，不增加世界、模型知识、菜单、记忆或存档字段。原模拟初始化可能恢复可证明的旧合同，但证据不回溯补造更早操作。捕获失败不返回成功观测，finally 清理记录器和待匹配输出；捕获器不是引擎回滚器。

实际运行时仍只在 durable commit 成功并安装新世界后发布。提交失败不发布草稿转换，成功重试只发布一次；重载已完成合同不会重播。复制及递归冻结保护对外记录，观察器抛错不改变模拟结果。

## 覆盖、严格 schema 与日报

本批交付时标记为 `gather_harvest_cook_fish_hunt_growth_craft_employment_v1`（后续收获扩展见文末）。以前的 craft、growth、fish/hunt 标记与无标记观测仍可读、保留明细，但不能证明雇佣加工覆盖，`foodFlows.totals` 为 `null`。只有完整当前标记和显式空数组能证明该范围本步没有操作；无推进会话、缺步、时序异常、重复事件或重复合同/考勤日/批次序号也不能给出完整切片总量。

严格 writer 检查每层对象、数组与纯数据属性。额外私有字段、访问器、原型、非法身份、非有限数、错配商店/投入容器、工人与雇主相同、考勤日与时点不符、非正或分数序号、零投入、非食品快照、重复物品、任何投入/产出偏离快照及矛盾批次/营养均被拒绝。校验不查当前世界配方，以免改写历史。

日报仍分 `sourceAdded`、`processingInputs`、`processingOutputs`，数量为各操作毛值。漏采或旧覆盖使该日总量未知，明细保留；新日重新累计。日报使用 `(from,to]` 的事实时点归属，午夜属于刚结束的日报，与内部考勤日标识是不同用途。九人 helper 已接收新增完成切片，但 `completeFoodLedger:false`；当时温室收获、境外生产、跨边界转移、其他消费和损失仍有缺口，完整 `foodProduction` / `foodConsumption` 保持 `null`。

## 离线验证

```sh
TSX_DISABLE_CACHE=1 node --import tsx --test tests/food-flow-employment*.test.ts tests/employment-conservation*.test.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc -p tsconfig.server.json
node --input-type=module -e "import {build} from 'vite'; await build({envFile:false});"
TSX_DISABLE_CACHE=1 node --import tsx --test tests/*.test.ts
TSX_DISABLE_CACHE=1 node --import tsx scripts/acceptance-nine-food-chain.mjs --offline
node scripts/acceptance-long-run.mjs 1 --daily-json
```

测试采用明确合成库存和场所、真实招聘/签约/编号工作、内存 SQLite、仅本地假模型，覆盖预留与实际完工、旧签约与营养、工资/归属、腐败/退料/竞争/取消、别名修复、重复/重载、开关与预测不变性、严格 schema、版本缺测与日报、提交失败/重试及观察器失败。独立反例见[独立审查](../reviews/employment-food-processing-evidence.md)。定向组已通过 51/51（本批新增 33 项与原守恒 18 项），完整测试结果另记于末尾。

未读取密钥或真实存档，未调用真实模型、浏览器或 npm，未提交/推送。不证明真实模型主动受雇或加工、不代表九人长期生存验收、不构成完整食物或工资账本。

### 定向与长程结果（2026-11-07）

- 本批新增 **33/33**：真实引擎/岗位 13 项、持久提交与观察器 4 项、严格 schema/writer/日报 9 项、独立反例 7 项。与原雇佣守恒联合 **51/51**，失败、跳过、取消均为 0。
- 实际岗位验证包括 cook、seedkeeper、miller、dairyworker、preserver，以及不涉及易腐食品的 carpenter/herbalist 排除；自定义 cook 实测生猎肉和鲤鱼原批次。
- 提交失败验证使用内存 SQLite 的真实 trigger 中止和真实版本竞争，比较八张持久表、运行时世界、证据状态与发布数量。失败草稿零发布，成功恢复只发布一次完工；重载不重播，开关与抛错观察器不改变世界。
- 九人离线 CLI 再次完成 229/229 个脚本动作、四次 SQLite 重开，6242 分钟；根菜 `45 + 12 − 1 − 48 = 8`、种子 24、货币 1295。该主链不含 employment，不把局部真实雇佣夹具混称为九人自然模型行为。
- 一年合成隔离日报连续 161,280 分钟、113 行，食物流无漏采；264 条浆果事实为 1320 份、15,840 营养，逐日原批次、总量、事件唯一性和年度重载核对通过。该长期夹具没有 employment 或 craft，processing 两侧均为空，不据此声称长期加工、净生产或完整收支验证。
- 最终完整离线测试 **2,525/2,525** 通过，无失败、跳过或取消。类型检查、服务端编译、禁用环境文件读取的 Vite 构建与 `git diff --check` 全部通过；Vite 仍提示已有大分块警告。本次未解决该既有警告。

## 后续来源扩展

[温室与受保护代管收获证据](greenhouse-custody-harvest-evidence.md)将当前覆盖更新为 `gather_harvest_cook_fish_hunt_growth_craft_employment_house_custody_v1`。本页 employment 标记保留为旧覆盖，可读但不能证明新来源已采集；真实完工来源与加工两侧仍各自列账，完整账本保持未知。
