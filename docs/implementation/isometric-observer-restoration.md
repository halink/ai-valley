# Continuous observer restoration, first usable batch

**Later integration:** The [optional formal client entry](isometric-formal-entry.md) now reuses the same observer through an explicit adapter and idempotent installer. The default remains 2D. Statements below about production excluding the renderer describe this historical restoration batch, not the later entry candidate; browser/touch/GPU acceptance remains unclaimed.

This restores a runnable, opt-in outdoor observer on the current checkout. The earlier isometric commits are not present in this repository's object database. This batch reconstructs reusable client modules rather than claiming that those lost implementations have been recovered. It does not change simulation, model, storage or production startup behavior.

## Run locally

All commands are run from the repository root. Neither command loads an environment file or real save.

1. In one terminal: `TMPDIR="$PWD/output/test-tmp/observer-restore" node --import tsx scripts/dev-observer-server.ts`
2. In another: `node scripts/dev-observer-web.mjs`
3. Open the printed local `/ai-town/` address. The original 2D view is the default. Choose **连续等距** explicitly.

The isolated backend serves a newly constructed, paused frontier world on loopback port 3413. It does not run the simulation or a model. The page labels this source as a synthetic paused opening, not autonomous behavior.

For an already-running formal service, use `node scripts/dev-observer-web.mjs --live` instead of step 2. This selects the existing loopback service on 3412; it does not start it. The development proxy permits only GET `/ai-town/api/world` and GET `/ai-town/api/events`. Other API paths and methods are rejected. It reuses the original main client reconciliation, full snapshot retrieval, SSE update processing and reconnection logic. Live attachment has not been exercised against a real save or model. No arbitrary endpoint or credential option is accepted.

The development HTML injection applies only to this isolated Vite server. The ordinary HTML, Vite configuration and production entry never import the optional renderer. The production 2D default remains unchanged.

## What works in this batch

- Continuous outdoor world coordinates, pan across former 16-cell boundaries, wheel/button zoom and keyboard pan.
- Original identities and exact recorded positions. Resident, building, project and ecology marker selections open the original inspector. Other markers show their record ID, coordinate and limitation.
- Original follow state is reused. Supported outdoor residents recenter the isometric camera. Actual room entry, regional travel or unsupported resident art returns to original 2D while preserving the followed identity. All original room-entry routes pass through unchanged. Leaving a room remains in 2D until the user explicitly opts back in.
- Native home locating, manual tile locating, home reset and 2D camera handback. Unsupported building locating, atlas, region, project and animal locating use original 2D.
- Shared projection and pixel-based picking, full cross-chunk home geometry, deterministic object ordering, integer source rasterization and nearest-neighbor display.
- Display animation freezes on world pause, disconnection, hidden page or inactive view. New same-world snapshots do not continually reset the phase clock. Animation is a display phase, not proof of success or production.
- Invalid active replacements preserve the last accepted controller/viewport state, disable the optional view and reveal original 2D. A later valid snapshot permits retry.

## Coverage and honest fallback

Detailed art currently covers terrain, home buildings within the art-size limit, resource trees, plots/crops and a subset of outdoor adult/child resident poses. Existing study art is reused, not a new simulation representation.

Neutral amber question markers represent records that lack restored art: other buildings and oversized homes, unsupported residents, non-tree resources, grave slots, living outdoor livestock, living beasts, nonempty recorded fish pools, reserved unfinished construction, relevant active infrastructure, outdoor estate/tool piles, prepared uncleared cultural events, active household storage, transport cargo, nonretired pastures, built unfinished pasture projects, uncut orchard trees, outdoor livestock crates, boats and the registered fishing shore. Grave markers do not assert a burial. A pasture is represented at its first recorded tile and explicitly does not depict its boundary or fence. Markers do not impersonate buildings, animals, goods or actions.

A known integer position inside the world produces a marker. Unknown or invalid positions are counted rather than guessed. Crate positions use the same pure location resolver as 2D; recorded indoor and regional crates are not placed outdoors. Retired, removed and dead records are filtered according to the outdoor category. Some nonempty fish pools and transport records have no outdoor location; they remain in the explicit unknown-position count. The tray reports current marker count, all accepted placeholder records, unknown locations and budget omissions separately.

Interiors, special resident poses, animal art/behavior, nonhome architecture, boats and facility-specific scenery are not complete isometric views. Full-map and regional views remain 2D. Weather effects, flood overlays, decorative plot posts, detailed fences and all original work-feedback effects are not restored. These gaps are visible in the scope notice and this checklist; this is not production 2.5D acceptance.

## Budgets and cost

- Visible inverse world bounds: at most 40 cells per axis under the constrained camera.
- Terrain: 8×8-cell LRU chunks, at most 64 chunks / 100,000 cached marks, at most 28 marks per terrain cell. The cache signature includes a one-cell neighborhood and season.
- Frame: at most 192 admitted objects and 60,000 marks, with 1,024 marks reserved per admitted resident. Omitted nearby candidates are counted.
- Static terrain and object poses are reused for animation. Panning the same accepted world does not rebuild global indexes. A new world snapshot still validates the tile array and scans record collections once to build indexes. This is not an incremental world-index implementation.
- The optional canvas caps its backing size at 2560×1600. The original Phaser loop sleeps while covered, but original snapshot acceptance and 2D scene preparation still occur. CPU-only renderer budgets do not prove whole-page or GPU performance.

## Offline evidence and remaining release gates

`isometric-observer-route.ts` constructs a fresh frontier world, then submits ordinary engine plans for cross-block walking, gathering water, entering a home for water supply and walking outside again. Only the clock is initially unpaused. Positions, rooms, inventory and activity are produced by normal `submitPlan` / `stepWorld`. This is a scripted engine fixture, not autonomous model decisions or a recording of a live world.

Focused tests cover that engine sequence, frozen-input behavior, identity/follow/room fallback, malformed and stale data, pause/disconnect/visibility, pointer cancellation, original routes and clean disposal. Independent review adds whole-map pixel oracles at fractional crops, complete cross-bucket home marks, exact budgets, real main SSE callback and real ValleyScene notification ordering, invalid-map reconnection and delta identity preservation. The DOM adapter is a test double, not a browser.

Before changing the formal default:

1. Complete or explicitly approve every marker-only art category, missing overlay and room type. Keep original identities/coordinates and action-position checks; never replace absent states with attractive invented behavior.
2. Exercise a real browser on desktop and touch/mobile: click/drag capture, keyboard focus, overlapping panels, resize, source crop edges, occlusion, original room round trips and free-camera handback.
3. Exercise the read-only live GET/SSE route with actual server lifecycle, disconnect/reconnect, world replacement and large delta streams. Verify it cannot issue writes.
4. Measure total page/GPU memory, frame time and snapshot processing under realistic large-world density and long pan/follow sessions. Verify original scene preparation does not dominate.
5. Complete integrated typecheck, production build and full offline regression under the parent-coordinated test window; record exact commands and results. Preserve a verified local source backup before any serial commit. Do not push as part of this batch.

No actual browser, mobile, GPU, live-model or real-save acceptance is claimed.

### This batch's focused result

The final four-file run (`isometric-study`, `isometric-viewport`, `isometric-observer`, `isometric-observer-review`) passed 50/50 tests with no failures, cancellations or skips. The independent reviewer reproduced and then verified fixes for placeholder follow fallback, the proxy's entire-prefix read-only guard, and regional crates incorrectly inheriting old valley coordinates. Its final standalone suite passed 9/9. These results are CPU/VM-only; integrated build and full-suite results are recorded separately when their serial window is available.

Serial integrated validation also passed: `tsc --noEmit`, `tsc -p tsconfig.server.json`, the production Vite build and a separate bundle of `src/client/development-preview.ts`. Both Vite calls explicitly set `envFile:false`; the development bundle also disables ordinary config/public loading. The first standard build stopped at typechecking before Vite because a migration contact may have no `person`; the observer's regional-cargo guard now checks that case. The four-file focused suite was rerun after this correction and again passed 50/50. Both bundles retain a >500 kB chunk warning. Production output contains no optional isometric renderer entry. A full integrated offline suite and actual browser acceptance remain separate release checks.

### Later living-world batch

The marker-only animal, fish and grave coverage described above is the historical first restoration batch. [Living-world observation](isometric-living-observer.md) now adds six wildlife and five livestock species, recorded fish-species glyphs and empty/reserved/buried grave slots in the same optional continuous renderer. Original IDs and recorded positions remain authoritative. Unsupported or inconsistent records still have explicit markers/counts, and source-native synthetic images remain distinct from browser acceptance.
