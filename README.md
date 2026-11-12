# 栖谷 / AI Valley

[English](README.en.md)

栖谷是一座只供观察的 AI 小镇。九位居民在同一片山谷里谋生、照顾家人、交易、设计和建设。模型为每个人作出选择，引擎核验位置、时间、材料、产权和当事人的同意。观察者可以跟随居民、进入房间，或打开年表回看世界如何变化。

- **同一个世界**。河里的鱼群、田地、牲畜和野生动物共享水域与资源。居民可以捕鱼、放牧、制堆肥、修缮和改良土地。
- **自主生活**。居民可以结识彼此、约好以后见面、建立家庭、经营商铺、安排工作、议事和开展工程。来访、迁居、成长与死亡写入世界记录。
- **从图纸到实物**。居民可以自拟工具和建筑，在实际场所制作、发布和学习图纸，或用真实材料分阶段建设。
- **只读观察**。浏览器可以查看人物和动物档案、关系、历史与建造进度。服务在没有观众时也会运行。

[有限双人日常约见](docs/implementation/social-appointments.md)让成年人当面约定未来在公共共屋门前见面，各自决定是否赴约并实际走路、等待；相遇后仍自主交谈或离开。人物档案区分原约、世界事实与本人获知，远方取消不自动通知。

已有私人非住宅工坊/店面的有限双边租约与每日工位窗口，租金押金、原址余货和已挣工资分别核验；[空屋单人有限住宅住宿](docs/implementation/residential-leases.md)已接通独立签约、托管与实际床位睡眠；多人合租和永久迁居仍待实现。本地经营迁址已接入原址结清、员工分别同意与实际搬货，保留原工资、期限和出勤；[迁址范围与验证边界](docs/implementation/business-relocation.md)。[范围与测试](docs/implementation/premises-leases.md)。

本地商铺已支持居民自定数量、买方最高总支出、供货方最低到手总额，以及明确同意后的部分成交；实际钱货、原食品批次与防重收据一并核验。[批量成交范围与测试](docs/implementation/bulk-trading.md)。

[有限渡船货运](docs/implementation/freight-ferry.md)现已接通既有外贸货单的陆水接力。货主与船主分别同意，客货共用容量，实际装卸与上岸交接后分别结算运费和买卖款；断航、返航、腐败和重载保留真实位置。替代码头改约及真实模型长期验收仍待完成。

[有限晚年安排](docs/implementation/later-life.md)提供自选短段工作和另行同意的照护交接，原工资、物资和自主权保留。较慢睡眠恢复已做隔离验证，默认仍关闭，待跨季生存基线验收。

[单人成人访谷](docs/implementation/visitor-journey.md)现已按本人选择的有限阶段行走，途中另选随身进食、坐休或按实际距离返家；路阻、失能和重启不自动续程。[成人亲属同行](docs/implementation/adult-family-journey.md)也须双方逐段确认，按慢者速度，途中各自照料并可明确拆队。没有自动接待、补粮或未成年家庭迁入。

有限社会关系已接通[本人持久关系记忆](docs/implementation/relationship-decision-memory.md)、[发言原话与语气](docs/implementation/dialogue-content.md)及[理解轮转](docs/implementation/interpretation-rotation.md)。面对面选项核对真实可见与可接近对象，三种语气并列供本人选择，不自动改变关系。[当面浆果线索](docs/implementation/food-source-sharing.md)另支持明选近身听者与本人亲见地址，听者收到带来源和时间的旧址后自主核实，不自动采集或转述。常规在谷菜单各组预算理论合计最多 84 项，已计入[播种](docs/implementation/plant-crop-menu.md)与[已知自有田址轮换](docs/implementation/known-land-menu.md)，独立停止/撤回入口另行恢复；[预算与边界](docs/design/simulation.md)。

[室内外连续跟随](docs/implementation/resident-follow.md)、[有限儿童照护](docs/implementation/emergency-child-care.md)、[财产代管](docs/implementation/protected-custody.md)及[本地公共储备采购](docs/implementation/public-food-reserves.md)已有实现，各自保留同意、权限、实物和失败边界；不代表连续照护或全村供给已获保障。

## 观察界面

默认入口已采用[绘本式UI](docs/implementation/storybook-ui-shell.md)：桌面六项导航、右侧对象卡与按需档案；手机底栏、更多入口和可展开阅读抽屉。保留原跟随、室内、全图与所有档案功能，无需开发参数。地图与头像仍沿用现有资产，UI改版不代表手绘地图或2.5D美术已完成；浏览器视觉与触控验收边界见实现文档。

## 快速开始

需要 Node.js **22.13 或更新版本**。本地开发与测试以 Node 22 为基准。

```sh
npm ci
npm run dev
```

另开终端运行 `npm run dev:web`，打开[隔离开发预览](http://127.0.0.1:5173/ai-town/)。每次启动后端都会新建临时 SQLite，固定使用端口 3413；不读取正式存档、`.env` 或模型密钥，不调用外部模型，也不推进世界时钟。正常退出会清理临时存档。完整测试要求 Linux，跨平台限制见[贡献指南](CONTRIBUTING.md)。

需要持久观察存档时，先 `npm run build`，再 `npm start`，打开[正式本机观察页](http://127.0.0.1:3412/ai-town/)。**正式服务会打开或创建 `runtime/formal.sqlite`，可能迁移并提交存档；它不是隔离预览。当前正式入口默认 `no-model`，不读取模型密钥、不自动调用模型。** 显式请求实时模型模式也会显示 `blocked`，直到真实运行授权、免费状态与旧未知请求完成核对；不能靠已有 key 或环境变量自称免费来解锁。[生产模型安全边界](docs/implementation/production-model-safety.md)仅有合成候选验证，未接通实时生产模型。

普通观察页默认仍为2D，可手动选择[2.5D（试用）](docs/implementation/isometric-formal-entry.md)，两种视图共用同一只读快照。[共屋室内与普通烹饪](docs/implementation/isometric-lodge-cooking.md)、[工坊室内与普通制作](docs/implementation/isometric-workshop.md)、[商店真实室内布局](docs/implementation/isometric-store.md)、[诊所真实室内布局](docs/implementation/isometric-clinic.md)、[学校真实室内布局](docs/implementation/isometric-school.md)与[畜舍真实室内布局](docs/implementation/isometric-barn.md)已有限接入；商店不补造货架、库存或室内交易，买卖仍在真实门外结算。诊所只画真实床位、桌台、静态厨房与原人物，不补造药品、器械或病人；治疗手势未支持，在场不表示治疗或治愈。学校只画真实桌台、静态厨房与原人物，不补造黑板、书本或教学手势，在场不表示学习完成；当前合成路线明确新增测试校舍，不冒充默认种子已有学校。畜舍栏位仅作导航标记，动物仅有barnId/pen时计位置未知，不补画动物；照料手势仍未支持。全图、住宅/共屋/工坊/商店/诊所/学校/畜舍之外的室内及未支持姿态会明确回到2D，可随时按Escape或2D按钮返回。该入口尚未通过真实浏览器、触控与GPU验收，不表示整体2.5D已经完成。

正式存档独占启动目前仅支持 Linux，其他平台会失败关闭；这仍是跨平台发布阻断项，不代表 1.0 已就绪。

默认每 20 分钟经过一个游戏日。模型、环境变量、存档和自托管方式见[运行与配置](docs/configuration.md)。

新建九人聚落时，每人携带至少三日可食口粮；食物会消耗和变质，旧存档不会补发。数量、期限与验收见[开局口粮说明](docs/implementation/founding-provisions.md)。

[粮食观察](docs/implementation/food-coverage.md)区分逐人的保守口粮估计和社区去重现物，不把共有库存重复相加或视为生存保证。构建后可用 `node scripts/acceptance-long-run.mjs 1 --daily-json` 输出无模型隔离夹具的[逐日事实证据](docs/implementation/isolation-evidence.md)；可选[食物流证据](docs/implementation/food-flow-evidence.md)已扩展至留种与晾鱼原型，供餐、腐败和有限跨边界转移独立列账；完整供需账目仍未知。

安全水[第一阶段供给](docs/implementation/safe-water-supply.md)已有有限水桶、实际取水与厨房净水、监护人现场幼儿供水和共屋自愿储水。另有[本人授权的有限成人协助与未成年人赠桶](docs/implementation/water-support.md)。旧清水库存保留，居民口渴和脱水尚未启用。

[有限分种鱼群与渔获](docs/implementation/fish-species.md)已接通同种捕鱼与捕食、品种实物交易、鱼餐和混合罐藏、季节繁殖及连通水域守恒迁移。旧鲜鱼批次不转换，孤立耗尽鱼群不自行补满；四季生态平衡仍待验收。

[有限狼狐生态](docs/implementation/predator-ecology.md)已接通实际栖地、雌雄繁育、幼崽消耗、逐格迁移和疾病死亡记录。旧档不补配偶，狼狐灭绝后不自动复生；长期食物网平衡仍待验证。

[野猪、鹿、野兔与野鸭有限种群](docs/implementation/wildlife-population.md)接通真实亲代繁育、幼崽需求、妊娠空位和驯化转出。旧档不补种、灭绝不再定时复生；孕鸭转为家鸭时保留原孕期，仍需母幼畜舍容量。非狼狐迁移与长期生态平衡仍待实现或验收。

[正式九人十五日验收](docs/implementation/nine-resident-acceptance-preparation.md)已有离线准备、证据 writer、精确终点/停止控制及合成进程监督组件，默认不启用；真实 runner 和正式监督接线尚未完成，模型、费用及发送数据的范围仍需用户明确授权。浏览器视觉、真实模型前十五日和四季平衡均未验收，新天气灾害调度默认关闭，既有险情照常推进。

## 自行配置主/备用模型

正式默认入口仍禁用模型。希望自己进行长期验证，可使用独立的[用户自托管模型入口](docs/implementation/self-hosted-models.md)：在 `.env` 显式启用并配置主/备用，运行 `node --env-file=.env build/server/self-hosted-main.js`。它不等同受监督验收，也未验证实际费用或长期稳定性。

## 游戏设计

开局、生态、世代、经济、建设和观察方式见[栖谷游戏设计](docs/design/README.md)。

## 开发

```sh
npm run check
npm test
```

在两个终端分别运行 `npm run dev` 和 `npm run dev:web` 即可前端热更新；代理只连接隔离后端 3413，后端改动后需手动重启。原正式热重载入口改为 `npm run dev:formal`，仍会使用正式存档，但与 `npm start` 一样禁止隐式模型调用；不要将它当作隔离预览。[预览边界与离线测试](docs/implementation/development-preview.md)。

[贡献指南](CONTRIBUTING.md) · [架构概览](docs/architecture.md) · [生存预测性能验收](docs/implementation/survival-performance.md) · [术语表](CONTEXT.md)

## 许可与素材

项目原创源码与文档采用 [MIT 许可证](LICENSE)。浏览器依赖的版权与许可声明见[第三方声明](public/THIRD_PARTY_NOTICES.txt)，画面参考与素材边界见[素材来源](docs/art.md)。

### Godot 小山谷（从 MVP 逐步生长）

在同一仓库内从小地图、两位居民的生活闭环开始 Godot 4 重建，再逐次加功能与扩大地图，不做移动端。旧客户端保留。见 [MVP 版本路线](docs/godot-migration.md) 与 [核心循环工程版运行及验证说明](godot-client/README.md)。当前本地规则驱动、几何占位与无模型测试不代表自主 AI MVP 或最终绘本画面完成。
