# Account supervision policy review

Independent review found a startup gap in the first draft: persistent artifacts
were checked only after child exit. This has been corrected by running the same
locked identity/replay check before `launch`. Failed preflight preserves an
already-reserved account as unresolved. Expired/future contracts are refused and
setup time is deducted from the bounded execution allowance. Numeric process
options are copied so later caller mutation cannot enlarge the bound.

Verification uses disposable synthetic worlds, journals and account registries.
The fixed Node child only exits or blocks. It never calls a model. Six integration
cases cover OS clean exit, old pending refusal, nonzero exit, timeout, account
contention before launch, and artifact disappearance. Four independent review
cases cover pending, prior failure, wrong world and expired contract before launch.
The focused combined result is **10/10 passed**. TypeScript check passes; this is
not a full-suite result or a real-provider/long-duration acceptance result.

Review acceptance is limited to the documented disconnected trusted policy.
The process adapter is trusted, while durable completion is verified by the
implementation rather than a caller-supplied boolean. A fixed production worker,
independent watchdog and parent-death wiring remain absent. `main` stays closed.
Local completion does not attest pricing, remote cancellation or actual cost.
