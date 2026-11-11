# 绘本独立动画契约审查

范围：以 `07a6826` 为基线，审阅旁置动画元数据、只读播放状态及其合成测试。阅读了贡献说明、美术设计、原 v1 manifest、静态绘本计划/Observer/Phaser 接线和原居民位置适配器。审查仅新增本报告与 `tests/storybook-animation-review.test.ts`，源码修复由实现者负责。

## 发现与反例

1. **停步被无进展版本更新解除。** 已接受世界时间推进但脚点不变的快照后，播放器正确冻结；再接受仅 `revision` 增加、时间和脚点不变的快照，却重新摆动四肢。独立反例先记录 100 ms，相同脚点版本更新后实得 200 ms。应保持停步，直到有真实位置进展。
2. **室内阻挡回退仍保留插值脚点。** 真实房间 `(5,6)` 的下一步 `(6,6)` 被布局阻挡，进度 `.75`。动作已回退且不提供动画帧，但返回的 anchor 是 `(5.75,6)`，而非已知原位 `(5,6)`。原户外阻挡分支已经回到原位，室内也应如此。

初跑独立测试 7 项：5 通过、2 失败，未跳过。两个失败对应以上问题，不是视觉测试。实现者修复后，独立复核确认：停步保持不再依赖版本号相同，室内布局或建筑不一致时 anchor 回到实际记录位置。两个原反例保持原断言重新通过。

其余独立反例覆盖：居民离开当前空间再返回时不得沿用旧朝向；重复居民快照与无效时钟原子拒绝；解析后外部修改不改变身份、时长与 atlas；静态和动画入口均保持原 v1 严格结构；缺失可选采摘不回退为待机或行走；四种冻结原因同时生效后逐项解除，最后恢复也不补播；游戏时间大跳不快进显示相位或越过已记录位置。

最终独立文件共 9 项，随全部 `storybook*.test.ts` 终跑共 **169 项通过、0 失败、0 跳过**。这些结果包括原静态绘本基础、动画主测与独立反例，不是全仓测试。最终 `node node_modules/typescript/bin/tsc --noEmit` 退出码 0，通过。

## 复现与已运行范围

从原仓库根运行，测试工具目录仅使用仓库 `output/` 下新建的独占目录：

```sh
TMP_REVIEW=$(mktemp -d "$PWD/output/storybook-animation-review-XXXXXX")
env -i PATH="$PATH" HOME="$TMP_REVIEW" TMPDIR="$TMP_REVIEW" TMP="$TMP_REVIEW" TEMP="$TMP_REVIEW" \
  node --import tsx --test tests/storybook-animation-review.test.ts
env -i PATH="$PATH" HOME="$TMP_REVIEW" TMPDIR="$TMP_REVIEW" TMP="$TMP_REVIEW" TEMP="$TMP_REVIEW" \
  node --import tsx --test tests/storybook*.test.ts
env -i PATH="$PATH" HOME="$TMP_REVIEW" TMPDIR="$TMP_REVIEW" TMP="$TMP_REVIEW" TEMP="$TMP_REVIEW" \
  node node_modules/typescript/bin/tsc --noEmit
```

本次独占目录为 `output/storybook-animation-review-ZD1IIt/`：`review-initial.tap` 保留两项原失败，`review-final.tap` 为 169 项终跑结果，`typecheck-final.log` 为最终类型检查输出。没有修改受保护的赠食候选或美术设计文件。

## 未验收边界

- 这是 CPU 元数据/状态契约审查，不证明 PNG 像素、哈希内容、人物身份造型、四向非镜像、衣装、脚点视觉稳定或素材许可；矩形不重用并不能证明图像内容不同。
- 两张参考 PNG 尚未取得，没有正式美术制作或视觉验收。未运行浏览器、桌面/手机版面、帧率、遮挡或真实 GPU 动画验收。
- 动画仍未接入默认 2D、绘本原型、Observer 或 feed；播放控制由将来的调用者及时传入连接、页面可见性和单调时钟。离线测试不证明未来接线正确。
- 未运行全量 `npm test`、`npm run build`、真实模型、真实存档或长期生活验收。未联网、读取凭据或 runtime、执行 git 暂存/提交/推送，也未重试 bwrap 或浏览器 IPC。
