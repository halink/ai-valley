# Independent review: optional workshop interiors

## Scope and evidence

Reviewed the optional extension against base `380f744`, repository `CONTRIBUTING.md`, the existing home/lodge observer implementation notes, and the actual room-layout and industry work code. Review-owned files are `tests/isometric-workshop-review.test.ts` and this report. Production edits were left to the implementation owner. No commit or staging was performed.

The fixture uses original `createFormalWorld(5402)`, original `founder-18-2`, and the existing workshop. Only the initial paused flag is directly changed. Explicit `submitPlan` / `stepWorld(.25)` calls produce actual discovery, travel, table craft, bench installation, return, bench craft and exit. The route is scripted, not an autonomous model outcome. Review counterexamples deliberately clone and corrupt these synthetic snapshots; none are real saves.

## Findings

1. **Fixed after a red independent regression:** a negative station installation time was accepted as ordinary craft evidence. With `installedAt=-1`, `ordinaryCraftVisual` returned the craft pose and verified-batch description. The implementation owner added the nonnegative-time gate. Separate tests check that invalid installation times retain an explicit station marker and the original table instead of drawing an installed bench.
2. **Fixed after a red independent regression:** the furniture gate requires a nonempty station ID, but the initial craft gate did not. With the bench ID set to the empty string, the station becomes an unsupported marker while the resident still advertises craft at a real bench. The targeted independent regression reproduced this failure. The implementation owner added the same nonempty-ID gate on craft evidence; the retained regression now passes.

## Independent coverage

Eight test cases cover:

- Real table and bench batches with positive work; terminal snapshots do not retain the specialized craft claim. Actual recipe outputs are checked only after completion.
- First arrival at the actual workstation, before batch creation, is a static ready pose explicitly described as not started. An existing working batch with a missing action batch reference is rejected.
- Wrong or absent batch identity, owner, building, definition, action binding, timestamps, work amount and reserved inputs; walking, room exit, wrong doorway/slot, absent station, station removal, invalid installation time and missing station ID.
- Exact room coordinates and original person selection; frozen source snapshots remain unchanged. Table and installed bench share one physical rendering, never two stacked tables.
- Invalid dimensions, duplicate station keys and unknown station kinds fail closed. A supported layout with an unsupported forge retains an exact-location marker rather than invented forge art.
- Actual `ValleyScene` plus the observer controller follows the same resident through all synthetic entry/exit stages and preserves identity on 2D handback. Missing precise position and unsupported building type produce fallback. DOM/canvas/time adapters are synthetic.
- Paused world, hidden document and disconnection freeze phase advancement; captured craft marks no longer consult mutated source collections.
- 700 synthetic residents exercise object, mark and chunk budgets; ticks do not rebuild pose evidence, buckets or floor chunks, and obsolete scenes cannot animate after replacement.

## Reproduction and results

Run from the repository root, with isolated tool directories:

```sh
mkdir -p output/test-tmp/workshop-review/home output/test-tmp/workshop-review/tmp
env -i PATH="$PATH" \
  HOME="$PWD/output/test-tmp/workshop-review/home" \
  TMPDIR="$PWD/output/test-tmp/workshop-review/tmp" \
  TMP="$PWD/output/test-tmp/workshop-review/tmp" \
  TEMP="$PWD/output/test-tmp/workshop-review/tmp" \
  node --import ./scripts/acceptance-offline-guard.mjs --import tsx \
  --test tests/isometric-workshop-review.test.ts
env -i PATH="$PATH" \
  HOME="$PWD/output/test-tmp/workshop-review/home" \
  TMPDIR="$PWD/output/test-tmp/workshop-review/tmp" \
  TMP="$PWD/output/test-tmp/workshop-review/tmp" \
  TEMP="$PWD/output/test-tmp/workshop-review/tmp" \
  node --import ./scripts/acceptance-offline-guard.mjs \
  node_modules/typescript/bin/tsc --noEmit
```

After the installation-time fix and before adding the missing-ID counterexample, the independent suite passed **8/8**, zero failures/skips. The subsequent targeted missing-ID check failed as described above. Initial full type checking found only a concurrent implementation-test helper passing `{world}` where a complete `Snapshot` was required (`tests/isometric-workshop.test.ts:18`). Both implementation fixes are now present. The final guarded independent run passed **8/8**, with zero failures, cancellations or skips; full `tsc --noEmit` passed with exit 0. Logs: `output/test-tmp/workshop-review/final-tests.log` and `final-types.log`. The earlier missing-ID red result is retained at `station-id.log`. Review-file whitespace checking passed.

## Release boundary

These tests are synthetic CPU/source evidence, not browser acceptance. This reviewer did not run the full repository suite, a browser, touch, GPU performance, live GET/SSE lifecycle, a model, formal service, or any real save. The reviewer visually inspected `output/isometric-workshop-crafting/synthetic-workshop-craft-1.png`: one bench surface and a person at its edge, empty hands, no invented flame, tool or output. This source-rasterized PNG is not a browser screenshot. Existing unsupported rooms, specialized poses and equipment details remain fallback/marker cases. This review does not authorize changing the formal 2D default or claiming complete renderer parity. No existing personal-food gift files, model entry, credentials, runtime files or real saves were edited or read; no network or bubblewrap operation was used.
