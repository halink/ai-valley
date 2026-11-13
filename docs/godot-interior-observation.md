# MVP indoor observation slice

## Data contract and scope
The two small-world servers expose optional `roomViews: {worldId, revision, rooms}`
with home/lodge layouts derived directly from shared `roomLayout(world, building)`.
It is read-only, not persisted, and does not change simulation plans or positions.
Godot accepts layouts only for the exact full snapshot identity and revision.
The formal large-world endpoint is unchanged; missing projection never creates a
speculative layout. Limits are 64 rooms, 64×64 cells, 128 slots and 4096 obstacles.

`roomAt` is a separate room coordinate system, **not** scaled outdoor coordinates.
Only alive locally-resident occupants with valid integer roomAt in the server's
resident room domain are rendered. Unknown positions remain unknown. Rooms are
selected explicitly; no automatic camera following or resident control is added.
Only observed positions update; no route interpolation across room walls, invented
furniture, or sleeping animation is claimed. Beds use the layout's blocked footprint;
other blocked cells have neutral markers. Far walls are retained; near walls are cut
away. Current actions and details remain server-derived, including no-action states.

## Validation and boundaries
- Offline Godot regression covers entry/exit, valid/unknown coordinates, dynamic
  positions, two snapshot identity fields, bounded geometry, old revision through
  the actual receive handler, transport failure, and world change.
- Live local HTTP short test advances the real rule-driven small-world engine for
  180 simulated minutes and checks every projected layout against roomLayout,
  two bed slots, and actual changing indoor coordinates. No model calls or real saves.
- Existing persistent server tests use isolated temporary databases only.
- Independent review caught overly permissive resident coordinates and a wall
  intersecting first-row beds; both corrected before commit.
- No DISPLAY is configured here. GPU desktop appearance and human usability remain
  unverified; headless checks are not a substitute. Long-run real-model acceptance
  stays with the user. GitHub push remains pending separately; this slice is local.
