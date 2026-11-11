# 学校室内的有限只读2.5D观察

本批基于 `f00f772`，在[可选入口](isometric-formal-entry.md)及[诊所室内](isometric-clinic.md)基础上有限增加 `school`。默认仍2D，不改原2D、引擎、学校建设、教学同意、物资、钱、存档或网络。

## 先核对真实模型

- `BuildingKind` 和 `building/school@1` 确有学校，定义为7×5、capacity=0。实际离线运行 `createFormalWorld(5402)` 确认原种子没有 `school` 建筑，也没有初始 `rooms` 或课程。不能把测试学校写成默认世界原有事实；普通引擎首步初始化 rooms/education。
- `roomLayout` 为该校舍产生16×13房间、入口 `(8,11)`、桌台 `(8,8)`、厨房 `(8,4)` 和 `care=(4,5)`。`care` 只是导航目标，不画为设施。学校即使capacity非0，也不会按容量生成床位；不同于工坊/商店，其基础高度为13，不人为扩成16。
- 引擎 `actionRoom` 从实际课程及报名席位计算教学目标：老师 `(center,5)`，第0席学习者 `(center-2,8)`，其它席位仍按原引擎坐标。目标不是新增课桌/椅子/黑板。人物必须真的通过室内路径抵达。
- `education.post` 只发布课程，学习者另行 `enroll` 才报名并托管本人学费。单方在场不计学习；引擎只有双方本步实际工作时间重叠时才消耗示范材料、累计技能与学费。渲染器不复刻或改写这一结算逻辑。

## 显示范围与回退

- 保留 `homeInteriorSupport` API名，加入school白名单。要求实际 `world.rooms`，先验证宽高、非负整数容量、尺寸/槽预算，再核对同一 `roomLayout` 的槽key和坐标。学校容量不当床数，畸形输入、未知/重复工位、超大几何仍失败关闭。
- 只画真实桌台、未点火静态厨房与原人物；不补造单人课桌、书本、纸笔、黑板、讲台、教具、食物或教学产出。实际未支持工位仍按真实槽key显示问号，不因学校类型改变为教具。
- 人物只由实际 `inside/roomAt` 纳入，不根据职业、课程、报名、预定席位、门口或行动目标补人或猜坐标。点选保留原人物ID、房间ID与槽key。
- 沿用 `personVisual` 和原人物外观，无学校专属动作。说明明确：“学校室内原人物；未绘制授课、读写或学习手势，在场不表示正在授课、取得进度或完成学习。”课程进度/完成不改变人物中性像素，也不冒充教学视觉验收。
- 未支持重病、婴儿、携运、遗体或工作姿态继续原记录标记/2D跟随回退；无精确坐标只计未知，不放到入口。普通烹饪/工艺未因学校开放取得住宅/共屋/工坊的姿态支持。
- 手动进入/退出、连续跟随、拖动释放、点选、暂停、隐藏、断线冻结、Escape与2D交还沿用原机制。动画只读快照接受时准备的数据，不扫描教学账本、推进模拟或改变原状态。

## 明确合成的真实引擎路线

`scripts/isometric-school-route.ts` 从全新内存 `createFormalWorld(5402)` 保存原始开局。直接设置只有两项：

1. 在 `founder-1-1` 原登记地块 `(267,181)` 添加一栋 `building/school@1` 测试建筑 `synthetic-school-1`，所有者仍是该原教师，尺寸/容量来自版本化定义，门 `(270,186)`。没有以改造住宅假冒学校，也没有追加公共使用权。
2. 解除暂停。

完整世界差分测试证明除此之外无直接变化。原教师 `founder-1-1` 本有建造技能1、木12/石6与22钱，原成年伴侣学习者 `founder-1-2` 本有建造技能0与23钱。未改原人、技能、钱、背包、知识、位置；未预写课程、同意、托管、`roomAt` 或学习进度。新增学校本身是测试fixture，不声称已完成建设或证明原种子有学校。

之后10个显式 `submitPlan` 加 `stepWorld(.25)` 完成：

- 教师走到学校取得地址认知，发布60分钟后开始、窗口240分钟、1席、学费12钱的建造课，再回家。
- 学习者本人走到门口，独立报名并托管12钱，再回家。发布和报名均无进度，也不消耗材料。
- 窗口开始后教师另选teach，真实进入学校抵达 `(8,5)` 并独自等待2分钟；材料、工时、技能与报酬仍未变。
- 学习者另选study，户外/室内行路到 `(6,8)`。刚抵达的快照仍无共同工时；下一步才实际结算0.25分钟并一次消耗教师原有木/石各1。
- 共同30分钟时增加0.125技能、支付6钱；59.75分钟支付11钱且尚未完成；60分钟才完成本人本场学习、共增0.25技能并支付12钱。
- 教师余下teach动作自然结束，两人再各自另选回家，通过真实出口和户外路径。没有新增学习、付款或重复耗料。学习者完成不等于整个课程窗口结束，课程仍是scheduled。

实际合成时刻：501.25发布；537.75报名；课程561.25–801.25；587.25教师到位，589.25独自等候；610.25双方到位但0工时，610.5首次共同0.25分钟；640.25半程，670为59.75分钟，670.25完成60分钟；707.25教师动作结束；教师717.25离屋、733.5回家，学习者738.5离屋、754.75回家。每帧原居民+托管的钱守恒；不将首步初始化外部商人资金当成教学收益。

这是脚本选择的合成路线，不是自主模型、原种子学校建设或真实长期学习验收。

## 图像来源

`scripts/render-isometric-school.ts` 使用上述 `half-learning` 快照，直接栅格化客户端的真实像素列表，输出：

- `output/isometric-school-interior/synthetic-school-room.png`
- `output/isometric-school-interior/synthetic-school-original-people.png`
- 同目录 `manifest.json`，记录明确fixture差异、源文件/PNG SHA-256、原人物ID、roomAt、时刻与预算。

两张图顶部都明确标注 **SYNTHETIC / NOT BROWSER**；PNG描述也声明合成校舍与原居民。总览只有同一桌台、静态厨房、两位原人物。放大图显示原人物空手、中性姿态，厨房部分被裁切；教师下身受真实桌台深度遮挡，不是新增讲台或教学手势。素材来自既有源码，不增加外部素材/依赖。不能从图声称浏览器或课堂教学效果已验收。

## 安全重现与检查范围

仓库根目录运行以下已有离线guard，禁止网络和密钥/环境文件/真实存档读取；不启动正式服务。`realpathSync.native` 仅兼容指回同一受保护函数，不放宽路径范围。

```sh
mkdir -p output/test-tmp/school
cat > output/test-tmp/school/guard-native-compat.mjs <<'COMPAT'
import fs from 'node:fs';
if(globalThis.__valleyOfflineGuard!==true)throw new Error('offline_guard_required');
if(fs.realpathSync.native===undefined)fs.realpathSync.native=fs.realpathSync;
COMPAT
env -i PATH="$PATH" HOME="$PWD/output/test-tmp/school" \
 TMPDIR="$PWD/output/test-tmp/school" TSX_DISABLE_CACHE=1 \
 node --import ./scripts/acceptance-offline-guard.mjs \
 --import ./output/test-tmp/school/guard-native-compat.mjs --import tsx --test \
 tests/isometric-*.test.ts tests/action-position.test.ts tests/resident-follow.test.ts \
 tests/rooms.test.ts tests/education.test.ts tests/client-bundle.test.ts tests/client-loading*.test.ts
env -i PATH="$PATH" HOME="$PWD/output/test-tmp/school" \
 TMPDIR="$PWD/output/test-tmp/school" TSX_DISABLE_CACHE=1 \
 node --import ./scripts/acceptance-offline-guard.mjs node_modules/typescript/bin/tsc --noEmit
env -i PATH="$PATH" HOME="$PWD/output/test-tmp/school" \
 TMPDIR="$PWD/output/test-tmp/school" TSX_DISABLE_CACHE=1 \
 node --import ./scripts/acceptance-offline-guard.mjs node_modules/typescript/bin/tsc -p tsconfig.server.json --noEmit
env -i PATH="$PATH" HOME="$PWD/output/test-tmp/school" \
 TMPDIR="$PWD/output/test-tmp/school" TSX_DISABLE_CACHE=1 \
 node --import ./scripts/acceptance-offline-guard.mjs \
 --import ./output/test-tmp/school/guard-native-compat.mjs --import tsx scripts/render-isometric-school.ts
```

`client-bundle` 为 `configFile:false, envFile:false, write:false` 的Vite内存生产构建，不读取环境文件或改写dist。五处原测试文件把school不支持房型反例保留为barn/greenhouse；无rooms的旧路由反例仍保留school，继续验证失败关闭。

未运行完整 `npm test`、真实浏览器/触控/GPU、GET/SSE真实网络生命周期、正式服务、真实模型或真实存档。没有联网、bwrap、暂存或提交。原五个赠食候选保持不变，不因本次测试通过而宣称其验收。

## 最终结果

- 显示专项7/7、真实引擎路线5/5、[独立专项](../reviews/isometric-school.md)10/10通过。全部等距、动作位置、连续跟随、房间、教育、客户端加载与Vite内存构建限定集成 **320/320** 通过，0失败、取消或跳过；日志 `output/test-tmp/school/final-integration.log`。最后调整的显示测试另跑7/7通过。
- 前端与服务端 `tsc --noEmit` 以及 `git diff --check` 通过；类型日志 `client-types.log`、`server-types.log` 位于同一输出目录。它们不等于完整项目或赠食候选验收。
- 实现者与独立审查者均实际查看两张源码合成PNG；后者核对5份源码与2张PNG的manifest哈希一致，未发现剩余阻断。
- 原5个赠食候选的开始/结束SHA-256一致，HEAD仍为 `f00f772`，未暂存或提交。
