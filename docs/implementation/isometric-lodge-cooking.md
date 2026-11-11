# 共屋室内与普通烹饪的只读2.5D观察

本批在[住宅室内观察](isometric-home-observer.md)上有限扩展 `lodge`，沿用[正式客户端可选入口](isometric-formal-entry.md)。默认仍为2D，观察者不能使人物进屋、烹饪、取得食物或完成行动。没有改变引擎、权限、模型、存档或网络连接。

后续 [工坊室内与普通制作](isometric-workshop.md) 另有有限扩展；下文“其他建筑类型”描述本批边界，现已单独增加工坊。

## 真实数据与显示范围

- `homeInteriorSupport` 保留原API名称，明确接受 `home` 和 `lodge`，其他建筑类型继续说明原因并回2D。必须已有 `world.rooms`，房间宽高、入口、床数、桌台、厨房和工位都来自导航使用的 `roomLayout`，不为旧档或预览制造房间记录。容量、尺寸和工位数量先有界检查；共屋额外两个安置槽也计入输入预算。
- 人物只出现在实际 `inside` 与有效 `roomAt`。家庭、住处、床位分配、目标门和行动意图不产生室内位置。家具按原槽位绘制，沿用原像素拾取、原人物ID和详情页。`care`、`bodyBay` 是导航目标，不画成设施或现存遗体；实际遗体记录沿用已有明确占位标记。
- 普通烹饪单独使用 `ordinaryCookingVisual`。原 `personVisual` 必须是现场 `work`，行动必须是普通 `cook`、正整数份数、正有限剩余工时及有效开始时点，且原绑定厨房、建筑门、行动门目标及实际厨房 `roomAt` 一致。赶路、门口、室内接近、离屋和完成后的站立不画成烹饪。旧行动没有 `buildingId` 时只按原门/原室内路线解析，不迁往新住处。
- 烹饪图只给原人物增加朝厨房的手臂相位。没有新增火焰、锅具、餐盘、食品对象、原料数量或产出状态，也不改变2D的 `work` 姿态语义。相位说明明确不证明资源或成品已结算。雇佣烹饪、公共供餐、其他工艺及室内重病、婴儿、携运等未支持姿态仍有原占位原因，跟随时回2D。
- 手动共屋进入/退出、原人物跟随和返回2D继续走已有路由。同一身份可跨室外、实际共屋进入、到厨房、完成和离开，不新增世界操作。未知位置不借用入口，场景切换取消拖动，室内与室外镜头保持分离。
- 原192对象、60,000像素标记和缓存预算不变。烹饪判定只在接受快照时建立，后续相位读取已复制的外观与坐标，不扫描世界集合。暂停使用第0相位；断线和页面隐藏冻结相位推进，但并不声称销毁其显示interval。返回2D和dispose沿用原清理。

## 可复现的普通引擎路线

`scripts/isometric-lodge-route.ts` 创建全新内存 `createFrontierWorld(5401)`，仅直接解除初始暂停；显式 `submitPlan` / `stepWorld(.25)` 产生全部位置、库存和房间变化，没有直接搬动人物或补充原料。

第一位居民明确选择在 `frontier-hall` 做一份普通饭食：480开始，先走实际室外和室内路线，510到厨房，此时仍有20分钟工时；520.25时剩9.75分钟，530完成。原萝卜5→3、水4→3、饭食1→2只在完成后结算。随后另选返回原住宅门，560.25完成出屋路线。测试保留原ID，验证过程中库存不提前变化。此路线是显式脚本测试，不是模型自主选择或长期生存证据。

## 合成验证与独立审查

新增主测试 `tests/isometric-lodge.test.ts` 覆盖真实路线、冻结快照、家具与人物拾取、无虚构对象、旧厨房绑定、工时/数量/位置边界、暂停及其他姿态回退。独立审查见 [review](../reviews/isometric-lodge-cooking.md)，包括实际 `main.ts` 接收函数、`ValleyScene` 与观察器路由的DOM/Canvas替身组合。

从仓库根目录运行，所有临时工具目录留在仓库内；守卫明确拒绝网络、环境文件及真实存档读取：

```sh
mkdir -p output/test-tmp/lodge
cat > output/test-tmp/lodge/guard-native-compat.mjs <<'EOF'
import fs from 'node:fs';
if (globalThis.__valleyOfflineGuard !== true) throw new Error('offline_guard_required');
if (fs.realpathSync.native === undefined) fs.realpathSync.native = fs.realpathSync;
EOF
env -i PATH="$PATH" HOME="$PWD/output/test-tmp/lodge" \
  TMPDIR="$PWD/output/test-tmp/lodge" TSX_DISABLE_CACHE=1 \
  node --import ./scripts/acceptance-offline-guard.mjs \
  --import ./output/test-tmp/lodge/guard-native-compat.mjs --import tsx --test \
  tests/isometric-*.test.ts tests/action-position.test.ts \
  tests/resident-follow.test.ts tests/rooms.test.ts \
  tests/client-bundle.test.ts tests/client-loading*.test.ts
env -i PATH="$PATH" HOME="$PWD/output/test-tmp/lodge" \
  TMPDIR="$PWD/output/test-tmp/lodge" TSX_DISABLE_CACHE=1 \
  node --import ./scripts/acceptance-offline-guard.mjs \
  node_modules/typescript/bin/tsc --noEmit
env -i PATH="$PATH" HOME="$PWD/output/test-tmp/lodge" \
  TMPDIR="$PWD/output/test-tmp/lodge" TSX_DISABLE_CACHE=1 \
  node --import ./scripts/acceptance-offline-guard.mjs --import tsx \
  scripts/render-isometric-lodge.ts
```

`client-bundle.test.ts` 使用 `configFile:false, envFile:false, write:false` 的Vite生产构建，核对可选渲染模块不进入初始分包，不加载 `.env`，不覆盖 `dist`。这些有限文件通过不能写成项目全量通过。

初次加入bundle检查时，225项中224项通过，Vite因现有offline guard替换 `fs.realpathSync` 后不再保留 `.native` 属性而报 `safeRealpathSync is not a function`。上面的局部预加载仅将 `.native` 指回**同一个受guard保护的函数**，没有恢复未保护函数、放开读取/联网或修改守卫。此兼容处理后单独bundle测试1/1通过。原216项等距/房间/位置/跟随回归、主测试7项与独立审查8项也通过；最终集成统计另列下方。

最终限定集成结果：**225/225通过**，0失败、取消、跳过；含上述Vite内存生产构建与可选分包断言，日志 `output/test-tmp/lodge/final-guarded.log`。`tsc --noEmit` 已由开发与独立审查分别通过，`git diff --check` 通过。没有运行完整 `npm test` 或正式启动命令，不把当前共享工作树的有限检查宣称为其他并行候选已合并。

## 源码原生像素与未验证边界

`output/isometric-lodge-cooking/` 的房间图、四个近景相位及 `manifest.json` 来自上述实际引擎合成快照，由运行时室内渲染器的真实像素列表直接栅格化。清单保留ID、坐标、描述、预算统计及源码/图像SHA-256，脚本可重复生成。已检查房间及近景PNG，修正最初朝离厨房方向的手臂后重绘。

这些图不是浏览器截图，也不是实际山谷存档。未执行浏览器、触屏、GPU、真实GET/SSE生命周期、正式服务、真实模型或真实存档验收。其他房间类型、其他室内特殊姿态、完整工位/物资美术仍未覆盖，正式默认不得据此改为2.5D。本批不提交或暂存，不表示其他并行候选已合并。
