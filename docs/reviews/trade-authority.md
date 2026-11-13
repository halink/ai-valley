> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# Ordinary barter authority review

## Scope and independent method

Reviewed ordinary `offer` and `accept` only. Inspected the existing formal age rule, submission, activity start/ticks/completion, contact checks, inventories, final numbered choices and SQLite persistence. Added `tests/trade-authority-review.test.ts` independently of the implementation tests. All fixtures are synthetic; SQLite databases are in memory. No real saves, credentials, model calls, browser sessions, package installs, commits or pushes were used.

## Findings

- Existing formal rules permit ordinary barter only from age 18. The existing `knownAgeYears` helper rejects unknown, malformed, nonfinite and future birth timestamps and respects precise birthdays. Reusing it avoids treating unknown age as authority.
- An offer is a proposal, not the recipient's acceptance. Rechecking the proposing actor, while retaining the original ability to propose to a minor, preserves this distinction. Settlement requires both the acceptor and the original author to remain alive, present, capable and, in formal mode, known adults.
- Checks of pending barter actions, execution start, every active tick and atomic completion close the stale queued and last-quarter-minute gaps, including a later barter action behind an earlier wait. Failed authorization clears the current work through the existing failure path; the offer itself is not repaired, rewritten or accepted. Restoring a birth date must not revive failed work.
- Acceptance needs structurally valid original parties and terms, not merely a stable offer ID. Missing IDs, parties, definitions and expiry cannot become valid evidence simply because a newly copied snapshot matches the same malformed record. A snapshot of ID, author, recipient, give/want, expiry and definition detects same-ID replacements and price changes. Rejecting a supplied stale snapshot before enqueueing is essential. Binding fresh direct API submissions preserves existing callers; old persisted pending accepts without evidence must fail and require a fresh choice rather than fabricate evidence on load.
- Existing known-person, visibility, real contact, recipient identity, expiry and stock checks must remain in place. The implementation retains contact and stock checks before the atomic food-ledger and inventory transfers. Two concurrent acceptors cannot obtain the same limited author stock.
- Interval-start age validation is appropriate: if the author was underage at the beginning of the last quarter-minute, turning 18 at its end cannot retroactively authorize that work. A fresh choice at the birthday must work. Independent review found that the runtime preflight originally simulated one elapsed minute without advancing its clock, incorrectly rejecting that fresh birthday choice. A regression covers the exact boundary.

## Independent regression coverage

The 40-test review suite covers missing term identifiers, parties, definition and expiry; same-ID changes to either party, both bags, expiry and definition; stale final-menu terms at submission; real stock competition; invalid author and acceptor ages after SQLite reload at the final quarter-minute; before/exact birthday behavior and fresh-choice recovery; death before transfer; proposals to minors; old queued and active accepts missing their snapshots; malformed inventory bags; proposal capacity loss; and read-only exact-birthday runtime preflight.

Baseline before implementation: the initial 17 cases had 11 expected failures and six passing existing invariants. The failing cases demonstrated five undetected same-ID substitutions and six persisted invalid-age settlements. More cases were added during review.

## Compatibility and limits

Validation worlds retain their non-formal age behavior; capacity and genuine-participant checks remain necessary. Optional context eligibility fields preserve manually assembled contexts, while authoritative execution supplies the safety boundary. The review does not add automatic consent, guardianship, renewal, cancellation, hidden-person discovery, or transfers from third-party accounts. Failed trade checks do not promise that unrelated simulation physiology, deaths or expiry will stop advancing.

## Verification status

After the exact-birthday preflight correction and queued-action continuity check, the 40 independent review tests pass. The two existing social-target visibility suites also pass: 69 tests total, zero failures. Command: `node --import tsx --test tests/trade-authority-review.test.ts tests/social-target-visibility-review.test.ts tests/social-target-visibility.test.ts`. The reviewer found no remaining blocking issue in the requested age, capacity, original-offer consent, stock or visibility behavior. Independent `node node_modules/typescript/bin/tsc --noEmit` also passed. Broader unified checks remain the coordinating implementer's responsibility.
