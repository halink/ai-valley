> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# MVP resident action presentation

The renderer does not execute actions or predict successful outcomes. The engine
(`src/world/engine.ts`, `advanceActivity`) first moves through `activity.room.path`
and `activity.path`, then performs on-site work against `remaining`. The real MVP
drinking action is `mvpDrink`, not `drink`.

The Godot resident now has these deliberately narrow presentation states:

- Walking: alternating arm/leg swing **only during validated completed-movement
  feed playback**, with phase bounded to that replay. A queued future path never
  starts gait; unsupported indoor movement still snaps, without invented gait.
- `gather`: both hands reaching forward.
- `eat`: one hand raised toward the mouth.
- `mvpDrink`: a more raised hand-to-mouth pose. No invented cup or consumable mesh.
- `sleep`: bowed resting head only when an authoritative indoor `roomAt` exists.
  No inferred bed, lying animation or teleport is added.

On-site poses require empty outdoor and indoor paths, positive finite remaining
work, and no room-exit phase. These are **static illustrative poses**, not a
claim of animation polish or successful consumption/resource gain. Unknown,
missing, finished or unsupported activity resets all parts to their original
transforms. Pause, lost continuity and existing disconnect/error handlers reset
presentation. Mesh child transforms change; the authoritative resident root,
selection ring and simulation coordinates do not. Existing triangle picking
uses the current child transforms, not stale proxies.

Validation: `node scripts/test-godot-headless.mjs` imports clean resources and
runs the offline synthetic suites, including action-phase/reset/root tests and
motion interruption checks. No real model, save, HTTP simulation, GPU rendering
or long-run acceptance is implied. Visual quality remains to be checked in a
real Godot window; this is a bounded first pose pass, not a complete character
animation library.
