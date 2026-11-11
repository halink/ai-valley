# 参与开发 / Contributing

待实现设计的交付顺序、依赖和验收条件见[《栖谷》实施批次](docs/implementation/roadmap.md)。

使用 Node.js **22.13.0 或更新版本**安装锁定依赖（Node 22 系列也必须至少 22.13.0）。规则测试和隔离静止开局预览无需外部模型密钥。

**完整测试要求 Linux。** CI 使用 Ubuntu 与 Node 22；安全证据 writer 依赖 Linux 的 `/proc/self/fd`、`O_NOFOLLOW` 与目录文件描述符，监督器合成进程测试还依赖 `/proc` 与 POSIX 进程组。多个供餐/食物流集成测试也使用该 writer，不只是名称含 `acceptance` 的测试。macOS 和原生 Windows 运行 `npm test` 会遇到平台限制；请在 Linux 主机或 WSL2 的 Linux 文件系统中执行完整套件，不要移除安全检查或把跳过当作通过。

```sh
npm ci
npm run build
npm test
```

### 仓库内临时文件

`npm test` 固定从本仓库运行，合成夹具统一使用 `output/test-tmp/` 下的随机目录；并发测试各自清理自己的目录。测试启动器也将子进程的 HOME、TMPDIR、TMP、TEMP 指向该目录下本次独立的工具目录，正常退出会清理。直接运行单个测试文件时，夹具仍使用仓库路径；工具自身的临时文件需由调用方约束。安全证据与离线入口继续拒绝 `runtime` 路径，不因迁移放宽。

隔离预览使用 `runtime/dev-preview/`，与 `runtime/formal.sqlite` 分离；所有这些输出均被 `.gitignore` 排除。路径固定于仓库位置，不受工作目录或临时目录环境变量改变，并拒绝符号链接祖先。仓库需位于可写的真实目录；完整证据测试仍需满足 Linux 安全路径规则。

这里只约束项目管理的文件与启动器可传入的环境，不是操作系统沙箱。清空环境的安全子进程、Node/tsx、npm、系统和外部工具仍可能使用系统缓存或临时目录。强制终止或断电可能留下本次临时目录，确认对应进程停止后再清理；不会自动清扫其他测试或正式存档。

### 安全开发预览

```sh
# 终端一：新建一次性静止开局，不读取正式存档或模型配置
npm run dev
# 终端二：前端热更新，只代理隔离后端
npm run dev:web
```

打开 `http://127.0.0.1:5173/ai-town/`。预览后端固定为 `127.0.0.1:3413`，每次启动创建全新临时 SQLite，正常退出删除；不接受数据库/模型/端口覆盖参数，不读取 `.env` 或密钥文件，不启动时钟或模型调度。启动器清除子进程继承的模型、`VALLEY_*`、`VITE_*`、`NODE_OPTIONS` 等配置；前端也禁用 Vite 环境文件与配置文件加载。后端改动后手动重启，即生成另一个新世界。

`npm run dev:formal` 和 `npm start` **不是隔离预览**：默认使用 `runtime/formal.sqlite`，可能迁移并提交存档。目前正式入口为 `no-model`，不读取模型密钥，显式实时模式也保持 `blocked`；[生产安全候选](docs/implementation/production-model-safety.md)仅有假 transport 与合成 SQLite 验证，未接通实时模型。正式存档独占启动只在 Linux 实现，其他平台失败关闭。`dev:web` 不会代理正式端口 3412。更多边界与异常退出清理见[开发预览说明](docs/implementation/development-preview.md)。

macOS/Windows 可先做类型检查和显式的部分离线测试，例如：

```sh
npm run check
node --import tsx --test tests/dev-preview.test.ts tests/dev-preview-review.test.ts tests/content.test.ts
```

这是选定文件的部分验证，不是完整测试，也不证明跨平台已实测；提交时分别列出执行、失败与未运行的检查。完整 Linux 测试命令仍是 `npm test`，没有自动跳过平台测试。

[学校室内2.5D有限观察](docs/implementation/isometric-school.md)复用真实 `school` 布局与人物位置；默认种子没有学校，合成路线仅显式新增按真实定义的测试校舍并解除暂停。原人、物资、技能与钱不预改，实际引擎分开验证单方等待、双方共同学习和最后0.25分钟结算；不补造黑板、书本或教学手势，在场不表示学习完成。[独立审查](docs/reviews/isometric-school.md)与源码合成图不是浏览器验收，原2D仍为默认。

[开发专用绘本诊断预览](docs/implementation/storybook-development-preview.md)复用已有 `dev-observer-web.mjs` 的精确 `?storybook=1` 开关及同一观察快照。仍需手动选择原居民 ID 并开启，只用自制合成箭头/线框；两张参考 PNG 未取得，非正式美术。原2D默认、世界及连接不变，失败/室内/销毁恢复原视图；[独立审查](docs/reviews/storybook-development-preview.md)与 Mock DOM/Phaser 不代表浏览器、美学或性能验收。

[诊所室内2.5D有限观察](docs/implementation/isometric-clinic.md)复用真实 `clinic` 布局与人物位置，`care/bodyBay` 不画成设施；不新增医疗动作或改变原2D。使用原种子诊所与原居民，另立明确的测试药剂/伤病例夹具验证真实引擎进出、单方等待、双方结算及[独立审查](docs/reviews/isometric-clinic.md)。图像为标注合成的源码像素栅格，不是浏览器验收。

- 提交问题时写清版本、预期、复现步骤和观察到的状态。分享前移除密钥、真实服务器地址、存档和私人运行日志。
- 修改模拟时说明谁可以采取行动、在什么地点执行、花费什么，以及如何处理旧存档和中途失败。尽可能通过居民实际行动和公开观察入口验证。
- 修改地图或界面时检查桌面和手机尺寸，提供自建测试世界中的截图。添加素材或依赖时说明来源和许可证。
- 如需报告可能泄露凭据或改变世界状态的漏洞，请使用代码托管平台的私密报告渠道。

[儿童求助有限镇外捎信](docs/implementation/child-help-mail.md)接通原报告人另行交托、既有货运实际送到同源且在家的既有人物、本人独立拒绝或分段来访，以及到谷后另选原址探访与既有现场照护。普通编号菜单主链、无送达/拒绝/过期/路阻/搬迁/重载/重复与[独立审查](docs/reviews/child-help-mail.md)只用隔离合成世界，不新增人口、补给或监护/进入权，访客本人捎儿童信和完整接应仍待实现。

[有限公共储备镇外采购](docs/implementation/public-food-procurement.md)只由明确指定商人与经办人的新议案授权，走既有商人独立接单、真实陆运及公粮另行送至原共屋。旧授权不扩大，公粮不进私人背包/遗产，预算、在途额度、到期退运退款及死亡原位封存分别验证；默认九人编号菜单与[独立审查](docs/reviews/public-food-procurement.md)仍是离线合成验证，不代表长期模型供给验收。

运行 `node scripts/acceptance-long-run.mjs 3` 可在构建后验证隔离世界的多年生命周期。脚本使用本机内存中的测试数据库。

增加 `--daily-json` 可输出隔离运行的逐日事实证据，包含口粮端点、已完成动作计数、变质、等待采样、人口，以及明确只覆盖成功 `eat` 的逐人实际份数与营养明细；没有完整账本的总产量、总消费和毛伤害仍明确留空。[字段范围与重现](docs/implementation/isolation-evidence.md)。该脚本不调用真实模型，也不替代真实模型长期验收。

[有限物理食物流证据](docs/implementation/food-flow-evidence.md)另行记录成功采浆果、田地收获，以及普通 `cook` 的投入/产出；来源新增与加工各自列账，原批次营养缺失保持未知。沿用默认关闭的运行时证据入口，仅持久提交后发布，不能据此宣称完整食物收支。

[钓鱼与狩猎原料新增证据](docs/implementation/wild-food-flow-evidence.md)扩展上述可选食物流：实际鱼群/鱼种与击杀个体分开记录，原鲜鱼/生猎肉批次保持原义；未成功、自然恢复和范围进入不计生产。旧采集器无新覆盖标记时总量保持未知，仍不构成完整账本。

[果树与畜产品自然生成证据](docs/implementation/natural-food-growth-evidence.md)在 `advanceIndustry` 真正生成水果、蛋和奶时记录原实体、物种与批次；采摘/收取仅转移，不重复记产出。仍默认关闭、durable commit 后发布，旧覆盖未知，羊毛和其他未列来源不属于完整食物账。

[行业食物加工转换证据](docs/implementation/industry-food-processing-evidence.md)仅在本人真实 craft 批次完工时另记原配方快照、实际投入/产出和可知原批次；预留、等待、腐败退料不算消费，成品不算净生产。默认关闭、durable commit 后发布；旧覆盖保持未知，非完整账本。

[雇佣食物加工完工证据](docs/implementation/employment-food-processing-evidence.md)独立记录真实签约工人完工的原约配方、在制投入与归店产出；预留、腐败、退料和取消不计转换，工资仍按原劳动分钟。默认关闭、durable commit 后发布；旧覆盖与缺批次保持未知，不是净生产或完整账本。

[温室与受保护代管收获证据](docs/implementation/greenhouse-custody-harvest-evidence.md)仅记录实际成熟作物完工新增，保留原作物定义与真实新批次；代管产物按原遗产包所有者分类，不归劳动者，不重复份额摘要或普通收获。默认关闭、durable commit 后发布，旧覆盖未知；未列转移与播种仍未覆盖，后续留种与晾鱼原型见下文；这些有限切片仍不构成完整生产账。

[本人留种加工食物流证据](docs/implementation/seed-saving-food-flow-evidence.md)仅记录真实 `production.saveSeed` 完工的一根菜投入与两种子非食品输出，不算摄入或新增粮食，也不重复行业/受雇加工。原批次未知与旧覆盖保持未知，严格schema、日报及九人主链分别核对加工两侧；仍默认关闭、durable commit后发布，不是完整账本。

[鲜鱼晾晒原型食物流证据](docs/implementation/prototype-food-flow-evidence.md)分开记录实际开工扣鱼与成功鱼干产物，失败/放弃仅保留已投入不返还的终态，不虚构第二次损失或重复行业加工。原批次未知和旧覆盖保持null，严格schema、日报与九人边界独立核对；默认关闭、durable commit后发布，仍非完整账本。

[真实腐败损失证据](docs/implementation/food-spoilage-evidence.md)在原 `advanceFood` 实物扣减处另记食品、数量、实际容器和可确认原批次；不重复公共汇总，不把迁入、转移或初始化修补算损失。仍默认关闭、durable commit 后发布，旧覆盖与损坏批次保持未知，不是完整损失账。

[普通一次照护供餐证据](docs/implementation/care-meal-evidence.md)另记成功 `care` 的真实照护者扣减、受助者、原批次可知营养和即时饥饿变化。仍默认关闭且仅持久提交后发布；固定缓解不反算营养，旧记录缺测保持未知，不覆盖长期照护或完整消费账本。

[长期照护实际供餐证据](docs/implementation/long-care-meal-evidence.md)独立记录成功 `longCare.visit` 的签约物资实际扣减、原批次可知营养、受助者即时饥饿和健康变化。仍默认关闭、仅 durable commit 后发布，旧记录缺测保持未知，不把缓解或健康增益等同营养，也不宣称完整账本。

[长期照护跨六岁本人同意](docs/implementation/long-care-age-consent.md)区分监护签约和本人选择：满六岁后暂停原约服务与收费，保留原 ID、预付款和期限，待具备决定与表达能力的本人另行同意。旧幼儿默认值不作为同意，可证明的旧本人同意仍保留；本人拒绝、即时停止和原期限退款不被改写。[独立审查](docs/reviews/long-care-age-consent.md)覆盖生日完成竞态、能力恢复、公共资助、旧档重载与饱和菜单，均为离线合成验证，不代表真实模型长期验收。

[监护交接跨六岁本人同意](docs/implementation/foster-age-consent.md)同样区分幼儿年龄豁免与孩子实际选择。实际完成按当前年龄、能力和原提议重验，生日后不能由监护人单独新增永久监护；旧合法签署与期限不改写，拒绝后旧选择不能签新提议。最终编号菜单、最后0.25分钟、SQLite与收养回归及[独立审查](docs/reviews/foster-age-consent.md)均为离线合成验证，不代表真实模型长期验收。

[公厨与公共照护实际供餐证据](docs/implementation/public-duty-meal-evidence.md)独立记录本人完成 `publicDuty.receive` 的个人或授权公共实物、原批次和实际受益者，并分别核对即时饥饿/健康变化与工资；公共汇总不双计。仍默认关闭、durable commit后发布，旧覆盖未知，不是全部喂养或完整账本。

[访客旅途中实际进食证据](docs/implementation/journey-meal-evidence.md)独立记录完成 `visitorJourney.eat` 与捎信 `eatMail` 时本人随身食品的实际扣减、原批次可知营养和即时饥饿变化。默认关闭、durable commit 后发布，旧覆盖未知；不把转移、预留或收信当作摄入，也不是完整消费账。

[家庭迁居逐成员供餐证据](docs/implementation/family-journey-meal-evidence.md)另用独立切片记录真实出发、符合间隔的重启和行路供餐；按已签供给者的原批次份序分别记录成员meal与伴随water扣减及即时饥饿变化。同一事务不重复整组库存，预留/到达不算摄入；仍默认关闭、durable commit后发布、旧覆盖未知，不是完整账本。

[离线九人旅途供餐核对](docs/implementation/nine-journey-food-accounting.md)将已有 journeyMeals/familyJourneyMeals 接入只读 food accounting，分别核对九人与公共库存扣减、固定九人受益摄入；完整家庭事务逐成员留存、缺测不作零、重载不重复，完整消费仍未知。

[离线九人公共与紧急供餐核对](docs/implementation/nine-public-care-food-accounting.md)继续接入已有 publicDutyMeals/emergencyCareMeals，保留实际公共或个人来源和九人受益者的独立口径；公共汇总不重复，严格回执和事务身份在整步接收前验证，缺测不作零，未改变引擎或权限。

[outsideAid.collect 有限边界转移](docs/implementation/outside-aid-transfer-evidence.md)另记真正领取的 aid→person 实物余量与可知原批次，只有固定九人接收计其范围流入；领取不算进食或生产，预留/到站/退运不计。仍默认关闭、durable commit 后发布、旧覆盖与缺批次未知；外贸、遗产和所有权变化仍不构成完整边界账。

[外贸有限跨范围食品转移](docs/implementation/foreign-trade-transfer-evidence.md)继续记录个人出口预留流出、货运实际领取与死亡封存的真实余量；预留不是成交，到站不是领取。固定九人及公共遗产包按实际所有者分别统计进出，外部→外部保留；个人预留原批次与营养保守未知，新旧覆盖分开，仍仅 durable commit 后发布，不是完整边界账。

[继承导致现有食品归属变化的有限证据](docs/implementation/inherited-food-ownership-evidence.md)独立记录成功 `production.inherit` 对实际遗产包、树上水果和现存蛋奶的改权瞬间数量、真实所有者与份额；不当物理转移、生产或摄入。别名/数量不明及原批次营养保持未知，旧覆盖不补零，日报和固定九人分别核对归属进出；默认关闭、durable commit 后发布，仍非完整账本。

未来真实模型验收可显式启用运行时的[逐人决策等待证据](docs/implementation/decision-wait-evidence.md)，区分排队、请求、超时、重试和计划接受，并保留缺失覆盖为未知。默认服务和上述隔离脚本均不自动启用；离线假模型回归见 `tests/decision-wait-evidence.test.ts`。

[正式九人十五日离线准备](docs/implementation/nine-resident-acceptance-preparation.md)提供固定拟议配置、源码/合成开局指纹、已提交自主进食的可选运行时入口及缺测审核。运行 `node --import tsx scripts/prepare-nine-resident-acceptance.mjs --prepare` 只输出准备清单，不加载密钥、存档或模型，也不代表真实验收已完成。

[默认关闭的隔离证据 writer](docs/implementation/acceptance-evidence-writer.md)提供独占目录、分类序号/哈希链、短写与fsync、最终状态和只读崩溃恢复。它不启动模型或数据库，默认服务与准备入口不接入；离线故障注入与独立反例见 `tests/acceptance-evidence-writer*.test.ts`。

[离线九人精确每日边界快照](docs/implementation/acceptance-daily-snapshots.md)在resumable合成入口把午夜采样与世界、事件和回执放进同一SQLite事务，固定九人和独立人口、个人/公共库存及缺测分开报告。真实runtime末小数分钟进食、重启/跳日界/回滚及[独立审查](docs/reviews/acceptance-daily-snapshots.md)只验证所测离线机制；原审计跨库缺口仍失败关闭，不代表完整食品账或真实十五日验收。

[默认关闭的验收停止控制](docs/implementation/acceptance-stop-controls.md)提供精确游戏终点、单调墙钟与请求上限、取消/晚到隔离和仅免费候选的逐请求费用检查；仅注入模型可启用，无真实运行入口。墙钟不能抢占同步阻塞或证明远端取消，[显式离线集成](docs/implementation/acceptance-integration.md)现可同时封存控制终态与两条证据；提交/关闭失败仍保持不完整，无真实运行入口。

停止控制与 writer 的[最小离线集成](docs/implementation/acceptance-integration.md)使用 `acceptanceEvidence` 显式启用，默认服务不接入。完整封存的中止段不代表验收通过；真实免费可用性、远端取消仍未核实。

[外部进程硬时限监督器](docs/implementation/acceptance-process-supervisor.md)现提供默认不接线的监督策略与仅合成进程适配，离线覆盖初始化/同步阻塞、TERM→KILL、有界等待、父中断/owner死亡、孤儿清理和只读恢复。正式运行入口与生产级进程隔离仍未接入；实际退出、发送信号和清理未知不得混同，更不证明远端取消或零费用。

[安全隔离离线入口](docs/implementation/acceptance-offline-entry.md)进一步接通真实runtime、独占新SQLite、writer和实际子进程监督。先创建仓库内 `output/` 目录，再用 `node scripts/run-nine-resident-acceptance.mjs --offline --output "$PWD/output/valley-nine-offline-unique"` 只演练2.5游戏分钟假模型，不接受真实运行、恢复或模型参数；全新目录与符号链接保护、环境清空、网络/凭据路径拦截、精确短终点、信号/崩溃/晚到和重载核对均不代表真实九人十五日通过。

[单候选免费模型离线契约](docs/implementation/acceptance-free-transport.md)单独冻结 DeepSeek/精确端点、单并发与请求/墙钟上限；默认拒绝，只有显式合成价格/范围批准及内存transport可演练。派发、模型与费用证据先于合成决定解析，未知费用不补零，晚到/失败无回退。原Qwen方案和公开 `--offline` 入口不改，真实HTTP、真实数据批准与零费证据仍未实现；该契约不接入世界运行。

[SiliconFlow单模型HTTP形状与九人离线接线](docs/implementation/acceptance-siliconflow-http.md)复用生产请求编码和决定解析，以品牌内存响应完成原seed5401九人、独占新SQLite、逐请求证据和482.5分钟封口。单槽、24次/20秒/每次5秒、无重试回退，未知费用不补零；仍无真实HTTP/live CLI或外部监督器接线，实际账户与远端取消未知，不是十五日真实验收。

[单免费模型真实短测入口](docs/implementation/acceptance-live-probe.md)另外提供显式授权和新鲜官方零价观察门禁、内存key管道、精确单模型、9次/180秒上限及外部guardian。仅短启动核验，实际账单仍未知；不能把新入口、离线测试或短测成功当作十五日完成。

[本人可见田况](docs/implementation/crop-observation.md)将带时点的粗粒度农业事实独立送入最终决策输入，即使本人没有水也能观察田况，但不会自动取水或浇水。合成 context→prompt→引擎、日界与内存重载回归见 `tests/crop-observation*.test.ts`，独立审查同时覆盖隐私边界和摘要上限。

[已知泉水与现场水量](docs/implementation/spring-visibility.md)区分历史地址和真实可见库存，统一徒手采水、装桶与清淤的视野边界，并保留遮挡时主动走访核验的路径。合成最终菜单→prompt→引擎、并发与重载回归见 `tests/spring-visibility*.test.ts`；不改变取水菜单的议程轮转时机。

当前常规在谷菜单的各组预算理论合计为 **84 项**：基础议程 56 + 最多 2 水源 + 1 烹饪 + 1 播种 + 1 已知自有田址 + 9 社交语气 + 10 本人理解 + 2 浆果分享/听闻核实 + 2 日常约见。这不是统一截断器；实时 `care.stop` / `personalFoodGift.stop` 及通过过滤的 `health.cancelRescue` / `health.declineRescue` 仍另外恢复。日常约见的拒绝/撤回计入其两项组内；镇外、途中、乘船和护送走各自菜单路径，能力/年龄过滤不变。以下 58/59/60/68/78/80/82 是各次增量交付时的阶段预算，不是并存的当前上限。[当前菜单规则](docs/design/simulation.md#一次行动从哪里来)

[有界已知水源菜单](docs/implementation/water-source-choices.md)为最近水源和公平轮换的已知替代水源保留最多两项，绕过二次议程裁剪；该阶段完全饱和时普通菜单上限为58项，保留原有危急、拒绝与停止入口。正常编号菜单→引擎、九人seed5401零水干田、并发、视野、重载与独立审查见 `tests/water-source-choices*.test.ts`，不会自动取水或浇水。

[有界直接进食与烹饪菜单](docs/implementation/direct-food-choices.md)在基础32项截断前轮换最多4种本人食品，最终保留1项已知厨房烹饪；该阶段完全饱和普通菜单上限为59项，实时停止入口仍按原规则额外恢复。合成12/20食品、正常编号→实际进食与烹饪、权限/腐败/隐私、重载及独立审查见 `tests/direct-food-choices*.test.ts`，不会自动选择、进食或补充物资。

[本人随身食品时效](docs/implementation/personal-food-freshness.md)把本人实际库存约束下的最早到期份数、游戏分钟与批次营养送入最终决策输入，明确过期、未知与未展开部分；最多8种并保留当前eat食品。合成反向时效、附近畜舍不补造批次、重载、上限与独立审查见 `tests/personal-food-freshness*.test.ts`；不会自动选食或改变腐败执行。

[雇佣加工批次守恒](docs/implementation/employment-conservation.md)隔离真实库存与签约配方，利用历史快照修复可证明的旧约要求，并在腐败或不完整批次上停止产出。真实开店、招聘、工作、后续轮次、内存 SQLite 恢复与独立反例见 `tests/employment-conservation*.test.ts`；不补造损失物资、不用当前版本改约。

[双人日常约见](docs/implementation/social-appointments.md)接通成年人当面提议与独立答复、固定公共地点和未来窗口、各自实际赴约与选择等候、共同在场后的独立交谈或离开。远方撤回不传知、不自动赴约或改变关系，人物档案分别展示世界状态与本人知识；正式seed5401编号主链、失约/路阻/生活冲突、短记忆与重载及[独立审查](docs/reviews/social-appointments.md)均为离线合成验证，不代表真实模型长期验收。

[本人持久关系决策记忆](docs/implementation/relationship-decision-memory.md)把真实可见已认识人物的本人好感、信任、矛盾及最后理解独立送入最终模型输入，避免被短记忆和家庭记录裁剪抹掉。最多6人，观点与事实分开，旧档缺失保持未知；正式seed5401编号形成看法、记忆挤出、SQLite、隐私与独立审查见 `tests/relationship-decision-memory*.test.ts`，不会自动交谈或改变关系。

[室内可见关系记忆](docs/implementation/indoor-relationship-memory.md)将本人回忆与两格身体近察分开：同屋十格内真实可见且双方有使用权限的已知人物保留本人看法，家具/隔屋/远方边界不放宽。正式seed5401编号交谈→独立理解→睡床/厨房→短记忆挤出及重载见 `tests/indoor-relationship-memory*.test.ts`；同时保留实际小数分钟的理解时点，不新增动作或世界写入。

[有界社交语气完整组](docs/implementation/social-tone-choices.md)修复正式seed5401分钟481配偶最终菜单仅剩hostile的问题：对最多3个实际可交流对象同时保留neutral/friendly/hostile，最近者常驻、其余一次公平轮转。最终补齐仅用空位、多余目标反思或最多9条额外容量，该阶段饱和普通上限68条，原紧急、拒绝与停止不丢失；不会自动说话、强制友善或改变关系分值。正式编号→原话实际执行、失权、室内距离、重载及独立反例见 `tests/social-tone-choices*.test.ts`。

[实际发言语气留存](docs/implementation/dialogue-tone.md)与[完整原话依据](docs/implementation/dialogue-content.md)将已完成talk的可选语气和原话传递到既有听众的本人记忆，三种模型分别呈现安全引用与最终理解选项依据。正式seed同句三语气、尾部相反含义、旧档未知、迟到与听众范围、SQLite及独立审查均使用离线合成世界；不改变既有听觉规则、不自动改变关系或替听者解释。

[本人尚未理解记忆轮转](docs/implementation/interpretation-rotation.md)为本人最后80条保留记忆提供每30分钟最多5事件×2对象的公平候选，绕过最终菜单二次截断；该阶段饱和普通菜单最多78条，原关键与实时停止入口保留。正式seed真实六句→等待恢复→编号理解→SQLite重载、80×8对象、去重/遗忘/旧档/隐私及独立反例见 `tests/interpretation-rotation*.test.ts`；不补造未听见的原话、不自动解释或改变关系。

[精确面对面社交对象](docs/implementation/social-target-visibility.md)区分本人真正看见、合法接近与实际接触，过滤通用说话/交换及基础社交选项中的遮挡与不可达对象；真实围栏门可绕行，迟到位置不追踪。最终编号→走路→发言/失败、三模型、SQLite及独立反例均离线验证；既有听觉witness、历史理解与远方信件保持独立，不自动改关系，也未统一改写所有专用社会流程。

[公共服务现场核实与路径](docs/implementation/public-duty-observation.md)区分公开班表和实时服务事实，保留合法已知地点的自主查看；真实桌台/床位路径、动态阻断、工作位置和完成事务重验，失败不扣料不付薪，离线最终菜单及独立审查覆盖两类服务。

[未领取遗产份额接续](docs/implementation/inheritance-successors.md)沿用原法定顺位与后代递归，只转接尚未领取支路，不重分已领钱物。正常编号菜单、20钱6田先后死亡、原址食品批次、产权与债权、SQLite、同轮完成/死亡中断及独立反例见 `tests/inheritance-successors*.test.ts`；无人或缺少可核实身份/遗产记录时继续保全。

[医疗护送跨六岁本人同意](docs/implementation/child-medical-transport-age-consent.md)保留原提议与期限，区分幼儿代理答复和本人真实接受；生日停止旧代理搬运，待本人另行接受、拒绝或取消。可表达停止即时生效，已用布水不返还；靠泊、最后床位工时、SQLite 并发与旧档未知证据见[独立审查](docs/reviews/child-medical-transport-age-consent.md)，均为离线合成验证。

[青少年自有钓具装备](docs/implementation/teen-fishing-equipment.md)仅为开拓聚落满13岁且具决定/表达能力者接通本人 `rodKit` 的菜单、年龄白名单与实际15分钟装备。正式seed5401编号装备后另选捕鱼，保留真实地点、工时、所有权与课堂/班次冲突；12/13边界、迟到、最后0.25分钟、内存SQLite与[独立审查](docs/reviews/teen-fishing-equipment.md)均离线验证，不自动给竿、捕鱼或放宽其他成人产业动作。

[家庭共同赠与交付重验](docs/implementation/family-gift-authority.md)统一原有待交付失效规则的菜单、途中和完成校验；末0.25分钟能力变化、死亡登记顺序、真实变质、已完成取消、原提议绑定和SQLite回归见[独立审查](docs/reviews/family-gift-authority.md)。保留历史批准、实际剩余各自原址份额与合法绕路，批准后不新增双方在场要求。

[分数分钟生日权限](docs/implementation/fractional-age-boundaries.md)统一真实出生记录的整岁边界，按实际生日双向校准浮点误差，不设置提前授权窗口。6/13/18岁能力、行业与监护，六岁末工时代理同意，默认1.2/0.25步进、SQLite、相邻浮点和大时钟反例见 `tests/fractional-*.test.ts` 与[独立审查](docs/reviews/fractional-age-boundaries.md)；日界、出生时间和死亡幂等不改写。

[未知年龄家庭权限](docs/implementation/unknown-age-family.md)用 `knownAgeYears` 区分真实幼儿与坏出生资料，关闭新监护及幼儿喂养豁免，保留本人和原监护人的旧提议拒绝、原签名及期限。未知不会改写生命周期阶段或能力，也不会取得成人权限。最终编号菜单、末0.25分钟、内存SQLite与[独立反例](docs/reviews/unknown-age-family.md)均为离线合成验证；各年龄分支合并前只做专项，不代替全量验收。

[剩余未知年龄幼儿代理](docs/implementation/unknown-age-residual-authority.md)经真实菜单与引擎关闭财产代管、儿童求助、普通照护及既有监护灾害护送的豁免路径，兼顾代管监护人自身资格失效。保留有效0岁、历史签署/期限/产权、真实本人同意、表达停止与严格年龄无关救急；先红后绿、SQLite、中途资源和[独立审查](docs/reviews/unknown-age-residual-authority.md)均为限定离线验证，不代表全量完成。

[未知年龄观察与显示](docs/implementation/unknown-age-display.md)仅在个人观察、最终提示、人物UI和人口汇总区分真实0岁与未知出生记录，人口另列未知，并修复JSON增量缺字段保留旧年龄。实际context、前端入口、分数生日、SQLite及快照/重连回归不改授权、生理、排序或存档，也不推断真实坏档发生率。

[未知年龄运行时排队](docs/implementation/unknown-age-runtime.md)将未知出生资料从幼儿照护压力中剔除，关闭虚假监护优先和慢钟立即停表；有效0岁、真实生日、本人普通急需和确有自救路径的原个人保护仍保留。真实 runtime 注入假决定、并发槽、资料变化、SQLite与停止迟到回归见[独立审查](docs/reviews/unknown-age-runtime.md)，不修改授权、出生资料或存档。

[未知年龄本人最小自理](docs/implementation/unknown-age-selfcare.md)为实际具备决定和表达能力的本人开放自有食物、已有合法真实床位、等待和实际移动，不推定成人或幼儿，不增加公共物资/交易/代理/产业权限。当前菜单、旧回复、途中及最后小数分钟均重验；真实及时自救才取得原等待保护。先红后绿、默认运行时竞争、SQLite与[独立审查](docs/reviews/unknown-age-selfcare.md)均使用合成世界，不读取或修补真实存档。

[当面分享亲见浆果地址](docs/implementation/food-source-sharing.md)把本人真实首次观察与收到的历史线索分开；说话者明选近身对象和地点、实际传达1分钟，听者另选旧址核实、采集和进食。空源、失去接触、权限、短记忆、重载防重与饱和菜单由隔离主测试及[独立审查](docs/reviews/food-source-sharing.md)核对，不解析自由聊天、不自动转述、补货或行动。

[已知自有田址导航](docs/implementation/known-land-menu.md)按身份而非远程田况单次轮换，饱和议程至多另加一项，不替换生存、避险、拒绝或停止。本人仍须明确选择、实际行走，到场后另选浇水；合成回归不替代真实模型长期验收。

[四种野生动物有限种群](docs/implementation/wildlife-population.md)新增真实亲代繁育、幼崽需求、妊娠预留与失败、旧档不补种和驯化转出核对。整年合成测试只验证实际推进与有限数量边界，不证明默认开局或真实模型长期存活。
