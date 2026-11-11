# 等距建筑、资源与施工外观

这是可选等距观察器的只读程序像素模块，沿用已有菱形投影与色板，不改变模拟、存档、碰撞、正式入口或默认2D。不访问真实存档、环境文件、密钥、模型、浏览器或IPC。

## 覆盖与真实性

- 建筑按实际 `Building.kind` 区分住宅、旅舍、工坊、诊所、学校、畜舍、温室、商店。实际足迹宽高决定地基四角；屋檐和商店遮棚属于外观，不能扩大碰撞或深度足迹。门仅绘在真实记录所在的可见外墙，背面门不移到正面。
- 建筑记录意味着建筑已存在，不从工程计划推断完工。`condition` 的70、25、0分界仅给出程度不同的裂纹/失用符号，不推断坍塌、火灾、修理、烟火。缺失或超出0至100的状态使用明确回退。
- 屋顶可采用定义中的合法 `art.roof` 色板。建筑种类仍来自实际kind；温室保留玻璃构造，不补造植物，工坊不补造设备，商店不补造货物。诊所/学校/工坊的小型立面符号用于辨认种类，不表示活动或服务正在运行。
- 石矿、浆果丛、泉保留实际资源ID和一格坐标。正余量与耗尽有不同形态，浆果仅在实际余量大于0时出现，空泉不画水。石矿不附会矿井入口、矿车或特定矿物。自然石沿不是新增井或供水设备。单个图形表示有无存量，不表示逐份数量。
- 果树的生长中/成熟、实际果实存量分别由 `status` 与 `fruit` 控制，不根据季节或成长数值猜成熟。冬季不擅自去掉实际果实。生长中却有果、未知状态、负/非有限数值保留明确回退；已砍树由上层按原观察规则隐藏。果实符号不推断苹果等品种，也不逐个对应份数。
- 三阶段新建工程只认实际reserved的新建记录。预留阶段为虚线观察边界，不是安装栅栏；已开始且有有效工时、材料投入和时间顺序的阶段依次是基础、梁柱、局部屋顶。没有完整屋顶，绝不将未交付项目画成完成建筑。扩建、改用途、地形工程、未知/冲突阶段返回null，保持明确标记。

## 整合API

`src/client/isometric-buildings.ts`：

- `buildingMarks(building, season, art?)`、`buildingLabel(building)`、`buildingFootprint(building)`、`buildingArtSupported(building)`。
- `constructionMarks(project, minute)`、`constructionAppearance(project, minute)`、`constructionLabel(project, minute)`。
- 单对象上限 `BUILDING_MARK_LIMIT = 16000`；尺寸和不超过80的足迹限制用于边界防护。

`src/client/isometric-resources.ts`：

- `resourceMarks(resource, season)`、`resourceLabel(resource)`、`resourceArtSupported(resource)`，处理rock/bush/spring；tree仍由原有树木绘制函数处理。
- `orchardMarks(tree, season)`、`orchardLabel(tree)`、`orchardArtSupported(tree)`。
- 单对象上限 `RESOURCE_MARK_LIMIT = 512`。

所有marks函数返回 `PixelMark[] | null`。是否能画以marks结果为准：数据格式支持但像素超预算也会返回null。调用方验证ID、位置与世界边界，以原记录构造subject和footprint，对null提供明确标记/未知位置计数，不能静默消失或借用另一类图形。返回像素都是整数，建筑先在局部坐标光栅化再进行整数平移，避免远坐标半像素舍入抖动。它们不需要动画预算，也不扫描世界、初始化状态或创建对象ID。

## 证据与复现

```sh
mkdir -p output/test-tmp/isometric-buildings
TMPDIR="$PWD/output/test-tmp/isometric-buildings" node --import tsx --test tests/isometric-buildings.test.ts
TMPDIR="$PWD/output/test-tmp/isometric-buildings" node --import tsx scripts/render-isometric-buildings.ts
npm run check
```

`scripts/isometric-buildings-fixture.ts` 创建23个明确人工对象：8种建筑、2个损坏建筑、6个有/无余量资源、3株果树、4个工程阶段。测试覆盖四季形状差异、冻结输入、精确平移、未知记录、状态与材料约束、真实门位、脚锚、完整足迹排序，以及分数镜头下原ID的可见像素命中。

`output/isometric-buildings/` 包含春/冬PNG、说明页与原ID/足迹/坐标/源码及图像SHA-256清单。两张PNG已实际查看，属于**纯绘制API的源码原生合成图，不是浏览器截图、实际存档画面或运行视觉验收**。viewport接线与其预算/缓存/交互验证由独立集成测试覆盖；真实浏览器、手机触控、GPU、实时快照以及非住宅室内仍未验收。

独立审查与最终全量结果由父任务统一记录，此文不将定向测试当作全量通过。
