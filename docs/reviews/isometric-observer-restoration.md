# Continuous isometric observer: independent restoration review

Scope: source and CPU-only review of the restored, opt-in development observer. This is not browser acceptance or a claim that isometric interiors are restored. The formal production entry remains the original 2D view.

## Evidence

`tests/isometric-observer-review.test.ts` provides independently constructed checks:

- Full-map terrain pixel oracle compared byte-for-byte with cached chunk crops at four fractional cameras, including chunk boundaries and a world edge. Separate inequalities verify the source image covers the exact display rectangle.
- A 22-cell-wide home spans several buckets. Its complete marks equal the direct home-art oracle while its anchor is outside visible bounds during three pans.
- A malformed active replacement must leave snapshot, scene, camera, animation clock, indexes and counters unchanged. A corrected replacement at the same revision succeeds, stale input does not roll back, and old scenes cannot animate against the new revision.
- The actual `main.ts` receive function and SSE update callback are transpiled in an offline VM and run with the actual `ValleyScene` methods using renderer spies. The callback uses `applyObserverUpdate`; the new snapshot is installed before room, follow and map notifications. Invalid map revision closes the stream and schedules reconnection without replacing the snapshot. No network connection is made.
- Delta patch reconciliation preserves unaffected resident identity and does not mutate the original position. Home, barn, clinic, workshop, school and lodge room-entry events all pass through to the original route and uncover 2D. Disposal clears timers and listeners.
- 257 colocated recorded grave slots produce exactly the object budget plus explicit omission count, stable selected identities after record reordering, and terrain-cache reuse. These are neutral record markers, not invented burials.

## Finding

The new neutral resident markers initially satisfied `followResident`'s object-exists check. An infant was correctly drawn as a question marker, but following returned success and stayed isometric instead of using the original 2D observer. The independent regression reproduces this. A related source concern applies to oversized home placeholders in `locateBuilding`. Both were reported to the implementation owner, who now excludes placeholder subjects from both success checks. The focused regression verifies infant follow falls back to 2D while retaining the same original resident identity. Implementation edits were outside this review's ownership.

## Validation status

After the owner's fix, the independent focused suite passed 7/7 with zero failures, cancellations or skips. This removes the reproduced source/CPU-level blocker; it is not browser acceptance. The final run took about 1.5 seconds. The initial failed run is retained as evidence that the placeholder regression detects the former behavior.

No real save, model, environment file, browser, IPC, network or server process was accessed. All test-tool temporary paths were restricted to `output/test-tmp/observer-review`. Only focused tests were run during the shared heavy-test exclusion window. No full suite, typecheck, build, git staging, commit or push was performed by this review.

Unverified: actual browser event propagation and pixels, responsive CSS, touch devices, GPU rendering, mobile performance, live server attachment and complete isometric room art. Existing native 2D room routes are a truthful fallback, not recovered isometric interiors.

## Additional outdoor categories and proxy review

The extension was compared directly with `Outdoors.accept`. Infrastructure, estate piles, prepared cultural events, household stock, shipment positions, pasture/projects, orchard records, crates, boats and registered shore positions use neutral one-cell markers, not invented facility art. Pastures explicitly identify their first recorded tile rather than imply fence geometry. Known dead/retired/indoor exclusions are preserved. Infrastructure uses its recorded asset anchor rather than the 2D sign's access tile; both are explicit source fields.

Two follow-up regressions were independently reproduced:

1. The proxy matched `/ai-town/api`, but the read-only middleware initially guarded only `/ai-town/api/`. Bare-prefix and adjacent-prefix requests could reach the upstream proxy without the world/events GET allowlist check. The regression tests the whole configured proxy prefix. No request was sent to a real server.
2. `crateLocation` can return a resident's or estate's old valley coordinate even when the source explicitly records a regional location. Rendering that coordinate as an actual outdoor crate would be misleading. The observer must suppress those positions rather than infer a local location. The independent test covers carried crates, estate crates and parcel crates with regional source records.

Both findings were fixed by the implementation owner and independently rechecked. The guard now matches the entire configured proxy prefix, with only exact world/events GET requests allowed through. Before resolving crates, the observer excludes explicitly regional resident/contact, estate and parcel containers. It neither changes the world helper nor substitutes a valley coordinate.

Final focused review run: **9/9 passed**, zero failures, cancellations or skips, approximately 1.3 seconds. The two new tests failed before these fixes and passed afterward. The optional livestock-cargo test types were corrected without running a build or typecheck. No remaining source/CPU blocker was found in this narrow follow-up scope. Browser and live-server limitations above remain unchanged.
