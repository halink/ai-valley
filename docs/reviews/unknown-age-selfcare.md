# Unknown-age self-care: independent review

## Scope and conclusion

Reviewed `self-care.ts`, `self-care-opportunities.ts`, and their family, engine,
room, decision-context and final-menu integration. Both concrete review findings
recorded below are fixed and verified; no remaining blocking finding in this
narrow fix. The reviewer changed only the independent test file and this report; production fixes belong to the implementing task. Existing unrelated
working-tree edits were not treated as part of this review.

Unknown birth data remains unknown. The new allowance is limited to an alive,
local person with actual decision and expression capacity: eat edible food in
their own inventory, use a real known bed under existing rights, wait, or traverse
an actual permitted route. It does not confer adult status, gather/cook access,
public food/bed allocation, agency, industry, or other asset authority. Existing
refusal/withdrawal exceptions are retained rather than replaced with adult rights.
Known ages below six retain their existing action boundary and infant physiology.

The final menu separates these choices from the compatibility display-age value.
Submission and execution recheck live age/capacity rather than trusting a cached
menu. Forecasting filters stale choices against current authority, transport and
capacity, checks the five-minute meal horizon for future birth dates, and runs
uncertain rescue paths in a disposable world. Duration-picker sleep placeholders
are evaluated using the same concrete forecast duration that is simulated.
Existing family/medical passenger restrictions and ferry restrictions still apply.

Sleep validation checks known building, condition, current residence or held
lease, real bed index/capacity, and reachable room geometry. Held commons and
residential beds remain usable only until their existing rights expire; no new
lease or allocation is created. Interior movement validates actual coordinates,
individual cached steps, and completion at the real exit. Outdoor movement keeps
its ordinary live route checks.

## Findings and corrections

The initial independent suite was red on the original behavior: malformed birth
data suppressed personal eating/sleeping and did not distinguish unknown age
from a known infant. Review also identified the need to recheck expression,
physical beds, and a future birth date becoming a valid infant during a meal.

A later review found a concrete cached-room-exit teleport. After starting an
unknown-age person's movement from their bed, replacing the existing exit
journey's path with an empty array caused `moveInRoom` to clear `inside` and
`roomAt` while the person was still at bed coordinates `{x:2,y:5}`. Merely proving
that some exit route existed did not prove that this journey had traversed it.
The implementation now includes unknown-age self-care in the exit-completion
check for the building, target, outdoor door, and actual interior entry position.
The independent reproduction failed before that correction and passes after it.
A separately blocked next interior cell also cancels movement without teleporting,
even when another route exists.

Two test expectations were corrected without changing production: first context
construction lazily initializes unrelated definitions, so menu-purity comparisons
warm that initialization; known infants retain automatic rest physiology, so the
cancelled-sleep test compares against an otherwise identical no-action baseline.

## Independent verification

Passed on the final reviewed code:

`node --import tsx --test tests/unknown-age-selfcare-review.test.ts`

**50 tests passed, zero failed, zero skipped.** Coverage includes missing, null,
nonfinite, coercible and unsafe birth values; known infant/six-year/adult bounds;
strict no-new-rights checks; actual food consumption and bed recovery; live age,
expression, decision, residency, inventory and bed loss; forgotten home; existing
commons/residential bed expiry; normal and newly blocked outdoor movement;
invalid/missing interior coordinates; stale cached steps and empty exits; cached
meal capability loss; future birth during execution and rescue forecasting; and
read-only rescue forecasts; and retention of a nearby timely held bed alongside
a distant legal bed. Production code and tests are now frozen for the parent
task’s full offline validation.

## Limits

These checks use synthetic worlds and local engine execution. The independent
suite does not call a model, access real saves or credentials, use a browser,
install packages, or publish changes. It does not claim long-run real-model
acceptance or full-repository validation. The implementing task owns the primary
runtime/SQLite deadline integration tests, broader regressions, and final type
checks. Scope is the new unknown-age self-care allowance, not a general rewrite
of all known-age movement, physiology, or authority rules.

## Follow-up: held-bed candidate visibility

The final pre-freeze audit identified a second concrete issue: choosing only the
lexicographically first held alternative bed before menu compaction can permanently
hide a nearby, timely bed behind a distant but physically reachable one. The
50th independent test gives the resident two genuine known commons stays. The
far bed is legal and reachable but its rescue forecast is false; the resident is
already at the nearby bed and its forecast is true. The initial implementation
failed because the final menu omitted that nearby bed.

The implementation now enumerates every legal known held-bed candidate before
the existing final-menu compaction and rotation, rather than permanently
selecting one by identifier. Each candidate still passes the same physical and
legal guard. This does not allocate beds or choose an action. The final rerun
passes all 50 independent cases, including this final-menu/forecast regression.
