# 2.5D 居民状态与位置证据

开发预览的只读居民像素模块，入口为 `src/client/isometric-residents.ts`。不修改模拟规则、人物、行动、存档、世界时钟或摄像机，不调用模型。此次范围是视图，不代表完整 1.0 验收。

## 集成契约

`prepareIsometricResidents(world, space?)` 对每位原居民返回一项，始终保留原 `id`。

- 户外省略 `space`。室内传 `{roomId, bounds:{x:0,y:0,width:layout.width,height:layout.height}}`，布局由调用者先验证。
- `kind: 'render'` 返回 `at`、`anchor`、`footprint`、`pose`、`description`、`animated` 和 `marks(elapsed)`。
  - `at` 是当前场景坐标系中实际记录的地格；已经核实的携运对象使用携带者的地格，绝不使用患者/遗体的旧坐标。
  - `anchor` 只插值实际 `path[0]` 与快照中的 `[0,1]` 进度。世界方向投影为屏幕方向。没有进度的旧普通路径保持起点，不外推。室内只用匹配房间的 `room.path/progress`。
  - `footprint` 是含地格与已报告插值点的整数 AABB，用于分桶、裁剪和排序。命中人物身份使用原 `id`，不是动作名或携带者 ID。
  - `marks` 只换手脚/身体动作相位，不再扫描世界，不推进 `anchor`。动态预算上限为 `RESIDENT_MARK_LIMIT=1024`，由调用者先预留；静态对象也不得超过此上限。
  - 使用预览的暂停感知毫秒时钟。暂停快照额外固定到第 0 相位，`animated=false`，不会因直接传入更大 elapsed 而动；切换暂停可能回到第 0 帧，不声称保持上一瞬间的同一像素帧。
- `kind: 'fallback'` 返回 `reason` 和 `at: Vec | null`。有点才画明确的未知/未绘制标记；`at=null` 只计未知位置，禁止猜入口、床位、旧位置或地图原点。
- `kind: 'hidden'` 同时返回 `hiddenReason: 'buried' | 'outside' | 'other-space'`，分别表示已实际安葬、谷外/区域旅途，或当前应在另一室内外场景。跟随桥接必须用该类型字段区分原因，不能用患者旧 `inside` 或解析中文说明覆盖携带者的真实谷外状态。不是预算 omission，也不是未知标记。
- 重复居民 ID 和无有效布局的室内调用直接失败；调用方应保持旧视图或明确回退。

## 已表达状态

- 普通及室内行走：只有合法相邻下一格和已报告进度会移动锚点；持续动画只摆手脚。不按墙钟推测居民已走到目的地。
- 通用现场工作：采用已有 `personVisual` 门禁。空手动作不附加虚构锤子、设备、产品或产出。
- 婴儿：用本人外观的小型坐姿，不附加摇篮。婴儿有独立步行路径而没有携运关系时明确降级。
- 重伤病：依据已有未恢复病例与规则阈值，画收缩身体姿态；不添加药品、病因或治疗结论。
- 文化活动：沿用实际到场、未取消活动的 `open/speak` 姿态门禁；不添加彩纸、赠物或已成功举办的结论。
- 狩猎：到场姿态且有可核实的本人随身可用猎矛才绘制；不画命中、伤害、猎获物或自动追踪动物。
- 河岸休息与已确认床位睡眠：静态休息/卧姿，不附加未记录床具。
- 未葬遗体：原位置、原身份、原外观的静止卧姿；只有非未来、非负、有效 `buriedAt` 的真实安葬才隐藏。预留或登记待葬不当已安葬。
- 已核实医疗、儿童接送和遗体携运：载荷用自身 ID 与外观，锚点跟随真实携带者；不加未记录担架。缺携带者、冲突、循环、多项载荷或行动不匹配时不沿用旧坐标。

## 明确保留的边界

当前世界的睡眠事实门禁只确认可用床位。仅有户外 `sleep` 计划不能证明已睡着，返回“睡眠位置待核验”，不补造户外睡眠状态。真实引擎在走完户外路径和入室之间会报告一帧住宿门口状态：只有住宿仍可确认、本人位置和行动目标都精确等于该真实门口、尚未进入房间且没有室内路线时，保留本人当前非睡眠姿态，并明确说明“尚未到床，不表示睡眠”。卧姿画法不是睡眠事实的替代证据。

渡船乘客与家庭共同旅程有独立进度，暂用真实记录位置与解释性回退，不把旧个人路径画成水面步行或独行。室内当前可访问种类仍由住宅预览决定，此模块不自行开放其他建筑。没有精确位置的旧档仍未知，不进行初始化、迁移或修补。携运、渡船或家庭关系账本形状损坏时，所有居民明确回退为位置未知，不把残缺账本当作无人被携运；其他场景对象仍可由调用方照常处理。

## 本地验证

所有夹具都是新建内存合成世界；未读 `.env`、密钥、真实存档，未使用浏览器 IPC、真实服务或模型。

- `TMPDIR="$PWD/output/resident-tools" node --import tsx --test tests/isometric-residents.test.ts`：22 项通过。
- `TMPDIR="$PWD/output/resident-tools" node --import tsx --test tests/isometric-residents.test.ts tests/isometric-observer.test.ts`：门口过渡修复时 34 项通过，包含真实引擎门口→室内→床位路线与连续跟随；后续 typed hiddenReason 增加一项专属回归，单独复跑全部 22 项专属通过。
- `TMPDIR="$PWD/output/resident-tools" npm run check`：类型检查通过（2026-11-10 的当前共享工作树）。
- `TMPDIR="$PWD/output/resident-tools" node --import tsx scripts/render-isometric-residents.ts`：生成四相位联系表、HTML说明、原ID/位置与源码/PNG SHA-256 清单。
- 输出在 `output/isometric-residents/`，已查看 `synthetic-resident-phases-260.png` 的实际像素。联系表为检查姿态重新排布，不表示世界中的互相位置。

这些是轻量 CPU/源码验证和像素合成，不是真实浏览器截图、触控/GPU验收、长期自主模拟、完整测试套件或整合后的最终验收。独立复核另见 `docs/reviews/isometric-residents.md`。
