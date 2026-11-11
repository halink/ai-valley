# 畜舍室内独立审查

基线：HEAD `5b122cb` 上的畜舍工作树扩展。结论：本次限定范围未发现阻断问题；最终独立测试 10/10 通过。正式默认仍为 2D。本报告不构成浏览器、触控、GPU、正式存档或自主模型验收。

## 证据与边界

阅读了 `src/client/isometric-interior.ts`、`isometric-preview.ts` 的工作树差分，`src/shared/rooms.ts`、`src/shared/industry.ts`、`src/world/industry.ts` 的布局/动物/动作语义，以及 `scripts/isometric-barn-route.ts` 和畜舍测试。独立新增 `tests/isometric-barn-review.test.ts`；仅编写此测试与本报告。

没有联网、读取密钥/环境文件/真实存档、启动正式服务、运行 bwrap、暂存或提交，也没有修改赠食候选文件。DOM/canvas adapter 测试走实际 ValleyScene 跟随状态，但不是实际浏览器。

## 独立覆盖

- 真实 `roomLayout` 一致性：畜舍最少四个 pen；pen 数来自面积而非动物数量。高度预检包含 `ceil(pens/2)*4+5`；12×20 的 65 行布局提前拒绝，未进入工位扫描。槽预算包含 pen 与固定槽，并验证超额工位拒绝。
- fail closed：缺失 rooms、非法/非有限/非整数尺寸和容量、未知工位种类、重复工位 key 拒绝。重复人物导致替换失败时保持旧快照、场景和统计，不半提交。
- pen 只是原 key/坐标上的导航注释。删除动物或把动物 pen 改为 0、3、999 不改变任何场景对象；四个导航点不表达四只动物或占用。只有 barnId/pen 的真实动物计一个未知位置，不绘制动物。
- 显式室内动物只绘制真实 roomAt 标记；携运动物以真实携带者 roomAt 作标记，未知携带者或非有限室内坐标不沿用旧坐标。动物导航保持 2D 回退。
- 原人物精确点选返回原 `founder-1-1` ID 和室内 room ID。真实路线 entry、walking、feed/water work、exit 保留跟随身份；两个照料 work 阶段各回 2D，停止等距定时器，后续可重新开启；进出房间释放 pointer capture。
- 冻结快照不被渲染/动画修改；旧场景不被新快照动画更新。700 人压力场景遵守对象、marks、chunk、缓存预算；动画不重建 pose/floor/bucket，逆序人物数组后的可见 key 顺序稳定。
- 全世界 fixture 差分精确为一个合成 barn、原人物一只 chickCrate、一份 fodder 与解除暂停，没有改变其他世界初值。建筑使用真实 `building/barn@1` 尺寸，原人物保留。
- 实际 submitPlan/stepWorld 初始化运输笼、保留释放动物 ID/种类/性别/出生时间。照料目标是 actionRoom 的 pen 导航点。feed/water 在最后 0.25 分钟消费一份对应资源、降低同一动物需求并记录 lastCaredAt。没有虚构产品、孕育、第二只动物或动物室内/户外坐标；人物退出后动物仍只有 barnId/pen。

## 源码合成 PNG 独立像素检查

实际打开并检查以下 PNG，而非仅查看 manifest。两个画面均明确标注 `SYNTHETIC / NOT BROWSER`，使用 water:completed 的普通中性人物，未画照料动作或动物。

- `output/isometric-barn-interior/synthetic-barn-room.png`：1444×990，完整等距木地板、真实桌台和静态厨房；三处未被人物遮挡的问号清晰可见，第四个 pen:0 与原人物重合。人物身体保留，没有围栏、饲槽、干草、动物或产品。
- `output/isometric-barn-interior/synthetic-barn-original-person.png`：712×610，近景人物的头、脸、蓝色上衣、手臂和腿保持完整，邻近问号可辨；人物脚边保留少量底层注释像素，没有用注释覆盖身体。裁剪后的桌台在右侧，不视为缺失布局。

最终实现将 pen 标记置于地板之上、真实对象之下，仍保留原 at/key。新增独立回归测试验证同 point 的 pen 排在人物前；逐像素检查人物 marks 与 pen marks 的重合区域，每个测试点选都返回真实人物 ID。该验证是源码 marks/CPU 点选，不是 GPU 像素读取。

重新计算两张 PNG 的 SHA-256 与 PNG 头部尺寸，均与 manifest 一致；manifest 中五个源码哈希也均与审查时工作树一致：rooms、interior、preview、route、render 脚本。

- room PNG SHA-256：`b5e391d775e36aa806003b3f07995f9f30a4fd0d21e2562d637289b00a8e908b`
- person PNG SHA-256：`13040f7af33b878b94dea6de0aeb208c46b36ebc98dd6138f0c077abd752b593`
- interior 源码 SHA-256：`02e116a02aa2eb1323bfed05652f5d5bf51d8f2c714b5e81dfeaae4f67086fad`

## 执行结果

在最终 pen 注释层改动后，以提供的空环境离线 guard 与 native compat shim 执行：

`env -i PATH="$PATH" HOME="$PWD/output/test-tmp/barn" TMPDIR="$PWD/output/test-tmp/barn" TSX_DISABLE_CACHE=1 node --import ./scripts/acceptance-offline-guard.mjs --import ./output/test-tmp/barn/guard-native-compat.mjs --import tsx --test tests/isometric-barn-review.test.ts`

结果：10 tests，10 pass，0 fail，约 11.95 秒。没有独立运行全量仓库测试、类型检查或构建；这些应以主实施者实际执行结果为准。
