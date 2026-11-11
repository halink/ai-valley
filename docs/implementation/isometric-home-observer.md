# Home interior observer milestone

**Current extension:** [Lodge interiors and ordinary cooking](isometric-lodge-cooking.md) now also support the real `lodge` layout and a conservative gesture for an ordinary `cook` action at its actual kitchen. The home-only/unsupported-cooking statements below describe this earlier milestone; room types beyond these documented extensions and unsupported poses still fall back to 2D.

**Workshop extension:** [Workshop interiors and ordinary craft](isometric-workshop.md) add the authoritative workshop layout and verified table/bench batch gestures. Other workshop processes remain explicit fallbacks.

**Later integration:** The [optional formal client entry](isometric-formal-entry.md) provides an explicitly selected 2.5D trial in the ordinary page. It does not change the 2D default or complete the browser, room-coverage and performance gates described here.

This is the next optional client milestone after the continuous outdoor restoration. The formal default remains the original 2D renderer. The live development entry still reads the existing GET/SSE feed and cannot issue world-control requests. No server, simulation, storage or model implementation is changed here.

## Usable slice

A supported home with an actual `world.rooms` record can now be observed in isometric room coordinates. Its floor dimensions, entry, beds, table, kitchen and workstation positions come from the same `roomLayout` used by navigation. The `care` navigation target is not drawn as an installed facility. Furniture art does not invent food, tools, fire, inventory or completed work.

Living residents use their actual `inside` and `roomAt`. No resident position is inferred from their home, assigned bed, entry or requested destination. Selecting a resident retains the original identity and inspector. Room hit labels identify the local coordinate space. Supported states, including a simple lying pose only for confirmed sleep, use the original `personVisual` evidence; unsupported states remain marked explicitly, and following such a resident falls back to 2D rather than pretending the pose is rendered.

The original follow state now carries one resident through outdoor walking, actual home entry, movement within that home and actual exit without switching renderers. Manual home entry and exit continue through original scene routes. Escape or the 2D switch retains the current room and selected/followed identity. Nonhome rooms, missing precise positions, missing room records and invalid/oversized layouts retain clear 2D fallback.

Dragging is cancelled when a scene changes or a navigation route is activated. Outdoor and indoor camera coordinates remain separate. Resizing inside a room preserves its local center and updates the saved outdoor camera independently, so leaving the room does not pass local room coordinates to the world camera. Drawing and picking use the exact constrained camera returned by the active renderer.

## Data coverage and limits

- Native room art covers supported home furniture and resident states only. Other room types are not presented as homes.
- Real indoor estate/tool piles, livestock, crates and installations without restored art use neutral record markers at known coordinates. Building-only storage records, prepared events without an exact location and missing resident locations are counted as unknown rather than placed at an entry or table.
- Regional cargo and records with conflicting custody/location are not silently relocated into the room. A marker does not assert a burial, activity, quantity or successful transaction.
- Unsupported household assets, cultural decoration, workstation detail, detailed animals and special resident poses other than sleep still need fuller art and interaction coverage before a formal production switch.
- The renderer shares the existing frame/object/chunk budgets. Floor chunks are reusable, resident pose evidence is cached per accepted snapshot, and animation visits only admitted visible entries. A new accepted snapshot still scans source records; this is not a fully incremental whole-page renderer.

The paused synthetic opening produced by the isolated preview server does not yet contain engine-initialized room state. It therefore correctly uses 2D for room views. Home isometric rendering is available once the actual source supplies room records, including the ordinary-engine offline route fixture and a normal initialized live world. This batch does not manufacture room records merely to make a paused preview look complete.

## Evidence and release gate

The offline route uses ordinary engine plans and steps for cross-block walking, gathering, entering the home for water-supply work and leaving again. An additional ordinary-engine sleep plan verifies that the lying pose appears only after actual bed arrival, never during the indoor approach. Tests compare each resident's source coordinates and identity against the rendered subject and freeze snapshots to detect writes. These are scripted synthetic engine states, not autonomous model behavior.

Additional checks exercise room/outdoor camera restoration, resize, pause/disconnect/visibility, pointer capture, manual navigation, retained follow identity, missing exact position, nonhome fallback, malformed snapshots, old scenes, deterministic budgets and pixel-level crop/hit consistency. An independent review also combines the actual main receive function, actual ValleyScene methods and the development observer in an offline adapter. None of these are browser, touch, CSS or GPU acceptance.

Formal activation remains blocked on full object/pose/room coverage or explicit product acceptance of each fallback, real browser and touch round trips, read-only live lifecycle checks, whole-page CPU/GPU measurement and the coordinated integrated regression/build. Do not switch the production default solely because source/CPU tests pass.

### Focused acceptance result

Six related test files passed **83/83**, with zero failures, cancellations or skips. This includes **16 independent review checks** and **12 interior renderer checks**. The controller's cached room label also prevents status painting from scanning the building list on animation frames. A type-only annotation was subsequently added to an independent test's screen point; no assertion or implementation logic changed. Coordinated whole-repository type/build/full-suite results are reported separately.

The next defensible connection to the formal entry is an explicitly opt-in observer switch, with 2D still the initial and fallback renderer, after integrated checks and real-browser round trips pass. Making isometric the default is a later decision requiring coverage of nonhome rooms, missing object art and remaining poses, rather than merely moving this development button into the formal page. No formal switch is made in this milestone.
