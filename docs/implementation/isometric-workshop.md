# 工坊室内与普通制作的只读2.5D观察

在 [住宅室内](isometric-home-observer.md)、[共屋与烹饪](isometric-lodge-cooking.md) 和 [可选正式入口](isometric-formal-entry.md) 上有限扩展 `workshop`。默认仍为2D，观察者不能使人物进入工坊、制作、安装设备或领取成品。本批只改客户端显示、合成路线、测试与公开文档，不改引擎、模型、权限、存档或网络。

## 数据与动作边界

- `homeInteriorSupport` 保留兼容API名称，增加工坊，仍要求实际 `world.rooms`。工坊宽高、入口、桌台、厨房和设备槽来自导航共用的 `roomLayout`；工坊无住宅床位，最低16行，不把 `capacity` 当床数。输入宽高、槽数与坐标先做有界检查，不为旧档补造室内。
- 原 `inside`、`roomAt`、人物ID、建筑ID和房间槽key保持。原有姿态、镜头与点选复用住宅路径，不以目的地、住处、设备或批次反推人物位置。工坊摘要明确写“工坊室内”，不再沿用住宅标签。
- 工坊未安装设备时画原桌台；已登记且安装时点有效、未拆除的木工作台使用 `station:bench` 身份。`table` 和 `station:bench` 在真实布局中共用位置，故只画一个桌台实体，不堆叠两个。厨房来自原布局，静态未点火，不表示实际开火。其他设备外观仍是附带原槽key的明确记录标记；`care` 是导航目标，不画成设施。
- `ordinaryCraftVisual` 仅支持普通 `industry/craft`，且限 `station:null` 的桌台制作或 `bench` 木工作台制作。原 `personVisual` 必须是现场 `work`，行动门、实际门、工坊身份、真实工位、正有限剩余工时、开始时点、原配方与行动设备一致，所有室内/室外路径已走完且不在退出。
- 制作手势还要求本人唯一进行中的真实批次，匹配行动的 `batchId`、配方版本、工坊、`actionKey`、实际已工作时间和保留原料。尚未开始、已完成、取消、异主、异地、异配方、未来时点、材料不符或缺失证据不能画成正在制作。木工作台必须有唯一有效安装记录，拆除中不支持。
- 引擎到工位与第一次加工tick之间尚没有批次。这一真实过渡显示静态“制作准备：已到真实桌台，尚无加工批次”，只在原配方、工位和随身原料可核对时采用；不预先扣料，也不把缺失已选批次当准备。这样连续跟随不会在合法到达帧无故交还2D。
- 手势只有原人物衣着、皮肤与朝桌台的空手相位，不增添锯、锤、钳、火焰、原料或成品物体。说明明确不证明工具、火焰或成品已结算；批次是引擎事实，动画不创造生产。
- 冶炼、磨坊、乳品、织机、罐藏工位制作、设备安装/拆卸、修复/升级、雇佣制作，以及原本不支持的室内特殊姿态保持明确fallback，跟随时回2D并保留人物身份。精确位置未知单独计数，不借用入口坐标。
- 动作判定只在接收快照时建立；动画只读已复制坐标、外观与暂停状态。保留原192对象、60,000 marks、缓存和帧预算。暂停用第0相位，准备姿态始终静止。隐藏/断线冻结相位，返回2D或dispose沿用原清理。

## 完全由普通引擎推进的合成路线

`scripts/isometric-workshop-route.ts` 创建原始 `createFormalWorld(5402)`，只直接解除暂停。既有居民 `founder-18-2` 从原住址走到既有 `commons-workshop-10`（东桥共用工坊）；没有直接写入位置、知识、库存、房间、设备或批次。

六个明确 `submitPlan` 及 `stepWorld(.25)`：

1. 从480开始走到工坊门，525.25完成，实际抵达才获知原工坊。
2. 选择20分钟普通纤维制作：525.5进入，531.25到桌台，541.5批次工时10.25，551.25完成。原木材12→11，在实际工作开始时保留到批次，纤维3只在完成后出现。
3. 以本人原库存实际安装木工作台，671.25完成，木材11→3、石料6→4。此设备安装行动本身不在新增动作美术支持内。
4. 沿真实室内/户外路径回原住宅门，723.5完成。
5. 选择40分钟锯制木板：769.75进入工坊，775.5到真实木工作台，805.75剩9.75分钟且原木材3已经在批次中、尚无木板；815.5实际完成后得到2木板。
6. 离开工坊，821.5出屋，867.75到原住宅门，保留同一人物身份与结算后库存。

这是显式脚本合成路线，不是模型自主选择、真实山谷状态或长期生存证据。安装前桌台与安装后木工作台都由该路线覆盖。

## 可复现验证

在仓库根目录执行，临时目录只在 `output/test-tmp/workshop/`；空环境加现有offline guard拒绝网络、环境文件与真实存档。不要运行正式入口或尝试bwrap。

```sh
mkdir -p output/test-tmp/workshop
cat > output/test-tmp/workshop/guard-native-compat.mjs <<'COMPAT'
import fs from 'node:fs';
if(globalThis.__valleyOfflineGuard!==true)throw new Error('offline_guard_required');
if(fs.realpathSync.native===undefined)fs.realpathSync.native=fs.realpathSync;
COMPAT
env -i PATH="$PATH" HOME="$PWD/output/test-tmp/workshop" \
  TMPDIR="$PWD/output/test-tmp/workshop" TSX_DISABLE_CACHE=1 \
  node --import ./scripts/acceptance-offline-guard.mjs \
  --import ./output/test-tmp/workshop/guard-native-compat.mjs --import tsx --test \
  tests/isometric-*.test.ts tests/action-position.test.ts tests/resident-follow.test.ts \
  tests/rooms.test.ts tests/client-bundle.test.ts tests/client-loading*.test.ts
env -i PATH="$PATH" HOME="$PWD/output/test-tmp/workshop" \
  TMPDIR="$PWD/output/test-tmp/workshop" TSX_DISABLE_CACHE=1 \
  node --import ./scripts/acceptance-offline-guard.mjs \
  node_modules/typescript/bin/tsc --noEmit
env -i PATH="$PATH" HOME="$PWD/output/test-tmp/workshop" \
  TMPDIR="$PWD/output/test-tmp/workshop" TSX_DISABLE_CACHE=1 \
  node --import ./scripts/acceptance-offline-guard.mjs \
  node_modules/typescript/bin/tsc -p tsconfig.server.json --noEmit
env -i PATH="$PATH" HOME="$PWD/output/test-tmp/workshop" \
  TMPDIR="$PWD/output/test-tmp/workshop" TSX_DISABLE_CACHE=1 \
  node --import ./scripts/acceptance-offline-guard.mjs --import tsx \
  scripts/render-isometric-workshop.ts
```

局部 `.native` 兼容仅指回同一个受guard保护的函数，不放宽网络/文件限制。`client-bundle` 用 `configFile:false, envFile:false, write:false` 做Vite内存生产构建与可选分包检查，不写dist。

主测试 `tests/isometric-workshop.test.ts` 验证合成引擎路线、原料与成品时点、真布局、家具去重、拾取、准备/工作状态、畸形证据拒绝、进出连续跟随、未支持动作回退、冻结输入、暂停和缓存。独立审查与额外回归见 [review](../reviews/isometric-workshop.md)。最终限定集成统计见下方；不能把有限测试写成完整项目通过。

## 合成图像与尚未完成的验收

`scripts/render-isometric-workshop.ts` 直接把运行时室内渲染器的真实像素列表栅格化，输出 `output/isometric-workshop-crafting/` 中的合成房间PNG、四相位近景及 `manifest.json`。清单包含合成来源、时间、ID、roomAt、说明、预算及源码/图像SHA-256。

这些PNG仅为合成源码像素，不是浏览器截图，也不是实际存档。没有真实浏览器、触屏、GPU、GET/SSE网络生命周期、正式服务、真实模型或真实存档验收，没有执行完整 `npm test`。正式默认仍2D，不因本批有限支持改为2.5D。未暂存、未提交，也不表示共享工作树其他候选已合并。

## 本批最终检查结果

- 限定集成 **241/241通过**，0失败/取消/跳过，日志 `output/test-tmp/workshop/final-guarded-v2.log`。其中主专项8项、独立审查8项，以及原等距、位置、跟随、房间、客户端加载与Vite内存生产构建检查。独立审查报告保留单独结果。
- 首轮集成240/241，原观察器测试发现新增工坊摘要在动画期间重新扫描建筑集合；现已把房间类别随快照/切房缓存并纳入原子回滚，最终同一测试绿色。独立审查分别补上负安装时间和空设备ID反例，两者修复后通过。日志保留，不将初次失败隐藏为从未失败。
- 前端 `tsc --noEmit`、服务端 `tsc -p tsconfig.server.json --noEmit` 和 `git diff --check` 均通过。类型检查覆盖当前共享工作树，并不等于其他并行候选已独立验收。
- 房间及近景PNG已实际查看。最终manifest由修补后的源码重新生成；图片内容依然仅为合成源码像素，浏览器、触屏、GPU与真实网络生命周期未验收。
