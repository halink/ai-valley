# Daily acceptance snapshot independent review

## Scope

Reviewed the uncommitted daily snapshot capture, validation, SQLite persistence, WorldStore integration, runtime boundary clamping, exact-end engine stepping, and resumable report changes. This is an offline synthetic implementation review, not real-model acceptance, a fifteen-day simulation result, or a complete food ledger. No live network, credentials, real saves, sandbox launcher, or commits were used. Implementation and the five protected personal-food-gift candidate files were not edited by this reviewer.

## Findings and resolution

- **Fixed: sparse founder IDs were accepted.** The initial independent regression demonstrated that eight unique IDs plus a hole could pass config validation. The implementation now requires dense ordinary arrays with data-only indexed properties and no extra keys. Independently rerun regressions reject holes, accessor elements without invoking their getter, and extra keys.
- **Fixed: semantic aggregate validation.** Snapshot validation now recomputes community totals and rejects a mismatched total. Known population group counts must equal their ID counts, even when a tampered overall total matches the group sum. Both changes have passing independent regressions.
- **Verified: ambiguous aliases remain unknown.** Reusing the same inventory object for a store and a reserve makes totals null with an alias marker. Two distinct inventories with equal contents sum normally. The snapshots pass read-back validation in both cases.
- **Fixed: same-midnight late-commit population events were omitted.** The independent regression first reproduced a departure committed at minute 1440 after that boundary was sampled disappearing from every transaction slice. The implementation now uses durable archive row sequences between snapshots. The passing regression confirms the event appears exactly once in the minute-2880 transaction, retains its original minute 1440, and lies within the recorded previous/through sequence cutoffs. These are archive-commit-order slices, not strict calendar-time buckets.
- The durable chained checksum detects altered bodies, but it is not an authenticity signature against an actor able to rewrite all data and checksums.

## Independent executable checks

`tests/acceptance-daily-snapshots-review.test.ts` uses newly generated synthetic worlds and temporary databases. Final independent run after the archive-sequence fix: **16 passed, 0 failed**. No unresolved blocker was found within this executed scope.

Verified:

1. A SQLite trigger aborting the midnight snapshot insert rolls back the world update, an appended event, and an appended receipt together. Removing the trigger permits a clean retry.
2. Closing/reopening after that boundary and committing a changed world at the same minute retains the first boundary sample and revision.
3. A stale second connection cannot overwrite the winning commit; a skipped midnight is rejected with the previous world intact.
4. Changing a snapshot body while retaining its checksum causes report generation to reject it.
5. An omitted historical midnight remains missing in the derived report and adjacent interval coverage, rather than being interpolated.
6. Missing founder inventory/hunger/health remain null; a newcomer increases population without changing the fixed nine cohort.
7. Duplicate reserve IDs make aggregate stock unknown rather than double-counting them.
8. Four fractional engine starting times, including a sub-nanominute distance to midnight, land exactly at minute 1440 and produce a midnight sample.
9. Reopening with a changed sampling endpoint rejects the mismatched config.
10. Sparse, accessor-bearing, and extra-key config arrays are rejected; rejected getters are not invoked.
11. Tampered community totals and inflated known population counts are rejected.
12. Shared inventory object aliases produce unknown totals, while distinct equal inventories sum correctly.
13. Duplicate IDs make both records unknown, remove the duplicate from confirmed living membership, and make total population null; malformed IDs also invalidate the total.
14. Invalid exact engine endpoints throw before any initializer mutates the input world.
15. Archived departure and return events are retained even when the endpoint residency is unchanged.

16. A population event archived after the first sample at the same midnight is retained exactly once in the next boundary transaction, with its original timestamp and matching archive-sequence bounds.

Run with:

```sh
env -i /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node --import ./scripts/acceptance-offline-guard.mjs --import tsx --test tests/acceptance-daily-snapshots-review.test.ts
```

## Limits

The trigger test proves transactional rollback on a SQLite statement failure, not power-loss durability or a concurrent process crash. The two-connection test is sequential optimistic-concurrency testing, not a simultaneous race stress test. Exact engine stepping is exercised; runtime scheduling/clamping was inspected but is not directly exercised by this independent suite. Broader existing and author-owned tests remain separate evidence. Missing fields, endpoints, historical boundaries, and complete food-flow accounting must not be reported as observed zeroes or acceptance success.
