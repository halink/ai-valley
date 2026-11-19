# 谷灵：模型年鉴内核（开发进度，未提测）

此内核与客观天气日志分开，不修改世界、居民认知或天气。只从当前授权的天气来源组装版本化事实清单；稳定引用、时间范围、权限版本、实际时点和无输入小时随请求保存。未输入的小时既不等于档案缺样，也不等于没下雨；当前每轮最多 24 个小时桶，不能将这一段样本表述为整月结论。不发送原始 World、描述全文、私人字段或私有日志。

- 模型输出只可选择与排序已知的天气、气温、湿度主张；每项核对来源、字段、事实值。气氛独立为编辑语气枚举，不能输出人物动机、因果或新天气。实际中文事实由固定模板渲染，不冒称模型撰写；无模型时明确返回客观回顾。
- 先持久化发送意图，共享账户有额度才保留服务名额；发送前存可能已发送的状态。发送后失去回应不默认重发或退款。私有存储保存本轮准确的结构化输入，未提交草稿不能读取。保留名额后、实际外发前、收到草稿后、发布及读取时重验授权和证据；未送出的名额独立释放，发送之后撤权不能收回供应商数据。旧链接、撤销和更正使用相同规则，撤掉的文本和来源不会从旧链接返回。
- 持久化适配器在既有世界 SQLite 的独立版本表使用事务与比较更新。只读预检遇到未知格式拒写，调用方应隔离可选年鉴而不停止世界。传输总账、请求费用结算和不可确定供应商投递只能由共享账户入口处理，年鉴不建第二套费用账。

尚未接运行时生成与发布、玩家 UI、日历调度、完整公开事件类型和共享账户传输。没有默认出站适配器；本变更不访问任何真实供应商，G1/G2 未启用。局部单元测试保留本地，覆盖精确投影/缺失小时、正确值/伪造事实、发送门控、发布前及历史撤权、不可确定发送、重启、更正链和未知表版本隔离。不代表完整谷灵功能，不能据此提测。

## 规则持久演示的只读接口

- `GET /ai-town/api/valley-spirit/almanac?entryId=valley-almanac-…`：读取已存在、已发布且所有证据仍获当期授权的单条年鉴。无可见条目统一返回 404；不提供草稿、私有输入、发送状态或生成请求。默认规则世界不会自己生成条目。
- `GET /ai-town/api/valley-spirit/topics?fromHour=0&toHour=24`：游戏绝对小时、起点含/终点不含，仅已结束时段，最多 24 小时。只返回实际存档时点支持的候选；没有可用时点时菜单为空。最新授权和解析引用用一次批量快照，不逐条扫描日志。
- 仅独立规则持久入口提供；无公开生成、发布或选择提交接口，无后台模型调度。已有年鉴存储在世界预检私有副本内先做只读验证，未知结构只隔离年鉴，不修复、覆盖或阻塞世界，也不影响独立天气档案与选题。运行时 SQLite 年鉴连接为物理只读。

开发侧本地单测验证批量授权、顺序绑定和严格查询参数，短时本机 HTTP 用独立合成存档确认目标条目经重启可读、撤权后旧链接关闭、未知年鉴版本保持原样且规则世界继续推进。未调用真实供应商，测试文件未提交，仍属整套谷灵的开发中阶段。

## 内部离线调度与账户准入

独立内部调度接口只在显式选择离线合成账户、周期、账户上限、居民保留额度、年鉴上限、输出预算与冷却策略后才可运行。上限为每分钟请求、每分钟 token 和并发三维；年鉴预算不得侵占任何居民保留额度。真实时钟和数据窗口来自调用方提供的已关闭游戏时段与授权档案，调度不自行启动计时器、外发或改世界。没有授权数据、模型不可用或居民优先时继续使用客观回顾。

账户端口要求同一账户内居民与谷灵共享额度原子裁决，居民等待时不发新年鉴。它负责耐久请求身份、实际用量、未发退款证据，以及跨窗口／重启仍不确定的风险。调度只依赖该端口，不创建自己的模型预算，且仅允许离线合成通道。于发送前持久化可能已发；未知状态不补发或退款；晚到撤权不发布；已核对草稿可以在恢复后单独重验发布。某窗口没有额度时保留客观回顾，不自动反复申请。

目前居民运行时按模型持有进程内预算，重启将疑似在途费用保留在有限窗口；季节离线账本也只属于合成会话。两者均不能充作真实供应商账户的共同权威。上线前仍须落地连接居民和谷灵的同一持久账户队列、可核实配额与审批、跨窗口风险对账、实际环境中的模型适配器和生产调度。此变更不引入任何真实调用、运行时自动生成、公开生成端点或账户设置。

## 已发布文字的持久版本

年鉴发布时把逐条已核对的原文、来源、值及排版渲染器版本一同原子保存；读取返回已保存的文字，不按当前模板重写。更正使用新的文字版本和 supersedes 链，普通更正不会覆盖旧文字；撤权或来源改变时旧链接立即不可读，撤销会清除该条草稿和文字快照。发现原文与核验结果不符、未知渲染器或没有原文快照的早期离线版表，均隔离年鉴，不从现行模板回填历史原文。当前用显式版本 3 表行保存版本 1 渲染快照与来源；不自动迁移离线试验数据。

模型结构化选项可选择「先时间」或「先字段」的静态句式，缺省保持原先表达；不能提供任何自由措辞。事实值、人物经历和因果不因句式而变化，气氛仍只是一枚独立的编辑语气枚举。Godot 继续用自己可校验的观测展示格式。尚无生产模型接入、自由文章撰写或其他已公开生活事实的年鉴生成。不能把离线选材与经过核验的固定句式称作真实模型撰写。

## 选材来源

已发布年鉴使用中性类型并携带版本化来源。受控离线调度器仅在离线合成共享账户门控后取得内部分派标记，公开明确显示「离线合成选材，不是真实模型输出」。普通内部注入没有供应商证明，显示「选材来源未核验，不代表真实模型输出」。模型回包、HTTP 或存档标签不能声明真实来源；未知来源版本、类型、条目身份不匹配和早期无来源快照均不读取、不回填。Godot 同步识别两类来源，无法识别则不展示年鉴。

公开身份绑定来源版本和类型，用于检测记录不一致，不是签名或供应商真实执行证明。当前没有任何可以标为真实模型选材的路径；将来要新增该来源，必须先接入已授权账户和可独立复查的出站请求及对应回复证据，再显式定义新的来源规则。

### 界面采用发布句式

只读接口将已封存的渲染器版本与当时的句式枚举一同返回。Godot 只接受版本 1 的「先时间／先字段」，先校核线上快照文字与已核对的类型化分钟、字段和值是否一致，再用本地日历按相同的顺序排版；不直接显示可被替换的任意文字。语气枚举单独显示为「编辑语气（不是事实）」，不会成为天气描述或人物经历。更正显示独立文字版本，撤权后回到客观档案提示；缺少渲染契约、未知类型和不一致的文字均不显示年鉴。

### 发布形状下的私有只读生活年鉴

独立持久规则运行时仅在调用方显式指定测试世界和**现有已批准章节**时接入只读查看器。普通 CLI 不提供该选项，默认没有徽标和正文。预检只读验证档案；打开后始终对照当前已提交的世界和授权，并仅接收能由同一世界数据库验证的原生实际交谈凭据。较早但仍获准的事实可以展示，旧或外国世界快照不行。撤权、未知格式、章节不符直接隐藏，不降级到旧章节。该入口不写生活授权或正文，不创建发布器，不接真实供应商或正式世界。

### 私有合编与审稿试验

内存合编试验只接受同一隔离世界、同一当前时点和提交版本的已批准天气与原生交谈来源。输入只含受约束的事实和授权版本，不接纳来源正文、原始世界或正式收据。编辑只能挑选有据编号和决定顺序。固定模板生成的精确草稿、来源版本和上一版本共同决定审稿摘要；独立的夹具验证器认可后仍再次读取两个来源，才切换私有版次。读到撤权或来源不符时立即隐藏并记录本进程撤下状态，撤下版次与已见旧来源不会自动复活。未观察到的变更不在本地记录，未来可信读取器须保证授权版本单调，不能再提供已失效的授权版本。较旧仍获授权的历史事实可随当前有效时点展示。

这是内存开发试验，不是已认证的发布器或可持久正式刊物。真实读者尚不能为天气和生活两套档案签发原子的共同世界证据；因此未接任一运行时、接口、真实供应商或发布授权，也未推测正式数据可公开。

### 两类已发布来源的私有临时读

独立只读检查器自行取得同一个既有世界所有权锁，不连接已运行实例。它读取受 SQLite 权限核验的既有天气 JSON、确切已发布的天气条目，以及既有生活查看器核准并由原生交谈保管凭据验证的指定生活版次。两次同步读取都必须匹配本机已提交世界、时点、来源和现行授权，所回传内容只含类型化事实，不直接转发正文或私人语句。读取期间发现世界、权限或日志倒退即隔离，撤权后的来源不可读。

这只是协作式同一所有权下的临时合编依据。SQLite 和天气 JSON 不是一笔原子事务，重开检查器不能证明它启动前未发生全档回滚。不写观察、授权或刊物，不接一般运行器、路由、模型、正式保管凭据或发布。检查器默认不启动。

### Private SQLite weather credit (sealed development only)

A sealed temporary validation WorldStore must explicitly opt in. Initial world
creation, normal CLI runs, the JSON archive, and all public readers are unchanged.
With an already open SQLite weather grant, each grant/hour can credit the first
eligible forward one-minute native commit **after** opt-in, including mid-hour. The
same transaction checks the persisted preceding head and validated clock/climate
projections at both ends; this is a transition check, not a separate attestation of
which in-process function built the draft. Same-minute writes never qualify. It does
not backfill, guess gaps, grant permission, or credit startup archive observations.
This independent savepoint stores the source identity and a versioned digest of
the exact typed weather projection, never its prose or a second public row.
Optional malformed custody leaves normal world writes intact.

The read primitive checks the current grant and exact supplied projection. A
different first JSON sample in the same hour, or a missing post-commit JSON write,
must never be treated as proof for a public archive record. Nothing here proves
JSON publication, whole-DB anti-rollback, or a combined atomic yearbook; sharing a
SQLite snapshot across the existing head, edition, and life readers is separate.

A separate **private atomic read** can now pin a released weather entry and the
latest addressed-speech section. It owns the existing runtime lock and opens one
physically read-only SQLite connection. In one read transaction it checks the
world head, current weather grant, released almanac data, all of that edition's
weather source credits, latest life publication, current native life grants, and
speech custody. JSON supplies only candidate weather payload; absent or mismatching
payload fails closed, without replacing authoritative SQLite evidence. An older
fact remains eligible if it is exact and currently authorized; an older life
edition does not replace the latest section. This neither changes the older
non-atomic inspector nor adds any runtime, public, edition-write or review path.

A separate sealed temporary fixture can pin a purpose-specific Ed25519 public
key at creation and persist reviewed combined editions. The independent signer
receives deterministic rendered terms bound to the fixture, world, pinned
sources, ordered selections, exact source/rendered digests, and prior edition;
the editor never receives a signing key. Its bounded private SQLite log stores
only signed approvals, not duplicate prose. The exact draft is reconstructed
from the native source snapshot before append and again on every read. Approval
uses one BEGIN IMMEDIATE for the source checks and prior-edition compare-and-swap.
An identical currently authorized retry is idempotent. Latest is selected before
reauthorization; an unavailable or revoked source produces no older fallback.
A temporarily absent/mismatching JSON witness is not a durable revocation;
a later revalidated witness may restore availability under the same current
authority. This is not a public edition, a user-save feature, or resistance to
whole-database rollback by someone who controls fixture storage.
Within an open reviewed-edition handle, all pins share one monotonic source
reader, and the signed approval log must extend its exact previously observed
prefix. A detected rewind isolates the handle; newly written log state is
remembered only after COMMIT. The in-memory floors do not survive a reopen.

A private sealed development weather packet reader can assemble the canonical
outbound projection without a released almanac or life input. Its internal
`readCurrent` binds all selected sources to the exact persisted validation
head, current SQLite weather grant, and native credits in a single physically
read-only snapshot. The JSON archive is only a candidate payload; a missing
or mismatching credit for any point rejects the entire packet. Only the
canonical allowlisted packet leaves the reader, not the source rows or World.
This is a read-only evidence pilot, not an account/purpose grant, a dry send,
or a production/runtime activation.

A disconnected developer fixture may separately pin an Ed25519 **weather-use**
authority and a documentary synthetic account fingerprint. Signed grants and
revocations bind the exact branded quota account/run, sealed world/fixture,
canonical quota policy digest, weather-specific purpose, current public weather
epoch, contiguous version, and at most 30 seconds of wall-clock validity.
The verifier never accepts a caller-supplied active flag or uses a yearbook
reviewer key. Transitions are recorded in one bounded private SQLite log, with a
revocation slot reserved for every accepted grant; an open verifier isolates
observed history rewind. Closing or rotating the public weather grant denies
old use even if the purpose signature remains valid. No quota is booked, no
outbound transport opens, and the record proves neither real account identity
nor any production authorization.

An explicitly disconnected weather rehearsal can now borrow the same sealed
validation owner for source and purpose verification, and the exact canonical
quota handle also accepted by the synthetic resident dispatcher. It yields
after a real durable hold, rebuilds and hashes the exact packet, and rechecks
the unchanged signed purpose/source versions and resident waiting immediately
before handing off to a compiled-in memory transport. There is no database
transaction across that yield. Unknown outcome is retained in the existing
ledger without automatic retry or a second shadow ledger. The mock records its
full allowlisted packet and digest in memory; this does not prove external
delivery, real account identity, or a common official world/runtime.

In the same sealed rehearsal, `groundEdition` exercises the existing almanac
editor with a bounded private in-memory CAS, never the public almanac SQLite
store. The editor's entry ID and exact packet digest are bound before the mock
handoff. Only a settled synthetic completion returns deterministic, typed,
source-cited conditions to the existing grounding path; no free text enters.
The public weather epoch and exact source projection are rechecked after the
response. A positively canceled pre-handoff hold can be marked unsent; lost
post-handoff outcomes stay unknown in the canonical quota ledger. No publish
or private reading of generated prose is attached to this rehearsal.

An explicit `storage: 'durable-private'` rehearsal uses a separate bounded SQLite
CAS namespace on the sealed developer world, bound to the disconnected grant's
fixture/world/account/run/policy context. It accepts only canonical synthetic
intent, unknown, grounded, or discarded entries and legal transitions. It
exposes only existing edition status, not rendered drafts or publication. In
durable mode all sending passes through edition staging; ordinary in-memory
rehearsal remains the default. Restart does not retry unfinished or grounded
entries, or reconstruct completion when the separate quota database settled
before the edition transaction. No ordinary/public almanac table is affected.

An optional separate sealed weather-editorial fixture pins **different**
Ed25519 keys for sending and editorial review and cannot carry other fixture
roles. Private preview, approval and readback share a SQLite transaction across
the durable grounded rehearsal state, current native weather authority and
bounded signature log. Review binds the exact renderer, packet, typed draft,
text and grant versions, prior entry and exact rendered content digest. Only
the latest grounded, authoritatively verified, independently signed synthetic
edition can be read; send authority is not editorial authority. Missing JSON
merely hides the edition until the exact witness can be verified again. A
revoked or rotated public weather grant blocks on read; no ordinary database,
public release, or automatic retraction writes are performed.

An explicit programmatic developer listener can read one pinned, independently
reviewed synthetic weather entry at `GET /developer/weather-review` on an
ephemeral IPv4 loopback port. It has no ordinary server/CLI hook, recognizes
only the exact peer/Host/path, rejects credentials, and rechecks the authenticated
latest entry and current sources in the private editor's read transaction for
every GET. Its versioned DTO contains only IDs, versions and typed weather
facts (minute, field, value), never source links, rendered prose, approvals,
World or publishing capability. A revoked/latest-ineligible/missing witness
returns the same unavailable response and never writes permanent withdrawal.
