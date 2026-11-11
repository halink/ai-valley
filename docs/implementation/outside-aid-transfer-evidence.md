# outsideAid.collect 的有限食品边界转移证据

后续增量：[外贸有限跨范围食品转移](foreign-trade-transfer-evidence.md)已扩展新的覆盖标记。本文保留原援助切片的历史范围与验证结果，原标记不能证明新增外贸覆盖。

## 精确范围

沿用默认关闭的 `stepWorldWithFoodEvidence` / `directEatingEvidence`，新增独立可选 `foodTransfers` 和 `foodTransferCoverage: "outside_aid_collect_v1"`。只在原有 `outsideAid.collect` 最终资格检查通过并真正完成领取时记录：

- `container: aid:<deliveryId>` → `destinationContainer: person:<recipientId>`。
- 原送达单、求助单、商人、领取者、原领取事件 ID 和真实完成时点。
- 原交接实际转移的食品、**腐败后的全部真实剩余数量**，及可确认原批次的营养。

原合同的 `quantity` 不是转移量。例如原承诺 4 份，先腐败 1.5 份，实际领取 2.5 份，只记 2.5；不足完整一份仍按原规则不能领取。有效原批次沿原交接保留过期时点；观察代码不改变旧账修补或过期规则。

预留、发运、到站、等待、撤回、取消、退运没有这条转移事实。领取不是进食，不增加 `receipts`、照护供餐、摄入营养、`sourceAdded` 或加工产出；之后本人另行 `eat` 才产生既有进食记录。没有新增自动决策、救援、照护、监护、迁居或共享库存权限。

这不是完整边界账。外贸、死者遗产、所有权变更、其它交接与未列来源仍未覆盖。`completeFoodLedger` / `fullTransferLedger` 仍为 `false`，完整 `foodProduction` / `foodConsumption` 仍为 `null`。

## 原批次与未知

证据在原 `foodTransaction` 初始化之前只读该 aid 容器的原 ledger，不额外盘点容器、初始化、修补或改变模拟顺序。原批次数量必须准确覆盖真实余量，批次元数据有效，营养来自其原定义，而不是当前商品定义或饥饿变化。已知批次缺营养定义时保留批次、营养为 `null`；缺批次、错误数量、无效时点/定义或当步修补均保留数量但批次/营养未知。

援助货物不能在运输途中生产食品。为防止之前一步或重载前的初始化补账被误当原批次，报告已知营养还要求每个批次的生产时点**严格早于**送达单 `createdAt`。在预留同一分钟新生成的真实批次，与同分钟补账无法单凭现存数据区分，因此保守地保持未知。此约束不加世界字段、常驻观察状态或存档格式。

这不是完整历史真实性证明：旧过量 ledger 裁剪后若仍保留有效原批次元数据，之后状态与原本合法同量批次不可区分。后续证据可报告这些保留的原批次，但不能声称证明历史上从无修补。

## 提交、严格边界与去重

采集器仍只通过 WeakMap 附着一次同步 World 调用。预测副本不串入，异常调用不返回成功事实。运行时先 durable commit、安装新世界，再复制并深冻结发布；SQLite 故障或版本竞争不发布已执行但未提交的领取草稿。重试成功只发布一次，重载不重播已领取单。观察器异常不改变世界、知识、菜单或存档。

writer 对事件、每条 transfer、amount、lot 和数组逐层白名单检查，拒绝额外字段、访问器、符号/稀疏数组、非法 ID、非有限数量、非食品、伪容器及批次数量/营养不一致。声明覆盖必须带数组；旧输入同时缺数组与覆盖标记仍可读，但表示未知。只有合法空数组和明确新覆盖能证明本步该切片零领取。

独立审计按事件 ID、送达单 ID 跨步去重，并核对与其它切片事件 ID 冲突、时间、会话边界、序号及版本连续性。重复、缺步、旧覆盖、失效关闭或破损 seal 保留可读明细，但相关总量未知。未推进的会话也不能证明已覆盖。原始按日明细只是观察分组，不能脱离审计当作已去重总量。

## 日报与固定九人 helper

隔离日报单列 `foodTransfers` 的明细、观察/漏观察分钟与 `{units,nutrition,completedActions}`。日界仍采用 `(fromMinute,toMinute]`，恰在午夜完成属于刚结束的一天。一天中任何缺测使该日总量为 `null`；已知明细保留，下一日重新累计。严格验证及涉及 transfer 的事件/送达单重复检查均在接受整步之前，失败后可用修正输入重试原分钟。

九人 helper 用初始化固定的九个 ID，而非当前地理位置或库存变化划定范围：

- aid 来源恒为 `external`。
- 只有 `recipientId` 属于固定九人时，目标才为 `nine-and-public`，独立 `scopeInflowTotals` 记一次流入。
- 非九人领取恒为 `external → external`。公共名字、商人归属、误导性的容器 alias 或库存端点不能改变此判断。
- `scopes`、`destinationScopes` 和真实明细保留。转移不混入 `nineIntakeTotals`、食物来源新增、加工投入/产出或 scoped debit。
- 未采覆盖不作零；范围内已知数量但原营养未知，会将流入营养保持 `null`。范围外未知营养不会污染范围内已观察零流入。

## 离线验证

```sh
node --import tsx --test tests/food-transfer-aid*.test.ts tests/nine-aid-food-accounting.test.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc -p tsconfig.server.json
node --input-type=module -e "import {build} from 'vite'; await build({envFile:false});"
node --import tsx --test tests/*.test.ts
node scripts/acceptance-long-run.mjs 1 --daily-json
node --import tsx scripts/prepare-nine-resident-acceptance.mjs --prepare
git diff --check
```

定向测试使用真实编号菜单、原信使/商人应答及引擎领取，覆盖部分腐败、非本人竞争、重试、请求撤回/到期、最后一分钟能力/身份/地点变化、原批次未知、预测副本、SQLite 重载，以及真实 SQLite trigger 和竞争 revision 提交失败。固定 seed 5401 九人的脚本夹具另行核对领取流入与之后进食是两条不同事实。所有世界和数据库均为合成测试，网络与模型调用由离线测试拦截；不代表真实模型九人长期验收。

独立审查记录见[复核结果](../reviews/outside-aid-transfer-evidence.md)。

### 最终离线验证（2026-11-07）

- 新增援助转移测试 **96/96** 通过，含独立反例 **12** 项、真实提交失败/开关一致性 **4** 项和固定九人端到端领取/重载/独立进食；审查者最终定向复核 **39/39**。
- 最终完整离线测试 **3,010/3,010** 通过，失败、跳过、取消均为 0。类型检查、服务端编译、`envFile:false` 的 Vite 构建及 `git diff --check` 通过；Vite 仍有既有大分块提示。
- 最终服务端构建的一年合成隔离复验通过：**113** 条日记录连续覆盖 **161,280** 游戏分钟，援助转移切片每分钟有覆盖，年度内存 SQLite 重载通过。本年度夹具没有实际领取援助，所以明细与窄切片总量均为零；实际领取及非零范围流入由定向真实引擎夹具证明，不能用年度零值声称广泛边界账完备。
- 离线九人准备入口通过，新切片列为可选提交证据，`realModelExecuted:false`、`acceptancePassed:null`。完整食物生产、消费和边界账仍未知；没有进行真实模型长期验收。
