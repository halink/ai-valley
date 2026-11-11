# 外贸食品的有限跨范围转移证据

## 实际动作与覆盖

沿用默认关闭的 `stepWorldWithFoodEvidence` / `directEatingEvidence`，扩展独立 `foodTransfers`，新覆盖为 `outside_aid_foreign_trade_v1`。原 `outside_aid_collect_v1` 仍可读取，但不能证明新增外贸切片已观察；缺数组、缺覆盖或旧覆盖均不能补成零。

新增四类**真实实物交接**，不新增交易、事件、世界字段、存档字段、居民知识、自动决策或权限：

- `reserveOffer`：居民完成出口提议，实际 `person:<id>` → `offer:<id>`。只证明预留流出，尚未获商人同意，更不证明成交。
- `reserveShipment`：居民完成接受商人收购报价，实际 `person:<id>` → `shipment:<id>`。证明实物从个人库存进入已同意运输安排，尚未发运或交付结算。
- `collect`：居民完成本人实际交接处领取，实际 `shipment:<id>` → `person:<id>`。进口与退回出口分别保留 `side`、`returned`；数量来自领取前真实 `goods`，不是合同 `quantity`。例如四份先腐败剩0.5份，按既有外贸规则领取0.5份，只记0.5。
- `estateCustody`：死亡后的出口报价余物、待发/退回出口货物、进口实际到站，以及先到站后死亡，直接进入已有 `estate-stock` 的独立实物事实。不是死者本人领取；`personId:null`，保留实际接收包的 `estateOwnerId`。原自动到站后死亡路径没有事件，保留 `eventId:null`，不为证据制造事件。

保留原报价、货运、商人、居民、源/目标容器、实际时点、食品余量。死亡前后不更改原合同或包的所有权。原报价可能已被历史裁剪，货运已有的报价ID仍足够标识事实，不能为了证据补造报价历史。

商人库内预留、商人生产、offer→shipment、发运、普通到站、出口结算进入商人库存、进口退回商人库存不在新增切片内。取消报价或运输本身不恢复个人库存：只有之后实际领取或死亡封存才有相应入流。非食品不记录。尚未完成、最后资格失败、缺货、零余量和重复领取没有成功事实。

`outsideAid.collect` 原有食品转移保持原义。转移不是摄入、生产、加工或腐败，不加入这些切片。完整食品消费、生产与边界账仍未知；`fullTransferLedger` / `completeFoodLedger` 均保持 `false`。

## 批次与未知

个人库存既能真实生产食品，也可能在此前任意一步被初始化补账。当前存档没有可区分这两种历史的证明。为不把推测报告为事实，**两种个人出口预留一律只记实际数量，`lots:null`、`nutrition:null`**；严格schema也拒绝其声称已知原批次或营养。不新增持久标记，不用当前默认营养、库存差额或饥饿变化反推。

货物领取/死亡封存仍在原 `foodTransaction` 初始化之前读取现有容器批次：批次数量须完全匹配真实余量，元数据有效且食品未过期，生产时点严格早于报价/货运 `createdAt`。缺失、错量、当前步修补、运输开始后修补、同分钟不可区分元数据保持未知。缺原营养定义时可保留有效批次，但营养仍为null。

货物规则只证明读取到的有效、早于货物创建的元数据，不能证明更早个人库存从未修补，或历史过量ledger从未被裁剪；此历史完整性没有新增证明。个人预留未知与后续货物可读元数据是不同证据强度，不得将后者用于追补先前未知预留营养。

## 提交与严格边界

采集只附着一次同步 World 调用，预测副本不串入。运行时仍先 durable commit，安装成功世界后再复制并深冻结发布。真实 SQLite trigger 失败、revision 竞争失败均不得发布草稿转移；重试成功一次，重载不重播。观察器异常不改模拟或持久结果。

schema逐层白名单检查、拒绝额外字段、访问器、非法容器、非法枚举、非食品、非有限数量、错误目标/身份与批次数量/营养不一致。个人预留是正整数，货物领取/封存允许真实正小数。声明覆盖必须有数组。

去重分开识别预留和释放：预留按唯一目标offer/shipment；释放按唯一源offer/shipment，`collect` 与 `estateCustody` 共用释放身份。因此合法预留后领取可共存，但改收货人、改目标、换操作或事件ID不能重复记同一批货物释放。非空事件ID还跨切片/跨步去重；空事件不能跳过源容器身份检查。

## 日报与固定九人 helper

日报独立保留原事实、观察/漏观察分钟及数量/营养总量，采用原 `(fromMinute,toMinute]` 日界。整步严格检查先于接受，后条无效或重复不能部分推进游标或消耗前条身份。旧覆盖保留明细但相关总量未知。

九人边界仍是初始固定九个ID加既有公共物理容器，不随地理位置、在世状态或当前居民数组重新选九人：

- 固定九人个人→外部offer/shipment记 `scopeOutflowTotals`，不是消费；非九人同样预留保持 external→external。
- shipment→固定九人个人记 `scopeInflowTotals`，不是摄入；非九人领取保持 external→external。
- 固定九人或commons实际所有的estate-stock原本就属于边界。死亡封存按实际 `estateOwnerId` 计独立流入；其他所有者为external→external，不能仅凭死者ID/包名推断所有权。
- 保留 `scopes` / `destinationScopes` 与全部外部→外部明细。转移不重复计入 `scopedTotals.inputs`、来源新增、加工或 `nineIntakeTotals`。
- 范围内未知营养保持null；范围外未知不污染已观察的范围内零流入/流出。没有新覆盖则进出总量均未知。

## 离线复验

仅合成世界/内存或临时SQLite，禁止读取真实密钥/存档、联网、调用真实模型、浏览器、npm或提交推送。

```sh
node --import tsx --test tests/food-transfer-foreign*.test.ts tests/food-transfer-aid*.test.ts tests/nine-aid-food-accounting.test.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc -p tsconfig.server.json
node --input-type=module -e "import {build} from 'vite'; await build({envFile:false});"
node --import tsx --test tests/*.test.ts
node scripts/acceptance-long-run.mjs 1 --daily-json
node --import tsx scripts/prepare-nine-resident-acceptance.mjs --prepare
node --import tsx scripts/acceptance-nine-food-chain.mjs --offline
git diff --check
```

独立反例与结论见[独立复核](../reviews/foreign-trade-transfer-evidence.md)。离线测试不代表真实模型长期验收，年度夹具没有非零外贸转移时也不能据零值宣称完整边界账。

## 最终离线验证（2026-11-07）

- 新增外贸测试 **71/71** 通过，其中真实世界/菜单44项、真实SQLite提交/观察隔离4项、固定九人引擎核对3项、严格分析/schema8项、独立反例12项。与既有援助及九人援助定向回归合计 **167/167**。
- 最终完整离线测试 **3,081/3,081**，失败、跳过、取消均为0。类型检查、服务端编译、禁读环境文件的Vite构建和 `git diff --check` 通过；Vite保留既有大分块提示。
- 最终服务端构建的一年合成隔离复验通过：113条日记录、161,280游戏分钟连续覆盖，transfer漏观察为0，年度内存SQLite重载通过。本年度没有实际外贸或援助转移；非零进出、死亡、腐败、竞争和重放由专门夹具证明，不由年度零值推断。
- seed5401原九人离线食物链复验通过，推进6,242游戏分钟；准备入口通过。`realModelExecuted:false`，真实模型自治/人口生存验收仍为null，完整食品生产/消费与边界账仍未知。
- 所有变更仅本地工作区；未读取真实密钥或存档，未调用真实模型、浏览器或npm，未提交或推送。
