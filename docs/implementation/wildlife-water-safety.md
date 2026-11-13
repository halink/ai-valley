> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# 野生动物饮水的有限灾害安全

## 证据与选择

本项先核对既有[鸭寻食](duck-foraging.md)、[鹿浆果补缺](deer-berry-foraging.md)、[有限种群](wildlife-population.md)与本地野猪实验记录。历史三年合成结果仍有狼、狐、兔、猪灭绝；另行隔离的野猪寻果候选只留下单只雌猪，而且 seed7777 多损失一只雄鹿，原结论为保留实验、不提升。本项没有重新启用该候选，也没有调整资源、代谢或捕食效率来追求存活数量。

选择修复的是可独立复现的饮水不一致：繁育审核的水路排除活动灾害，但实际 `seekWater` 仍可能喝到活动风暴中的邻接泉水，或沿缓存路线走入活动灾害。存在安全绕路时也会发生。独立审查另行复现了泉水真实扣减和错误移动，不是只比较观察文字。

## 实现边界

业务源码只修改 `src/world/frontier-wildlife.ts` 的 `seekWater`：

- 泉水与原河岸点均排除 `active` 灾害，使用原 `disasterContains` 的径向或真实 footprint 几何。warning/ended 不作活动灾害。
- 饮水缓存路径逐边检查四向邻接、`walkable`（含围栏）和活动灾害。后来出现的危险、障碍或断裂路径不能被旧缓存绕过。
- 缓存失效时，按原最多80步重新寻找不穿活动灾害的实际路线；每次仍只移动一格。当前水源不可达时继续尝试其它实际候选；全部不可用时清除旧饮水路径。
- 到原可接触距离才实际扣泉水1份、更新 `lastHarvest` 并缓解口渴46点。行走不产生水，不提前补水，两只动物不能重复最后一份。
- 保留原口渴56门槛、泉水70格/河岸65格发现范围、受损泉排除、饮水优先级及起点灾害的优先逃离。

没有修改通用 `moveToward`、觅食、追猎、回巢、巡游、逃离、繁育、初始物资、再生或生命需求，也没有增加持久化字段和迁移。其它活动仍使用既有规则；饮水失败后的回巢或巡游并不因此获得全局避灾保证。河岸是否仍邻接真实水面是已有独立边界，本项没有重新定义它。

## 本轮离线验证

- `tests/wildlife-water-safety.test.ts`：20项在原业务源码上10失败、10通过；修复后20/20通过，零跳过。
- `tests/wildlife-water-safety-review.test.ts`：独立夹具8/8通过，零跳过；覆盖后续围栏、隔栏接触、优先逃离、备用水源、耗尽缓存、非饮水规则、SQLite后重新核验和断裂缓存。[独立审查](../reviews/wildlife-water-safety.md)
- 与既有鹿、鸭、野生种群、狼狐、鱼群、天气灾害等11个测试文件联合运行173/173通过，零失败、零跳过；该173项包含主测试20项，不包含另行运行的独立8项。
- TypeScript类型检查、服务端编译、禁用 `.env` 加载的Vite生产构建通过。构建仍有原有前端包超过500kB的提示。
- 随后冻结共享工作树统一整合，474个测试文件共6189/6189通过，零失败、零取消、零跳过；完整类型检查、服务端编译及生产构建通过。执行环境、首次构建的只读缓存限制和证据范围见[独立审查的最终整合记录](../reviews/wildlife-water-safety.md#最终整合验证)。上述定向结果与全仓结果分别保留。

## 七日默认世界对照

本轮另外从相同完整初态运行原版与候选，各测 seed5401、5402、7777 的7个游戏日。每条轨迹只解除暂停、不下居民计划，执行10080次完整 `stepWorld(w,1)`，逐日提交并在同一Node进程内关闭/重开SQLite，共六条轨迹60480次tick、42次重开。

三对初始世界哈希相同；21对逐日语义结果、三对最终语义结果及终点SQLite全部表的全部行完全相同。比较排除了墙钟、内存、性能采样和预期不同的源码哈希；实际生态、资源、人口、事件与数据库状态没有从比较中删去。只读数据库核对前后文件哈希未变。所测鱼账、食源账、有限种群/容量和非有限数检查均无异常。

这证明本次七日默认无新灾害调度的轨迹没有改变，不是灾害存续或生态健康验证。三种子的居民终点均为0，因为夹具不提供居民计划；鹿为5、鸭为3，兔为1/1/2。不能把这种隔离对照说成居民生存保障，也不能用退出0代表物种长期存续。

运行时明确核验的三个源码文件是 `src/shared/frontier-hazards.ts`、`src/world/fishing.ts` 和 `src/world/frontier-wildlife.ts`，每条轨迹内均未变；不是整仓及依赖树冻结证明。饮水业务文件SHA256：

- 原版：`fa7be3ec72879e38a6acac531f1100a4d3fe73ffb80330b16fb4a80f7091d36e`
- 候选：`ef3e1324e96975e94af53c8ea4539fa7873f1a0098c9fab9c1584ff446e1f7f7`

本地复验原始记录保存在 `output/wildlife-water-safety-m9ms3O/`：红/绿测试日志、专项与构建日志、两侧七日日报和合成数据库、只读比较脚本及 `comparison.json`。这些是本轮隔离产物，正式测试不依赖其存在。

## 复验

从仓库根目录使用已安装依赖。专项可通过已有项目测试启动器运行；单文件调用可将工具临时目录限定到项目下：

```sh
mkdir -p output/test-tmp
tools=$(mktemp -d "$PWD/output/test-tmp/wildlife-water-tools-XXXXXX")
env -i HOME="$tools" TMPDIR="$tools" TSX_DISABLE_CACHE=1 \
  "$(command -v node)" --import ./scripts/acceptance-offline-guard.mjs \
  --import ./node_modules/tsx/dist/loader.mjs --test \
  tests/wildlife-water-safety.test.ts tests/wildlife-water-safety-review.test.ts

# 使用全新的项目内输出目录；此命令只复跑当前候选，不自动建立原版对照。
env -i "$(command -v node)" --import ./scripts/acceptance-offline-guard.mjs \
  --import ./node_modules/tsx/dist/loader.mjs ./scripts/wildlife-longevity.mjs \
  --seeds 5401,5402,7777 --days 7 \
  --output "$PWD/output/wildlife-water-new-run" --wall-seconds 600

env -i "$(command -v node)" node_modules/typescript/bin/tsc --noEmit
env -i "$(command -v node)" node_modules/typescript/bin/tsc -p tsconfig.server.json
env -i "$(command -v node)" --input-type=module \
  -e "import {build} from 'vite'; await build({envDir:false});"
git diff --check
```

上述专项阶段没有读取密钥或真实存档，没有调用真实模型，也没有暂存、提交或推送；本地提交由后续统一整合处理。本轮未重新执行历史336日实验，未验证进程崩溃恢复、浏览器效果或无限期生态稳定；同进程SQLite重开不冒充进程重启。真实模型长期验收仍未完成。

## English summary

This bounded fix makes wildlife water seeking reject active disaster destinations and revalidate every edge of its cached route. Only water seeking changes; finite stock, thirst relief, search limits, general movement, foraging, predation and reproduction remain unchanged. The held boar berry experiment was not promoted.

The primary 20-test suite first produced ten failures on the original source, then passed completely. Eight independent tests and 173 focused ecology tests pass without skips. The subsequent frozen-worktree integration passed all 6,189 tests across 474 files with no failures, cancellations or skips, plus type checking and both builds. The existing bundle-size warning remains; the review records the read-only Vite cache limitation and native-config build invocation separately.

Three paired seven-day default synthetic runs use full minute ticks and daily SQLite handle reopen. Initial hashes, all daily/final semantic records and final database table rows match. All residents still die without supplied plans. This is bounded regression evidence, not ecological health, a fresh three-year run, process-crash recovery or real-model acceptance.
