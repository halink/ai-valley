# 本人留种加工食物流证据

## 仅在真实完工记录两条腿

沿用默认关闭的 `stepWorldWithFoodEvidence` / `directEatingEvidence`。本批仅在原 `production.saveSeed` 的完成路径，原材料核验、实际扣减、种子增加和原事件发出之后，记录 `processed / saveSeed`：本人一份 `turnip` 转为两份 `seed`。必须是同一真实活动、剩余工作已经完成，不能把直接调用完成函数、菜单查看、计划接受或预测执行当作真实完工证据。

原规则仍是15分钟、本人现物、扣一份根菜、加两份种子及原能量变化。没有添加配方、补给、权限、强制选择或动作，没有改引擎的生产、食物、知识及持久化语义。最终编号菜单使用原议程轮转；测试通过实际选择等待来等菜单出现，不钉住留种选项。

此动作没有独立的在制批次、recipe快照或持久批次ID。回执仅保留原 `at/residentId/eventId/planId/container/definition` 与实际两侧。`definition` 来自已绑定活动，描述该活动的版本，不把写在代码中的固定转换伪装为可变配方。每次原完成事件是身份；同一计划连续两次留种可以有两条不同事件的回执，重载完成动作不重放。

## 食品范围与原批次

- 根菜在现有商品表中 `food=20/life=14`，属于食品投入。一份实物消失是加工扣减，不是本人摄入，不能根据饥饿或能量变化反算营养。
- 种子 `food=0/life=0`，是非食品输出。实际两份数量保留，`nutrition:0/lots:[]`，不凭空创造食品批次、可食份数或新粮食。
- 投入读取本人现有原 ledger 的实际份序（最早到期优先，允许跨批次分数数量），使用其原定义中的营养；不是当前激活定义或默认商品营养。缺定义营养可保留原批次，但营养为 `null`；已知零营养则保留0，食品分类不随营养值改变。
- 缺失、数量不完整、过量被修补、非法定义、未来生产时间或同一次捕获内初始化修补，不能证明所用原批次，数量仍为真实扣减1，`lots/nutrition` 保持 `null`。
- 证据读取当前已有批次元数据，不是跨历史来源认证。旧存档没有批次来源证明位；若一次更早的引擎初始化已修补元数据并保存，后续只看该存档不能识别它与真实生成批次的差异。本批不添加存档标志，也不声称能追溯这类历史修补。

直接 `saveSeed` 与受雇 `seedkeeper` 是不同完成路径。受雇批次仍只记 `employment_processing`，归属商店；行业加工根菜→饲料等仍只记 `industry_craft`，不重复加入 `saveSeed`。普通 industry 中没有新增种子配方。`plantCrop` 播种仍在覆盖之外。

## 成功、失败及观察中立性

材料不足、接受后材料被其他真实扣减、完工前腐败、未结束等待均没有转换。腐败只留在已有 `foodLosses` 切片；原料预留/转移不当摄入或新增。原 `seedSaved` 计数及原库存仍由模拟决定，证据不据此合成回执。

记录器绑定一次同步 World 对象，预测副本、最终菜单、决策检查不会污染父世界；关闭记录器或观察器抛错，不改变世界、事件、知识和SQLite结果。运行时仍在 durable commit 成功、安装已提交世界后才发布冻结副本。SQLite真实中止及版本竞争会回滚草稿，既不推进证据状态也不发出回执；恢复后仅一次，重启不重播。

## 严格 schema、日报和九人核对

当前覆盖为 `gather_harvest_cook_fish_hunt_growth_craft_employment_house_custody_seed_v1`。包括上一版 `...house_custody_v1` 在内的旧标记仍可读，明细可保留，但不证明此次新增的留种覆盖，当前范围 `foodFlows.totals` / scopedTotals 为 `null`。缺步、缺标记不当零；完整当前空数组才证明该分钟没有已覆盖操作。

严格 schema 限定 `processed/saveSeed`、真实人容器一致性、非空身份、精确 `turnip×1 → seed×2`、原批次数量与营养一致性、非食品零营养空批次。不允许附加 batchId、recipe、私人文本、访问器、异常原型、符号/稀疏数组、重复物品及非有限数量；不为校验历史而查看今天的配方。

日报保持 `sourceAdded` / `processingInputs` / `processingOutputs` 独立。saveSeed只进入后两桶，午夜沿用 `(from,to]` 归属；同一完成事件跨日报重放会被拒绝。九人 helper 按实际本人容器范围分类，种子可出现在物品数量中但营养为0，没有 `nineIntakeTotals`。全部食品生产/消费仍为 `null`，`completeFoodLedger:false`。

原九人主链中“收获12根菜→留种1根菜→原田再播”现在由真实回执交叉核对：固定九人与公共库存的加工投入根菜1、输出种子2，与原收获批次及实际计划/事件一致。旧 `conversions` 仍是脚本动作交叉核对，不加入第二份累计；两次 `plantCrop` 仍仅单独核对。根菜库存公式保持 `45 + 12 − 1 − 48 = 8`，不把加工扣减混进48份摄入。

这不是完整食物账、净生产账或营养守恒证明。播种、原型试制、其他未列转换、境外生产、未列消费/转移/损失仍有缺口。离线脚本选择不证明真实模型会留种或九人跨季可持续。

## 离线验证

```sh
TSX_DISABLE_CACHE=1 node --import tsx --test tests/food-flow-seed*.test.ts
TSX_DISABLE_CACHE=1 node --import tsx --test tests/food-flow-*.test.ts tests/nine-resident-food-chain*.test.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc -p tsconfig.server.json
node --input-type=module -e "import {build} from 'vite'; await build({envFile:false});"
TSX_DISABLE_CACHE=1 node --import tsx --test tests/*.test.ts
TSX_DISABLE_CACHE=1 node --import tsx scripts/acceptance-nine-food-chain.mjs --offline
node scripts/acceptance-long-run.mjs 1 --daily-json
```

测试使用明确合成世界/库存、真实菜单和引擎时间、合成SQLite（含真实提交故障），仅有计数并拒绝调用的本地假模型。未读取密钥或真实存档，未调用真实模型、浏览器或npm；保持工作区，未提交或推送。

独立反例与范围见[留种证据审查](../reviews/seed-saving-food-flow-evidence.md)。最终全量、九人及年度统计见下节。

## 本轮验证结果（2026-11-07）

- 新留种专项 **36/36**：真实引擎16项、durable commit 4项、schema/日报/九人6项、独立反例10项；合并全部食物流及九人主链 **223/223**，无失败、跳过或取消。
- 独立审查发现 runtime与日报两处跨切片事件重用缺口，补上saveSeed事件的双向交叉核验。相同event不能再次当进食或其他转换；同计划不同事件仍合法。修复后独立10/10再次通过。
- 九人离线CLI **229/229** 个脚本动作、6242游戏分钟、四次SQLite重开。唯一saveSeed回执时点5810，保留5795分钟实际收获的根菜原批次；根菜 `45+12−1−48=8`、种子24、钱1295均与原实际库存一致。没有将留种再计作摄入或来源新增。
- 一年合成隔离 **113行、161280分钟** 连续日报：48次实际saveSeed，投入根菜48份/可知原批次营养960，输出非食品种子96份/营养0，与原模拟 `seedSaved=96` 一致。逐日报加工两桶与每条回执重算相等，事件唯一、与进食事件不交叉；原264次采浆果和96次温室收获仍独立计来源。年度末SQLite重载成功。年度场景不是固定九人场景，也没有据此证明受雇、代管或其他加工发生。
- 以九人正常菜单产生的真实回执另做严格 writer 封存/只读恢复：当前覆盖回执与加工总量完整往返，上一版覆盖保留回执但总量为null。未把合成单步writer往返误称为真实模型验收。
- 类型检查、服务端编译及禁用环境文件读取的Vite构建通过；仍有既有大分块警告，本批未处理该警告。

- 最终全库离线测试 **3168/3168** 通过，失败/跳过/取消均为0（203.3秒）；这是独立审查修复后的完整重跑。`git diff --check`通过。所有结果均为本地合成验证，工作区仍未提交或推送。
