# 未知年龄的观察与显示

## 确认的误报

`knownAgeYears` 已把缺失、非数字、非有限值、未来出生时间和不可安全解析的时间返回为 `null`；兼容函数 `ageYears` 仍返回 `0`。因此用后者直接显示年龄，不能区分真实新生儿和没有可信出生资料的人物。合成反例确认个人监护观察和最终决策提示会显示 `0岁`，近身监护观察还会添加幼儿喂养提示，人口簿会把未知计入未满18岁。

这是代码和合成数据验证，不表示真实存档中发生过这些情况，也不能推断损坏比例、人口实际年龄或缺失的出生事实。

## 限定实现

- 个人监护观察使用 `knownAgeYears`。原登记关系及已知登记住处仍可记得，未知年龄明示“年龄未知”，不能生成幼儿喂养提醒。真实0岁和未满六岁的已知年龄仍保留原提醒，已知成年人仍不进入原未成年登记摘要。
- `DecisionContext.formal.knownAge` 是新增加的可选只读展示字段，生成时为已知整岁或 `null`。最终三种模型提示均按它显示，不把显式未知回落成0。原 `formal.age` 和所有菜单筛选、行动授权、生理计算、决策优先排序保持不变。旧手工context没有该字段时沿用其原数字年龄，非数字、非有限或负年龄明示未知；旧context只有0而没有来源，不能追溯判断它是真实0岁还是早期兼容值。
- 地图选择卡、人物名册、档案年龄使用 `knownAgeYears`；生平的登记出生也先核验，不再把 null 当成开局日期或输出 NaN 日期。保留原中文界面、人物名称转义及数字格式，不引入新语言层。名册和档案仍按 `deathAt ?? world.minute` 显示，选择浮层仍沿用原当前时刻口径，本切片未统一重定义死亡年龄。
- 人口簿仍只汇总存活常住居民的年龄。未知单列为“年龄未知 N 人”，不计入未满18岁或65岁及以上。常住/访客总人数、出生/定居/迁出/离世流量和历史季报不变，不新增人口存档字段。
- 发现并修复观察增量的缺字段兼容问题：值变成 `undefined` 时 JSON 会省略 patch 键，旧页面因而保留旧值。原“字段删除则全量替换该实体”的路径现也覆盖变为 `undefined`，仍使用同一协议和原始实体，不写回出生资料。`null`、NaN 经JSON成为null、未来时间和缺字段都能在快照、增量及重连后显示未知，恢复有效日期时也能清除旧警告。

## 保持的边界

个人记录只沿用本人登记监护关系和本人已知地点。近身身体观察仍使用原 `observeBody` 的位置、遮挡、室内与能力边界，仅给粗粒度迹象；远方亲属、历史监护或公共观察快照不能把当前健康、饥饿、库存或位置送给不应知道的居民。

本修复不猜测或修补 `bornAt`，不根据旧 `lifeStage`/能力推断年龄，不新增本人同意、监护或幼儿代理权，不调整生命周期、照护、交换、排序或其它年龄门槛。已有存档无需迁移；新增字段只存在于临时决策context，人口统计只在客户端计算。动物日龄与其它历史时间字段不在此次人物年龄范围内。

## 离线验证

主测试 `tests/unknown-age-display.test.ts` 覆盖正式合成 seed5401 的实际 `decisionContext → prepareModelDecision`，只生成三种模型的最终输入，不请求模型。包含七类异常出生值、近身与远方登记、旧context、有效0岁、5.5/6/13/18/30/65岁、分数分钟生日前后、菜单相等性、初始化后的只读性及内存SQLite。JSON快照、增量和重连均使用实际 `ValleyRuntime.snapshot → observerFrame → applyObserverUpdate`。

`tests/unknown-age-display-client.test.ts` 执行真实 `main.ts` 入口配合既有DOM/Phaser/transport测试替身，检查选择卡、名册、档案、人口簿和生平。包含空值、非数字、±Infinity、未来与不安全时间，0岁、18/65边界、原死亡年龄口径、访客/外出/死亡排除以及没有人口簿的旧payload。它是离线UI回归，不是浏览器视觉验收。

后端异常观察、本人提示、旧context及缺字段delta已有先红后绿复现。21项主测试和4项前端测试通过；与care observation、formal observer、decisions、model routing、fractional birthdays、client loading、community及history的13文件合跑145/145通过，零失败、取消、跳过。独立反例与最终全量结果见[独立审查](../reviews/unknown-age-display.md)及下方记录。

```sh
node --import tsx --test tests/unknown-age-display.test.ts tests/unknown-age-display-client.test.ts tests/unknown-age-display-review.test.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc -p tsconfig.server.json
node --input-type=module -e "import {build} from 'vite'; await build({configFile:false,envFile:false,base:'/ai-town/'});"
node --import tsx --test tests/*.test.ts
node --import tsx scripts/acceptance-nine-food-chain.mjs --offline
git diff --check
```

仅使用合成世界、内存或临时测试SQLite；不读取密钥或真实存档，不调用模型、浏览器、npm，不提交推送。不代表真实模型自主行为、坏档发生率或长期存活验收。

## 冻结后的统一结果

2026-11-07 UTC，独立审查冻结后对同一最终源码执行首轮完整离线检查：

- 329个测试文件，4282/4282通过，零失败、取消、跳过；198.33秒。没有用复跑替换全量失败结果。
- `tsc --noEmit`、服务端编译、禁用配置文件和环境文件加载的Vite构建、`git diff --check`均通过。Vite仍有主包超过500 kB警告。
- 九人离线粮链通过：229项选择全部实际完成，0待完成、0失败，末态9人存活；根菜45+12−1−48=8，钱款1295守恒，家庭赠与2份另选吃1份、余1份。
- 粮链明确 `realModelExecuted=false`，模型自主性与人口长期存活验收仍为未知，并未由上述短合成流程证明。
