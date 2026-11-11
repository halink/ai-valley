# 畜舍室内的有限只读2.5D观察

本批基于 `5b122cb`，继续[学校室内](isometric-school.md)及[可选入口](isometric-formal-entry.md)，有限加入真实 `barn` 类型。默认仍为2D，不改原2D、模拟引擎、正式服务或存档。

## 真实类型与位置语义

- `BuildingKind` 和 `building/barn@1` 确有畜舍，定义尺寸为7×5、capacity=0。`createFormalWorld(5402)` 的原开局没有barn，且industry/rooms尚未初始化，不把测试畜舍当成默认世界已有事实。
- `roomLayout` 对这个畜舍产生16×13房间，入口 `(8,11)`、桌台 `(8,8)`、静态厨房 `(8,4)`、care `(4,5)` 和四个pen导航点：`(4,7)`、`(11,7)`、`(4,11)`、`(11,11)`。care不画成设施。pen数量是 `max(4,floor(width*height/8))`，不是动物数，capacity也不是畜舍床数。
- `Livestock` 支持 `at`、`inside`、`roomAt`、`carrierId`，但当前正常 `placeAnimal` 安置以及 `moveAnimal` 送达畜舍会保留barnId/pen而不保留精确室内坐标。原2D的 `barnAnimalPoint` 会依据栏位映射动物；本批不把这种布局映射当成实测动物位置。
- `actionRoom` 的pen坐标是人物照料目的地。`placeAnimal` 本身实际去table，之后 `feedAnimal`/`waterAnimal` 才去pen。人物抵达pen也不能证明动物实测位置、实际照料成功或已产出。

## 可见范围与诚实回退

- `homeInteriorSupport` 保留原API，添加barn白名单。仍要求真实rooms。调用roomLayout前，把pen导致的高度及槽数计入尺寸/预算检查，防止大畜舍进入无界布局循环。比如12×20的畜舍按pen公式需65行，应拒绝，不能只按建筑高算43行。
- 绘制同一真实地板、空桌台、未点火厨房及原人物。四个pen只显示可点选的问号导航记录，不补造围栏、饲槽、草堆、饮水、产品或占用。标签明确“不是动物位置或数量”。导航标记在真实人物/家具下面绘制，人物到达同一pen时不会被问号遮住身体或夺走身体像素的点击。
- 只凭 `barnId/pen` 的动物计入位置未知，不放到pen、入口或桌台。室外动物、其他房间的动物和死亡动物不移入。实际 `inside/roomAt` 记录仍只画准确位置上的动物记录标记；携运标记使用真实携带者位置，不沿用动物旧坐标。未知坐标另计，不猜测数量。
- 动物定位入口继续原2D回退，不假装已支持室内动物外观或携运动画。问号仍可选择原动物ID查看记录，不意味着真实动物美术已覆盖。
- 原人物在精确roomAt上保持原外观与点选ID。沿用 `personVisual`；本批不补喂食、喂水、挤奶、剪毛、繁育或护送手势。喂食/喂水达到实际工作阶段会成为尚不支持的work姿态，显示记录标记，跟随诚实交回2D且不丢原人物身份；完成后的中性人物和室内行走可在用户再次选择2.5D后继续跟随。不自动强行切回2.5D。
- 未知人物位置、未支持姿态、无rooms、畸形/超限布局等继续失败关闭。手动进出、拖动释放、Escape、暂停/隐藏/断线冻结沿用原机制。动画不重新扫描动物/房间集合，也不推进模拟。

## 明确合成的真实引擎路线

`scripts/isometric-barn-route.ts` 从全新内存 `createFormalWorld(5402)` 保留原始开局，直接改动严格只有：

1. 在原居民 `founder-1-1` 已登记地块 `(267,181)` 加一栋 `building/barn@1` 测试建筑 `synthetic-barn-1`，尺寸/容量来自版本定义，门 `(270,186)`，原居民仍是所有者。
2. 给该居民背包设置一个测试 `chickCrate` 和一份 `fodder`。
3. 解除暂停。

完整世界差分验证除此之外无变化。没有预写动物身份、年龄、性别、位置、健康、roomAt、行为、产物或照料完成；没有改原人物、水、钱、技能、知识或原建筑。新增畜舍不声称由代理实际建成，测试运输笼/饲料不声称在原种子中已有。

随后只有五个显式 `submitPlan` 加 `stepWorld(.25)`：走到畜舍并取得地址认知、安置、喂食、供水、回家。普通引擎首步登记运输笼动物身份和状态；安置真实消耗该运输笼并释放同一 `animal-cargo:valley-formal-5402:1` 个体，保留其身份、年龄和性别。原人物经过真实入口和路径，安置结束在table，喂食/供水到pen:0。两次照料在剩余0.25分钟时物资还未扣，最后一步才分别扣1份fodder/原有water并降低同一个体的饥饿/口渴。

`water:completed` 为594.25分钟，原人物位于 `(4,7)`，动物只有barnId和pen:0，无at/inside/roomAt。原人物实际离屋回家后，动物仍无精确坐标。路线只有1只实际释放个体，没有第二只、产物、繁育、室外迁移或室内游走。不能把四个pen解释成四只动物。

这是脚本选择的合成路线，不是自主模型或真实长期畜牧验收。

## 合成图像

`scripts/render-isometric-barn.ts` 使用上述 `water:completed` 快照，直接栅格化客户端实际像素列表：

- `output/isometric-barn-interior/synthetic-barn-room.png`：同一16×13室内、桌台、静态厨房、导航标记和原人物。
- `output/isometric-barn-interior/synthetic-barn-original-person.png`：原人物与附近导航点放大；不是全屏适配证据。
- 同目录 `manifest.json`：明确fixture差异、原个体缺坐标事实、5份源码和2张PNG SHA-256、原人物roomAt、时刻、对象标记与预算。

两张图顶部均标注 **SYNTHETIC / NOT BROWSER**，PNG描述也声明合成来源。正常动物因缺精确室内位置完全没有画入。人物下方被遮住的pen问号依然是导航注释，不能称动物、喂食工具或占用。素材全部来自已有源码，不增加依赖或外部素材。实现者实际查看了两张PNG，[独立review](../reviews/isometric-barn.md)另核像素与哈希。

## 离线复现

仓库根目录使用已有guard，不读key、环境文件或真实存档，不联网，不启动服务。兼容shim仅把缺失的 `realpathSync.native` 指回已受guard保护的函数，不放宽路径限制。

```sh
mkdir -p output/test-tmp/barn
cat > output/test-tmp/barn/guard-native-compat.mjs <<'COMPAT'
import fs from 'node:fs';
if(globalThis.__valleyOfflineGuard!==true)throw new Error('offline_guard_required');
if(fs.realpathSync.native===undefined)fs.realpathSync.native=fs.realpathSync;
COMPAT
env -i PATH="$PATH" HOME="$PWD/output/test-tmp/barn" \
 TMPDIR="$PWD/output/test-tmp/barn" TSX_DISABLE_CACHE=1 \
 node --import ./scripts/acceptance-offline-guard.mjs \
 --import ./output/test-tmp/barn/guard-native-compat.mjs --import tsx --test \
 tests/isometric-*.test.ts tests/action-position.test.ts tests/resident-follow.test.ts \
 tests/rooms.test.ts tests/industry.test.ts tests/animal-behavior.test.ts \
 tests/client-bundle.test.ts tests/client-loading*.test.ts
env -i PATH="$PATH" HOME="$PWD/output/test-tmp/barn" \
 TMPDIR="$PWD/output/test-tmp/barn" TSX_DISABLE_CACHE=1 \
 node --import ./scripts/acceptance-offline-guard.mjs node_modules/typescript/bin/tsc --noEmit
env -i PATH="$PATH" HOME="$PWD/output/test-tmp/barn" \
 TMPDIR="$PWD/output/test-tmp/barn" TSX_DISABLE_CACHE=1 \
 node --import ./scripts/acceptance-offline-guard.mjs node_modules/typescript/bin/tsc -p tsconfig.server.json --noEmit
env -i PATH="$PATH" HOME="$PWD/output/test-tmp/barn" \
 TMPDIR="$PWD/output/test-tmp/barn" TSX_DISABLE_CACHE=1 \
 node --import ./scripts/acceptance-offline-guard.mjs \
 --import ./output/test-tmp/barn/guard-native-compat.mjs --import tsx scripts/render-isometric-barn.ts
```

`client-bundle` 是 `configFile:false, envFile:false, write:false` 的Vite内存生产构建，不读环境文件或改dist。八处既有测试把barn不支持类型的反例改成仍未支持的greenhouse；没有rooms的原barn负例保留，不削弱失败关闭覆盖。

没有运行完整 `npm test`、真实浏览器、触控/GPU、GET/SSE真实网络生命周期、正式服务、真实模型或真实存档。合成图不是浏览器截图，专项通过不等于正式2.5D验收；默认不得据此更改。本批不暂存、不提交，不代表五个未提交赠食候选已验收或合并。

## 最终检查结果

- 显示专项7/7、真实引擎路线6/6、独立review10/10，最终畜舍专项合跑 **23/23** 通过，0失败、取消或跳过；日志 `output/test-tmp/barn/final-barn.log`。
- 全部等距、动作位置、连续跟随、房间、industry、animal-behavior、客户端加载和Vite内存构建的限定集成 **342/342** 通过；日志 `output/test-tmp/barn/final-integration.log`。集成后仅补全显示测试Snapshot的类型元数据，再跑23/23专项和客户端类型检查均通过。
- 前端及服务端 `tsc --noEmit` 通过；日志 `client-types.log`、`server-types.log` 在同一目录。`git diff --check` 与新增文件空白检查无报错。
- 实现者与独立审查者均查看两张实际源码合成PNG；独立审查的5项源码/2张PNG哈希全部匹配，未发现剩余阻断问题。
- 5个预存赠食候选开始/结束SHA-256一致，HEAD仍 `5b122cb`，暂存区为空。没有提交、联网或bwrap尝试。
