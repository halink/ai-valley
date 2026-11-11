# 健康幼儿灾害护送独立审查

范围：`guardian-evacuation.ts`、健康机会生成、最终菜单限额、`MedicalTransport.evacuationDangerId` 及医疗引擎接入。只使用隔离 `createWorld` fixture，不读取真实存档或密钥，不调用模型、浏览器或 npm，不提交或推送。

## 已确认问题

### P1：绑定灾害的幼儿护送仍会进入另一项现场可见危险

初始实现中，菜单及接出时使用普通 `findPath`；`engine.ts` 的逐边规则只对 `frontierHazard.retreat` 使用 `frontierRetreatStepAllowed`。普通 `walkable` 仅阻止进入具有 footprint 的 active 洪水，不能阻止进入已见洪水 warning 或 active 风暴。

独立测试 `tests/guardian-evacuation-review.test.ts` 经真实 `decisionContext → decisionChoices → parseChoice → submitPlan → stepWorld` 复现：从 `(11,8)` 接出健康两岁幼儿，送往 `(5,8)` 安全床位，另一项可见危险只覆盖 `(8,8)`。存在安全绕路，护送仍把孩子带进 `(8,8)`。三个案例：

1. 提交前已有另一可见洪水 warning。
2. 接出后才出现另一可见洪水 warning，旧路线没有逐边停止。
3. 提交前已有另一可见 active 风暴。

修复应仅作用于具有 `evacuationDangerId` 的救助：菜单路径、实际接出时配送路径以及引擎逐边检查一致采用已见危险的退离规则。保留可离开原危险、不得进入或重新进入其他已见危险、不能读取远方未见野兽/未来天气的边界。普通医疗护送不应随之扩大或改变。

### P1：现实空床仍可能是离家居民的登记专属床

`medical-transport.ts:bedAvailable` 检查临时借床/租约/家庭迁居、实际占床及医疗预约，却没有检查 `b.residents` 对应的永久 `residentBed` 分配。

隔离复现：唯一床位的 lodge 登记给另一活着的本地居民，该居民暂时在 `(1,14)`，`residentBed(w,other,b) === 0`。健康幼儿仍获得最终菜单护送选项，执行后运输记录为 `delivered`，幼儿占用其 bed:0。独立测试分别断言菜单不应提供此床、真实引擎不能送入此床，初轮均失败。另增加运输途中新登记床权必须中止的回归断言，待修复后验证。

## 初轮验证

- `node --import tsx --test tests/guardian-evacuation.test.ts`：当时已有的 6 项全部通过。
- `node --import tsx --test tests/guardian-evacuation-review.test.ts`：上述 3 项全部失败，均实际到达禁止进入的 `(8,8)`，不是菜单缺项或 fixture 初始化失败。
- 静态检查确认：新的健康幼儿候选没有并入普通 `rescuePatients`，没有自动添加 stabilize；最终菜单主动保留且最多两项绑定护送；绑定灾害及当前监护/拒绝条件在接出前重验，配送记录保留绑定 ID；配送阶段不要求原灾害仍活跃。
- 没有修改生产文件。没有运行全仓回归、浏览器或长期模拟。

## 边界

`canSeeDisaster` 接受现场可见 warning；此审查不把现场预警本身认定为未来天气泄漏。实现负责人已确认允许现场可见预警阶段开启护送，不能与“不得读取未来天气参数”混为一谈。

没有承诺穷尽全部地形、室内路径、渡船衔接或长期容量并发。非危重失能成人、无床干地撤离是明确未实现的范围，不列为缺陷。

## 类型检查

初轮 `node node_modules/typescript/bin/tsc --noEmit` 发现主测试追加中的 AgencyState fixture 缺少 nextSerial（当时第84行），已报告实现负责人；生产代码没有该次诊断。待并行修改完成后需重跑。

## 修复后独立复核

两项 P1 已修复并复测：绑定幼儿护送的接近、配送路径及执行逐边检查复用 `frontierRetreatStepAllowed`；医疗床位检查排除其他活着、本地、homeId 与登记建筑一致居民的实际 `residentBed`，持续执行仍复核。

新增独立 8 项全部通过，包括已有/新增 warning、active 风暴、缺席居民登记床、实际引擎不可侵占、途中新增登记权、途中已接受预约竞争，以及不能过度排除另一空床或孩子自己的床。最终与主 15 项合跑共 23 项通过。

独立测试新增登记权用 fixture 精确改变当前权利状态；预约竞争亦注入已经接受的预约，仅验证运输层持续重验，不宣称覆盖登记/预约产生流程的全部并发政策。

审查结论：本次发现的路线和永久床权缺口均已闭环，已测范围无剩余阻断问题。这不是全仓或长期模拟通过声明。主测试重载使用内存 SQLite；审查不访问真实存档。

最终 `node node_modules/typescript/bin/tsc --noEmit` 退出 0。主测试缺失 nextSerial 和独立 fixture 的空数组类型推导均已修复，未留下类型错误。

最终范围确认：这是仅使用当前监护人现场已观察的本地接收床的有限入口。室内受灾幼儿及未知远方床位仍未覆盖，不构成本轮遗漏修复；不得为让菜单出现而加入全知床位或远处实况。
