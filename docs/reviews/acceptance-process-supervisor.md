# Independent offline process-supervisor review

Reviewed the supervisor policy, closed synthetic process adapter, subprocess fixture, and primary tests. Added only `tests/acceptance-process-supervisor-review.test.ts` and this review. No model entry, credentials, browser, real saves, npm, commit, or push was used.

## Reproduced findings (initial implementation)

1. **Timer ownership loss on replay/deferred callback (medium).** A callback belonging to a cleared timer unconditionally sets `armed=false`. If a newer timer exists, `tick()` schedules another without clearing the newer handle. Settlement clears only the last handle, leaving a live timer. The test replays the first callback after `start()` replaced that timer, then delivers OS exit and an absent group. One active timer remains. Use a generation/identity guard before accepting a callback.
2. **Reentrant interrupt corrupts the resolved report (medium).** A TERM adapter callback can synchronously call `interrupt()`. Its nested KILL callback queues exit but the nested `send()` clears the shared signalling flag and drains events before outer TERM returns. The promise resolves with TERM `not_attempted`, although it was sent, and later `status()` differs. Serialize interruption and event dispatch across the whole adapter operation, including nested callbacks.
3. **Synchronous scheduling can launch after settlement (high within injected-clock boundary).** A clock that synchronously invokes the first scheduled callback and throws on the nested schedule causes emergency settlement before launch. Outer `arm()` nevertheless succeeds, and `start()` launches a process after the report resolved, never disposing it. Default Node timers are asynchronous, so this is a custom-clock boundary failure, not a claim about the default scheduler. Reject/normalize synchronous timer callbacks and verify phase before creating a child.

4. **Late non-timer events extend the absolute shutdown bound (medium).** If the event loop resumes after the total budget is exhausted and processes a parent signal or transport error before the overdue timer, `stop()` starts a fresh grace window at the current time. With wall/grace/wait 100/20/30 and elapsed 500, only TERM is sent and phase remains `term_wait`. Cap every stop deadline against the original wall deadline, independently of the first trigger. Two separate regressions cover parent signal and transport error.

Reproduction: `node --import tsx --test tests/acceptance-process-supervisor-review.test.ts`. Initial expanded result: 2 passed, 5 failed (four findings). Findings sent to implementer immediately. Fix verification follows below when available.

## Positive checks and boundaries

- Late callbacks after an already settled report are inert. Probe/dispose exceptions remain sanitized, cleanup remains unknown, and a real zero exit is not rewritten as failure merely because cleanup could not be confirmed.
- The process adapter uses a fresh detached group and never accepts caller-supplied PIDs or shell commands. Its environment is empty; executable, loader and child program are fixed repository paths. Scenario selection is allowlisted and the root is a real, immediate `/tmp/valley-supervisor-fixture-*` directory. These checks are suitable for a synthetic test helper, not a general untrusted executable sandbox.
- Exit facts come from Node's OS child `exit` event, not IPC messages or stdout. Signal delivery success is kept separate from group absence and observed exit. `kill(-pid, 0)` conservatively treats zombies as present. PID/process-group reuse remains an OS identity limitation; this adapter is not a pidfd/cgroup supervisor.
- The independent guardian observes owner pipe EOF; owner SIGKILL therefore does not require the blocked child to run a callback. Killing the guardian itself is outside that protection. Detached/session-escaping descendants are outside the owned-group guarantee; the synthetic descendant stays in its inherited group.
- The absolute clock is established before child launch. A blocked child cannot block the supervisor's event loop. No JavaScript supervisor can enforce deadlines while its own event loop, clock or nonblocking adapter contract is violated by arbitrary synchronous work.
- The wall budget is followed by separately bounded TERM grace and KILL observation windows. It is not a promise that process disappearance occurs exactly at `maxWallMs` or that a kernel kill request succeeds.
- `remoteCancellationConfirmed:false`, `confirmedCostUsd:null`, and null acceptance/model fields correctly avoid inferring remote cancellation, free execution, or successful acceptance from local exit or local signal delivery.

## Validation

Review suite and TypeScript checks are run with the installed Node/tsx/TypeScript tools only. No implementation files were changed by the reviewer.

## Fix verification, first pass

The original seven independent regressions passed after generation-tagged timer ownership, serialized interruption, synchronous scheduler rejection, and capped shutdown deadlines were added. A combined adversarial test then found one remaining queue/settlement race: when already overdue, TERM queues an interrupt and nested KILL queues an OS exit. The nested deadline tick settles before the outer drain consumes the exit, clearing an already-delivered OS fact and reporting unknown. Added regression `review: overdue reentrant stop drains observed OS exit before final settlement`; initial fixed-version result is 7 passed, 1 failed. Sent this finding immediately for correction. This is conservative misreporting, not a false claim of death or cancellation.

## Final verification

All five reproduced findings are fixed. Settlement now consumes already-delivered synchronous observations before sealing its report, without waiting for future OS events. The final independent review suite passes **9/9**, including an additional terminal-snapshot test covering dispose-time callbacks, caller mutation of returned nested fields, replayed timers, and late exit/spawn-failure events. No remaining blocker was found within the documented trusted nonblocking adapter, usable clock, and owned process-group boundary.

The primary plus initial review suites independently passed **35/35** after the initial fixes, including synthetic blocked initialization, blocked synchronous work, shutdown sealing, TERM resistance, orphan/held-pipe cleanup, and owner SIGKILL/EOF. Both installed TypeScript checks passed on the initial fixed version. Both also passed after the final queue correction. See the implementation's final full-suite run for the integrated test count. The reviewer changed no implementation files.

## Additional process-probe hardening

The implementer additionally found and fixed probe reentrancy: `groupState()` could synchronously interrupt, allow nested settlement, and then overwrite the terminal group observation with its stale return value. Group probes now use the same adapter-operation queue as signal calls, and `tick()` checks for settlement after probing. Independently inspected this delta and verified the added primary regression covering stable terminal group state and no rearmed timer. This broadens callback serialization to both adapter observation and signal methods; the concrete POSIX probe remains passive.

Final post-probe verification: combined primary and independent review suites passed **38/38** (29 primary, 9 independent). Both `node node_modules/typescript/bin/tsc --noEmit` and `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.server.json` passed. No remaining review blocker.

## Seal-fsync fixture precision

Independently inspected the final fixture-only refinement. The synthetic `seal_block` hook now identifies the close-record write and blocks that descriptor's fsync, rather than stopping at an earlier channel-stop write. The bytes of `run-close.json` can therefore be readable and internally consistent while its fsync has never returned. A read-only evidence result of `complete=true` correctly means logical segment completeness, not proven storage durability or graceful process completion. The independent supervisor still records `wall_limit`, observed `SIGKILL`, TERM then KILL, and no acceptance, remote-cancellation, or cost confirmation. Byte comparisons continue to verify that inspection does not modify evidence.

Verification: `node --import tsx --test --test-name-pattern='seal_block' tests/acceptance-process-supervisor.test.ts` passed **1/1** after the final fixture change. No production-source change or new review blocker.

## Implementer final aggregate verification

After all reviewed source fixes and the final seal-fsync fixture change, the implementer reran the full repository suite on 2026-11-07, Node v24.22.1: **2069/2069 passed**, zero failed/skipped/cancelled. Supervisor tests contain 38 cases (29 primary plus 9 independently authored); the combined supervisor/integration/stop-control/evidence-writer group passed **125/125**. Typecheck, server compilation, Vite build, offline preparation, and diff whitespace checks passed. Vite retained the existing >500 kB chunk warning.

These aggregate results are separate from the reviewer's independent 38-test rerun and final targeted seal-fsync verification. They do not establish real-model acceptance, free-provider availability, remote cancellation, fsync/power-loss durability, or production process isolation. Final preparation remains not ready for real execution, with source fingerprint `8eaefbaebb7a514d33bca97414eaff8ae3d6da9a72048959e2af61ec5976b462` across 284 source/configuration files.

## High-load timing review, 2026-11-07

A later build/annual-run concurrency check exposed fragile fixture assumptions. The original suite passed 38/38 independently, but one CPU shared by twelve bounded busy loops reproduced `init_block` failing with zero ready messages. The production deadline correctly includes Node/tsx startup and imports; a 1500 ms launch budget never guaranteed readiness. A real-wall upper bound also cannot assert a real-time scheduler guarantee that the supervisor does not provide.

The implementation now separates exact injected-clock policy tests from real process observations. No production supervisor source or deadline was changed. Real initialization/synchronous/seal-fsync blocks still require observed OS SIGKILL and group cleanup, and assert TERM at logical 1500 ms and KILL at 1620 ms. Readiness originates inside the blocking loop or the actual seal fsync hook. TERM resistance requires an actual child acknowledgment before advancing the injected grace clock. A separate real-system-clock `never_ready` case verifies the launch-based deadline without requiring readiness. The existing adversarial deadline and stale/reentrant callback regressions remain unchanged. Watchdog and per-test timeouts remain 12 and 15 seconds.

Independent review identified and reproduced a test-harness cleanup issue: after a ready blocked worker, an invalid fixture command made its guardian exit with code 1 and close its pipes, while the worker was still executing (`/proc` state R). `closed` had incorrectly suppressed cleanup of the known detached worker group. The revised cleanup checks the known group independently of guardian pipe closure. Repeating the same failure and executing the current cleanup changed the owned worker from R to Z, confirming it no longer executes. This was a test failure-path leak, not a production supervisor change. A guardian crash before it delivers any worker identity remains outside this fixture's cleanup guarantee.

The independent reviewer reran the frozen final primary and review suites: **39/39 passed**, with no remaining executing fixture process afterward. Checked coverage includes parent INT/TERM, owner KILL/EOF, descendants retaining pipes, seal fsync, immutable read-only evidence, and explicit unknown outcomes. No remaining review blocker was found within the stated synthetic adapter boundary.

The implementer's sustained-load run used twelve 30-second CPU loops pinned with the five deadline tests to the same CPU: **5/5 passed**. Actual worker startup to ready reached 2227/5556/5894 ms for init/sync/TERM-resistant cases while all injected signal boundaries stayed exact. This demonstrates the removed assumption rather than hiding it behind a larger timeout. Both installed TypeScript checks and whitespace checks passed. Full-repository concurrent validation is recorded separately from these focused checks.

A separate controlled scheduling experiment stopped only the owned synthetic guardian after readiness and resumed it 4200 ms later. The unchanged system-clock supervisor correctly reported elapsed 4406 ms, wall_limit, both signals sent, and unknown exit/cleanup. This reproduces why the old `<4000 ms` assertion cannot be guaranteed under descheduling. The experiment cleaned up its owned worker group; routine tests retain deterministic delayed-clock coverage instead of adding a scheduler pause or larger timeout.

## Frozen-code concurrent aggregate validation

An independent validator started the full suite with `--test-concurrency=4`, TypeScript checks/server compilation, Vite with `configFile:false` and `envFile:false`, and one-year offline simulation concurrently at 09:06:49Z. The first and only full-suite run passed **2373/2373** in 154.49 seconds, with zero failed, cancelled, skipped or todo cases. All src/tests/scripts TS/MJS hashes were unchanged across the run. Type checking, server compilation, Vite and whitespace checks passed; Vite retained only its existing >500 kB chunk warning.

The one-year synthetic simulation produced 113 consecutive daily records covering 161280 minutes, passed in-memory SQLite reload, and passed per-day action, nutrient/serving, detail/total, event-deduplication and missing-channel reconciliation. Ordinary care and longCare were observed zero in this fixture, not positive examples; full production/consumption remains unknown. This validates concurrent offline stability without implying real-model acceptance or complete food accounting.

Aggregate artifacts: `/tmp/valley-supervisor-load-first-l9Jm8P/full-tests.log`, `year-regression.log`, `year-audit.json`, and `timing.txt` in the same directory. This aggregate validation is separate from the reviewer's focused 39-test run and actual guardian-error cleanup experiment.

## Follow-up missing-report race: independently reviewed fixture fix

A later parallel aggregate failed **1 of 2804** tests (`sync_block`); the previous isolated 30/30 and serial 2804/2804 successes did not resolve that failure. The retained failing log shows readiness at about 899 ms, real TERM/KILL at injected 1500/1620, then an observed OS SIGKILL exit while the group probe still returned present. The ordinary fixture driver never advanced beyond 1620, so the queued 1630 poll never ran and its 12-second watchdog killed the guardian without a final report. This is an injected-clock protocol defect; no production supervisor source changed.

Independent review reproduced the state sequence with the production controller and synthetic clock. Repeating advanceTo(1620) cannot run the pending poll, and duplicate exit events are intentionally ignored. Advancing the actual next timer to 1630 settles once the group is absent. The same bug also applies after owner death, where stdin relay is unavailable.

Reviewed the fixture repair: the guardian starts a host poll only after real exit when not settled, checks the unwrapped adapter's actual group state, and advances its existing next logical timer only on real absence. It does not promote present/unknown to clean completion or fabricate exit. The host interval clears both on settlement and final completion. The parent watchdog now explicitly fails even if a report arrived before a later pipe hang. Strict TERM 1500 and KILL 1620 assertions remain; final settlement is bounded separately instead of incorrectly requiring simultaneous group disappearance.

Two real-process regressions inject one conservative present observation at actual exit, then resume real probes. Both failed before repair: live-driver timeout/no report, and dead-owner unsettled top-level await/no report. Both pass after repair at logical 1630/130, with actual SIGKILL and group absence. Under the same six finite 30-second CPU loops pinned to one CPU, the original driver again failed both regressions; the repaired fixture passed those plus the five existing deadline scenarios (**7/7**). This controlled replay matches the retained failure sequence, not a claim that the original kernel ordering was naturally reproduced again.

The reviewer added four independent tests to the review file and verified **4/4**: earliest uncanceled timer semantics and no invented timer, post-exit absent cleanup at 1630, and persistent present/unknown remaining unconfirmed through 1840. The three post-exit cases retain exact TERM 1500/KILL 1620 and no timers after settlement. No review blocker was found. Existing owned-PGID reuse and pre-PID-delivery crash limitations remain; this is not a production process-isolation guarantee.

### Frozen-code aggregate verification of the fixture fix

The implementer's first frozen run with `--test-concurrency=4` passed **2810/2810** in 180.34 seconds, zero failed/cancelled/skipped. Installed TypeScript checking, server compilation and Vite ran alongside it and passed. Vite used `configFile:false` and `envFile:false`, preserving the repository's base/output settings; only its existing >500 kB chunk warning remained. All src/tests/scripts TS/MJS hashes matched before and after, and the production supervisor hash was unchanged from the start of this investigation. This aggregate is separate from the independent reviewer's four targeted tests and does not claim all future scheduler runs must pass.

Evidence is retained under `/tmp/valley-supervisor-report-race/`: original failure, failing before-fix regressions, matched CPU-load runs, full concurrent run, build output and frozen-source hashes. No serial retry replaced this passing parallel run. No credentials, real archives, model calls, browser, npm, commit or push were used.

After aggregate validation, the implementer reran the combined primary and independent suites: **45/45 passed** (32 primary, 13 review), zero failed/cancelled/skipped. This does not replace the independent reviewer's own 4/4 targeted result. The final focused log is `final-primary-review.log` in the evidence directory; whitespace checks passed.

A separate same-shell cleanup check passed all seven parent-signal, owner-death, orphan/held-pipe and new regression cases, with no fixture process remaining in the subsequent process listing. The retained cleanup logs describe that observation only, not a universal process-isolation guarantee.
