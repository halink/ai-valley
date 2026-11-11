# 正式客户端的可选2.5D入口

这是客户端接线候选，不是完整2.5D或浏览器验收。普通页面增加 **2.5D（试用）** 按钮，首次打开与刷新仍使用原2D，不保存视图偏好、不自动启用。此改动不启动正式服务、不打开真实存档、不请求模型，也不改变世界模拟。

## 一份数据、一个观察器

- `main.ts` 继续独占原GET `/ai-town/api/world`、EventSource `/ai-town/api/events`、增量合并、重连及历史读取。既有历史和传记接口未换为开发代理。
- `observer-map.ts` 只声明已有只读快照、房间、选择、跟随和镜头适配器。它没有时钟、计划提交、模型或存档写入方法。
- `isometric-observer.ts` 从原开发DOM接线中提取，通过显式适配器消费同一快照。它没有网络连接、测试驱动或开发服务器依赖。
- 安装默认只建立隐藏画布、视图开关与监听。未启用时不会建立地形/对象索引或动画计时器；点击试用按钮才绘制等距场景。代码当前随主客户端构建，并非懒加载分包，因此不能声称首包成本不变。
- 同一个适配器重复安装返回同一个实例。开发兼容入口 `development-preview.ts` 也使用它，不再建立第二套画布、监听或定时器。正式页面不导入该兼容入口或开发代理。

## 退出、失败与真实范围

- 2D按钮或Escape停止计时器、取消指针捕获、撤销临时跟随位置解析、唤醒原Phaser循环，并按原有规则交还镜头。保留原房间和观察身份，不将室内局部坐标交给世界镜头。
- dispose可重复执行，移除共享事件监听、快照/房间/跟随订阅及DOM；旧实例的事件和activate不会复活已移除画布。其后可以重新安装一个干净实例。
- 安装逐项记录已取得的DOM、监听和订阅；晚期安装失败按逆序回滚。清理单项报错不阻止其他项继续释放，避免主入口catch后留下半安装观察器。2D模式的“回到住宅”按钮明确禁用，启用2.5D后才可用。
- 状态条、房间banner和试用开关位于同一个纵向正常流HUD，保留各自内容，间隔8px；手机、长状态文本和房间出现时由内容高度自然占位，不使用互相覆盖的固定top。矮屏HUD保留滚动区域。源码/几何边界测试不替代实际字体、浏览器和触控验收。
- 手机状态条另保留原右侧世界版本按钮的专属空间，宽度取HUD自身与 `100vw - 125px` 中较小值；长暂停文本换行，不覆盖或隐藏版本按钮。回归包含390px及其他手机宽度的外部兄弟边界，不仅检查HUD内部堆叠。
- Canvas2D不可用时显示原因并禁用试用，原2D继续工作。异常快照或绘制失败恢复原2D，禁用试用；后续有效快照解除禁用，但不自动切回2.5D。原连接先启动，安装失败不能中止原数据接收。
- 全图、区域、工程定位、贸易站与不支持房间/位置/姿态继续显示原因后走原2D。这些降级没有被删除或改标签伪装完成。
- 住宅外观、人物户外姿态、建筑资源等沿用已合并模块；[共屋室内与普通烹饪](isometric-lodge-cooking.md)、[工坊室内与普通制作](isometric-workshop.md)、[商店真实室内布局](isometric-store.md)另有有限扩展。商店不增加货架、商品或室内交易手势。住宅/共屋/工坊/商店之外的室内、其他室内特殊姿态、设施/围栏/船货等未覆盖类别、天气灾害叠层及全图仍需后续工作。问号、未知位置和预算省略分别可见，不补造物体或成功动作。
- 暂停、断线、隐藏页面和未启用状态继续冻结显示相位。2D被覆盖时仍处理原快照和场景准备，本次没有宣称消除双场景CPU成本。

## 验证边界

`tests/isometric-formal-entry.test.ts` 使用实际main源码和传输适配器，核对只有一次GET、一条SSE、一次安装及共享快照；另以实际共享安装器源码核对默认2D、重复安装、开发兼容、重复切换、Escape、缺失Canvas2D、坏快照恢复、明确降级、销毁和重装。已有住宅往返与真实follow路由测试改为执行共享安装器，保留原断言。

这些是离线DOM/Canvas/传输替身，不是浏览器、触控、GPU、真实网络生命周期或真实存档验收。完整回归、构建及独立review结果由父任务在最终集成窗口记录。不能依据通过这些检查将正式默认改为2.5D。

定向复现只使用仓库内临时目录和合成引擎快照；不执行 `npm start` 或 `dev:formal`，不读取环境文件：

```sh
mkdir -p output/test-tmp/isometric-formal-entry
TMPDIR="$PWD/output/test-tmp/isometric-formal-entry" node --import tsx --test tests/isometric-formal-entry.test.ts tests/isometric-observer.test.ts tests/isometric-observer-review.test.ts tests/isometric-interior-review.test.ts tests/isometric-follow-route.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

生产构建应显式关闭Vite环境文件加载，并核对bundle模块清单不包含开发驱动、scripts、tests或server模块。构建产物和静态源码图不替代实际浏览器证据。

### 本批定向结果

- 独立review指出的布局覆盖、手机状态遮挡外部版本按钮、默认2D无效重置按钮和晚期安装失败泄漏已修复。全部等距测试与受影响的main/历史/面板/年龄显示适配测试合计 **223/223** 通过，0失败、取消或跳过。这是选定文件验证，不是全量套件。
- `tsc --noEmit` 通过；`configFile:false, envFile:false` 的Vite生产构建通过，输出到独立的 `output/test-tmp/isometric-formal-entry/dist`，不覆盖既有正式产物。
- 生产bundle实际包含120个模块，清单核对无scripts、tests、server或development-preview模块，包含共享等距安装器。主JS约1,525.19 kB（gzip约449.37 kB），仍有超过500 kB的分包警告，未声称消除首包或GPU性能问题。
- 最终定向日志与模块清单位于 `output/test-tmp/isometric-formal-entry/combined-final.log`、`bundle-modules.json`。未运行服务、真实模型、真实存档、浏览器或IPC。全量与独立review仍由最终集成窗口另行记录。
