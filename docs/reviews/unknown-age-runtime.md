# Unknown-age runtime scheduling: independent review

## Scope

Review of the narrow `observedChildPressure` age-evidence correction in
`src/server/runtime.ts`. Existing uncommitted work is outside this review.
No production edits were made by the reviewer. Tests use actual `ValleyRuntime`,
in-memory SQLite, frozen interval timers, an injected never-resolving fake model,
and a fetch guard. No real saves, secrets, network, browser, or model calls.

## Findings

The same helper supplies ordinary guardian queue pressure, the fast-clock
critical-dependent priority class, and the slow-clock distressed-dependent hold.
Rejecting unknown age before the under-six comparison therefore closes all three
paths without changing their existing location, guardianship, distress or clock
conditions. Valid age zero remains distinct from absent or invalid timestamps;
the sixth birthday remains an exclusive boundary.

This is scheduling evidence, not new care authority. No consent, action execution,
storage migration or automatic birth-date repair is introduced. Own hunger and
exhaustion emergency protection is separately calculated by the engine through
`protectedNeedMinutes`; it remains conditioned on a verified, timely self-rescue path. The formal menu
currently restricts ordinary choices for an unknown-age actor; this patch does
not invent eat/sleep authority or infer protection eligibility from need alone.

## Independent checks

`tests/unknown-age-runtime-review.test.ts` exercises model-slot competition and
actual clock advancement, including missing/null/nonfinite/string/future/unsafe
birth timestamps; newborn, immediately below six, exactly six and adult ages;
fast-clock critical dependents; missing guardian link, different room, outside
residency, distance, absent or healthy need observations; stop/SQLite reload; and
real own hunger/exhaustion protection for a capable guardian of an unknown-age
dependent with retained 180-minute deadlines. Exhaustion uses the actual owned
bed. Unknown-age actors separately retain their own need-based queue priority
and slow-clock hold after the existing 30-second grace period.

## Results

Passed: `node --import tsx --test tests/unknown-age-runtime-review.test.ts`
with **25 tests passed, zero failures, zero skipped** on the patched implementation.
The initial test run identified fixture problems (unrelated seeded regional
candidates competing and an exhausted actor not at a timely reachable bed).
Those synthetic fixtures were corrected, not production behavior.

No blocking finding in the narrow age-evidence correction. Existing authority,
physical rescue requirements and persistence behavior remain outside its edits.
These are synthetic offline checks, not real-model long-run acceptance or a full
repository validation. Parent task owns broader regression and type checks.

## Follow-up review of integration coverage

Reviewed the additional 21 tests in `tests/unknown-age-runtime.test.ts` and the
implementation note. The birthday requeue expectation correctly gives the newly
six-year-old child their existing independent decision opportunity, rather than
assuming the original adult rival must win. Removed and restored birth records
are reevaluated when a real pending request frees its slot.

The invalid-reply case exercises retry deferral followed by the next actor's
admission; stopping then resolving that actor's late reply must leave the world
unchanged. The restart protection test preserves the original protection object
and checks the separate total-outage hold before its original expiry, rather than
claiming the personal protection expired or was renewed. Its 151 one-second ticks
remain below the restarted 180-second wall outage threshold, distinguishing the
persisted protection deadline guard from that wall-time guard.

The implementation note appropriately distinguishes unsupported dependent age,
age-independent own needs, and genuine menu-backed personal rescue. No additional
blocking issue found by source review. The parent runs the combined tests,
type checks, and full-suite validation; this follow-up did not run another suite.
