# Independent review: optional clinic interiors

## Scope and findings

Reviewed against base `c8e1566`, repository contribution guidance, shared room layout, health appointments and settlement, original person pose handling, and the two production client changes. Reviewer-owned files are this report and `tests/isometric-clinic-review.test.ts`.

The extension is read-only and bounded. Clinics use their actual capacity-derived beds, table, static kitchen and precise `roomAt`. The two body bays and care slot are navigation destinations, not installed furniture or invented patients. Existing people retain the original appearance and pose renderer. Their fixed disclaimer explicitly says treatment, medication and nursing gestures are not rendered and presence does not prove treatment or cure. No appointment-to-treatment visual inference was added. Unknown locations and unsupported poses retain the previous marker/fallback behavior.

One provenance error was found and reported before finalization: the original seed already contains commons clinics. The initial route unnecessarily added a clinic and claimed none existed. The route owner corrected it to use original `commons-clinic-5` and existing nearby adults. The independent route test now requires every building to remain unchanged between seed and fixture. Initial reviewer fixture failures were missing room/industry initialization in the fabricated renderer fixture, not production defects; that setup was corrected.

## Independent coverage

Nine CPU cases cover:

- Exact shared room geometry and capacity-derived beds, including zero capacity, with no care/bodyBay furniture.
- Malformed or oversized geometry, missing legacy room state and duplicate/unknown station keys fail closed.
- Person pixels equal the existing source appearance/pose renderer. Inventory and absent appointments do not create medical art; station benches remain explicit markers outside workshops.
- Exact source identity/position picking; deep-frozen snapshots remain unchanged; duplicate identities reject replacement atomically; obsolete scenes cannot animate after replacement.
- Unknown exact position, unsupported infant pose and unsupported room return to 2D while retaining followed identity and real room.
- Paused, hidden and disconnected rendering freezes; 700-person synthetic crowds obey object, mark and cache budgets without tick-time pose/bucket/floor rebuilding, with deterministic admission after source reordering.
- Fixture provenance and actual engine settlement: original buildings, people, money, skills, knowledge, water and coordinates remain intact at setup, except the explicitly added medicine and synthetic health case. Solo doctor attendance has zero worked minutes/payment and consumes no reserved medicine. Shared work consumes reserved materials, completion settles the promised fee, and remaining injury severity proves treatment completion is not cure.
- Both original participants traverse the genuine scripted route through outdoor travel, entry, actual care/bed:0 role positions and exit. Real `ValleyScene` follow identity and room survive transitions, pointer capture releases, and switching to 2D preserves follow. DOM/canvas adapters are synthetic.
- Empty body bays create no body; an actual deceased resident is represented only by its original identity/location marker, and missing coordinates stay unknown.

## Provenance and limits

The route uses `createFormalWorld(5402)` and original clinic/person records. It explicitly adds one medicine and one severity-50 test injury through `addHealthCase`, and unpauses. Discovery, offer, patient acceptance, escrow, room paths, role positions, shared treatment, payment and exit come from `submitPlan` and `stepWorld(.25)`. These are scripted synthetic medical inputs, not default-world patients or supplies, real injuries, autonomous decisions or model acceptance.

The separate renderer fixtures deliberately clone a building and place a person for negative/mutation tests. Those fixtures do not prove engine movement. Genuine route snapshots provide that separate evidence.

This is source/CPU evidence, not browser, native pointer propagation, touch, GPU, GET/SSE lifecycle, or full renderer-parity acceptance. The reviewer did not run a model, service, network operation or real save. No key, `.env` or runtime-save file was read; no bubblewrap, staging or commit was performed. The five preexisting personal-food gift candidate files were not edited. Formal default 2D remains unchanged.

## Reproduction

```sh
mkdir -p output/test-tmp/clinic-review/home output/test-tmp/clinic-review/tmp
env -i PATH="$PATH" \
 HOME="$PWD/output/test-tmp/clinic-review/home" \
 TMPDIR="$PWD/output/test-tmp/clinic-review/tmp" \
 TMP="$PWD/output/test-tmp/clinic-review/tmp" \
 TEMP="$PWD/output/test-tmp/clinic-review/tmp" TSX_DISABLE_CACHE=1 \
 node --import ./scripts/acceptance-offline-guard.mjs --import tsx \
 --test tests/isometric-clinic-review.test.ts
```

Use the same clean environment and guard for `node_modules/typescript/bin/tsc --noEmit`. Final test/type logs are under `output/test-tmp/clinic-review/`. Results and image inspection are recorded below after final validation.

## Visual inspection

Independently opened `output/isometric-clinic-interior/synthetic-clinic-room.png` and `synthetic-clinic-bedside-people.png`, and read the renderer and manifest. Both visibly state **SYNTHETIC / NOT BROWSER**. The complete-room diagnostic shows two actual beds, an empty table, an unlit kitchen and two original people at the bed edge/care location. The enlarged diagnostic shows the same empty-handed standing people, with feet on the floor and no medication, medical apparatus or treatment gesture. It crops the room and kitchen intentionally, so it does not establish whole-screen fit.

The renderer uses the route's `half-treatment` snapshot, the production interior renderer and source rasterizer, then encodes pixels with integer scaling. PNG metadata and manifest explicitly disclose the synthetic injury/medicine fixture. These are source diagnostics, not browser screenshots, and support no claim of animation, touch, GPU or live-state acceptance.

## Final results

The independent guarded tests passed **9/9**, with zero failures, skips or cancellations, against the corrected original-clinic route. Full guarded TypeScript checking passed. Reviewer-file whitespace checking passed. No remaining blocker was found in the bounded client extension. Full-suite and browser acceptance are not claimed by this review.
