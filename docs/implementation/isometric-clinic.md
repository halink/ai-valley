# 诊所室内的有限只读2.5D观察

本批基于 `c8e1566`，在[可选正式入口](isometric-formal-entry.md)及[商店室内](isometric-store.md)基础上有限增加 `clinic`。默认仍2D，不改变引擎、原2D、诊疗、物资、同意、付款、存档或网络。

## 先核对真实模型

- `BuildingKind` 和 `building/clinic@1` 确有诊所。实际运行 `createFormalWorld(5402)` 可见 `commons-clinic-2`、`commons-clinic-5` 和 `commons-clinic-8`，均为原公共建筑。初次仅靠源码作出的“没有诊所”判断被独立测试纠正，最终路线没有新增或改造建筑。
- `roomLayout` 为诊所按真实容量产生床位，并提供桌台、厨房、入口、`care` 和两个 `bodyBay`。后两类是导航目标，不是已有设备、药柜、病人或遗体。现场设备仍须来自实际 `industry.stations`。
- 普通预约由 `health.offer` 预留医生本人药剂/水，患者另选 `accept` 才预存费用。`actionRoom` 将医生 `treat` 送至 `care`，患者 `receive` 送至 `bed:0`；床位坐标不意味着患者正在躺睡。
- 单方到场或双方刚到位置都不自动计诊疗。引擎在双方本步实际工作后计算重叠时间，首次共同工时才消耗预留物料，并按实际分钟累计进度/报酬。结束预约不等于伤病康复。渲染器不另写医疗有效性或结算判定。

## 显示范围与回退

- 保留 `homeInteriorSupport` API 名，加入 `clinic` 白名单。要求实际 `world.rooms`，宽高、容量、工位数量先有界校验，再核对同一导航布局的尺寸、槽key和坐标。诊所的两个安置槽计入输入预算；旧档没有房间记录时不造房间。
- 只画同一真实布局的床位、桌台和未点火的静态厨房；`care/bodyBay` 不画为设施。未支持的真实工位沿原槽key显示问号说明，不制造药柜、药瓶、手术台、工具、食物或产出。
- 人物只由实际 `inside/roomAt` 进入场景。预约、住房、职业、床位分配、门口或行动目的地不会新增人物或猜测室内位置。点选保留原人物ID、房间ID和槽key。
- 诊疗没有新专属姿态。沿用原 `personVisual` 及原人物外观，显示说明：“诊所室内原人物；未绘制治疗、给药或护理手势，不表示正在诊疗或已经治愈。”真实医疗记录不会自动产生白袍、卧姿、喂药或治疗动作。
- 原受支持的中性人物与经核实睡眠继续沿用。重病、婴儿、携运、遗体和其他未支持室内姿态仍显示原记录问号，跟随不能可靠显示时回2D；无精确位置只计未知，不放到入口。诊所的普通烹饪与工艺没有借此取得住宅/共屋或工坊的额外姿态支持。
- 跟随、手动进入/退出、暂停、隐藏、断线冻结、Escape、2D交还及预算沿用原实现。动画读取快照接受时准备的资料，不重新扫描医疗账本或推进世界。

## 明确隔离的合成医疗路线

`scripts/isometric-clinic-route.ts` 使用全新内存 `createFormalWorld(5402)`，保存原始开局，再使用原 `commons-clinic-5`、原有具照护技能成人 `founder-14-2` 与其原成年伴侣 `founder-14-1`。

**唯一直接测试设置**是给前者增加1份测试药剂、调用原 `addHealthCase` 为后者建立severity=50的合成伤病例，以及解除暂停。该调用正常初始化的健康/经济状态与事件也属于已声明夹具差异。未新增人物、建筑、知识、位置、技能、钱或水；没有预写同意、预约、`roomAt`、实际治疗、报酬或治愈。默认种子没有药剂或活动伤病例，不能把这些测试输入冒充默认世界事实。

之后8个显式 `submitPlan` 与 `stepWorld(.25)` 完成：

1. 医生从原住处走到原诊所门口，到场取得地址认知后返回伴侣身边。
2. 医生提出预约，约定60分钟后开始、10钱，真实预留其测试药剂及原有1份水。
3. 患者本人另行接受，10钱进入原预约托管账户。
4. 医生实际进屋至 `care`，超过开始时刻独自等待，worked、paid、treatment仍为0，预留物料未消费。
5. 患者另选赴诊，经过真实室内路径到 `bed:0`。刚到场时仍为0；下一步首次共同0.25分钟才消费物料。
6. 共同15分钟支付5钱，29.75分钟支付9钱，30分钟完成并支付10钱。伤病仍为recovering且severity>0，不称治愈。
7. 双方分别另选回家，经过实际室内出口和户外路径；没有重复扣料、治疗或付款。

最终路线时刻：532.5提出，537.5接受；预约窗口592.5–712.5；594.75医生独自等候，642.75双方刚到位置仍无共同工时，643首次0.25分钟结算，657.75完成15分钟，672.5完成29.75分钟，672.75完成30分钟。医生682.75离屋、707回家；患者719离屋、743.25回家。原诊所建筑6×5、容量2；实际房间16×13，入口`(8,11)`、`bed:0=(2,5)`、`care=(4,5)`。

这只证明脚本选择的合成路线，不是自主模型、真实伤病、默认医疗供给或长期生存验收。原引擎首步会初始化镇外商人资金，测试因此分别检查每帧居民+托管守恒及初始化后的全账户守恒，不能将正常初始化误报为诊疗造钱。

## 图像来源

`scripts/render-isometric-clinic.ts` 取上述 `half-treatment` 快照，直接栅格化真实客户端绘制的像素列表，输出：

- `output/isometric-clinic-interior/synthetic-clinic-room.png`
- `output/isometric-clinic-interior/synthetic-clinic-bedside-people.png`
- 同目录 `manifest.json`：明确夹具差异、来源、真实ID/roomAt、时刻、预算、源码与PNG SHA-256。

两张图顶部均可见 **SYNTHETIC / NOT BROWSER**；PNG描述也声明合成药剂/伤病例输入，原诊所与人物。房间总览只有2床、桌台、静态厨房和2位原人物；放大图显示同一空手人物，厨房部分被裁切。没有把共同工时画成给药、治疗手势或躺床，不能从图认定医疗动作是否正在结算。已由实现者与独立审查者检查像素。

## 验证与重现

仓库根目录执行，使用已有离线guard禁止网络、密钥/环境文件与真实存档。临时工具输出只放在仓库 `output/`。`realpathSync.native` 兼容仅指回同一个guard保护的函数，不放宽读取范围。

```sh
mkdir -p output/test-tmp/clinic
cat > output/test-tmp/clinic/guard-native-compat.mjs <<'COMPAT'
import fs from 'node:fs';
if(globalThis.__valleyOfflineGuard!==true)throw new Error('offline_guard_required');
if(fs.realpathSync.native===undefined)fs.realpathSync.native=fs.realpathSync;
COMPAT
env -i PATH="$PATH" HOME="$PWD/output/test-tmp/clinic" \
 TMPDIR="$PWD/output/test-tmp/clinic" TSX_DISABLE_CACHE=1 \
 node --import ./scripts/acceptance-offline-guard.mjs \
 --import ./output/test-tmp/clinic/guard-native-compat.mjs --import tsx --test \
 tests/isometric-*.test.ts tests/action-position.test.ts tests/resident-follow.test.ts \
 tests/rooms.test.ts tests/client-bundle.test.ts tests/client-loading*.test.ts
env -i PATH="$PATH" HOME="$PWD/output/test-tmp/clinic" \
 TMPDIR="$PWD/output/test-tmp/clinic" TSX_DISABLE_CACHE=1 \
 node --import ./scripts/acceptance-offline-guard.mjs node_modules/typescript/bin/tsc --noEmit
env -i PATH="$PATH" HOME="$PWD/output/test-tmp/clinic" \
 TMPDIR="$PWD/output/test-tmp/clinic" TSX_DISABLE_CACHE=1 \
 node --import ./scripts/acceptance-offline-guard.mjs node_modules/typescript/bin/tsc -p tsconfig.server.json --noEmit
env -i PATH="$PATH" HOME="$PWD/output/test-tmp/clinic" \
 TMPDIR="$PWD/output/test-tmp/clinic" TSX_DISABLE_CACHE=1 \
 node --import ./scripts/acceptance-offline-guard.mjs \
 --import ./output/test-tmp/clinic/guard-native-compat.mjs --import tsx scripts/render-isometric-clinic.ts
```

`client-bundle` 是 `configFile:false, envFile:false, write:false` 的Vite内存生产构建，不读取环境文件或改写dist。五处旧测试文件将“不支持房型”的clinic反例改成school，保留回退断言；原无rooms的路由反例仍保留clinic。未改原2D绘制或引擎。

最终测试与独立审查结果见下节及[独立审查](../reviews/isometric-clinic.md)。未运行完整 `npm test`、真实浏览器、触控、GPU、GET/SSE网络、正式服务、真实模型或真实存档；这些边界不因有限CPU检查通过而消失。未使用bwrap、联网、暂存或提交，原五个赠食候选保持原样。

## 最终结果

- 主显示专项 **6/6**、真实引擎路线 **5/5**、独立专项 **9/9** 通过。最终全部等距、动作位置、连续跟随、房间、客户端加载与Vite内存构建限定集成 **277/277** 通过，0失败、取消或跳过；日志 `output/test-tmp/clinic/final-integration.log`。
- 前端及服务端 `tsc --noEmit` 与 `git diff --check` 通过；日志 `client-types.log`、`server-types.log` 位于同一输出目录。它们不等于完整项目测试或五个赠食候选验收。
- 两张源码合成图均已实际查看，独立审查未发现剩余阻断。原5个赠食候选开始/结束SHA-256一致，未暂存、未提交，HEAD仍为 `c8e1566`。
