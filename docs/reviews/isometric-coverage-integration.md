# 等距真实记录覆盖整合独立审查

日期：2026-11-10。范围为 `isometric-study`、`isometric-viewport`、`isometric-preview` 接线及相应测试，同时核对居民、建筑、资源 API 和住宅室内待葬遗体修复。后续纳入 `resident-follow.ts`、`scene.ts`、`main.ts`、`development-preview.ts` 的临时跟随桥接和卸载行为。本审查没有修改业务代码或测试，也未提交。

## 结论

**本轮报告的问题均已修复并复查，当前范围未发现剩余阻断问题。最终定向串行测试 155/155 通过。** 此前 68/68、72/72、131/131 是中间检查，不替代最终结果。分数镜头的独立可见像素 oracle 共比较 18 个镜头、70 个可见实体，未发现普通预算下的索引遗漏。真实 ID、记录坐标、携带者位置、暂停显示、像素点击、预算标记、未知位置计数与旧 2D 路由均有测试证据。

屏外静态候选耗尽对象名额的原反例已修；动态候选允许补扫但受明确的 384 次检查上限约束。携运的模型定位、真实 main 点击路由、共享跟随状态与后续快照追踪均已接通；旧房间残留加携带者出谷的组合也已修复。没有发现世界写回、凭空坐标、静默超预算或正式默认入口被改变的证据。此结论不是浏览器或全量验收。

## 独立反例与保留边界

1. **原 P2 已修，保留明确扫描预算。** 原算法先将含 halo 的候选按地格距离截到 192，再检查像素。合成 100×100 世界，镜头中心 (50,50)、180×600、zoom=3，放 192 个居民于屏外 (52,48)，另一个实际可见居民于 (53,53)，原画面会为空。修后静态对象用准确像素 AABB 预筛，完全屏外对象不消耗可见名额；该反例现在只检查 1 个对象、显示目标且省略为 0。动态对象不缓存某一相位的 AABB，而是在当前相位检查后补扫下一候选，最多检查 384 次。独立用 0/192/383/384/385/600 个屏外动态对象验证：前三者显示目标且无省略，后三者目标可被检查预算省略，`omittedObjects` 分别为 1/2/217。将目标优先后全部保留，所有情况 checks≤384、objects≤192、marks≤60000，四相位预算均成立。这是受限且明确披露的降级，并非任意密度下完整显示；极端动态 halo 场景仍可能空画面。
2. **携运定位与持续跟随 P2 已修。** 已核实医疗患者的旧 `at` 为 NaN、(-1,-1)，或 `inside='missing-old-room'` 时，新版准备结果仍可核实携带者保存分数锚点 (14.25,8)。最初只调整预览模型，真实 main 路由仍使共享状态 `stopped`；现加入仅在预览启用期间注册的可选 resolver。真实 main 点击分支与真实 ValleyScene/ResidentFollow 方法可保持 `following`，后续快照使用传入新世界追踪携带者，未依赖旧预览快照。退出、异常和 HMR dispose 撤销 resolver 后立即按原 2D 重验，未向居民写入显示锚点。
3. **旧室内残留与出谷的组合已修。** 患者残留有效旧住宅 `inside/roomAt` 时，携带者进入区域旅途最初会被误导回旧房间继续跟随。现居民 API 返回 `hiddenReason: 'buried' | 'outside' | 'other-space'`，viewport 原样传递，桥接按 typed `outside` 停止，不匹配中文文案，也不依赖载荷旧 inside。独立验证 `inside=null/有效旧住宅/失效旧房间` 与携带者 `regionalLocation/residency='outside'` 的 6 种组合：全部停止为 outside，镜头保留原处，不改世界，恢复证据不自动续追，显式重新跟随才恢复。真正本人室内 `other-space` 仍沿用原房间路由，住宅睡眠者切 2D 再切回保持正确。

上述反例都只使用内存合成数据。没有尝试修补真实存档。

## 验证范围

执行：

```sh
TMPDIR="$PWD/output/review-tools" node --import tsx --test --test-concurrency=1 \
  tests/isometric-follow-route.test.ts \
  tests/resident-follow.test.ts \
  tests/isometric-residents.test.ts \
  tests/isometric-coverage-integration.test.ts \
  tests/isometric-viewport.test.ts \
  tests/isometric-study.test.ts \
  tests/isometric-interior.test.ts \
  tests/isometric-interior-review.test.ts \
  tests/isometric-observer-review.test.ts \
  tests/isometric-observer.test.ts
```

最终结果为 155 passed、0 failed，日志为 `output/review-tools/final-independent-tests.log`。`git diff --check` 通过。没有另跑全量测试或构建，避免与父任务并行重复。

桥接专属测试文件 `tests/isometric-follow-route.test.ts` 共 7 项，执行真实 main 跟随分支及真实 ValleyScene/ResidentFollow 方法，覆盖失效旧坐标、新快照追踪、普通 2D、交回 2D、卸载、未知/死亡/出谷/区域/丢失停止、恢复不自动续追、世界替换、异常、旧房间加区域携带者、真正住宅室内。另独立运行 3 轮启用/退出、不同 ValleyScene 实例隔离、手动停止后新快照不恢复和 dispose 解除 resolver/timer；全部通过。

- 八种真实建筑 kind、实际足迹和原 ID 均保留，可定位；非住宅不会被错误开放为住宅室内。
- 石矿、浆果丛、泉、果树与新建工程来自同一记录和冻结 API；未知类型或最终 marks 为 null 时使用明确问号或计数，不借用另一类外观。
- 所有已绘制居民状态使用准备 API 的原 ID、记录地格、保存分数锚点和完整足迹。已核实携运不借用载荷旧坐标；失踪携带者成为未知位置，不画在旧点。
- 实际非未来、非负、有限的安葬时间才隐藏遗体。预留、缺失、非法或未来时间不冒充已葬；室内未知位置保持计数，不猜床位。
- 分桶支持锚点在视野外、足迹跨桶的长建筑。独立 oracle 以整个对象 API 的真实像素是否与源画布相交判断应见对象，验证边界镜头与 1.01、2.3、5.7 分数 zoom。
- 动态人物先预留完整相位预算；密集场景保留原 ID 的问号或明确预算省略。跟随目标可优先入场，但不改变坐标和排序深度。
- 384 次检查上限限制每次 render 的候选 make 调用数，不等于 384 个已确定可见对象，也不证明所有剩余候选都在屏外。未检查尾部计为预算省略。像素与对象预算不因补扫被放宽；为可能入场对象预留的问号成本在屏外候选较多时可能保守多留，但不会导致超预算。
- 暂停快照人物固定第 0 相位；动画不重扫世界集合，不外推行走位置。冻结输入及深比较通过。直接合成居民图前后的世界 SHA-256 均为 `6ea276d8897f995f32f724ee888224682988e8f86be9c54a87d8ee1ec9ab960f`。
- 地面先绘、实体按足迹排序，分数 zoom 下可见像素点击保留原身份；测试覆盖屋顶、树冠、婴儿、步行者、遗体与旧选择映射。
- 正式 `main.ts`、`scene.ts`、`index.html` 没有引入等距模块。旧 2D 身份、房间和路由仍保留；未知姿态或不支持的室内跟随明确回退。
- 离线动作图使用 `isometricStudyAnimationFixture` 的独立复制体，仅改变复制体的显示暂停标志；源夹具仍暂停，minute/revision 不变。不能把动作图说成真实运行或自主模拟。

## 实际像素查看

实际查看建筑春季源码图、居民 260ms 联系图，并从当前整合后的 `renderIsometricStudy` 生成和查看 `output/review-tools/integrated-residents.png`。后者保留居民夹具的原相互位置，能看到携带者与患者/遗体叠放、婴儿、地面遗体和未知睡眠问号。临时 PPM 导出丢弃透明通道，因此画布外为黑色；它只是独立 CPU 复核图，不是正式展示产物或浏览器截图。

最终重新查看 `output/isometric-coverage-integration/residents-viewport.png`、`halo-budget-viewport.png`，以及重新导出的 `output/isometric-study/synthetic-isometric-study.png`。halo 图中目标人物保留，居民图中携带者与载荷身份/位置一致。独立核对整合 manifest 的 14 个源码文件和 4 张 PNG，全部 SHA-256 一致，无差异。manifest 为 `output/isometric-coverage-integration/manifest.json`，哈希 `3d1733ad42852cb7f1489efdbe93a37bf94ec62291c35bbf65d67220606cb96e`。重新导出的 study PNG 哈希为 `74cc338c46bfa56afb6fc334b5215b5889e366086c8b9feaeb065693b064a1c7`。这些仍只是源码原生 CPU 合成图，不是浏览器截图。

## 审查版本

SHA-256：

- `src/client/isometric-study.ts`: `fa9052167171c6840215282e5fa0b37716a292853335471cbea0cabde66a2919`
- `src/client/isometric-viewport.ts`: `6403602b079ae2f0d1da6cc020daeb529258e1f32ef94302bf5a8e0e1e84d28e`
- `src/client/isometric-preview.ts`: `e87b251f2e939dfd004a8ac5968b4d0f513d098991b05b6e8ca1bf12908f17c1`
- `src/client/isometric-residents.ts`: `8e1d9f131107880da202c5e3158c088a39a8ad90df0ee5c4441e7d1265f3ef12`
- `src/client/isometric-interior.ts`: `4ecfa6557a9b80afb3b163cd98e2a731f88e1799eee5eaeaacc8b80a294f68e0`
- `src/client/resident-follow.ts`: `a7b44714f27ada5fba651b284935fcdcfcd3688339021dc08822ad59dc95e36d`
- `src/client/scene.ts`: `ce2b36e9be61ac4473bf5962aaa223c81576847a4ace053b15eb51f0a308dcb5`
- `src/client/main.ts`: `283fb0df277b1da8f304e24632698b97b723a1133fd59276e9a866e42b3d7945`
- `src/client/development-preview.ts`: `4ab6b2b37a3fc59f3a4327a2ec8396ba8a3af435bad311e2878b1916f6ce3592`
- `tests/isometric-coverage-integration.test.ts`: `05a41e50bfac77626bb4576ea02e8b650acdfb908f0c5c74062aa40faa71dfec`
- `tests/isometric-follow-route.test.ts`: `56d14109ec361c74269baa0afd24a08f2e192523e6156298f8318be73e64b5e0`
- `tests/isometric-residents.test.ts`: `b648a9638a47ac68d4f8ecc1e51c80de6d58cffd682a417b791db85a9d7fed3e`
- `output/review-tools/integrated-residents.png`: `ec9cabd332a8f1d89b66d734250e58920c6c3123cb34fe7c07aa85e7f6eb9a2e`

未访问浏览器 IPC、真实后台、网络服务、模型、真实存档、`.env` 或密钥。未验收浏览器、触控、GPU、实时快照与最终全量构建；后续源码变化应重跑受影响的定向测试并更新本报告。
