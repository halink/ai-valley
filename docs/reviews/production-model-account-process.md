# Synthetic fixed worker/watchdog review

Independent reviewer inspected the concrete adapter and added a separate test
file. No blocking live-escape or false-clean path was found. Three independent
checks passed: durable intent-only fault, durable response-without-ack fault,
and rejection of a gated/live contract before spawn. These overlap main test
coverage and are not three extra implemented features.

Initial implementation run: 3/4. The failing assertion incorrectly demanded
SIGKILL after the blocked worker had already terminated under SIGTERM; it was
changed to require actual group cleanup and unresolved reservation instead.
Second run: 5/5, including actual caller SIGKILL. Expanded run: 6/6, adding
actual worker SIGKILL, plus persisted unmatched journal assertions. These runs
are synthetic: no key, real save or provider request was used. Broad targeted
regression and early-disconnect behavior are tracked separately in local logs.

Known limits: trusted caller supplies synthetic artifacts; no enforced synthetic
path marker. Immutable JS guard is defense in depth, not an adversarial sandbox.
Unknown child/descendant cleanup is never promoted to success. Same-host/shared
registry coordination only. This does not complete the production launcher or
real-model long-run acceptance. Price/account statements are not authenticated.
