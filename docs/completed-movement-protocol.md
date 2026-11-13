> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# Godot MVP completed movement feed (protocol v1)

This is an **optional, read-only, transient observation field**, not a control
API or a planned-path API. Both small-world GET snapshots include `movement`.
Old saves and old consumers need no schema migration. Nothing is added to World,
SQLite history, model prompts, or resident decisions. The older full-world
server does not opt in. The backend checkpoint originally provided the feed alone.
The Godot client now validates and consumes it for bounded multi-cell playback:
at most 16 completed steps per resident and 1.4 seconds of presentation lag.
A new batch arriving during playback snaps to the latest authoritative position
instead of extending the queue. Missing, invalid or truncated evidence, changed
world/map/epoch, pause and connection interruptions also snap rather than infer
routes. Legacy snapshots without `movement` remain supported without playback.
See the client README for synthetic verification evidence; this is not native
window, GPU, real-model or long-running acceptance.

The engine records each actual outdoor grid-cell settlement **after** the
walkability check and movement budget succeed. `activity.path` is never exported
as evidence. A blocked attempted step produces no event. Engine narrative events
do not provide this per-cell record. Roads may settle multiple cells in one tick;
each successful cell is recorded, including corners. Indoor/transport motion is
not covered and must not be interpolated as walking.

`movement` contains:

- `version: 1`, `worldId`, authoritative snapshot `revision`.
- `epoch`: random observation-session identity, reset after restart, world/map or
  building-footprint changes, revision/minute rewind, or unobserved actor changes.
- `firstSeq`, `lastSeq`: inclusive global sequence range. Empty feed has
  `firstSeq = lastSeq + 1`. Sequence is global across residents, not per resident.
- `limit: 256`, `steps`: ordered `{seq, actorId, minute, from:{x,y}, to:{x,y}}`.
  All steps are completed cardinal adjacent cell transitions. `minute` is the
  engine settlement minute, not wall-clock animation duration.

There are at most 256 steps per enabled world. At most 4096 tiles, 64 residents,
64 buildings are supported; exceeding the bound disables this optional field.
No per-client buffers or request-triggered simulation are created. Runtime
transaction drafts receive independent observer state: failed durable commits
cannot publish speculative steps. Restart starts a new empty epoch even for the
same saved world. Snapshot buffers are detached from live observation storage.

## Required consumer rules (before enabling playback)

1. First connection/reconnect/new world/new epoch/new map: snap to current
   authoritative positions and remember `lastSeq`. Never replay old backlog.
2. Reject older revisions and duplicate snapshots. Require version/identity/
   revision agreement, finite integer coordinates, in-bounds steps, strictly
   contiguous unique sequences, and bounded counts. An absent/invalid feed is
   compatible with older servers: snap, do not guess.
3. Replay only unseen sequences after the previous accepted `lastSeq`. If this
   range starts before `firstSeq`, history was truncated: snap to the endpoint.
   Sequence gaps are global; filtering by actor before checking gaps is wrong.
4. For each resident, require the complete chain to start at its **previous
   authoritative** outdoor coordinate and end at the new authoritative outdoor
   coordinate, with every next `from` equal to preceding `to`. Reject any chain
   with missing resident, indoor transition, geometry change or endpoint mismatch.
   Never fill missing intermediate positions with a straight line or planned path.
5. Stale/failed HTTP, disconnect, pause, world switch and reconnect cancel queued
   animations. Bound pending animation length and lag; if a new batch cannot
   safely append, snap. Animation is delayed presentation, never world authority.

The Godot consumer enforces these rules even though the server conservatively
resets on unsupported transitions. Tests here are synthetic real-engine unit and
local HTTP tests, **not real-model or visual/long-running acceptance**.

Run `node --import tsx --test tests/completed-movement.test.ts
 tests/godot-mvp.test.ts tests/godot-mvp-persistent.test.ts` as one command.
