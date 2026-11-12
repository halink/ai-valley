# Fixed synthetic account process chain

`launchSyntheticAccountProcess` starts only the repository's fixed independent
watchdog, which owns `ProductionModelAccountSupervisor` and its durable account
reservation. The watchdog starts a separate fixed worker process group. The
worker actually runs `createProductionModelOfflineRuntime`, memory HTTP, journal
intent/response and persisted world acknowledgement. This is executable wiring,
not a caller-supplied launch mock, but **not a real provider acceptance**.

The launcher supplies an already-open report descriptor and fabricated
world/journal paths. Scripts run with an empty environment, no shell and the
immutable offline network/credential-file guard loaded before application code.
Only `synthetic-production-candidate` contracts are accepted; no credential
callback or live HTTP transport exists. The guard is trusted-code defense in depth,
not a hostile-code operating-system sandbox. `main` remains unchanged/disabled.

The caller's monotonic start time covers watchdog setup plus the remaining
supervisor budget. The contract wall deadline remains an independent bound.
Parent IPC loss is latched before imports and checked before worker dispatch.
An actual caller SIGKILL closes IPC without killing the detached watchdog; it
interrupts supervision, signals the worker's own group, and persists its report.
A normally exited, fully absent worker group AND locked artifact revalidation
are necessary to clear the account. A cancelled run remains unresolved even
when the process group was successfully cleaned up.

`crash_intent` and `crash_response` are **injected exceptions after durable journal
writes**, followed by orderly compiler teardown, not uncatchable process kills.
Separate tests SIGKILL the real worker and its real caller. The worker kill must
never count as clean or enable automatic retry. If leader identity disappears
while descendants remain, signaling fails closed and cleanup may remain
unconfirmed. We do not claim arbitrary hostile-descendant containment, survival
of watchdog death, or preemption of an unresponsive kernel/watchdog.

Scope remains cooperative, same host, same registry, same stable account label.
Other registries/hosts bypass this exclusion. Pricing in this chain is synthetic;
it authenticates no official price, account eligibility, past billing or zero-cost
guarantee. Actual provider dispatch, secure credential handoff, real reviewed
pricing and reconciliation, formal startup integration, and long-run live-model
acceptance remain unimplemented/unverified by this chain.
