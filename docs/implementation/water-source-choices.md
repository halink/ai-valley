# Bounded known-water source choices

## Why this follow-up exists

The earlier [spring visibility repair](spring-visibility.md) made remembered addresses distinct from live water observations, but intentionally did not change the final agenda. Two separately audited menu defects remained:

- Seed 5401 Su Ting could finish ordinary cooking and farming with zero carried production water and a personally observed dry growing crop. A known-spring travel candidate existed, but the final agenda could hide it for 120 game minutes.
- In a synthetic world, an inaccessible nearer known spring suppressed a reachable farther known spring. The engine correctly rejected the inaccessible route, without transferring water; the menu did not supply the known alternative.

This follow-up repairs candidate presentation. It does not choose an action, plan water trips, automatically gather or irrigate, create supplies, change regeneration, add a drinking need, alter navigation or weaken source/contact validation.

## One bounded source rotation

`server/water-source-opportunities.ts` derives candidates only from existing known spring IDs or locally readable street/gate signs. The resource locations are the existing fixed spring addresses, not discovered unknown sources. Sign-only travel uses the posted address. A current personal view through `canInspectSpring` is required before reading quantity or flood blockage to offer gathering. Hidden sources yield only address visits, regardless of amount, capacity, harvest time or damage.

Candidates are ordered by known address distance, then source ID. At most two are retained: the nearest eligible candidate and one alternative, rotating every 30 game minutes. With a stable set of N eligible candidates, all N−1 alternatives appear in N−1 consecutive rotation periods. Both gathering and inspection share this single budget, and the final focus agenda does not rotate or truncate them again. Changes to knowledge, personal visibility or visible availability can change the eligible set; the bound is not a promise across arbitrarily changing worlds or decision times that never sample another rotation period.

A hidden address does not certify reachability. No remote path query filters or ranks remembered locations. An unreachable source can remain offered, but cannot monopolize the two-source counterexample. With more sources the farther option receives bounded rotation rather than an omniscient guarantee of immediate success. The unchanged engine still validates travel and legal source contact, including fenced routes and changing gates.

## Final-menu preservation and limits

Formal worlds no longer use the basic gathering menu's nearest-only spring branch. The bounded source group is appended separately from the formal topic cap, then extracted from ordinary focus/domain selection and restored after the existing agenda has finished. Validation-mode gathering remains unchanged.

Restoration first uses spare space, then replaces only surplus goal-reflection choices while preserving at least one reflection. If neither exists, it adds at most two source entries. Thus the ordinary 56-choice allowance can become at most **58**, before the separately existing live-stop restoration. Water entries do not displace existing urgent care, consent/refusal, stopping, food, rest or other non-reflection choices. This explicit bounded supplement avoids making a water choice compete with critical controls.

Age and transport/expression-only filters run before restoration. No source choice is reintroduced into passenger, family-journey, aboard or expression-only menus. Resident-selected focus does not remove the water options, but remains effective for the other choices. Showing a source is an option, never an action policy.

## Execution and knowledge boundaries

- A hidden-address visit only moves. Gathering requires a new separate decision after inspection; watering requires another separate decision with actual personal water and a visible permitted plot.
- A visible gather uses only its observed finite quantity. At completion, the existing engine checks current stock, contact and blockage atomically. Competing plans cannot double-spend the remaining water.
- No schema or stored observation cache is added. Existing ID-based spring knowledge, JSON reload and SQLite reload retain their original meaning.
- Menu actions contain copied address coordinates. Mutating a later world does not change an already prepared decision snapshot.
- Bucket filling, flood cleanup, discovery and the latest visibility/contact implementation are unchanged and covered by their existing regressions.

## Offline evidence

`tests/water-source-choices.test.ts` adds eight tests. The full seed chain starts from generated seed 5401, changes only pause state, and chooses actual numbered menu entries for two cooks, travel, three plantings, two irrigations, explicit waits, source travel, gathering and final irrigation. Candidate timing can differ from the historical audit because this corrected menu itself changes available choices. The test verifies a new continuous 120-minute interval by actual 30-minute waits while the source choice remains present, then completes the explicit water chain. The observed zero-water point is minute 803 on field-1-3; explicit irrigation finishes at minute 979 after the 120-minute wait probes. Nine residents remain alive. No crops or water inventories are assigned to manufacture that primary chain.

The other primary tests cover the exact cliff-enclosed-nearer / reachable-farther counterexample, nine-source bounded fairness under multiple focuses, hidden-state invariance, finite concurrent gathering through in-memory reload, transport/age restrictions, detached snapshots/old JSON state, and a fully saturated 56-item agenda with no replaceable reflection, where exactly two source entries and an independently restored live stop remain bounded. Against saved pre-change source files from after the visibility repair, the seed menu regression failed at minute 803, while the cliff-enclosed case already passed because the nearer spring was hidden by that repair. The independent transparent-water-barrier and nonwalkable-source cases expose the remaining nearest-only suppression. All pass with this implementation.

The independent [review](../reviews/water-source-choices.md) adds nine tests, including every-minute 120-minute menu sampling, all-focus saturation, stock and unknown-location invariance, and transparent unreachable routes. Its seed dry-crop snapshot is explicitly synthetic, distinct from the primary actual-action chain.

### Verification

- `node node_modules/typescript/bin/tsc --noEmit --pretty false`: passed, including the final saturation regression.
- `node node_modules/typescript/bin/tsc -p tsconfig.server.json`: passed.
- Vite programmatic build with `configFile:false`, `envFile:false`, `base:'/ai-town/'`: passed, 183 modules. The existing large-chunk advisory remains.
- `node --import tsx --test tests/*.test.ts`: **2,154 passed, 0 failed**. The run includes all 17 new primary/independent water-source tests and the final no-reflection saturation case.
- `node scripts/acceptance-long-run.mjs 3`: passed, 3 isolated years, 16,478 plans, restart exercised and 1,290 coins preserved.
- `node --import tsx scripts/acceptance-nine-food-chain.mjs --offline`: passed, seed 5401, 6,109 game minutes. This remains a scripted rules chain, not population survival or model autonomy acceptance.
- `git diff --check`: passed.

All runs use existing local Node/TypeScript/Vite tools, generated worlds and isolated memory/temporary databases only. No secret files, real runtime save, model, browser, npm command, commit or push is used. Vite explicitly disables configuration and environment-file loading.

This is not real-model autonomy, complete nine-person fifteen-day acceptance, arbitrary-map accessibility, or long-term water sustainability evidence.
