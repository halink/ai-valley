# 绘本动画接线独立审查

审查基线为本地 `c17f0e2` 及本批未提交接线。阅读了贡献约束、绘本设计文字、已提交动画契约及播放器、静态原型、共享 Phaser surface 和本批动画控制器。本审查仅新增 `tests/storybook-animation-wiring-review.test.ts` 和本文，不修改生产代码，不修改原五项设计文本或赠食候选。

## 结论与范围

首轮离线审查未发现接线阻断缺陷；追加屏外裁剪复审发现自动观察窗口未纳入重画 signature，已由实现者修复并保留原断言验证先红后绿，详见下文。动画使用既有 ObserverMap 的快照/连接与房间订阅；显式 mount 使用调用方已有 scene 的 preupdate，不建立 Game、GET、SSE、RAF 或另一套世界推进。默认 `main.ts` 没有导入新接线，原视图 cover、frame、follow resolver 未被原型接管。

动画计划复用静态对象计划，输入必须匹配 world ID/revision、每条记录的 spaceId 和完整唯一居民集合；实际动作帧还核对已安装图集对应方向的 frame。末轮还核对实现者新增的空间错配防护及主测试断言：即使 world/revision 相同，也不能把室内 sample 当成户外坐标。控制器进一步要求整个 manifest 与 bundle 一致，不能只靠同一个 sha256 字段混用改过的几何元数据。这里检查的是可信调用链一致性，不是恶意 JavaScript 对象的安全沙箱。

共享 surface 按 draw key 复用 Image，帧变更调用 setTexture，移除对象时 destroy；透明像素拾取仍用安装时复制的像素。只有已确认脚点参与放置，显示时间不外推位置。未知身份或姿态保留 marker/原视图回退，不以成人待机或动作成果代替。

## 独立反例

首轮新增 8 项测试并全部通过，无跳过：

1. 没有 scene tick 时，页面可见性及 reduced-motion 的独立事件立即冻结当前相位；恢复时丢弃后台间隔，后续正常 tick 才推进，脚点不变。
2. 连接状态单独通知立即冻结，重连不补播；原世界逐字序列化结果不变，原视图导航不被调用。
3. 倒退 revision 的 feed 使计划清空；后续有效 feed 能恢复，只显示新接纳版本。
4. 进入室内清空户外计划，返回时重建相位，不保留跨场景播放进度。
5. dispose 后手动重放已捕获的快照、房间、环境、拾取回调，以及再次 activate/tick/dispose，不能复活绘制、选择或订阅。
6. environment 订阅建立失败时，已取得的 feed/房间/拾取和 surface 所有权全部释放。
7. 同 hash 但改过脚点的 atlas、错 revision 和遗漏居民的 animation plan 都被拒绝。
8. 默认 main 无动画 mount 导入；两个新增接线模块没有 fetch、EventSource、Game、RAF 或定时器调用。

已有动画契约独立反例与原 Phaser/绘制计划反例同时复跑，26/26 通过，0 跳过，验证停步、真实室内路阻、旧方向清除、静态拾取及销毁等兼容边界。这不是全仓测试。

## 屏外裁剪追加审查

新增第 9 项验证真实插值脚点 x=6.5 恰好位于窗口右边界时被半开区间剔除；只有 revision 更新不能推进屏外相位，非法窗口参数在相位/时间写入前拒绝，重新入窗第一段不补播。该项通过。

第 10 项为先红后绿反例：仅保留一个合成居民，原视图 currentTile 从 (6,3) 变为 (14,3)，自动观察窗应从 x=0 变为 x=2；在 50ms 未换帧时，原 signature 相同，plan 错误保留 x=0。原因是 sample 已使用新 viewBounds，重画去重却未包括窗口，导致实际画面与本次裁剪证据可能不一致。实现者将 viewBounds 加入 signature 后，原断言通过，独立审查未修改生产代码。

最终全部 `tests/storybook*.test.ts` 独立复跑 **206/206 通过，0 跳过**，包含本文件 10 项。全项目 TypeScript 无输出检查退出 0；不是全仓 `npm test` 或构建验收。

另复核 `tests/storybook-animation-phaser.test.ts`：三种 viewport 的帧切换/对象复用、纹理复制后拾取、移出人物销毁、shutdown 全资源释放、相机变更停用、三类 scene listener 注册失败及浏览器 media listener 失败清理均有断言。这些是 mock API 生命周期证据，不是浏览器视觉或性能验收。

## 验证方式与未验收事项

全部执行检查采用清空环境，HOME/TMPDIR 指向本仓库 `output/review-animation-home/`、`output/review-animation-tmp/`。独立测试日志为 `output/review-animation-tests.txt`，选定回归为 `output/review-animation-regression.txt`，类型检查为 `output/review-animation-typecheck.txt`。

追加及最终复审改用新建独占目录 `output/animation-review-final-NEcOdZ/`，HOME/TMPDIR 分别为其 `home/`、`tmp/` 子目录；`focused.txt` 保留第 10 项修复前失败，`all-storybook.txt` 记录修复后 206 项结果，`typecheck.txt` 记录无输出检查。初轮类型检查的两处审查夹具类型问题与主测试 sleep 参数错误均已修复，未跳过检查。

两张用户参考 PNG 尚未取得并查看像素；没有据此制作或验收人物美术。此处仅检查合成诊断图集接线，不声称四向真实画稿、浏览器渲染、遮挡观感、移动端布局、实际 GPU 内存或帧率已验收。未启动正式入口，未联网、读取 key、环境文件或真实 runtime 存档，未重试 bwrap/浏览器 IPC，未暂存、提交或推送。
