# 试算世界的持久误用防线

## 本切片

`World.simulationOnly?: {version:1}` 是新增保留字段。共同 `copyForSimulation` 在深复制后强制添加普通、可枚举 JSON 对象 `{version:1}`。普通 `structuredClone`、JSON 往返与嵌套试算会保留工厂产生的标记；源世界不被标记。地形副本和只读 receipt history 继承机制不变。

`assertWorldCompatibility` 按自身字段存在拒绝，错误码 `save_simulation_only`，包含 null、false、undefined、未知版本。不按真假或已知版本放行。该检查覆盖 Store 提交前、读取解码以及写打开前的私有副本预检；拒绝提交发生在 BEGIN 之前。旧档若已存在同名无关扩展也被拒绝，不自动删除或解释成 live。没有去标记升级 helper。

`content-proof` 的实际试算与 `region-extension`、`region-survey` 候选审查改用共同工厂。区域成功合入仍只拷贝原来明确列出的地图/资源/产业/区域/水源/新增收据字段，不合入顶层标记，不扩张合入权限。Runtime 的真实事务 draft 和 MVP 资源迁移的真实候选不是假设世界，未改为 simulation copy。

## 验证及边界

隔离临时脚本覆盖 MVP 与 formal：工厂/嵌套/裸 structuredClone/JSON 往返副本均拒绝 commit，拒绝前后 DB/WAL/SHM/journal 字节不变；各种非法标记值拒绝；合成磁盘标记档的预检和 Store 构造拒绝且原字节不变；实际 content proof 回调获得标记世界且原世界不变；正常 Runtime 构造能够提交真实 draft，模型调用 0。TypeScript 和 diff whitespace 检查通过。临时结果在忽略的 output 目录，不新增测试套件。

这只是持久误用防线，不是所有 capability、事件真实性、模型外发或跨库隔离的完成证明。不防可信代码主动删除标记、挑字段重建假 live 或人为改成 undefined 后 JSON 丢弃该字段。继承属性及自定义序列化也不属于工厂产物契约。原有世界规则、正式存档版本和迁移策略未改变；没有访问真实存档、调用线上模型或启用新玩法。

独立审查、完整30分钟规则与存储持续验证结果由后续检查点补充，不能用这里的局部合成验证替代。

补充合成验收：26项全部通过，含从移除本次资源扩充的合成旧MVP世界实际执行 adoption 并提交读回、区域扩展的嵌套内容证明成功后只合入真实允许字段并持久化。已打开 Store 遇到外部注入的标记状态，load 拒绝且主DB/WAL不变；此直接读取使用已打开SQLite连接，SHM读锁槽可改变，不能宣称与写前私有副本预检相同的全部sidecar零写保证。写前预检和提交早拒绝的四文件字节不变断言仍全部通过。region-survey完整玩家路径未单独合成复现，只读核对候选与明确字段合入，不能冒称覆盖。

## 检查点

2026-11-18 两轴独立审查无P0/P1，TypeScript/build及短程runner验证通过。30分钟实际规则运行于12:40:46 UTC开始，预计13:10:46 UTC结束，此提交仅为进行中备份。每分钟4类试算副本（原试算/嵌套/裸clone/JSON副本）提交须全部拒绝，正常MVP与formal存储影子仍须提交并重开读回相等。formal影子不等于formal玩法验收，不使用真实档或模型；前端未变。

### 持续验证结果

2026-11-18 12:40:46.714–13:10:46.759 UTC 完整运行1800.0449秒、3595 ticks（500 ms/游戏分钟，不补跑）。31轮共124次试算副本提交均以save_simulation_only拒绝；正常MVP库与formal格式影子各31次提交/关开/读回相等，结束后另进程独立重开仍相等。退出0、fault:null、4人health100、库存有限非负且33个资源amount在0..max。开始/结束源码指纹一致：`99ac5fa641b2f26a4b91f953e4147eb278037f6ef24bbb1521591825d53596ac`。

源码检查点 `d57ad584b2f945d1e5c73aa72c1d443496c718ab` CI成功，双审无P0/P1，26项隔离合成通过。持续证据在忽略目录output/simulation-isolation-verification，不发布日志或合成存档。本结果仍不代表模型外发隔离、真实用户档、formal玩法、完整四季或浏览器验收。
