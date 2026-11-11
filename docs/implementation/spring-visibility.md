# Known spring addresses and live water observations

## Scope

A remembered spring identifies a location, not a live stock query. The seed-5401 regression places 葛慈 outdoors within Euclidean distance 12 of `spring-419-233`, behind a house. Previously, changing only the spring amount from 180 to 1 or 0 changed the real final gathering menu and model prompt, even though another direction told the resident to verify the water on arrival.

This change separates known-address travel from current spring observation. It does not change water regeneration, add water or buckets, choose an action, automatically irrigate a field, or change agenda rotation/priority. The independently reported delay in presenting known-spring travel under a crowded agenda remains outside this patch. The subsequent [bounded water-source menu follow-up](water-source-choices.md) addresses that separate delay and known-source alternatives.

## Observation and contact

- `spring-observation.ts` requires a known spring, actual awake outdoor presence, a valid walkable standing tile, no indoor room-coordinate alias or boat position, and an unobstructed **12-tile Manhattan** sight corridor. This makes hand gathering, bucket filling and flood-cleanup observation use one boundary. Their former Euclidean/Manhattan disagreement is removed.
- `outdoor-observation.ts` extracts the existing conservative crop sight corridor and outdoor-presence guard without changing crop rules. Buildings, reserved construction footprints, cliffs and standing trees/rocks block sight, including diagonal corner flanks. Crops retain their existing 8-tile Manhattan range and ownership restriction. Non-spring resource menu visibility is unchanged.
- Spring transfers additionally require actual contact within one tile and a legal step onto the source tile. An indoor doorway, occupied source, newly closed fence or old shore coordinate cannot transfer water.
- Live amount and blockage enter `DecisionContext.resources` only after that observation check. Coordinates are copied into the snapshot. Bucket-fill and flood-cleanup candidates and world validators share the same check before consulting stock or damage records.
- Discovery during walking or ordinary observation no longer teaches an unknown spring through an obstruction. Existing remembered IDs and local address signage remain legitimate location knowledge.

## Travel, stale choices and completion

Known-address travel remains independent of amount and flood damage. A near but hidden spring now has the same explicit inspection direction as a distant or indoor known spring; a missing view does not permanently remove the route. Selecting travel only moves the person. A fresh decision after arrival can gather available water or inspect depletion/blockage.

A previously selected hand-gather action can still travel to its known location. Preflight does not reveal hidden stock or flood damage through early errors. If the source is currently visible, normal amount/blockage checks still apply. Final collection rechecks actual contact, current finite stock and blockage atomically. Concurrent collectors cannot spend the same remaining water twice. If the ordinary adjacent route stops across a closed fence edge, only spring actions retry a real path onto the source and stop at its lawful adjacent gate tile. The fallback does not alter general navigation, teleport, or waive the completion check. Bucket filling may reject a stale choice with the same generic visibility error for every hidden amount; the ordinary known-address direction remains available for a new choice.

No schema or saved observation cache is introduced. Old `knownResources` remain address knowledge, never reconstructed stock evidence. In-memory SQLite and JSON-reloaded state are evaluated from the resident's current real position and source state.

## Offline evidence

`tests/spring-visibility.test.ts` exercises the actual `decisionContext → prepareModelDecision → parseChoice → submitPlan → stepWorld` path, without invoking a model. The initial six tests produced four behavioral failures and two passes before the change; all six passed after implementation. Expanded tests cover indoor room exit, bucket filling, spring discovery, detached observations, actual finite transfers, in-memory reload and a competing collector. Independent adversarial tests and review are in `tests/spring-visibility-review.test.ts` and `docs/reviews/spring-visibility.md`.

The seed accessibility test now requires a visible gathering choice or an explicit known-address inspection choice, rather than remote gathering through a house. The preexisting water-supply cliff tests now assert the earlier visibility rejection instead of an unreachable-route error; their zero-stock/zero-fuel-consumption assertions are retained. Visually transparent but unreachable terrain is checked separately so sight and path reachability are not conflated.

Verification uses existing local Node/TypeScript/Vite entry points, synthetic worlds and memory databases only. The browser, real model, npm, real runtime save and secret files are not used. Build commands disable Vite environment/config loading. No commit or push is performed.

### Final verification result

- `node node_modules/typescript/bin/tsc --noEmit`: passed on the final implementation and all final tests.
- `node node_modules/typescript/bin/tsc -p tsconfig.server.json`: passed.
- Vite programmatic build with `configFile:false`, `envFile:false`, and `base:'/ai-town/'`: passed (183 modules). Its existing large-chunk advisory remains; no browser test was run.
- `node --import tsx --test tests/*.test.ts`: **2,137 passed, 0 failed**, including 10 primary and 13 independently authored spring tests. The full suite was rerun after the contact-aware gate routing fix and final gate-closure regressions.
- `node scripts/acceptance-long-run.mjs 3`: passed after final server compilation, 3 isolated years, 16,478 submitted plans, restart exercised, 1,290 total coins preserved.
- `node --import tsx scripts/acceptance-nine-food-chain.mjs --offline`: passed on seed 5401 over 6,109 game minutes. This is a scripted rules chain, not model autonomy or nine-person/cross-season sustainability acceptance.
- `git diff --check`: passed. The existing dirty worktree is preserved; nothing was committed or pushed.

Independent review first found a reachable-gate regression introduced by the stricter contact check. That issue was fixed and verified through actual final-menu execution for hand gathering, bucket filling and flood cleanup, then supplemented by all three mid-work gate-closure cases. The final independent review reports no remaining actionable issue in this scope.
