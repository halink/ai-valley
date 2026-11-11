# Storybook rendering foundation: independent CPU review

Reviewed the uncommitted foundation on base `d305264`, including `storybook-geometry.ts`, `storybook-assets.ts`, their two focused test files, and the added pure `placeStorybookAsset` wrapper. Read repository contribution/test instructions. This is a metadata and geometry review, not renderer or artwork acceptance.

## Conclusion

No blocking defect found in the reviewed scope. The new four-cardinal mapping preserves northeast/southeast/southwest/northwest independently; it does not reuse the legacy collapsing facing helper. Projection is fixed at 32×16 and inversion takes the same known elevation. World occupancy, world ground anchor, and frame-local image foot remain distinct. The placement wrapper rejects a manifest/world footprint mismatch and missing directional selection instead of resizing occupancy or inventing a direction.

The explicit pack/version pin, exact schema keys, local atlas path grammar, four directional entries, bounds checks, detached frozen results, and accessor rejection are covered by tests. Provenance and SHA-256 remain declarations: this parser neither loads files nor verifies pixels, digest bytes, or legal rights.

## Independent counterexamples and checks

Added `tests/storybook-render-review.test.ts` with five tests:

- A genuine four-object constraint cycle, reproduced across all 24 input permutations. The fallback reports the unresolved predecessor rather than claiming a physically valid order. A simultaneous positive-area overlap remains reported separately.
- 150 seeded seven-object scenes: every reversed ordering constraint is exactly accounted for by cycle-break reports, every positive-area footprint overlap is listed, and reversing input order preserves results.
- Four distinct directional atlas rectangles through the parser and placement wrapper; no shared-frame fixture can conceal an incorrect direction choice. Ground foot stays fixed while image feet differ. Missing/invalid direction and occupancy mismatch fail.
- Nonenumerable/extra/symbol array or frame metadata and directional getters are rejected without executing those getters.
- 3,721 negative, positive, and fractional coordinate pairs roundtrip with known elevation.

## Executed

From the repository root, with `HOME` set to `output/storybook-render-foundation/review-home` and `TMPDIR`, `TMP`, and `TEMP` set to `output/storybook-render-foundation/review-tmp` (absolute paths in the actual shell):

```sh
node --import tsx --test tests/storybook-geometry.test.ts tests/storybook-assets.test.ts tests/storybook-render-review.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

- Final focused test run: **89 passed, 0 failed, 0 skipped**.
- TypeScript check: **exit 0**.
- Earlier pre-wrapper baseline: 83 focused tests passed. Two bounded inline seeded searches were used to locate a cycle; the useful cycle is now a permanent independent test.
- Logs: `output/storybook-render-foundation/review-tests.log` and `review-types.log`.

## Not executed or established by this review

No full repository test suite or production build was independently run. No scene/browser startup, screenshots, image generation/loading, visual quality approval, animation, hit-testing against tall image silhouettes, performance benchmark, final asset approval, or renderer integration acceptance. The depth algorithm's diagnostics do not solve arbitrary overlapping/cyclic artwork. No network, credentials, real saves/runtime, or protected personal-food-gift candidates were read or modified. Only the independent review test and this report were added; generated test-tool files/logs stayed under the designated repository output directory. No commit or push.
