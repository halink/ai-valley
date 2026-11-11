# Home interior observer: independent review

Scope: the opt-in development observer's residential interiors, continuous follow between the same outdoor and indoor world records, and return to the original 2D observer. The formal default remains 2D. This review changes only `tests/isometric-interior-review.test.ts` and this document, apart from test logs under `output`.

## Findings and resolution

1. **A captured drag could outlive a navigation-induced coordinate-space change.** The capture-phase locate, tile and follow routes changed the preview's room before the original room callback ran. Its later prior-room comparison could no longer detect that transition, leaving the old drag origin attached to the new space. The implementation owner now cancels capture before all recognized navigation routes. Independent regressions cover those three routes and automatic entry/exit while a pointer is captured.
2. **Home reset had different highlight behavior indoors and outdoors.** Previously, only the indoor reset called the original frame/watch-tile route. An outdoor reset stopped following but retained the original scene's selected highlight. The owner now sends both through that existing route. The independent test verifies room exit, cancelled follow, cleared original highlight and the world-space home frame in both cases.
3. **Same-world layout changes require one display/picking camera.** The owner corrected controller rebuilds to publish the constrained camera returned by the renderer. The independent regression shrinks a room while the camera is near its former edge, checks the new bounds, and compares controller picking against the renderer's actual display camera.

No unresolved source/CPU blocker was found in this scope after these changes. This is not a browser, full-repository or production-release approval.

## Independent evidence

The 16 tests independently cover:

- The real `isometricObserverRoute` fixture, produced by `submitPlan` and `stepWorld`: the same person moves across outdoor blocks, enters the actual home, appears at the recorded `roomAt`, and exits again. All snapshots are frozen during observer use; identities, coordinates and simulation data remain unchanged.
- Missing, nonfinite and out-of-bounds indoor locations stay unknown. Neither `homeId`, a bed, an entry point nor a stale outdoor coordinate creates indoor occupancy. Unsupported room kinds, missing room records, extreme dimensions and duplicate station slots fail closed with an explicit reason.
- A separate real-engine sleep plan records indoor approach before actual sleep. The approach remains upright. Only the original `personVisual` sleep evidence produces the lying pose at the recorded point; missing coordinates and infant art still request fallback. The display does not assert bed occupancy or complete the action.
- Actual `main.ts` receive and click-handler source, actual `ValleyScene` methods, and actual `development-preview.ts` are composed with renderer, DOM and timer spies. The current snapshot is installed before room/follow callbacks, and the room callback precedes the ordinary map notification. Original manual enter, locate, tile and exit routes retain their scene behavior.
- The event adapter explicitly invokes capture, original bubble and after-route handlers in that order. This exercises application logic; it does not prove browser propagation, pointer-capture APIs or CSS behavior.
- A manual indoor switch to 2D retains the original room camera and never sends room-local coordinates to the world camera. Resizing indoors preserves a separately saved outdoor center, which is restored on exit. Ordinary home corners fit the checked desktop, landscape and phone viewport sizes, within the source-image and mark budgets.
- Unknown-position follow, a non-home room and an oversized replacement uncover original 2D without changing the original resident or room. A later valid replacement can be enabled again. Replacing the entire world clears the old followed identity and room safely.
- Duplicate-record rejection leaves the previous preview snapshot, scene, camera and interior counters unchanged. A corrected snapshot at that revision succeeds. Old scenes are inert after their renderer accepts a new room/world/revision, and foreign renderer scenes cannot be used for animation.
- Dense colocated occupants respect object/mark budgets, count omissions, copy position identities, retain deterministic ordering after record reordering, and select the foremost painted resident pixel. Later display animation remains within the mark budget.

## Validation

Final independent result: **16 passed, 0 failed, 0 cancelled, 0 skipped**, approximately 8.0 seconds.

Command, from the repository root:

```sh
env -i PATH="$PATH" \
  HOME="$PWD/output/test-tmp/home-interior-review" \
  TMPDIR="$PWD/output/test-tmp/home-interior-review" \
  TSX_DISABLE_CACHE=1 \
  node --import ./scripts/acceptance-offline-guard.mjs --import tsx \
  --test tests/isometric-interior-review.test.ts
```

Final log: `output/test-tmp/home-interior-review/independent-final.log`.

The first run was 7/10 because three fixtures incorrectly assumed the initial frontier snapshot already contained `rooms`. They were corrected to use the actual engine's post-exit snapshot, which contains those records. No production behavior or assertion about missing room records was weakened. Later focused runs passed 10/10, 12/12 and 13/13 before the final sleep, fit and home-reset checks were added.

No model, network, real save, environment file, credential, browser, browser IPC or server was used. No git index change, commit, push, full test suite, typecheck or build was performed by this reviewer. Temporary tool state and logs stayed below repository `output`.

## Still unverified

Actual browser pixels and event propagation; mouse and touch cancellation on devices; mobile layout and overlays; GPU/page memory and frame time; live SSE/server integration; non-home interiors and all unsupported poses; complete art, floor plans and lifecycle behavior. The legacy 2D renderer is the truthful fallback for unsupported states, not evidence that those states have acquired isometric art.
