# 绘本高清素材与逻辑尺度

本批只补充非默认绘本原型的素材密度契约，不更换正式素材、居民身份、地图占地、模拟、默认2D或界面。已实际查看[设计说明](../design/storybook-valley.md)及其恢复的两张参考 PNG；参考板用于对齐方向，不裁成生产图集，也不把它的家具、动作或光照当成世界事实。

## 三种尺度分开管理

- **世界格**：`footprint` 与 `groundAnchor`，投影始终是32×16逻辑单位，不随画稿密度变化。
- **源像素**：PNG宽高、`frame.rect`、`frame.foot`、建筑报告的门点/操作点，仍是未裁紧源画布的像素坐标。
- **逻辑显示与镜头**：`pixelsPerUnit` 表示每逻辑单位的源像素数。尺寸和局部脚点除以密度，得到逻辑大小；再乘视口缩放，得到画布上的位置和大小。密度不是镜头zoom，也不是devicePixelRatio。

例如同一图块1x为32×48、脚点(16,48)，2x为64×96、脚点(32,96)，分别声明密度1和2，显示大小同为32×48，脚点相同。示例仅说明单位，不指定正式人物规格。奇数源宽高和小数脚点也允许，所以逻辑尺寸可为小数。

`placeStorybookFrame` 与 `placeStorybookAsset` 的新增末尾参数是密度，默认1。返回的 `position,topLeft,size` 使用逻辑单位，`origin`仍为归一化源脚点，`scale=1/pixelsPerUnit`。frame保留原像素，不把世界建筑缩放成素材占地。渲染计划统一传入清单密度，包括地表、建筑层、人物方向帧和缺图标记。

## 清单与离线管线版本

严格v1清单与recipe不接受新字段，行为仍为1源像素=1逻辑单位。没有自动猜测密度或更改旧清单。v1合成构建的PNG、manifest、animation、report四份产物与改动前固定SHA256基准一致。

显式v2清单保留其他字段，在atlas加必填 `pixelsPerUnit`：

```json
{
  "schemaVersion": 2,
  "atlas": {
    "path": "assets/storybook/example.png",
    "width": 1024,
    "height": 1024,
    "sha256": "实际源PNG的SHA256",
    "pixelsPerUnit": 2
  }
}
```

这是字段变化示意，不是省略其他必填项的可运行清单。密度只接受1至8的安全整数；缺项、字符串、分数、非有限值、超范围值与访问器均拒绝。整张图集共用一个密度，不支持同包逐帧混用密度；需要混合密度时先制作一致密度的导出，而非修改世界占地。单图集仍不得超过2048×2048源像素，不因高密度放宽内存预算。

[离线管线](storybook-asset-pipeline.md)的recipe使用 `buildSchemaVersion:2`，其atlas在原 `width,maxHeight,padding` 上增加 `pixelsPerUnit`。`check/build/verify`命令不变，源图与recipe仍需要显式授权和hash pin。管线不会重采样、裁紧、镜像、去底或自动补画，只复制指定源像素。只修改密度声明不会改变PNG字节或PNG hash，但会改变清单、recipe hash及显示大小，因此实际换密度必须同时审核素材版本及其尺寸。

v2输出manifest v2与 `buildReportVersion:2,pipelineVersion:1.1.0`。报告追加atlas逻辑宽高、每帧 `logicalSize/logicalFoot`、`logicalBuildings`门/操作点换算，原源坐标保留。报告门点只是素材局部坐标，不自动变成真实建筑入口或家具。v1继续使用report v1与pipelineVersion 1.0.0，保持原输出形状与序列化顺序。动画companion仍为v1，其完整角色画布、脚点与四方向注册检查不变。

## 绘制、命中和滤波

Phaser图片在逻辑脚点放置，设置源脚点origin及 `1/pixelsPerUnit` 局部scale；父容器另设视口zoom。自动取景使用逻辑 `size`，不会把2x素材当成大一倍的建筑。换动画帧时继续设置局部scale，复用已创建图像。

点击先去掉镜头变换，再将局部逻辑坐标转换为源像素，从后往前读取原alpha；alpha=0穿透，alpha>0命中。边界为左/上闭、右/下开。根据运算量消除边界附近少量ULP误差，不增加固定点击范围，测试保留±1e-7源像素邻点。源alpha判定不等于GPU线性插值后的可见覆盖，半透明轮廓与极细线条仍需浏览器核验。

`StorybookSurface.subscribePick`的首参保持旧的逻辑坐标，新增可选第二参 `StorybookPointerEvidence`，含该事件未经逆变换的 `screen` 和 `camera`。Phaser在逆变换之前复制并深冻结此证据；给每个监听器的旧逻辑首参也独立复制。提示拾取和静态/动画observer选择都直接使用原始证据，确保相机相减的误差量不会因提前逆变换而丢失。没有第二参的原CPU/测试surface仍使用旧的identity-camera契约。

仅显式v2的独占绘本texture调用Phaser 3.90 `setFilter(0)`（LINEAR），以支持高清画稿的非整数缩放。v1不改采样。没有改共享Game的 `pixelArt:true,antialias:false,roundPixels:true`，没有改默认canvas的pixelated CSS，也没有改其他texture或camera。创建失败时仍释放已取得的独占texture。管线保持原padding规则与像素复制方式，不新增挤边或mipmap；采样接缝、透明边缘、CSS缩放与像素取整在真实GPU/浏览器上的观感尚未验收。

## 验证边界

测试只使用仓库生成的合成方向箭头、注册片与像素复制夹具。测试夹具的放大不代表正式美术制作方法，也没有生成两位居民或首批80帧画稿。

- 密度1/2/3的逻辑脚点、原点、尺寸、地表、建筑、标记、移动与深度顺序一致，世界数据不变。
- 清单支持1至8，管线覆盖1/2/8、字节hash、原注册检查与错误密度拒绝。
- 透明洞、首尾像素、半透明、非整数相机zoom及边界按源像素验证。
- 1440×900、1280×720、390×844的Phaser mock验证自动取景、局部scale、点击、2x动画换帧及独占资源释放。

实际测试命令、最终计数和独立审查见下方记录与[独立审查](../reviews/storybook-density.md)。这些是CPU/Mock契约测试，不是浏览器、视觉质量、设备性能、真实存档或自主生活验收。原开发预览仍加载v1合成箭头，新契约不会自动把原预览变成正式绘本。

### 本轮执行记录

所有检查清空继承环境，HOME/USERPROFILE/TMPDIR/TMP/TEMP指向项目 `output/storybook-density-verification/` 的独占目录，禁用tsx缓存；不读取.env、密钥或真实存档。服务端与Vite构建产物也仅写入该目录。首次新增测试有一处预期错误：缩小声明PNG宽度时先被合法的帧越界检查拒绝，已改成不影响帧边界的声明尺寸差异再验证PNG头，不改实现绕过检查。

独立审查复现3x密度与非整数相机下精确源像素边界误选，修前6项中4项失败。去除多余投影往返，并使用按运算量计算的ULP稳定取整后，独立7项与所选相关测试合计29项全部通过，修前日志保留。最终全仓类型检查还发现独立测试的字面量被TypeScript拓宽，按测试目标补充显式类型标注，没有更改断言或运行实现。

本批全部绘本专项串行回归 **327/327通过，0跳过**，日志 `output/storybook-density-verification/regression.log`；最后将旧测试的“不支持版本”输入从2更新为3后，清单测试另复跑 **75/75通过**，日志 `schema-final.log`。独立审查最终日志为 `output/density-review/after-fix-tests.log`。

源PNG→v2 recipe→check→build→verify命令路径均成功，日志 `output/storybook-density-verification/cli.log`，输入留在同目录 `cli-input/`，候选留在 `output/storybook-assets/synthetic-density-verification/`。这仍是80个编号方向箭头及4个层标记，不是人物动画画稿。

全仓TypeScript无输出检查、服务端编译和Vite构建均通过，日志同目录 `typecheck-final.log,server-build.log,vite-build.log`，退出码记于 `status.txt`；独立测试类型标注修正后另复跑7/7通过，日志 `output/density-review/typed-review-tests.log`。Vite使用 `configFile:false,envFile:false,envDir:false` 与原base，未运行会加载默认环境文件的 `npm run build`。既有大分块警告仍存在，不代表性能验收。

本批未重新运行全仓npm test、未做浏览器/GPU及美术验收，未提交或推送。此前恢复阶段的全仓测试与本批变更后的专项检查分别记录，不将旧的全仓通过当成这批变更后的全仓验收。

### 提交前端到端补验

提交复核发现此前327项与直接picker边界测试没有覆盖的小帧适配链路问题：surface先逆相机，再把逻辑坐标配identity camera传给提示及observer，丢失原始相消误差量。合法6×6、3x marker在390×844下，精确内部列边界可漏选或误选。有效外部复现日志为 `output/storybook-density-commit-review/adapter-edge-expanded-valid.log`，本批再次复现保留于 `output/storybook-density-pointer-verification/before-fix.log`。更早的 `output/storybook-density-commit-review/adapter-edge-expanded.log` 使用无效的非整数居民位置，仅是测试夹具错误，不作为实现失败证据。

修复采用上文的原始pointer证据传递，没有扩大取整容差、改变alpha规则或放宽半开边界。正式Phaser测试新增静态与动画两条实际 `pointerup→observer.select` 路由，覆盖1440×900、1280×720、390×844及带小数原点的390×844；每条还覆盖两轴、两种透明/不透明奇偶排列、0至6的全部源像素边界及±1e-7邻点，同时验证提示文字与实际选择一致。动画路由使用static-only bundle的真实fallback marker订阅，动画cel换帧另由既有动画Phaser测试覆盖。

修后原提交复现与正式Phaser测试共20项全部通过，日志 `output/storybook-density-pointer-verification/after-fix-focused.log`。独立新增pointer审查4项通过，与相关五文件联合复跑 **35/35通过**，另独立全仓tsc无诊断，日志见 `output/density-review/pointer-review-tests.log,pointer-combined-tests.log,pointer-typecheck.log`。

此轮最终全绘本专项 **333/333通过，0跳过**；全仓TypeScript无输出检查、服务端编译、隔离Vite构建全部退出0。完整日志在 `output/storybook-density-pointer-verification/` 的 `regression.log,typecheck.log,server-build.log,vite-build.log,status.txt`。环境隔离方式与前轮相同，Vite仍有既有大分块警告。源码与测试在此轮最终检查期间未再修改，之后只补写本文执行结果。仍未重跑全仓npm test或浏览器/GPU/正式画稿验收，先不提交或推送。


### 最终本地提交复核

以本地 `bob` 的 `0cf1b6a` 加最终20文件变更复核，工作区没有其他待提交修改；`main` 保持原提交不变。Linux / Node v24.22.1 下重新运行原始有效pointer复现文件，10/10通过，先前4处误选均消失。再运行 `node --import tsx --test --test-concurrency=1 tests/storybook*.test.ts`，25文件333/333通过，零失败、取消或跳过；全仓 `tsc --noEmit`、服务端编译和禁用config/env加载的Vite构建也通过。Vite既有大分块提示保留。日志及实际命令在 `output/storybook-density-commit-final/`，原修前失败证据未覆盖。

另从 `0cf1b6a` 提取原纯管线模块独立生成v1合成产物，四个SHA256与正式回归基准完全吻合；该次结果在 `output/storybook-density-commit-review/baseline-v1-hashes.json`。最终验证期间1398个非环境源文件路径与hash均保持不变，之后仅更新本文的路径与执行记录。20文件限定为绘本实现、测试和文档，不包含output、密钥或真实档；没有推送，也没有重新运行全仓测试或真实浏览器/GPU验收。

上述output日志未纳入版本控制；新检出可用已提交的25个测试文件、合成夹具及原有构建工具重跑契约检查，不能据未随仓库提供的历史日志宣称自己已复现当时运行或视觉质量。
