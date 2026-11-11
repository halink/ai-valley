# Independent review: optional school interiors

## Findings

Reviewed the extension against base `f00f772`, shared `roomLayout`/`actionRoom`, person pose rendering, education settlement and the scripted school route. No school-specific correctness blocker was found. Reviewer-owned changes are this document and `tests/isometric-school-review.test.ts` only.

School interiors reuse the authoritative room dimensions, table, static kitchen and existing people at exact `roomAt` coordinates. School capacity does not create beds or increase the room height; small schools retain the shared 13-row minimum. Care is a navigation point, not furniture. No desks, blackboard, books, students, teaching gestures or progress visuals are invented. Original people retain source appearance and neutral pose marks, with an explicit disclaimer that presence does not imply teaching, progress or completion. Installed stations outside supported workshop art remain honest markers.

## Independent coverage

Ten source/CPU tests cover:

- Exact shared layout and original slot positions, very large non-bed capacity and the 13-row minimum.
- Malformed dimensions/capacity, oversized rooms, missing layout records and duplicate/unknown station keys fail closed.
- Exact original person marks, no education-record-driven art, and unrendered station markers.
- Original-ID picking and room coordinates; deeply frozen source snapshots remain unchanged; failed replacement is atomic and stale scenes cannot animate.
- Unknown positions, unsupported infant poses and unsupported building types hand back to 2D without losing follow identity or room.
- Pause, hidden-document and disconnect freezing; 700-person synthetic crowds remain within object/mark/cache budgets, with deterministic admission and no tick-time pose/bucket/floor rebuilding.
- Exact fixture provenance: comparison of the complete setup world against the seed proves that only one school building and the pause flag change. All original residents, coordinates, skills, possessions, money, knowledge and other world state remain identical. The school uses `building/school@1` on the teacher's existing parcel and keeps the teacher as owner.
- Real engine settlement: teacher alone produces zero learning, payment or material use. Enrollment reserves 12 coins from the learner. Shared work consumes one wood and one stone, reaches 30 minutes/6 coins at halfway, remains incomplete at 59.75 minutes, and completes at 60 minutes with 0.25 skill and 12 coins. Tuition follows the authoritative proportional integer formula; materials are not consumed again.
- Both original participants use actual action-role targets, enter and exit through engine movement, retain `ValleyScene` follow identity and room, and release pointer capture on transitions. Default 2D is preserved, as is explicit 2D handback.
- Neutral marks are checked during solo attendance, first shared work, halfway learning, just before completion and completed learning. These stages do not acquire fabricated gestures or props.

## Provenance and limits

The route creates `createFormalWorld(5402)`, explicitly adds one synthetic school on an existing teacher-owned parcel and unpauses. Ten scripted plans for original `founder-1-1` and `founder-1-2`, executed through `submitPlan` and `stepWorld(.25)`, produce discovery, posting, enrollment/escrow, travel, role positions, shared learning, settlement and exit. It does not prove school construction by agents, autonomous decisions, model behavior or live-world learning acceptance.

Negative tests intentionally mutate clones of route snapshots. The crowd test fabricates 700 people solely to test bounded rendering. Neither represents real residents or live classroom attendance.

DOM/canvas and Phaser adapters test source behavior, not browser layout, native pointer propagation, touch, GPU, GET/SSE lifecycle or complete renderer parity. This review includes the source-native diagnostic pixel inspection below, but does not claim browser screenshots or full-suite acceptance. No network, model, service, real save, keys or environment files were used. No bubblewrap retry, staging or commit was performed. The reviewer did not modify the five preexisting personal-food-gift candidate files or production implementation.

## Independent pixel inspection

Opened both actual PNGs with the image viewer: `output/isometric-school-interior/synthetic-school-room.png` and `synthetic-school-original-people.png`. Both visibly carry **SYNTHETIC / NOT BROWSER**. The complete-room view shows the bounded wood floor, one empty shared table, a static unlit kitchen and two original neutral figures. There are no beds, extra classroom desks, books, blackboard, invented attendees, teaching gestures or visual progress indicators. The enlarged view shows the same empty-handed figures with distinct source appearances beside the table. It intentionally crops the room and part of the kitchen, so it does not establish whole-screen fit.

Read the manifest and generation source. The script selects the route's `half-learning` snapshot at minute 640.25, invokes the production interior renderer and source rasterizer at elapsed phase zero, and encodes integer-scaled PNGs. The manifest identifies precisely the kitchen, table and original residents `founder-1-1` at (8,5) and `founder-1-2` at (6,8), with the no-teaching/no-progress disclaimers. It discloses the one synthetic school and unpause fixture; it does not claim that the seed already contains a school or that autonomous agents built one. Independently recomputed all five source hashes and both PNG hashes; all match the manifest.

These pixels are consistent with the source and narrow visual claims. They are synthetic source-native diagnostics, not browser, animation, native pointer, touch, GPU, live-state or model acceptance evidence. Static pixels do not independently prove learning or settlement; the separate engine tests provide that evidence.

## Reproduction and result

Run from the repository root with the existing task-local compatibility shim. The shim restores `fs.realpathSync.native` to the already guarded `fs.realpathSync`; it does not remove the offline guard.

```sh
env -i PATH="$PATH" \
 HOME="$PWD/output/test-tmp/school" \
 TMPDIR="$PWD/output/test-tmp/school" TSX_DISABLE_CACHE=1 \
 node --import ./scripts/acceptance-offline-guard.mjs \
 --import ./output/test-tmp/school/guard-native-compat.mjs \
 --import tsx --test tests/isometric-school-review.test.ts
```

Final focused run: **10/10 passed**, zero failures, skips or cancellations. Reviewer-file whitespace validation passed. Typechecking and broader focused regression results are reported separately by the implementation owner; this review does not claim to have run them.
