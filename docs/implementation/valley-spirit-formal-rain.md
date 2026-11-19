# 谷灵：正式世界原生降雨记录

这是默认关闭的开发底座，不接入正式候选、天气公开授权、模型或落果执行。仅在显式启用的正式 SQLite 存档中，从同一世界真实运行的原天气规则边界记录降雨。原天气仍只有晴／雨，继续按旧规则赋值，未修改天气概率、时间、作物或行为。

采用时不从当前下雨反推开端。启用后只记录实际观察到的晴转雨；遇到同一世界后续真实雨转晴才关闭。暂停或模拟草稿不生成证据。记录使用独立的原生正式世界 ID 和实际起止分钟；不构造 MVP ID，仅保存最近 64 条已结束事实，超出窗口不能凭天气或旧年鉴重建。读取只返回已提交且匹配世界与编号的闭合记录。

记录与世界同事务提交；时钟推进必须带同一实际引擎草稿的本地边界证明。直接篡改、克隆带记录的草稿、通过普通提交移除记录、回拨已提交世界、未知版本或默认关闭状态下开启已采用存档均不继续；SQLite 失败回滚，未提交边界不对读取可见。不能检测从系统外部把整个可信数据库替换为一致旧备份，此机制不等于跨数据库防回退。正式运行入口、授权投影、调度与 G2 仍未接入；未提测。

An internal, explicit `sealed-formal-closed-rain-objective` read on the genuine
sealed Formal owner takes one read-only SQLite snapshot for the exact world,
commit revision and pinned native episode. It returns only a stable
world/episode source reference, the observed start and close, source digest,
and separately the current head revision/minute. The same retained source can
be rechecked under a later head. The native provenance window contains at most
64 closed episodes by count, not a promised number of days. An unknown, open,
pre-adoption, or no longer retained episode is reported as missing; an unknown
or inconsistent schema is unavailable and never rewritten. Current rain/sun,
forecasts, MVP climate, and the G1 review grant cannot supply a missing fact.
The read assumes the owned world store's native commit custody, not resistance
to an out-of-band whole-save rewrite. It has no disclosure authority, model
transport, route, writer, or ordinary startup hook.

A separate zero-effect temporary Formal fixture may pin one world and an
independent Ed25519 key for **offline weather preparation only**. Its seal
allows the native Formal rain store without any G2 effect key, effect schema
or G1 grant; pre-existing sealed archives are unchanged and not migrated.
A bounded journal pins one retained closed-rain source per fixture and accepts
only its exact signed allow/revoke epochs within a bounded game-time window.
One SQLite snapshot ties the current grant and the retained native source
digest to a minimal packet of versions, world/source IDs and observed start
and close. Stale versions, wrong scope/source, expiry and missing evidence
are unavailable. Neither preparing nor revoking a packet creates transport,
account admission, disclosure, model, or publication authority.
