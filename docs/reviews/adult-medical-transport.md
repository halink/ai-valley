> 历史记录：本页涉及的测试源码、夹具及专属验收脚本已于 2026-11-13 按项目所有者要求移除。旧命令仅作历史记录，不再可执行；历史结果不代表当前版本已验收。当前流程见仓库 CONTRIBUTING.md。

# Adult medical transport independent review

## Scope and conclusion

Reviewed the four changes shown by `diff -u /tmp/adult-medical-transport.before.ts src/world/medical-transport.ts`: accepted-offer respondent validation, emergency timely-guardian age gate, offer recipient selection, and guardian transport cancellation age gate. No implementation edits were made by this reviewer. The only reviewer outputs are this file and `tests/adult-medical-transport-review.test.ts`.

No blocking implementation defect found within this scope. The change matches `docs/design/people.md`: childhood guardianship ends at adulthood; adult incapacity proxy arrangements are not implemented. Retained guardian IDs are not current adult authority. Independent emergency authority still requires actual contact, carrier eligibility, incapacity, critical health/case criteria and no refusal. Destination, work, supply and ferry-contact restrictions are unchanged.

## Findings and severity

- **Resolved test expectation mismatch (test maintenance, not a production defect):** old health and ferry tests treated a capable historical guardian of an adult as a current proxy. Reviewed the implementer's correction: health explicitly tests adult allowed / 17-year-old blocked / absent guardian allowed; the ferry negative scenario alone uses a 13-year-old before work begins. All other negative mutations remain adult. Separate adult historical-guardian arrival tests exercise real rescue and stabilization completion. This preserves the minor protection instead of merely deleting the assertion.
- **Informational, historical audit basis:** when an accepted minor-proxy transport is already carrying and the patient becomes an adult while still critically incapacitated, current delivery checks can independently establish emergency authority. `t.basis` remains the truthful original pickup basis (`consent`), rather than being rewritten. The added test proves that raising health above the emergency threshold then immediately interrupts the transport despite the accepted proxy offer remaining. Thus this is not continued validity of childhood consent. A future per-step authority audit could make transitions more visible, but it is not needed to fix the four age gates.
- **Informational, offer cleanup:** a former respondent can cancel their old pending/accepted offer record. Adult emergency pickup does not bind that invalid proxy offer (`offerId === null`), so canceling the record does not stop the emergency. The independent final-menu test verifies this distinction.
- **Existing semantics preserved:** ordinary medical emergency incapacity accepts either decision or expression incapacity, unlike the separate constrained adult disaster-ground evacuation path. Full effective capacity and explicit care refusal block emergency medical authority. This patch does not widen that predicate.

## Independent verification

`tests/adult-medical-transport-review.test.ts` uses its own seeded synthetic world and no imported test fixtures. It includes 17 tests covering:

- One minute before, exactly at, and one minute after the eighteenth birthday, with intentionally stale life-stage metadata.
- Infant guardian pickup/cancellation and capable child own acceptance.
- Adult own refusal through final menu → `parseChoice` → `submitPlan` → `stepWorld`.
- Three capacity combinations and refusal dominance.
- Destroyed, privately owned, nonmedical and unknown destinations.
- Accepted childhood proxy reload through `WorldStore(':memory:')`, including missing legacy `respondentId`.
- Actual emergency delivery after canceling a stale proxy offer, with no appointment/treatment grant.
- Carrier cancellation and ongoing proxy-to-emergency adulthood revalidation.

All synthetic worlds assert `frontierHazards.weather.enabled === false`; no real save/runtime, credentials, external models, browser, npm, commit or push was used. The fixture's birthday simulation sets the adult life stage when retained historical IDs are intended, preventing the normal lifecycle transition cleanup from removing the very legacy IDs under test.

Commands run by this reviewer:

- `diff -u /tmp/adult-medical-transport.before.ts src/world/medical-transport.ts`: confirmed precisely four intended logic changes plus explanatory comments.
- `node --import tsx --test tests/adult-medical-transport-review.test.ts`: **17 passed, 0 failed** on the final test file.
- `node node_modules/typescript/bin/tsc --noEmit`: **passed**, exit code 0 on the final test file.

Existing ferry and adult ground-evacuation paths were reviewed as adjacent code/test context; this reviewer did not rerun the complete adjacent or repository regression suite. The implementer owns aggregate validation. This report does not claim that all regressions have run.
