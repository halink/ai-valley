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

## Canonical quota binding rehearsal

A separate opt-in bridge attaches the durable shared resident/yearbook quota to the original in-process account ownership object. It refuses copied handles, mismatched account scopes, caller-supplied quota paths, and a moved canonical registry. The quota file derives from the same canonical registry/scope as the process reservation. After enrollment the registry requires an attached quota handle even on later runs; an old launcher cannot pass its normal ownership check without it.

The handle cannot certify a clean local release until resident waiters, reservations, and unknown handoffs in its own durable file are clear. That check is additional to the supervisor's independently checked child termination and world/journal completion; neither one attests actual account identity, bill, or remote request. Clearing an unresolved process record explicitly does not erase quota uncertainty, and reopening cannot recreate a missing previously allocated quota file or substitute a copied file with the same quota/policy. Authorized backup migration needs an explicit recovery design; inode pinning is not an authenticated cross-host identity. No default callers attach the handle, and the guarded supervisor/provider dispatch is not wired to it.

Rehearsal-only, isolated local unit evidence: forged and mismatched handles refused; shared resident priority and completed metering; canonical owner lifecycle; pending quota blocked clean release; across reopen and process-level reconciliation, prior unresolved quota remains and legacy path cannot bypass enrollment. No real account, credential, transport or provider call.

### Recovery of one proven completed quota request

The disconnected quota rehearsal now allocates a stable account-scoped request identity and durably pins it to the creating run before a shared quota row may be allocated. A replacement run cannot reuse a request ID or settle its predecessor's row. Earlier raw, unpinned fixture rows are not upgraded by guessing their origin.

An operator can record externally reviewed completion and explicit usage for one sent-unknown request **while the original process run still remains unresolved and has no live owner**. The API acquires the registry ownership lock, checks the exact pinned quota file and account policy, validates the request's original run, and records a receipt intent beside the process registry before settling quota. If quota settlement commits first, a later retry compares the exact timestamp and usage before completing the evidence record. A changed evidence reference or charges cannot override the original record. Settle time is a conservative local recorded wall time, not an inferred provider execution time. An unfinished receipt blocks process reconciliation; a finished single-request receipt still does not itself close or reopen the process run.

Only the completed-with-explicit-usage branch is implemented. Missing external evidence, unknown completion, no-charge guesses, pre-send held rows and legacy rows do not qualify. A reference string remains documentary input, not validation of actual billing or account ownership by the provider. No live startup or transport is wired to this local rehearsal.

### Quota before the synthetic HTTP dispatcher handoff

A default-off constructor seam connects the existing branded memory HTTP candidate to the exact branded canonical quota handle for the same journal run. This is not accepted on gated/live transport. Quota is reserved before journaling intent; immediately before the transport observation the candidate revalidates its original intent, sequence and request digest, then makes the quota handoff irreversible and rechecks the guard. A failure known to precede handoff may cancel only its own reservation. Once handoff was attempted, anything ambiguous remains held for evidence-based recovery; no resend or fallback. A validated synthetic reply settles exact usage before journal response, but does not substitute for the later independent world-commit acknowledgement.

The existing real admission logic, default launching, credential handling and price rules are not changed. The current production contract still does not authenticate the supplier account or bind an approved account scope to the launch contract; the supervisor must attest that binding before any live wiring. The new option exercises only memory transport. It does not establish provider pricing, settlement, or permission to launch production.

### Disabled shared-launch documentary preflight

The offline-only preflight compares an explicit provider/account fingerprint, exact world/run/time envelope and quota policy against current reviewed fixture evidence and the original branded durable account handle. Resident context, public weather and expressly public life receipts have independent data scopes, approval references and grant versions; current revocation of one cannot be filled by another. Earlier account runs and pending quota remain blocking. No raw world or private publication fields are part of the envelope. The result is a private documentary digest with live authorization fixed to false; it does not authenticate provider evidence, expose credentials, or enable the real supervisor, runtime or yearbook publisher.

The isolated Formal offline resident runtime can explicitly attach an original
canonical disconnected quota handle and its exact original host owner. This
one-shot attachment also checks the frozen quota policy, exact run ID and
committed world journal fingerprint, and requires a fresh journal and no
unresolved canonical reservations. The real resident queue reports demand
before dispatch so other synthetic purposes cannot take reserved capacity;
the existing synthetic HTTP candidate records quota handoff and usage, while
the actual Formal world commit/ack remains a separate durable fact. Nothing
here proves a real vendor account, persists a production host attestation,
or permits reopening an already-attempted bound run. Default/offline behavior
without the option, live startup, and yearbook attachment are unchanged.
If its owner, quota file, or synchronous waiter update fails, this bound
runtime records `resident_quota_wait_write_failed`, stops its controlled
scheduler and local fake transport, and does not erase a surviving waiter
or pending unknown. A later readable ledger is not taken as clean evidence
for that failed run.
