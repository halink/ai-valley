# 来源、基线与审查记录

[总览](README.md)

以下至“本集合修订3”是设计收敛阶段的历史记录，其中“本轮/当前/不改项目”仅描述当时，不是实施期现状。用户后续授权开工后的证据见末尾修订4及[实施状态](IMPLEMENTATION.md)。

本轮仅对独立文档收敛，未修改项目、旧稿、运行存档或调用模型。现场本地HEAD为 `f22a925d0d86fae1d0a743f1b67703d84cb601dd`，git status仅既有 `.gitignore` 技能忽略规则改动。本轮不宣称重新核验远端或部署。

## 输入文档指纹

| 输入（历史论证，非并行实施规格） | SHA-256 |
| --- | --- |
| season_design_draft.md | `a3d4d39d524123a9bd13d354fa2de5229bd1a3198788dcb52a6538562764816a` |
| ai_valley_agent_architecture.md | `21206d3cf124c060a1be733e56c4d56cd7c1eb4df79051b31babdc6c99877d1b` |
| valley_guardian_design.md | `5be45a28c0c353189edd4cf841878fc9bb20f60db93709f4764cb0353af51148` |
| loop_engineering_design.md | `55c8257f656d3ba44c0cceb15bc31a3b7f6e6836e0d6e23f3d38aed4611dad00` |
| final_world_design_decisions.md | `0272e44247e994c0cf0d99bb4d49f30b12657d2a728fc984071f0330350a4d80` |

## 一手依据

当前Godot范围主要依据仓库 `docs/godot-migration.md`、`docs/godot-web-mvp.md`、`docs/architecture.md` 与实际src/godot-client。`docs/design`包含历史正式世界设计，不等于当前小山谷已开放。未发现tracked GLOSSARY/ADR体系；本集合术语和ADR为独立新增设计资料，不写回仓库。

源码核查依据：世界日历/engine执行次序；MVP与持久入口；mvp-seeds有限种源；mvp-resources独立恢复；mvp-drinking无脱水伤害；events的实际见证与ledger区别；store资源旧字段差量及actors索引；runtime/model-budget现有预算；simulation-copy与planStartError/自救预测。它们证明既有约束，不证明新规格已实现。

实际采用安装技能方法：grill-with-docs、grilling、domain-modeling及术语/ADR格式；此前Loop实际读取research、codebase-design/DEEPENING、wayfinder、to-spec。用户后续委托助手决策，因此不继续逐项访谈；未执行技能默认建issue、写repo、推分支等副作用。论文研究仅继承此前参考，不作为本轮重新验证证据。

## 审查状态

输入稿历经多轮独立审查，最近决策稿三视角无P0/P1；这些结论不自动覆盖本次重新整合。本集合现为待独立复核。收敛已主动消除旧稿冲突：时间只有一个端点、日照仅展示、PAW非空气湿度、旧种源长期兼容、费用未知不退款、获知非actor、谷灵故障分级、机会身份跨版本稳定。

本轮无模拟fixture、无推进倍率、无30分钟运行、无浏览器或模型测试。验证证据只有源码/文档读取、链接检查与独立review待办。后续所有真实功能需按实施门重新给证据，不复用旧MVP运行结果冒充新验收。

## 停止与未验证

参数、全年劳动/供给、实际请求成本、记忆/社交模型表现、迁移/事务和浏览器效果未验证。完成本集合评审就停止设计交付，不自动开发。若发现新P0/P1，按具体证据修订；用户取消、安全违规、预算或轮数上限及需额外授权的步骤立即停门前。未检出问题不是证明不存在。


## 本集合修订2（待复核）

首轮独立review发现两项P1：遗漏气候依赖关闭与时间序列化契约，以及把规则演示清田偏好写成模型硬限制。已明确依赖存在时停气候须整世界暂停拒写；整数微分钟以验证过的十进制字符串持久；清本人田的硬限制仅产权/在场/实例/工时/无补偿，保守策略不强制模型。另补完整112日压力序列、水账、个人实有储备和world/session/journal跨库恢复。

修订前各Markdown指纹保存在 [revision-1-sha256.json](revision-1-sha256.json)，原始输入五稿仍未修改。当前是设计文本修订，无运行/模型证据，待再次独立复核。文件链接及指纹不表示功能已实现。


## 本集合修订3（待复核）

复核指出私人留种数量仍可能被误读为演示目标的硬上限。已明确“同种计划田数+最多1备种”仅是规则演示默认规划；模型可对本人合法收成自主选择更多留种并支付真实成本，公共领取仍按本轮缺口限制。补私人超默认可执行/公共超缺口拒绝的合成用例。修订前指纹见revision-2-sha256.json，当时设计快照指纹见revision-3-sha256.json；该设计修订当时未改项目或调用模型。


## 本集合修订4：实施状态校正（2026-11-18）

用户已授权实施及 GitHub 阶段性备份。IMPLEMENTATION 第1节现区分历史设计授权与已开工状态，并链接气候/水账等已完成切片及农业 WIP；保留原技术退出门，不宣称农业、全年供给、浏览器或模型已验收。同时纳入此前对测试约束的准确更正：删除当时测试文件、避免无用测试并非永久禁止新增测试套件。

revision-1/2/3-sha256.json 保留为历史快照，不覆盖伪装成现行指纹。本次更新后的本集合全部 Markdown 指纹见 [revision-4-sha256.json](revision-4-sha256.json)，不包含该清单自身；后续改动须产生新快照或明确以 Git 提交追溯。指纹只证明文档字节，不是运行证据。
