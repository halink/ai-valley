> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# Independent water-source menu review

## Scope and outcome

Reviewed the dedicated known-water source candidates, formal menu integration, removal of the old nearest-only formal gathering branch, and bounded final-menu restoration. No blocking defect found in the reviewed changes. This is offline synthetic evidence, not a real-model or production acceptance result.

The selection retains one nearest eligible candidate and one alternative rotating every 30 minutes. It does not promise that every known source appears simultaneously. Hidden sources remain address-only visits, including addresses with unknown or impossible routes. This preserves the distinction between knowledge and authoritative execution: an unreachable nearest source may remain offered, but no longer excludes the reachable alternative in the two-source counterexample. For nine known candidates, all eight alternatives appear over eight rotation periods. The final menu can use two additional bounded source slots when existing critical choices leave no spare slot or surplus reflection; existing stop-restoration behavior is separate.

## Baseline evidence and distinction from the earlier visibility fix

Before this implementation was present, the independent review suite reproduced failures for a nearer source separated by a full transparent water barrier (both the remote-address and currently visible collection variants), an adjacent source on an impassable water tile, and a saturated final menu. The simple one-source 120-minute fixture, hidden-state invariance and explicit visit/gather separation already passed. The initial whole-world immutability assertion failed only because of existing lazy initialization and was narrowed to the relevant state; that was not counted as a new water-source defect. The synthetic seed 5401 dry-crop snapshot also passed baseline and is not the historical zero-water action-chain reproducer.

An opaque cliff is a different case: the preceding spring-visibility fix can hide the nearer spring from the ordinary visible-resource list, allowing the old nearest-gather branch to select a farther visible spring already. The implementation author's separate pre-change replay confirmed that cliff-near/far-primary case passed, while the historical seed 5401 zero-water action chain still lost its final water entry at minute 803. Those separate replay results are reported as such, not as independently executed here. The residual nearest-only counterexamples independently reproduced here use transparent water barriers or an impassable spring tile, so the nearer source remains visible and monopolizes the old candidate branch.

## Independent regressions

`tests/water-source-choices-review.test.ts` contains nine tests:

- A dry, personally observed growing crop with zero carried water retains its known remote source on every minute from 600 through 720. Preparing decisions leaves resident state, plans, stock, crops, and events unchanged.
- A nearer spring behind an impassable transparent barrier does not suppress a farther reachable known address.
- The same counterexample with two currently visible springs exposes reachable collection; explicit parsing and engine execution transfer exactly three units without watering the crop.
- Hidden spring quantity, maximum quantity, harvest timestamp and flood state, plus an unknown remote spring's location, cannot change the context, final choices or prompt.
- An explicit visit neither gathers nor waters. A separate explicit gather conserves stock and leaves irrigation unchanged.
- An inaccessible adjacent source tile does not monopolize the menu over another visible source.
- Saturated menus across all twelve focuses preserve baseline non-reflection action content and labels, retain water access, stay within the 58-choice tested envelope, and do not duplicate final choice IDs.
- Seed 5401 Su Ting retains water choices at 30-minute intervals over 120 minutes after synthetic placement on an owned plot with a dry growing crop. This deliberately does not claim to reproduce the historical action chain.
- Nine hidden known sources receive bounded nearest-plus-alternative fairness across daily, farming and exploration focuses, without a second rotation losing alternatives.

## Commands and results

- `node --import tsx --test tests/water-source-choices-review.test.ts`: 9 passed.
- `node --import tsx --test tests/water-source-choices-review.test.ts tests/spring-visibility.test.ts tests/spring-visibility-review.test.ts tests/crop-observation.test.ts tests/crop-observation-review.test.ts`: 53 passed.
- `node node_modules/typescript/bin/tsc --noEmit --pretty false`: passed.

Existing visibility/contact suites cover occlusion, room and boat exclusions, gate contact, actual gate routing, late gate closure, stale gather/fill, concurrency, finite stock and in-memory reload. Their success is retained rather than replaced by menu tests.

## Limits

No real model, browser, installed dependencies, runtime saves, private logs, secrets, server endpoint, commit or push was used. No long-duration simulation was run. Saturation cases inject synthetic commitments into decision contexts to isolate menu preservation; they are not claims that those commitments were created through gameplay. The general decision-context builder performs pre-existing lazy initialization of some definitions and arrangements, so non-automation assertions target residents, resources, plots and events rather than requiring byte-identical whole-world initialization state.
