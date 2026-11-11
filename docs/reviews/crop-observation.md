# Crop observation independent review

## Result

Approved for the scoped field-observation change after the diagonal-corner correction. The original zero-water failure is addressed by a timestamped, bounded observation paragraph independent of action availability and family-note truncation. Observation does not create a plan, supply water, or authorize an action.

One defect was found during review: the first sight-corridor implementation checked floor/ceil sample cells, which collapse to a single cell on a 45-degree diagonal. A solid cell on either corner flank was therefore skipped. The implementation owner corrected this by checking both side cells when the sampled path changes both axes. The independent regression now checks all four flank positions across a two-cell diagonal and passes.

## Reviewed boundaries

- `src/world/crop-observation.ts`: personal ownership; current physical presence; eight-tile Manhattan range; solid sight blockers; fixed crop definition; absolute-day watering state.
- `src/shared/crop-observation.ts`: small observation schema, with no crop name, raw growth count, historical timestamp, weather prediction, or inventory.
- `src/server/crop-observation.ts`: current-timestamp requirement; maximum eight descriptions; current action targets prioritized; deterministic remainder; no dependence on water stock or family-note capacity.
- `decisions.ts`: copied plot coordinates and crop state; observation paragraph separate from family notes.
- `affordances.ts`: default crop candidate no longer starved by an earlier non-default crop; observed maturity used when present.
- `production-opportunities.ts` and the orchard planting loop in `industry-opportunities.ts`: shared visible-own-plot filter.

## Independent verification

`node --import tsx --test tests/crop-observation-review.test.ts` passes 10 tests:

1. Hidden crop mutations do not change real prepared model messages for indoor, outside, room-coordinate, unable-to-decide, dead, off-map, distant, other-owner, sleeping, aboard, and blocked cases.
2. Diagonal corner flanks block observation.
3. Manhattan distance eight is included, nine excluded; walking toward sleep remains awake observation.
4. Prepared context is detached from subsequent plot mutation; raw crop internals are absent from model messages; zero water does not grant watering.
5. Fixed recipe version controls growth and season despite an active-version change; mature out-of-season crops remain harvestable.
6. Summaries are bounded and stable, include action targets, survive large family notes, and reject stale timestamps.
7. Current rain is separate from a watering record; absolute days avoid same-day-of-season aliasing.
8. Multiple crop definitions cannot hide the default crop watering candidate.
9. Production candidates cannot disclose hidden crop changes even when water is available.
10. Real formal-mode prepared messages and menus are identical for a blocked empty, growing, or mature field. Orchard planting has a visible-empty positive control and disappears behind a blocker.

`node node_modules/typescript/bin/tsc --noEmit` passes after the implementation owner corrected the model-name array typing in the expanded primary regression tests. An earlier concurrent check caught that typing issue; it is resolved.

All verification used synthetic worlds and local test/compiler entry points. No model, browser, npm, real runtime save, secret file, commit, or push was used.

## Scope and maintenance notes

- Raw `Plot` fields remain inside `DecisionContext` for menu construction, but are copied and are not serialized into the new model paragraph. This is acceptable for the current boundary. Future changes must not serialize the entire context as model input.
- The new corridor is deliberately conservative, not a general visibility engine. It can hide some plots near obstacles. Ground movement is not automatically treated as absence; boat coordinates cannot masquerade as shore presence.
- This review does not claim all other production or custody labels have been redesigned as coarse observations. Existing fertilizer/yield labels and delegated-custody menus are separate behavior.
- Known land addresses remain available when current crop observations are hidden. Remembering ownership/address is not remote live crop knowledge.
- No growth rules, execution permissions, future-weather calculation, or automatic action policy was changed by the observation layer. Day-boundary engine and persistence testing are owned by the implementation task.
