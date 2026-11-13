> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# Indoor guardian evacuation independent review

Scope: an actual current guardian carrying a healthy child under six out of a threatened room toward an already-known public or own clinic/lodge. Review covers the final choice menu, physical pickup/room exit/outdoor movement, deferred bed reservation, interruption and memory-only SQLite restart. This does not cover noncritical incapacitated adults or no-bed dry-ground evacuation.

## Baseline evidence

Before the implementation, the first independent run had five failures at the absent final-menu choice and one passing exclusion test. The pre-change compatibility run passed 49 existing guardian, health and room tests. These are baseline results, not final acceptance.

## Independent cases

`tests/indoor-guardian-evacuation-review.test.ts` uses its own generated world and final `decisionContext → decisionChoices → parseChoice → submitPlan → stepWorld` path:

- Remote empty/full capacity, zero building condition, absent registered bed holder and hidden flood must not change the offered action or block pickup through remote live-state inspection.
- Pickup creates no bed reservation. Room exit takes real time; the child tracks the guardian. A bed may be reserved only at the actual destination doorway, followed by real interior delivery.
- A registered bed cannot be stolen. Failure leaves the child at the actual reached position.
- Child refusal or loss of current guardianship stops movement at the actual room position.
- Private or unknown destinations, six-year-olds and adults cannot use the new mode.
- Memory SQLite preserves the unreserved carrying state and room exit.
- A remote bed claim after pickup does not interrupt the pair in the source room.
- Stale ownership or vanished source threat prevents pickup without spending resources.
- Two concurrent trips may begin without claiming a remote bed, but cannot both occupy the single destination bed.
- A child's explicit stop remains available before reservation.
- Pending transports do not consume destination shelter capacity until the bed is reserved at arrival.
- A newly blocked interior delivery route stops at the last actual room position.
- A hidden active destination flood permits the uncertain pickup but prevents physical unsafe entry.

## Constraints

Only this review document and its independent test file were edited by the reviewer. No production edits, real saves, secrets, model calls, browser, npm, commits or pushes. Weather changes are limited to generated test worlds; default weather generation is untouched. The SQLite test uses `:memory:` only.

## Final result

Final independent run: **106/106 tests passed**, including **13/13 reviewer tests** and the implementation's 11 indoor tests. Command:

```sh
node --import tsx --test tests/indoor-guardian-evacuation-review.test.ts tests/indoor-guardian-evacuation.test.ts tests/guardian-evacuation.test.ts tests/guardian-evacuation-review.test.ts tests/health.test.ts tests/rooms.test.ts tests/medical-destination.test.ts tests/ferry-rescue.test.ts tests/ferry-rescue-review.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

Typecheck exited 0 after the final test additions. No remaining blocking finding in this reviewed scope. This is not a full-repository, browser, model or long-run acceptance claim.

## Finding resolved during implementation

The hidden-active-flood test exposed an initial pickup oracle: ordinary `findPath` consulted the remote flooded destination, rejecting pickup before walking. The implementation now uses `guardianKnownAddressPath` for this narrow branch, limiting its disaster geometry to the currently observable patch. The reviewer reran both hidden-state pickup equivalence and physical unsafe-entry tests successfully. Actual walking retains the authoritative per-edge guard. The shared navigation system's existing terrain/infrastructure/fence visibility model was not redesigned or exhaustively audited here.

The two-guardian fixture initially introduced a new guardian without acknowledging the already witnessed source warning. That legitimate warning interruption was a fixture issue, corrected by adding the generated guardian and child IDs to that fixture's warned list; no production behavior was weakened.

## Static review conclusions

- `evacuationDestination: 'known-address'` is restricted to disaster-bound rescue and same-room pickup to another building. Delivery and synchronization require equality between action and transport mode, preventing silent downgrade after room exit or reload.
- `MedicalTransport.bed` remains null during uncertain travel. `actionRoom` refuses a null bed. Door synchronization validates the destination and serializes bed allocation before interior entry; ordinary existing transports retain numeric reservations.
- Known ownership and address rights remain checked. Hidden building condition, destination beds and flood geometry do not choose or reserve a remote bed. Current locally inspectable condition/risk can stop approach, and capacity is checked at the door.
- Registered occupants, leases, accepted medical appointments and existing carrying reservations remain included in the existing bed-availability predicate. Concurrent independent trips cannot both deliver into the only bed.
- Indoor contact checks actual room coordinates, legal presence and reachable exit. Each bounded guardian room step rechecks adjacency and current room blockage, both on source exit and destination interior walking.
- Refusal, current guardian identity, carrier capability and explicit stop remain effective. No automatic stabilization, treatment or successful reception is claimed merely from choosing or starting travel.
- Null-bed transports are excluded from shelter occupancy counting. No default weather changes were introduced.

Noncritical incapacitated adults and no-bed dry-ground evacuation remain explicitly out of scope.
