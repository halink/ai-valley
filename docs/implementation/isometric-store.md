# 商店室内的有限只读2.5D观察

在 [可选正式入口](isometric-formal-entry.md) 与 [工坊室内](isometric-workshop.md) 基础上支持真实 `store` 建筑的室内布局。默认仍为2D；本批不修改引擎、模型、交易、权限、存档或网络。

## 设计与事实核对

- `BuildingKind`、`building/store@1` 与分阶段建设确有商店类型，`roomLayout` 已为 `store` 提供最低16行的室内、入口、桌台、厨房与导航点。正式种子没有预置店面，不把住宅经营的小铺改名或转换成 `store`。
- [本地商铺设计](../design/economy.md)中的经营实体与建筑分开：住宅、工坊也可开店；建筑是 `store` 不等于在营业、已上货、有人购物或有收入。
- `economyTarget` 指向原建筑门口；`completeEconomyAtomic` 对 `buy/fulfill` 明确要求 `inside === null`。本批不增加室内成交路径，不把门外付款或挂牌改画成室内交换。

## 显示范围

- `homeInteriorSupport` 保留兼容API名，增加 `store` 白名单；仍须实际 `world.rooms`，不会为旧档补造房间。宽高、入口与槽使用导航同一 `roomLayout`，调用前检查尺寸、容量、工位数上限，调用后核对唯一槽key和有效坐标。商店容量不产生床位。
- 只绘制真实布局桌台与未点火的静态厨房，`care` 仍仅是导航点，不画成设施。没有另添货架、柜台、收银台、钱币、商品、纸笔、工具或顾客。
- 人物沿实际 `inside/roomAt` 出现；不从住处、商业归属、目的地或挂牌猜位置。点选保留原人物身份和房间槽key；连续跟随、手动切房、暂停、断线/隐藏冻结、Escape及2D交还沿用原实现。
- 工坊的普通制作和住宅/共屋的烹饪美术门槛不扩大到商店。商店安装设备仍是带原槽key的记录标记，工作等不支持姿态仍有明确标记或跟随回2D。缺少精确位置不放到默认入口。
- 商业库存和挂牌只有建筑地址，没有室内物品坐标，不摆成图中货物，也不把没画出来解释为库存为空。公开限制文字说明不补造库存/交易手势，交易继续由引擎门外结算。
- 原对象、marks、地形缓存和动画预算不变。动画只使用快照时已建立的绘制资料，不重查房间、商铺或交易表。

## 合成进出与成交路线

`scripts/isometric-store-route.ts` 使用 `createFormalWorld(5402)`，先保存原始种子，再明确增加一栋**测试用合成商店**：位于 `founder-1-1` 的原登记建造地块，尺寸和容量来自实际 `building/store@1`，之后解除暂停。它不是原种子自带建筑，也没有验证该建筑的施工过程。

夹具设置不改原居民、钱、随身物资、知识、房间坐标、商业记录、设备或交易。之后十个显式 `submitPlan`，由 `stepWorld(.25)` 推进：

1. 店主实际到门口，496.25完成；到场才知道新增测试商店。
2. 516.25开店，初始商业库存和钱款均为空。
3. 521.25由原随身库存投入2浆果，524.25挂牌2份、每份3钱。
4. 另选在商店桌台绘制斧具图纸，524.5从真实入口 `(8,14)` 进入，530.25到桌台 `(8,8)`，565.25完成图纸记录。使用原普通人物外观，不画纸笔，也不制作斧具。
5. 本人另选室内等候2分钟，再按实际室内路径离开，573.25出屋，589.5回原住宅门口。
6. 原居民 `founder-1-2` 走到店前，604.75到达；明确购买1浆果、最高总价3钱。607.75结算前没有买入、收入或新增交易记录；结算后买方原库存加1浆果、少3钱，商铺加3钱，挂牌少1份，新增一次真实成交。全过程买方在门外，624回原住宅门口。

这是脚本选择的隔离合成路线，不是模型自主经营、真实山谷或长期生存证据。路线没有种入库存或预先写入成交，图纸记录不代表实物工具产出。

## 验证与重现

主专项 `tests/isometric-store.test.ts` 覆盖明确夹具差异、布局/拾取、真实进出、空店→上货→挂牌→最后工时结算、钱货守恒、无库存外观推断、未知位置/未支持动作回退、只读冻结及预算门槛。[独立审查](../reviews/isometric-store.md)另有8项反例、真实 `ValleyScene` 跟随、交易时点、原子替换、700人预算、暂停/断线/隐藏验证。

旧住宅、共屋和工坊测试中把 `store` 当作“不支持房型”的四处反例改用 `greenhouse/clinic`，保留原回退要求。没有删除回退测试。

仓库根目录运行；空环境加已有离线guard禁止网络、密钥、环境文件与正式存档，临时输出仅使用仓库 `output/test-tmp/store/`：

```sh
mkdir -p output/test-tmp/store
cat > output/test-tmp/store/guard-native-compat.mjs <<'COMPAT'
import fs from 'node:fs';
if(globalThis.__valleyOfflineGuard!==true)throw new Error('offline_guard_required');
if(fs.realpathSync.native===undefined)fs.realpathSync.native=fs.realpathSync;
COMPAT
env -i PATH="$PATH" HOME="$PWD/output/test-tmp/store" \
 TMPDIR="$PWD/output/test-tmp/store" TSX_DISABLE_CACHE=1 \
 node --import ./scripts/acceptance-offline-guard.mjs \
 --import ./output/test-tmp/store/guard-native-compat.mjs --import tsx --test \
 tests/isometric-*.test.ts tests/action-position.test.ts tests/resident-follow.test.ts \
 tests/rooms.test.ts tests/client-bundle.test.ts tests/client-loading*.test.ts
env -i PATH="$PATH" HOME="$PWD/output/test-tmp/store" \
 TMPDIR="$PWD/output/test-tmp/store" TSX_DISABLE_CACHE=1 \
 node --import ./scripts/acceptance-offline-guard.mjs node_modules/typescript/bin/tsc --noEmit
env -i PATH="$PATH" HOME="$PWD/output/test-tmp/store" \
 TMPDIR="$PWD/output/test-tmp/store" TSX_DISABLE_CACHE=1 \
 node --import ./scripts/acceptance-offline-guard.mjs node_modules/typescript/bin/tsc -p tsconfig.server.json --noEmit
env -i PATH="$PATH" HOME="$PWD/output/test-tmp/store" \
 TMPDIR="$PWD/output/test-tmp/store" TSX_DISABLE_CACHE=1 \
 node --import ./scripts/acceptance-offline-guard.mjs \
 --import ./output/test-tmp/store/guard-native-compat.mjs --import tsx scripts/render-isometric-store.ts
```

`.native` 兼容仅重新指向同一个受guard保护的函数，不放宽文件或网络限制。`client-bundle` 使用 `configFile:false, envFile:false, write:false` 的Vite内存生产构建，不覆盖dist。

## 合成图像与未验收边界

`scripts/render-isometric-store.ts` 把实际客户端室内渲染器的像素列表栅格化，输出 `output/isometric-store-interior/synthetic-store-room.png`、`synthetic-store-table-person.png` 和 `manifest.json`。清单保留显式合成建筑来源、引擎时刻、实际ID/roomAt、预算、源码与图片SHA-256。图片顶部可见 **SYNTHETIC / NOT BROWSER**，PNG说明也标明不是浏览器或真实存档截图。

这两张图已实际查看，只见真实布局桌台、静态厨房和原人物；没有商品、交易工具或产出。未运行真实浏览器、触控、GPU、GET/SSE网络生命周期、正式服务、真实模型或真实存档，也没有执行完整 `npm test`。默认仍2D，未暂存、未提交；不能把本次限定测试表述成完整2.5D或其他共享候选已验收。

## 本批结果

- 主专项与独立专项各 **8/8通过**，最终限定集成 **257/257通过**，0失败、取消或跳过，日志 `output/test-tmp/store/final-integration-v2.log`。包含既有等距、动作位置、连续跟随、房间、客户端加载和Vite内存生产构建。
- 首轮集成256/257，唯一失败是旧共屋测试仍把 `store` 当作不支持类型；替换为仍不支持的 `greenhouse` 后，相同完整限定集重新通过，未放宽回退断言。首轮日志 `final-integration.log` 保留。
- 前端 `tsc --noEmit`、服务端 `tsc -p tsconfig.server.json --noEmit` 和 `git diff --check` 通过，日志分别为 `client-types.log`、`server-types.log`。这不等于全项目测试或其他共享候选独立验收。
- 开始与结束的SHA-256核对确认原有五个赠食候选原样保留；未暂存、未提交，HEAD仍为 `a945f92`。

主专项首轮7/8：测试曾把第一步之前的系统总钱数与引擎初始化镇外商人之后直接比较，原商人账户带来1200钱差异。修正测试为逐帧原居民加本地商铺守恒，并在实际成交前后另验全部账户总数。未修改钱款逻辑，保留初次失败日志 `output/test-tmp/store/main-tests.log`。
