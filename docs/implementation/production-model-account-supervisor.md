> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# Account-bound process supervision policy

This incremental module is **disconnected trusted-process policy**, not a fixed
production launcher. `main` remains unchanged. There is no production process
adapter, automatic credential access or network call. Tests use a fixed plain
Node worker that only exits or blocks; they are not real model acceptance.

`ProductionModelAccountSupervisor` reserves the account before launching, keeping
that reservation for the complete child lifetime and durable verification. It
reuses `AcceptanceProcessSupervisor` for bounded TERM/KILL and OS-exit/process-group
observations. The `launch` adapter is trusted code with the existing supervisor
contract: IPC messages and pipe EOF are not child exits, and arbitrary PIDs must
not be supplied. This module does not sandbox a malicious adapter.

The implementation, not a caller boolean, checks canonical paths, original file
inodes, fixed run/world contract, a formal paused world without in-flight work,
replayed journal fingerprint, and absence of pending requests/failure/incomplete
runtime stop. World and journal runtime locks are held during this check. Both
startup and successful completion are checked; old unresolved state cannot
reach `launch`. Account release additionally requires clean OS exit, absent
process group and no supervisor issues. Files are closed before release and
path locks remain held until after release. Journal replay may durably block
old unresolved state; this is not a read-only forensic inspection API.

The execution allowance subtracts local setup time and is capped by the original
contract deadline and 30 seconds. No heartbeat or readiness renews it. Price
validity and before-dispatch checks remain the reviewed runtime's job; this
policy does not authenticate price records or monitor provider billing.

Startup errors after reservation, abnormal exit, timeout, interrupt, missing or
replaced files, failed replay and unknown outcomes keep the reservation unresolved.
There is no automatic retry or reconciliation. An explicit caller must forward
signals/disconnect to `interrupt`; there are no global listeners installed by
importing this module.

## Boundaries and remaining work

- Account uniqueness still requires the same registry/account label on one host.
- The trusted process adapter, independent watchdog, fixed reviewed-runtime worker,
  parent-death wiring and verified pricing/operator admission remain to be wired.
- Parent death releases OS locks but retains its durable account reservation. This
  policy alone cannot guarantee that an orphan child is stopped after parent death.
- A clean result proves only local process/artifact completion. It neither proves
  that a real model was called nor that the provider charged zero.
- No default live launch is enabled, and no long-duration acceptance is claimed.

Focused verification: `node --import tsx --test tests/production-model-account-supervisor*.test.ts`.
