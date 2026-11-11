# Commons food observation review

## Result

No unresolved blocking findings in the final reviewed patch. The new inspection action is a stock-independent trip to a remembered address, not a food receipt or promise of service. Actual execution still validates the building and the actor's rights.

## Finding resolved during review

**P2: A newly blocked room entrance could be crossed during an underway inspection.** The original next-step guard validated destinations, but `moveInRoom` first assigned the entry coordinate and `roomPath` allowed escape from a blocked origin. An actor approaching outdoors therefore completed inspection after a body blocked the entry.

The final fix checks `canReachCommonsTable` before changing the actor's indoor location, and the commons step guard rejects a blocked source. The independent regression verifies failure while the actor remains outside with no room coordinate, food transfer, or receipt.

- Production: `src/world/rooms.ts:24-27`, `src/world/rooms.ts:43-49`.
- Independent reproduction: `tests/commons-observation-review.test.ts:41-51`.

## Review coverage

- Actual outdoor sight to the doorway and entry-to-table corridor, rather than a distance-only inventory reveal.
- Indoor observation uses the real room coordinate; table reachability is separately required for actionable food and nutrition forecasts.
- Hidden public and reserve quantities cannot change the prepared menu/prompt in the seed-5401 synthetic cliff fixture.
- Old public notices are not live stock observations; saved-state reload does not promote them.
- Stale pickup actions check physical observation/reachability before querying stock at action start.
- Dynamic indoor destination, source, and entrance obstructions stop travel without assigning impossible locations.
- Inspection transfers no stock, spends no nutrition allowance, creates no commons receipt, and does not eat.
- Public budgets, funded shifts, rolling allowances, reserve authorization, minors' donation restrictions, last-unit competition, batch expiry, and separate consumption remain enforced.
- A remote ruined known lodge intentionally retains a tentative inspection option. Filtering it by current unseen condition would leak registry knowledge; target validation rejects actual service. Independent test preserves this boundary.

## Validation

Installed Node/tsx only; synthetic worlds, no network/model calls, no secrets or real saves inspected.

At the intermediate review snapshot, before the last two independent cases were added, **66/66** tests passed:

```
node --import tsx --test tests/commons-observation-review.test.ts tests/commons-observation.test.ts tests/commons.test.ts tests/public-food-reserves.test.ts tests/building-knowledge.test.ts
```

Independent reviewer tests: **4/4 passed**, including the pre-fix failing dynamic-entry case. Existing tests cover in-memory SQLite reloads, conservation, and consumption predictions.

The final combined run including both existing `nine-resident-food-chain` test files passed **71/71**. The subsequent expanded independent review file passed **4/4**, including adult `openReserve` hidden-stock prompt parity with a positive visible control, and missing-coordinate/sleep exclusions. The nine-person harnesses use newly created temporary synthetic SQLite files. They are not evidence of model autonomy or population-survival acceptance.

Final aggregate validation on 2026-11-07, after all review fixes and all four independent tests were present: **3,340/3,340 passed** with `node --import tsx --test tests/*.test.ts`. Both TypeScript checks and Vite with `envDir:false` passed; only the existing bundle-size warning remains. The independent normal-menu script completed 229 actions with zero failures and preserved its conservation checks.
