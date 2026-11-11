# 鹿真实莓果觅食补缺 / Deer real-berry foraging fallback

## 审查状态 / Review status

**主仓库精确提升版本的范围内独立 review 已完成，未发现阻断问题。这里的通过仅指下述局部实现、计量与复验范围，不是生态平衡结论，也不构成提交、合并或部署授权。**

**The frozen, exactly promoted main-repository version has completed this scoped independent review, with no blocking defect found. The result covers the implementation, measurement, and checks below; it is neither ecological acceptance nor authorization to commit, merge, or deploy.**

主仓库与已完成 336 日实验的冻结候选 `frontier-wildlife.ts` 逐字节一致，SHA256：

`fa7be3ec72879e38a6acac531f1100a4d3fe73ffb80330b16fb4a80f7091d36e`

## 中文结论

### 已核验的局部改进

在该冻结候选范围内未发现阻断问题。鹿的原 browse 缺失、耗尽或原路线失败时，能够寻找附近现有、实际有量的莓果。新增发现半径为 9 格、完整真实路线最多 12 步；已有有效莓果目标可持续，每次移动重新检查整条路线、活跃灾害与障碍。每次只走一格，接触后才真实扣除一份莓果、更新采食时间，并沿用原来的 19 点饱腹缓解。

没有带入狼追猎修正；原捕食者、非鹿规则、繁育、亲缘、容量、代谢与资源再生规则未修改，没有增加初始资源、人工补食、复生或新持久字段。源代码结构比较和三 seed 初始世界逐字段对照均支持这一范围判断。

隔离阶段独立执行了作者 82 项组合测试与随后新增的 1 项测试，另外编写并通过 22 项隔离测试。提升后重新针对主仓库执行 81 项正式定向测试（其中新增鹿 23 项、观察器 2 项）和适配主源码导入的 22 项独立测试，合计 **103/103 通过、零失败、零跳过**；主仓库 `tsc --noEmit` 与 `git diff --check` 通过。验证包括资源耗尽、删除与移位、灾害、障碍与围栏、缓存损坏、两鹿竞争、健康鹿在长期无食条件下饿死、SQLite 同刻重入与续跑，以及观察器的同刻消费/再生拆分计量。本 reviewer 未重复执行全仓库测试，不用旧鸭单项全量结果替代当前版本结果。

### 336 日证据及必须保留的限制

三次独立合成实验（5401、5402、7777）均完成 336 日，每次 483840 个逐分钟完整世界步骤和 336 次 SQLite 重开；原 portable runner 不变，候选源码运行中不变，原始记录无检查问题。初始世界 hash 与原版、鸭单独对照逐 seed 相同。

- 第 336 日鹿分别为 6、2、6 只，鸭单独对照为 1、0、1 只。鸭分别为 4、4、2 只，与鸭单独一致。
- 5402 的两只幸存鹿都是雌性，终局没有雄性或妊娠。不能把“未在 336 日内灭绝”解释为可持续繁育闭环。
- 7777 的 `beast:deer:founding-3` 终局仍活着，但饥饿为 100、健康约 21.454；另一只雌鹿饥饿约 97.427、健康约 65.992。存活数量不是健康状态证明，更不是 336 日之后的存活保证。
- 狼、狐狸、野兔、野猪在三 seed 中都已灭绝。非鹿逐个体出生/死亡记录、最终数量、鱼账及非鹿食源账与鸭单独对照完全一致。这一鹿觅食修正没有解决整体食物网问题。

莓果消费按实际资源写入计量。5401 的期初 1778 + 正常再生 1071 − 消费 1084 = 1765；5402 为 1378 + 229 − 229 = 1378；7777 为 2146 + 1022 − 1027 = 2141。其他增加与移除均为 0，所有逐笔 before/after 链与期末汇总一致。`wildlife` 消费是鹿与野猪合计，不能全部归给鹿；原版及鸭单独没有该项累计观察，未知不能写成 0。

观察器是针对当前 Node/tsx、固定自然资源的外部计量工具，不是任意动态世界的通用账本。七日有/无观察器全世界 hash 对照及 SQLite 续跑通过。退出码、守恒、短期或有限窗口存活都不等于生态平衡。本实验仅为三个固定 seed、无居民模型决策的合成世界，未证明更广 seed、真实采集竞争或长期跨代稳定性。

### 主仓库提升核验

五项提升清单逐项 SHA 校验通过。主业务文件与已完成长测的候选逐字节相同；相对原基线的业务差异仍只有鸭真实鱼查询/食源选择和本次鹿补缺，没有狼追猎残留。捕食者生态、共享警戒结构、种群与生产再生文件未修改。

正式鹿测试与实验测试逐字比较，仅删除两条导入历史 output 源码的差分审计用例并规范首项名称；其余 23 项断言相同。正式观察器的两项测试仅改导入路径和注释。观察器实现仅补充用途注释，预载仅调整主仓库导入路径；正式新增文件没有 output 源码导入，生产 src 没有导入观察器或预载，二者不改变正常启动。独立 22 项中的历史对照导入只存在于 output 审计文件，不进入正式测试。

主仓库显式 `wildlife-berry-preload.mjs` 配合原样 `wildlife-longevity.mjs` 另跑 seed5402 七日冒烟：10080 ticks、7 次 SQLite 重开、检查问题 0、源码未变。实际记录期初 1378 + 再生 2 − 消费 4 = 1376。所有莓果变化事件与已核验隔离长测的前七日逐条相同，终点物种数量、出生/死因、鱼账、食源账、种群状态、灭绝/恢复记录也逐字段相同，证明主路径的预载实际挂接到 runner，且没有改变该段轨迹。此短冒烟不新增生态结论。

reviewer 只写 output 审查产物，没有修改主业务、正式测试、主文档或 index，也没有提交、联网或读取真实存档/密钥。336 日终局读取使用限定实验路径的 SQLite 只读 immutable 连接，读取前后数据库 SHA 相同。

## English conclusions

### Verified local improvement

No blocking defect was found within the frozen isolated candidate. A deer whose original browse source is missing, depleted, or unreachable through the original movement logic may seek existing, stocked berry bushes. New discovery is limited to Manhattan distance 9 and a complete physical route of at most 12 steps. A valid existing berry target may continue; each move recomputes the whole route and checks active disasters and obstacles. Movement is one tile at a time. Only actual contact consumes one unit, updates the harvest time, and applies the original 19-point hunger relief.

The change does not incorporate a wolf-pursuit fix. Other species' rules, predator behavior, reproduction, kinship, capacity, metabolism, and resource regeneration remain unchanged. It adds no initial stock, supplemental food, resurrection, or persistent fields. Source-tree comparison and exact initial-world comparisons for all three seeds support that scope.

The isolated review passed the author's 82-test group, its subsequently added test, and 22 additional reviewer cases. After promotion, the reviewer reran 81 formal focused tests, including 23 new deer tests and two observer tests, plus the 22 reviewer cases redirected to main source: **103/103 passed, with zero failures or skips**. Main-repository `tsc --noEmit` and `git diff --check` also passed. Coverage includes depletion, deletion and relocation, hazards, obstacles and fences, corrupt caches, competition for the last berry, eventual starvation without food, SQLite same-minute re-entry and continuation, and separate observation of consumption and regeneration in the same tick. The reviewer did not duplicate the full-repository run or substitute historical duck-only full-suite results for current-version evidence.

### 336-day evidence and required limitations

All three synthetic runs, seeds 5401, 5402, and 7777, completed 336 days: 483840 full-world one-minute steps and 336 SQLite reopen cycles per seed. The original portable runner and frozen candidate source remained unchanged, and the raw records reported no check failures. Initial-world hashes matched both original and duck-only controls for each seed.

- Final deer counts were 6, 2, and 6, compared with 1, 0, and 1 in the duck-only controls. Duck counts were 4, 4, and 2, unchanged from those controls.
- Both surviving deer in seed 5402 were female, with no living male and no pregnancy. Survival within 336 days does not establish a sustainable reproductive cycle.
- Seed 7777's `beast:deer:founding-3` was still alive with hunger 100 and health approximately 21.454. Another female had hunger approximately 97.427 and health approximately 65.992. A survivor count neither establishes health nor guarantees survival beyond the observation window.
- Wolves, foxes, hares, and boars were extinct in all three seeds. Non-deer individual birth/death records, final counts, fish accounting, and non-deer food-patch accounting exactly matched the duck-only controls. This local deer-foraging change does not repair the wider food web.

Berry accounting uses actual resource assignments. Opening stock + normal regeneration − wildlife consumption = closing stock was 1778 + 1071 − 1084 = 1765 for seed 5401, 1378 + 229 − 229 = 1378 for 5402, and 2146 + 1022 − 1027 = 2141 for 7777. Other additions and removals were zero, and every event's before/after chain agreed with the final totals. Wildlife consumption combines deer and boars and cannot all be attributed to deer. Original and duck-only cumulative berry consumption was not observed and remains unknown, not zero.

The observer is an external measurement tool validated for the current Node/tsx loader and fixed natural-resource set, not a general ledger for arbitrary dynamic worlds. Seven-day whole-world hash comparisons with and without observation, and SQLite continuation, passed. Exit status, conservation, and survival over a finite window are not evidence of ecological balance. These three fixed-seed synthetic runs without resident model decisions do not establish broad-seed robustness, competition with real resident harvesting, or stable multigenerational reproduction.

### Promoted-version verification

All five promoted artifact hashes matched the freeze manifest. Main runtime source is byte-identical to the completed long-run candidate. Runtime changes from the original baseline remain limited to the duck food query/selection fix and the deer fallback; no discarded wolf-pursuit changes were carried over. Predator ecology, shared hazard structures, population rules, and production/regeneration files are unchanged.

The 23 formal deer cases exactly match the experimental assertions after removing only two historical-output-source differential audit cases and normalizing the first test title. The two formal observer cases differ only in import path and a comment. The observer implementation gained comments only, and its preload changed paths to the main source. Newly promoted files have no output-source imports. Production src imports neither observer nor preload; normal startup is unaffected. Historical reference imports in the additional 22 reviewer tests remain confined to output audit files.

An additional seven-day seed-5402 smoke run used the promoted explicit `wildlife-berry-preload.mjs` and the unchanged portable runner: 10080 ticks, seven SQLite reopen cycles, zero check issues, and unchanged source. Actual berries balanced as opening 1378 + regrowth 2 − consumption 4 = 1376. Every berry-change event exactly matched the first seven days of the verified isolated run. Final species counts, births/death causes, fish and food-patch ledgers, population states, and extinction/recovery records also matched. This verifies that the promoted preload hooks the actual runner without changing that trajectory; it adds no ecological claim.

The reviewer wrote only output review artifacts and did not modify production source, formal tests, main documentation, or the index; no commits, network access, real saves, or secrets were used. Endpoint SQLite reads used read-only immutable connections restricted to the synthetic experiment paths, with identical database hashes before and after.

## Main-repository reproduction / 主仓库复现

下方定向命令在新检出中运行81项正式测试。独立22项审计脚本与原始日志保留在本地 `output`，不是正式发布文件；若有完整本地审计产物，可在命令末追加 `output/deer-berry-review/independent-main.test.mjs` 重现103项组合。下述证据路径是本地溯源位置，不承诺新检出已有这些文件。

The focused command below runs the 81 formal tests in a fresh checkout. The additional 22 reviewer cases and raw logs are local `output` audit artifacts, not shipped files. With that audit archive present, append `output/deer-berry-review/independent-main.test.mjs` to reproduce the 103-test group. Evidence paths below identify the local audit archive; a fresh checkout does not contain those artifacts.

```sh
env -i "$(command -v node)" --import ./scripts/acceptance-offline-guard.mjs \
  --import ./node_modules/tsx/dist/loader.mjs --test \
  tests/deer-berry-foraging.test.ts tests/wildlife-berry-observer.test.ts \
  tests/duck-foraging.test.ts tests/frontier-wildlife.test.ts tests/wildlife-population.test.ts
env -i "$(command -v node)" ./node_modules/typescript/bin/tsc --noEmit
git diff --check

# Use a new output path for a repeat of the independently executed seven-day preload smoke.
mkdir -p output/deer-berry-review
env -i "$(command -v node)" --import ./scripts/acceptance-offline-guard.mjs \
  --import ./node_modules/tsx/dist/loader.mjs \
  --import ./scripts/wildlife-berry-preload.mjs ./scripts/wildlife-longevity.mjs \
  --seeds 5402 --days 7 --wall-seconds 180 \
  --output "$PWD/output/deer-berry-review/promoted-smoke-new"
```

## Evidence

- Independent 336-day raw-result, ledger, and read-only synthetic SQLite audit: `output/deer-berry-review/final-336d-independent-audit.json`.
- Initial isolated review and exact test commands: `output/deer-berry-review/REVIEW.zh.md`.
- Reviewer tests: `output/deer-berry-review/independent.test.mjs` and `independent.tap`.
- Author tests independently rerun: `author-suite.tap` and `author-added-test.tap` in the same directory.
- Frozen source and artifact hashes: `output/deer-berry-review/review-sha256.txt`.

- Promoted main-source test run: `output/deer-berry-review/promoted-tests.tap` (103 passing tests).
- Main typecheck and diff check: `promoted-typecheck.log`, `promoted-diff-check.log`.
- Formal/experimental equivalence audit: `promotion-equivalence-audit.json`.
- Adapted reviewer tests: `independent-main.test.mjs`.

- Promoted preload smoke and comparison: `output/deer-berry-review/promoted-smoke.log`, `promoted-smoke-audit.json`, and `promoted-smoke/seed-5402/`.
- Final five-file freeze recheck: `output/deer-berry-review/promoted-final-sha-check.txt`.

## Promoted fingerprints / 提升文件指纹

```text
fa7be3ec72879e38a6acac531f1100a4d3fe73ffb80330b16fb4a80f7091d36e  src/world/frontier-wildlife.ts
4081f87d7165610d952b0d19a5c894e8d9d41d076fd6454369aca90960af86fa  tests/deer-berry-foraging.test.ts
41fb36f777b4caf5e5b2d407693f6324aad2912fc22f9df74315c7059bb44087  scripts/wildlife-berry-observer.mjs
db5d4212da035cfda20c232e85440e0911a6001cf2d764b686a1f8bbb62b4593  scripts/wildlife-berry-preload.mjs
1f3f0ef3e62d304a9d0386d1c353f1a3ee3ea10c082cd6426e04613b56b15de2  tests/wildlife-berry-observer.test.ts
499aa199edbef71021130a54a6d2b2902d68bc03fd922c7cfee6086bf64f0d5c  scripts/wildlife-longevity.mjs
```
