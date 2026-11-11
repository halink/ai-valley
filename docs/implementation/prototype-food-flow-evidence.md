# 鲜鱼晾晒原型食物流证据

## 原有物理规则与记录位置

沿用默认关闭的 `stepWorldWithFoodEvidence` / `directEatingEvidence`。此批只观察已有本人原型试验，不增加配方、补给、权限、自动选择或存档字段。

- 绘图、组装、菜单查看、计划接受以及行走都不扣鲜鱼，不记录食品投入。只有本人到达实际试验位置、原工作/权限检查通过，首次 `workPrototype` 的真实 `foodTransaction` 扣除鲜鱼后，才记录 `processed / prototype_trial / started`。
- `started.inputs` 是本人实际扣除的2至6份鱼，`outputs:[]`。输入可为原通用鲜鱼或已有鱼种，数量来自真实试验输入。投入已从本人食品库存消失，试验中的 `input/sourceLots` 是历史记录，不是 `foodContainers` 管理的在制库存。
- 成功结算 `succeeded` 只记录本次真正新增的鱼干，数量为原试验规则的 `floor(batchSize/2)`，`inputs:[]`。这不是第二次扣鱼，也不是净新增粮食。
- 超载、期限、雨水或日照不足导致 `failed`；本人放弃已有试验导致 `abandoned`。两者都是 `inputs:[] / outputs:[]`，说明已投入鱼没有返还、没有产物。终态没有新的实物扣减，不补造损失数量，不记成腐败。放弃从未投入鱼的组装品或已结束试验，不产生新的食品回执。
- 尚在本人库存的鱼真正腐败时，仍由已有 `foodLosses` 记录物理扣减。已投入试验过期的失败不是这个切片中的第二次腐败。

原组装材料、劳动时长、天气测量、产量、耐用变化和个人知识不变。行业 `industry_craft` 的鱼干配方及受雇加工仍走各自完成路径，不重复登记为原型试验。

## 身份、原批次与版本

每条记录保留本次实际事件和计划、本人容器，以及原 `trialId/prototypeId/designId/buildingId/startedAt`。`definition` 来自已保存试验的 `invention/air-drying@1`，不是当前活动版本。放弃时即使人在另一合法工位，也仍引用原试验工位；没有给历史记录补造地点或实体。`inputItem/inputQuantity` 在终态只是关联此前投入的身份信息，不能再加入加工投入累计。

开始回执在交易可能初始化或修补食品 ledger 前读取当前原批次，按实际最早到期份序取量，使用批次自身定义中的营养。缺失、不完整、数量不一致、非法或当次修补的元数据保持 `lots/nutrition:null`，不回退到当前营养或商品默认值。原批次存在但其营养未知时，只保留能证明的批次字段。成功输出只接受实际交易新建的鱼干批次，不把库存差或初始化修补当作产出来源。

试验历史 `sourceLots` 可能来自原有初始化修补，故终态不利用它追溯认证或重放食品投入。旧存档没有跨历史来源证明位，更早已修补并保存的元数据无法与真实生成批次区分。本批不声称提供这种历史来源认证。

重载时可以只观察到终态，不能因此补一条开始投入。观察完整时间段与观察到完整试验生命周期是不同概念。已有开始/终态之间身份必须一致，同一试验不能重复开始、重复终结或终结后重新开始。同一计划的不同实际事件不被错误合并。

## 提交、schema与统计边界

运行时保持原顺序：在隔离草稿中执行，durable commit成功并安装已提交世界后，才发布冻结证据。数据库中止或版本竞争不发布草稿回执、不推进证据状态；恢复后只记录真正成功的提交，重启不重播已结束试验。观察器关闭、抛错、预测副本与决策检查均不能改变真实世界。

新覆盖为 `gather_harvest_cook_fish_hunt_growth_craft_employment_house_custody_seed_prototype_v1`。包括上一版 `...seed_v1` 的旧覆盖仍可读，但不能证明原型覆盖，当前汇总保持 `null`。缺步或缺标记不作零。

严格 schema 限定阶段、固定试验版本、鱼种、数量、身份、人容器一致性、开始与终态时间、合法失败原因及每阶段准确的投入/输出。原批次数量和营养须一致，成功输出须为该时点的新鱼干。拒绝未知字段、访问器、符号、异常原型、稀疏数组和非有限数量。跨回执还检查试验阶段重复、身份改变及跨切片事件重用；接收失败不得留下半步累计。

日报依照每条回执的时间归属，开始鱼投入只进 `processingInputs`，成功鱼干只进 `processingOutputs`，失败/放弃只保留终态事实。固定九人 helper 按实际本人容器归属统计九人/公共范围，外部居民另列；原型加工不进入 `sourceAdded` 或 `nineIntakeTotals`。原有公共汇总不双计。

这仍不是完整账本。`foodProduction/foodConsumption:null`、`completeFoodLedger:false`，其他未覆盖转换、消费、所有权变化、边界转移与损失仍未知。加工前后的数量或营养差不能自动称为损失、净产量或摄入；脚本菜单选择也不是实际模型行为或可持续性验收。

## 离线验证

```sh
TSX_DISABLE_CACHE=1 node --import tsx --test tests/food-flow-prototype*.test.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc -p tsconfig.server.json
node --input-type=module -e "import {build} from 'vite'; await build({envFile:false});"
TSX_DISABLE_CACHE=1 node --import tsx --test tests/*.test.ts
TSX_DISABLE_CACHE=1 node --import tsx scripts/acceptance-nine-food-chain.mjs --offline
node scripts/acceptance-long-run.mjs 1 --daily-json
```

测试仅使用合成世界、真实最终编号菜单、引擎步骤和隔离SQLite。未读取密钥或真实存档，未使用外部模型、浏览器或npm；保持工作区，不提交、不推送。独立审查见[原型食物流审查](../reviews/prototype-food-flow-evidence.md)。

## 本轮验证结果（2026-11-07）

- 新原型专项48项：真实菜单与引擎18项、durable commit10项、严格schema/日报/九人6项、独立review10项、真实菜单对账2项、writer封存及旧覆盖往返2项均通过。
- 开始、成功、失败、放弃分别经过真实SQLite trigger中止和版本竞争。八张持久表、内存世界和证据游标在失败后保持不变；成功重试仅发布一次，重载不重播。所有网络和模型调用计数为0。
- 真实菜单成功场景独立核对实际扣鱼2、鱼干新增1，失败场景扣鱼4、产物0。日报和固定九人helper分别吻合物理变动，失败终态不追加扣鱼；外部所有者、冲突范围、未知批次及旧覆盖另外检查。
- 旧九人主链229/229动作、6242分钟、四次SQLite重开通过，原收获与留种对账不变。一年隔离回归113条日报、161280分钟，48次留种的48根菜→96种子与日报和原计数相等，年度末重载通过。这两条旧场景没有安排原型试验，其原型回执为0，不作为原型产量或自主选择证据。
- TypeScript检查、服务端编译及禁用环境文件读取的Vite构建通过，仍有既有大分块警告；`git diff --check`通过。独立审查没有发现阻断问题。
- 最终全库离线测试 **3216/3216** 通过，失败、跳过、取消均为0（233.8秒）。最终准备清单覆盖说明同步后，相关11项验收测试及TypeScript/服务端编译再次通过。工作区保持未提交、未推送。
