# 绘本素材密度独立审查

## 范围与依据

已阅读 `docs/design/storybook-valley.md`，并实际查看其本地规范板与全景概念 PNG。设计要求世界投影维持 32×16，绘制资产至少按默认显示尺寸两倍制作；概念图不是生产图集或运行验收。

审查范围是 manifest/recipe v2、source rect/foot 与逻辑尺寸分离、源 alpha 点击以及专属 Phaser 纹理适配。新增独立测试仅在 `tests/storybook-density-review.test.ts`。没有修改实现、默认入口、真实存档或世界规则，也没有浏览器/GPU验收。

## 已复现的问题

初始实现的 `pickStorybookPlan` 在源像素索引上直接 `Math.floor`。相机原点 `(123.45,-81.23)`、zoom `0.3`、density `3`，source frame `6×6`、逻辑 top-left `(-1,14)` 时：

- 精确内部列/行边界可能落到前一个透明像素，漏选应选对象。
- 精确右/底边界可能落回最后一个不透明像素，违反半开边界。
- 透明前景穿透、非零 alpha（包括 1）命中和非整除逻辑尺寸正常。

独立测试初次扩展运行 6 项，2 通过、4 失败；保留日志 `output/density-review/before-fix-expanded.log`。测试保留源坐标 ±1e-7 的邻近检查，修复应稳定精确边界而非增加实际点击容差。实现负责人已修复；独立重跑确认这四项边界回归全部通过。

## 已核对的正常契约

- v1 字段保持严格，不接受偷偷加入的 density；v2 显式要求 1–8 安全整数。两者投影固定 32×16。
- source rect 和 source foot 不因世界投影改变；位置、占地、groundAnchor 与深度仍由世界记录决定。绘制尺寸和脚点偏移应用 reciprocal density，允许非整除尺寸。
- Phaser viewport fit 采用逻辑 size，Image 应用单独 scale；container 仅承担视口 zoom。动画更新共用此路径。
- linear filter 只设置在当前 surface 新建的 v2 texture；v1 不调用 setFilter。失败清理与正常销毁保持专属资源所有权。
- 所选既有密度、Phaser 与动画 Phaser 合成契约测试初跑全部通过。含最初四项独立测试的合并结果为 26 项，24 通过、2 边界失败，日志 `output/density-review/before-fix-tests.log`。

以上都是代码和合成数据契约证据，不证明最终画稿比例、真实界面可读性、滤波画质、浏览器点击表现或性能达标。v1 产物字节回归由主实现的 pipeline 测试另行验证，本审查不冒称独立验证其所有产物。

## 运行约束

测试使用 `env -i`，PATH 固定为 `/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin`，HOME/TMPDIR 分别位于项目 `output/density-review/home`、`output/density-review/tmp`，`TSX_DISABLE_CACHE=1`，Node `--test-concurrency=1`。没有读取密钥、`.env` 或真实存档，没有推送。

## 修复后最终复核

重新检查最终 `pickStorybookPlan`：直接逆相机取得逻辑坐标，避免额外等距反投影/投影；源坐标通过已有 `stableCoordinateFloor` 稳定边界，误差估计包含相机相减、除 zoom、减 topLeft 及除 scale 的运算量，没有固定像素点击扩张。独立测试确认精确内部列/行、右/底边界及 ±1e-7 源像素相邻点满足半开语义。

新增第七项独立测试还确认零/负数/NaN/Infinity scale、极小 scale 导致运算溢出、缺失 alpha 均无法选中对象。代码对相关非有限运算量跳过当前 draw，alpha 必须显式大于零。

最终独立串行运行以下四个文件共 **29 项全部通过**：

- `tests/storybook-density-review.test.ts`（独立 7 项）
- `tests/storybook-density.test.ts`
- `tests/storybook-phaser.test.ts`
- `tests/storybook-animation-phaser.test.ts`

修复后完整日志：`output/density-review/after-fix-tests.log`。修复前两份失败日志保持原样，没有覆盖。这轮结论仅覆盖 picker 直接调用和普通像素内部的适配测试，未覆盖精确源边界经 pointerup 到 select 的完整路径。后续提交审查发现该盲点确有问题，见下文；不能据此断言端到端已正确。

## 第二轮：真实适配事件链路补审

前次独立测试只把原始相机传给 picker，没有覆盖 Phaser 已先逆相机、随后 observer 用 identity camera 再调用 picker 的精度损失。提交审查在合法 3x 6×6 marker、390×844 视口、topLeft `(-1,6)`、group `(195,68)`、zoom `1.390625` 下复现内部源列 1 漏选、列 4 误选。有效修前证据是 `output/storybook-density-commit-review/adapter-edge-expanded-valid.log`；早先 `adapter-edge-expanded.log` 使用无效 fixture，不计入有效缺陷证据。

最小接口修复保留 subscribePick 原逻辑坐标首参，增加可选原始 screen/camera 第二参。Phaser 每次事件复制并深冻结 screen、camera 与 origin；每位监听器收到各自逻辑坐标副本、共享当前事件的冻结证据。提示及 static/animated observer 优先使用原始证据，旧单参 surface 仍用原逻辑坐标。

新增 `tests/storybook-pointer-review.test.ts` 独立四项：

- static 与 animated observer 分别验证旧单参数 surface 仍可选择居民。
- 两条链路实际触发 scene input `pointerup`，通过真实 observer subscription 到 select；奇数源列不透明，逐个检查 0–6 边界与 ±1e-7 邻点，且提示与选中结果一致。
- 在 observer 前注册恶意修改逻辑坐标的监听器，验证后续监听器及选择结果不受影响。
- 验证 screen/camera/origin 深冻结、不同事件拥有独立证据、原 pointer 之后发生变化不会改变证据。

独立四项初跑全部通过，日志 `output/density-review/pointer-review-tests.log`。此处“真实链路”指使用真实项目适配器及 observer 实现、mock Phaser 事件/显示API；没有实际浏览器、GPU或生产画稿验收。它补齐的是明确复现路径，仍不声称所有端到端问题已不存在。

第二轮最终检查：全仓 `tsc --noEmit` 完成且无诊断（`output/density-review/pointer-typecheck.log`）；独立 pointer、独立 density、density、Phaser、animation Phaser 五文件串行联合回归 **35 项全部通过**（`output/density-review/pointer-combined-tests.log`），包含主实现补充的双轴、双奇偶、四视口事件链路矩阵。执行环境仍采用上述 env -i 和项目内专属 HOME/TMPDIR。先前失败日志未覆盖，本次没有修改实现。
