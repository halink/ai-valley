# 开发专用绘本诊断预览：独立审查

## 审查范围与结论边界

审查对象是开发入口、会话生命周期与现有 Phaser Game 中的附加 Scene。正式客户端默认观察流程保持原状；仅现有开发服务器的单一 `storybook=1` 查询参数注入诊断入口，客户端再检查开发环境及相同参数。没有新增世界 GET、SSE、世界实例或生产控制接口。

这是一份纯合成逻辑及源码审查，不是浏览器、截图、美学、真实存档或性能验收。两张用户参考 PNG 尚未取得并核验；文字 prompt 不能算作已收到图片。实现只能展示现有合成诊断图集，不能宣称已经完成参考图风格。

## 已运行的独立反例

`tests/storybook-development-review.test.ts` 的 14 个测试通过（11 个独立会话/入口测试，以及复用合成 DOM/Phaser helper 的 3 个额外反例）：

- 等待图集期间 close、dispose、进入室内、切换世界均阻止后续挂载，不暂停原视图。
- Scene 尚未回调 ready 时取消，迟到 ready 不复活预览，恢复及释放只执行一次。
- 打开场景失败恢复原视图，清理已注册订阅。
- 暂停原视图期间同步发布室内变化时，挂载失效；返回的恢复函数恰好执行一次，Scene 和 view 均未创建，后续 close/dispose 不再次恢复。
- 保留原快照对象及居民 ID，不修改合成世界；断线和隐藏不推进动作相位。
- 原动画层吞掉绘制异常并清空 plan 后，会话恢复原视图。
- 跟随精确居民 ID；跟随位置不可用时回退，保留原导航职责。
- 新世界复用同一居民 ID 不继承旧素材绑定。
- 重复居民 ID、室内启用被拒绝。
- 正式 main 不导入开发挂载；开发模块无新增 fetch、EventSource、WebSocket、Game 或独立计时循环。
- 缺省、错误值、大小写变体、重复参数及 hash 均不启用；已有 world/events GET 保持放行，新增伪接口或 POST 被拒绝。
- 关闭后立即重开，旧 Scene 的微任务删除及迟到 shutdown/destroy/preupdate 不影响新 Scene；原 2.5D 恢复次数与每次挂载一一对应。
- Scene 排队时世界切换，即使复用相同居民 ID 也清空选择；迟到启动被取消，新世界重新显式选择才可打开，随后室内切换保持原房间不变。
- 对 home、zoomin、zoomout 做静态 window capture 注册守卫及显式 window → document 顺序模拟，确认原 2.5D 在既有 document 导航处理前恢复，同一次点击不会误走原 2D 路由。模拟 EventTarget 不提供真实 DOM 传播验收。

执行使用本机已有 Node 与仓库本地 tsx；清空环境，HOME/TMPDIR 限定到本仓库独占的 `output/storybook-independent-review`。未联网、未读取密钥/环境文件/runtime/真实存档，未尝试浏览器 IPC 或 bwrap，未提交或 push。

独立审查首次 `tsc --noEmit` 发现实现方 session 测试的 `subscribeFollow` 回调签名与 ObserverMap 不兼容。实现方修正后，独立重新执行 `tsc --noEmit` 通过（exit 0）。该结果是类型检查，不替代全仓测试或浏览器验收。

## 代码审查关注点

- `storybook-development-session.ts` 使用 epoch 作异步失效标记，检查世界 ID、当前房间、绑定 ID 唯一性；恢复动作与 Scene 释放分离，避免一个清理异常阻止其余资源释放。
- 会话包装的是原 ObserverMap 的订阅，不创建新数据源。跟随窗口使用当前 playback 中同 ID 的已有 anchor，不能以目的地或室内门口替代位置。
- 既有动画表面会吞绘制错误，因此不能仅以异常捕获作为外壳健康检查；必须检查 plan，并在环境变化回调后立即检查，不能完全依赖可能已停掉的 Scene tick。审查提出后，开发外壳已加入环境回调包装，原回调执行后立即做健康检查。
- 已核对仓库 Phaser 3.90 SceneManager：`getScene` 在目标不存在时返回 null；Scene add/remove 可进入队列。实现仍需通过模拟晚启动及取消测试保证不留活动画布、输入或订阅。
- 开发路由的退出监听放在 window capture，而非 document capture：原 2.5D 的 document capture 监听安装更早，若在同层后注册退出逻辑，原路由可能先把这次缩放当成 2D 操作。更外层捕获先恢复原模式，保留已有路由的决定权。
- DOM 外壳恢复原 2D/2.5D、原 input.enabled，以及 Scene 排队取消的其余模拟验证另见实现方测试结果；独立测试及共享 helper 都不能替代真实浏览器验证。

## 尚未验证

未在真实浏览器中打开入口，未验证屏幕遮挡、触摸命中、字体换行、响应式布局或 GPU 绘制。未对用户两张 PNG 做验收；不得将合成图集或文字说明标记为正式美术完成。
