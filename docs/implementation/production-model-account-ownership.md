> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# Persistent model account ownership (disconnected primitive)

## Status and scope

This is a low-level coordination primitive, not a supervised production launcher.
Neither `main` nor the reviewed runtime imports it. Real model startup remains
closed. The implementation and tests use no credentials or real-world archives.

All cooperating launches for the same SiliconFlow account, including different
world directories and different API keys, must receive the **same canonical
private registry directory and stable accountScope**. The accountScope is an
operator-supplied label, not account authentication and not an API key hash.
The guarantee is limited to cooperating processes on one Linux host with a
supported local filesystem. Other registry directories, other account labels,
other hosts and noncooperating processes bypass it. This is not a distributed
account-wide quota or a provider zero-charge guarantee.

## Lifecycle

- Acquire a runtime OS lock and durably reserve the run ID in SQLite before any
  future caller starts execution. Registry files are private; symlinked paths,
  unsafe permissions, corruption and unsupported locking fail closed.
- Live contenders fail without taking over or deleting another process's lock.
- `abandon()` releases local resources but preserves the unresolved reservation.
  Process death also releases the OS lock without clearing the durable reservation.
- A subsequent launch refuses an unresolved run. There is no timeout-based
  takeover, automatic retry or automatic reconciliation.
- `closeClean()` is a **trusted caller operation**. The caller must first verify
  child termination and durable, matching, pending-free world/journal state.
  The primitive does not itself inspect a child or world. Aborting an HTTP request
  locally does not prove the provider did not execute it.
- Explicit reconciliation records a trusted operator's external disposition and
  an evidence reference. A SHA-256-shaped string is only a reference, not proof
  of provider confirmation or zero cost. It does not clear a world journal or
  retry a request. Used run IDs cannot be reused.

## Remaining integration

A fixed supervised worker entry, independently checked terminal journal/world
state, bounded shutdown and parent crash handling are still required. Do not
expose `closeClean()` as an automatic success path merely because a child exits
with code 0. No live acceptance or long-duration acceptance is claimed here.

## Verification

`node --import tsx --test tests/production-model-account-ownership*.test.ts`
uses disposable synthetic registries and subprocesses. The initial suite covers
live contention, clean release/run-ID reuse rejection, SIGKILL recovery refusal,
explicit disposition, unrelated scopes, and canonical/symlink path rejection.
See the review document for independent findings and final verification scope.
