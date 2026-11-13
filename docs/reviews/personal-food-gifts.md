> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# Personal food gifting: independent adversarial review

Result: PASS for the reviewed feature, its 36 targeted tests, and the 74-test expanded regression run. Three adversarial defects were reproduced, fixed, and independently retested. This is not a certification of the unrelated pre-existing dirty worktree or live-model behavior.

## Scope and method

Reviewed the new shared/world personal food gift modules and their engine, final-choice, room-routing, and persistence integration. Read repository context and contribution guidance. Tests use synthetic worlds, the final `decisionContext → decisionChoices → parseChoice → submitPlan → stepWorld` path, and in-memory SQLite. No production saves, credentials, model calls, browser use, package installation, commits, or pushes were used.

Independent suite: `tests/personal-food-gifts-review.test.ts` (15 tests). Main feature suite: `tests/personal-food-gifts.test.ts` (21 tests).

## Defect found and verified fixed

The initial acceptance validator checked the proof's rule, evidence, timestamp, and witnesses but did not require the accepting recipient to be an actor. Removing the recipient from the acceptance event's actors still permitted delivery. The regression test now rejects that corrupted proof. The fix additionally checks exact participant actor ordering, audit authority, provider, scope, resource quantity, and the durable original offer receipt.

## Independently exercised boundaries

- Original quantity, item, expiry, giver, acceptance time, accepted location, and proof references cannot be changed to authorize another transfer.
- Recipient withdrawal immediately before the final work tick prevents transfer.
- Missing gift state in an older SQLite save initializes without inventing gifts.
- Delivery replay after SQLite reload, including a freshly numbered plan, does not transfer twice.
- Missing action fields and unauthorized action extensions fail without changing ownership.
- An absent third party gains neither gift memories nor participant choices.
- Legal indoor handoff succeeds at the accepted room; revoked room access fails.
- A newly blocked next room step cannot be crossed by the saved path.
- Direct completion without actual work cannot create an offer or transfer goods.
- Nonfinite recipient inventory cannot receive the transfer.

The main suite additionally exercises three separate voluntary choices, fixed 120-minute expiry, no reservation, real lot/expiry preservation, independent later eating, travel, competing consumption/spoilage, autonomous adult constraints, busy giver cancellation, remote cancellation knowledge isolation, route loss, crowded final menus, and mid-walk SQLite reload.

## Reproduction

`node --import tsx --test tests/personal-food-gifts-review.test.ts tests/personal-food-gifts.test.ts`

Final targeted set: 36 passed, 0 failed. Expanded run including land transfers, relationship continuity, and agency: 74 passed, 0 failed. No unresolved feature defect identified in this review. Full repository regression and final build remain the implementation owner's responsibility.

## Follow-up adversarial findings

Two additional regressions were independently confirmed failing before fixes:

1. With three outstanding offers, a recipient declining remotely caused a new offer to appear in the giver’s final choice menu. The active-offer cap consulted actual status rather than the giver’s known status, leaking the remote change.
2. A recipient inventory of negative one allowed a gift to complete, absorbing transferred stock into an invalid negative balance.

A third new regression confirms that recipient withdrawal after 0.75 minutes of the one-minute handoff prevents transfer on the final 0.25-minute tick.

Both follow-up defects are fixed and independently verified: the cap uses the giver’s known active original records within the deadline, and delivery rejects negative recipient stock.

The final menu adjustment was also reviewed: all gift options are removed from ordinary domain rotation, then at most one offer/accept/deliver option per operation is added using spare capacity or replacing only surplus goal reflections. Existing stop preservation remains separate. A new crowded-menu regression checks that adding a gift leaves every existing non-reflection option and its ordering unchanged.

Expanded reproduction: `node --import tsx --test tests/personal-food-gifts-review.test.ts tests/personal-food-gifts.test.ts tests/land-transfers.test.ts tests/relationship-continuity.test.ts tests/agency.test.ts`

Result: 74 passed, 0 failed. No unresolved feature defect identified.
