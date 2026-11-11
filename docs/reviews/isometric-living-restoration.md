# Isometric living content: independent restoration review

Reviewed on 2026-11-10. Scope: the working-tree living-content restoration based on commit `58c27b6812faf756f3d001a5407205ad30e977eb`, before integration. This is a source, synthetic-test and source-native pixel review, not browser acceptance or complete 1.0 acceptance.

## Result

No unresolved blocking finding remains in the reviewed scope. One reproduced P2 was fixed by the implementation owner and independently rechecked. The review did not edit implementation or tests. Its only repository deliverable is this report; no staging, index changes, commit or push were performed.

Reviewed files include `isometric-living.ts`, `isometric-pixels.ts`, the study/viewport/preview integration, `development-preview.ts`, the living fixture/export script, the new living tests, and the changed viewport/observer-review assertions. Original ecology routing and animal/grave record definitions were inspected for comparison.

## Findings and fixes

### P2, closed: unsupported activity produced movement

Originally, creature movement excluded only `rest` and `shelter`. A synthetic `future-activity` with a target therefore produced different leg pixels at 0 and 260 ms. Fish similarly animated any activity other than `resting`, including unsupported or missing activity. Independent execution reproduced both cases. The test named “unknown activities never invent a movement” initially checked only a deleted animal activity and did not cover unknown activity kinds or missing fish activity.

The owner changed creature rendering to accept only own keys of `animalActivities` before reading the target or choosing activity-dependent movement. Fish now animate only `feeding` and `evadingFlood`. Added regressions cover an unknown string, an empty string, `toString`, and a missing kind/activity. Independent checks confirmed static marks for wildlife, livestock and fish in every such case. These records retain their original position and identity; no replacement movement is inferred.

### Evidence improvement, closed: the exported phase did not show animal movement

The first alternative export used 520 ms. For the fixture's roaming animals, that selects the same zero-step leg position as 0 ms. The owner changed the export to 300 ms and regenerated the PNGs and manifest. Independent mark comparisons now show changes in all six wildlife, four active livestock and all eight fish pools. The resting sheep remains unchanged, as expected.

## Checked behavior

- Six wildlife and five livestock kinds retain the snapshot ID, kind and integer coordinate. Target positions orient or pose existing art without changing its anchor. Unknown species use an explicit marker; unknown positions are counted rather than relocated.
- Dead animals are not drawn as living animals. Indoor animals keep the original 2D route. Escorted livestock are marked rather than shown as freely walking, and explicitly regional carriers do not reuse stale valley coordinates.
- Empty and reserved/assigned grave slots have no headstone. Headstone support requires a nonempty recorded person ID and a finite burial time from zero through the current world minute. An assigned ID alone is not treated as burial. Malformed or contradictory burial fields use the viewport's neutral fallback. This verifies use of the recorded ID and date, not independent proof of a real-world burial or referential integrity of the person record.
- Fish art uses positive registered species stock and the recorded `shoal.at`, with one glyph per species and one selectable object per original pool. It does not create individual fish identities. Missing/invalid composition, amount mismatches, unknown positive species or non-water coordinates fall back explicitly. Empty pools contain water lines but no fish silhouette.
- Render and pick order share the same object sequence. Fractional-camera selection, overlapping painted pixels, bounded animated marks, dense-object omission, cache reuse and daylight shading passed focused tests. Frozen synthetic snapshots remained unchanged.
- Supported ecology location preserves the original selection identity, including the existing beast-to-domestic same-ID resolution. Unsupported location/state/art returns to the original 2D route. Existing resident-follow and room behavior passed the source/VM tests; this is not a claim about actual browser propagation.
- `Pixels` was moved into a shared module without changing the primitive implementation. `description` is optional, and the original `Pixels` export remains available. The default production entry remains 2D.
- Earlier tests expecting every animal/grave to be a question marker were updated to distinguish restored art from unsupported records. Reservation checks still require no headstone; unknown-location, placeholder and budget assertions remain covered.

## Independently executed checks

The following focused runs were performed sequentially, not as a parallel full-suite run:

```sh
node --import tsx --test tests/isometric-living.test.ts tests/isometric-viewport.test.ts tests/isometric-observer-review.test.ts tests/isometric-preview.test.ts
node --import tsx --test tests/isometric-study.test.ts tests/isometric-observer*.test.ts
```

Results: 32/32 and 41/41 passed. Nine observer-review tests overlap, so these runs cover 64 distinct tests, not 73 distinct tests.

After the P2 fix, the affected focused set was rerun:

```sh
node --import tsx --test tests/isometric-living.test.ts tests/isometric-viewport.test.ts tests/isometric-observer-review.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

Results: 32/32 passed with no failures, cancellations or skips; TypeScript exited with code 0. Separate inline synthetic probes reproduced the original bug, verified all unsupported-activity fixes, and checked the 300 ms phase differences described above. No full suite or production build was run by this reviewer. The owner's separately reported 76/76 run is not counted as an independent execution here.

## Pixel evidence and integrity

The daylight, night and regenerated phase PNGs in `output/isometric-living/` were visually inspected. Species colors and silhouettes are generally distinguishable, and empty/reserved/buried slots remain visibly different. Individual fish glyphs are small and relatively subtle; this is a nonblocking readability limitation. Appearance at real browser sizes and devices remains unverified.

The images are stitched from the synthetic fixture's actual viewport source-coordinate marks. They are not browser screenshots, real-save screenshots or evidence of autonomous model behavior. The manifest's five source hashes and three PNG hashes were independently recomputed and matched after regeneration. Final reviewed hashes:

- `src/client/isometric-living.ts`: `1cc3ec5454a087d46bbdbc6783b67ed43f6629d43d1f2e59a61e8c28e3aa2f91`
- `src/client/isometric-pixels.ts`: `33f96a0d98ab91bcaa0d2804cc547a9dc94e78cb7af993974fcc2ceaddc712d7`
- `src/client/isometric-viewport.ts`: `dbeff70f79c3c45efb6328313795ad4f1d720b9e6fe360e413a1bca55e9c6b39`
- `scripts/isometric-living-fixture.ts`: `d56eecbba5f2bd52c395dafc7bb9b8cc9eaa69b993b8da373cded12e3af0eb07`
- `scripts/render-isometric-living.ts`: `2b9246692ba73d3072705b793f2085bd536ce339ed11d366daea146be5b07ed4`
- `synthetic-source-living-day.png`, 0 ms: `44b0b1288ec990d57ecd98aa911ad77e98ca2053cd51c26affe58613c6f2e879`
- `synthetic-source-living-phase.png`, 300 ms: `328a0d87ff62b51b7173706eb936be1c7d00530c51625616b64f0bbddc48f910`
- `synthetic-source-living-night.png`, 300 ms: `8f881c77e2a266e7cb3b483635887acf372278a18cd060466f8d088b766e82b2`

## Unverified boundaries

No browser was launched, and the prior Chromium IPC denial was not retried or bypassed. No environment file, credential, real save or model endpoint was accessed. There was no live-server or real GET/SSE acceptance in this review. Synthetic tests and offline VM adapters are not browser acceptance.

Still unverified: browser event propagation and visual layout, touch interaction, GPU rendering, mobile performance, real-snapshot attachment and live-world presentation. Non-home interiors, other building art, weather/disaster overlays, boats, complete fences and remaining placeholder categories are outside this batch. This review does not close those gaps or establish complete 1.0 readiness.
