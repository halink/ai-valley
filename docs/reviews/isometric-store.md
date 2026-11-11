# Independent review: optional store interiors

## Scope and source

Reviewed the candidate against base `a945f92`, `CONTRIBUTING.md`, `docs/design/economy.md`, `docs/design/building.md`, shared room layout and economy types, existing interior rendering and pose gates, and the actual scripted engine route. Reviewer-owned files are this report and `tests/isometric-store-review.test.ts`; production changes remain with the implementation owner.

The formal seed has no store. The route therefore explicitly adds a synthetic building using the actual store definition on the original owner's registered parcel and unpauses the world. It does not seed room positions, knowledge, inventories, businesses or transactions. Existing residents execute `submitPlan` and `stepWorld(.25)` to approach, open, stock and list a shop, draw a design at the actual interior table, wait, exit, and purchase outside. This proves scripted synthetic behavior, not original-seed store construction or autonomous model decisions.

## Findings

No new production blocker was found in the bounded store extension. Its shared-layout sizing correctly treats stores as nonresidential: even a large capacity does not invent beds. The actual table and static kitchen are rendered; the care destination is not furniture. Workshop-only craft and home/lodge-only cooking art remain gated off in stores.

Three old negative tests treated `store` as unsupported. Reported these to the implementation owner, who updated the unsupported examples while preserving other fallback cases. Review did not edit those files. An initial review harness failure was caused by clicking every snapshot, which correctly stopped follow; the test now only holds a pointer over room transitions and checks capture release. This was not a production defect.

## Independent coverage

Eight cases cover:

- Exact shared layout and original slot coordinates; no capacity-derived beds or care furniture.
- Invalid and oversized dimensions, missing legacy room records, duplicate and unknown station keys fail closed.
- Explicit station markers at exact coordinates, without invented bench appearance, shelf, goods, transaction or production art. Added business/listing quantities do not create drawable inventory.
- Actual `ValleyScene` and observer-controller follow across entry, interior work/wait and exit, room-transition pointer release and identity-preserving 2D handback. DOM/canvas adapters are synthetic.
- Original resident selection identity and precise room position; deep-frozen snapshots remain unchanged. Duplicate identity rejects an entire replacement atomically; obsolete scenes cannot animate after a later accept.
- Unknown indoor position, unsupported infant pose and unsupported building return to 2D without losing followed identity or actual room.
- Pause, hidden document and disconnection freeze; 700 synthetic residents stay inside object/mark/chunk budgets, with no tick-time pose, bucket or floor rebuilding. Reversing source order retains deterministic admission.
- Actual buyer remains outside. Immediately before completion no sale is credited; completion transfers one berry, charges three coins, decrements the listing once and adds one trade. Read-only interior rendering of frozen before/after snapshots changes none of these facts.

## Visual inspection

Independently inspected `output/isometric-store-interior/synthetic-store-room.png`, `synthetic-store-table-person.png`, and `scripts/render-isometric-store.ts`. Both PNGs visibly say **SYNTHETIC / NOT BROWSER**. The room overview shows one plain table, one unlit static kitchen and one resident at the table edge. The enlarged view shows the same empty-handed neutral resident, with feet on the floor and no invented paper, tools, goods, shelves, fire or transaction gesture. The close view intentionally crops the room and part of the kitchen; it is not evidence of whole-screen fit.

The renderer takes the actual route's `enter:on-site` snapshot, invokes the shared interior renderer and source rasterizer, then encodes pixels directly to PNG with integer scaling. It does not use a browser. These two views support only the visual claims above, not browser sizing, animation, interaction, GPU or live-state acceptance.

## Reproduction

From the repository root:

```sh
mkdir -p output/test-tmp/store-review/home output/test-tmp/store-review/tmp
env -i PATH="$PATH" \
 HOME="$PWD/output/test-tmp/store-review/home" \
 TMPDIR="$PWD/output/test-tmp/store-review/tmp" \
 TMP="$PWD/output/test-tmp/store-review/tmp" \
 TEMP="$PWD/output/test-tmp/store-review/tmp" TSX_DISABLE_CACHE=1 \
 node --import ./scripts/acceptance-offline-guard.mjs --import tsx \
 --test tests/isometric-store-review.test.ts
```

Use the same environment and guard with `node_modules/typescript/bin/tsc --noEmit` for full type checking. Logs are `output/test-tmp/store-review/final-tests.log` and `final-types.log`.

## Results and limits

Final guarded independent tests passed **8/8**, zero failures/skips/cancellations. Full `tsc --noEmit` passed with exit 0, and review-file whitespace checking passed. The initial type check started before the route file existed and reported only that missing module and its dependent inferred callback type; it is superseded by the final check.

This is CPU/source evidence, not browser, touch, native pointer propagation, GPU, GET/SSE lifecycle or complete renderer-parity acceptance. This reviewer did not run the full repository suite, a model, formal service, network operation or real save. No `.env`, credential, key or runtime-save file was read; no bubblewrap, staging or commit was performed. Existing personal-food gift candidates were not edited. The formal 2D default remains unchanged.
