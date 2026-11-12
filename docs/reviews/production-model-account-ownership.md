# Account registry independent review

## Reviewed scope

Disconnected `production-model-account-ownership.ts` only. No credentials, real
provider requests or real saved worlds were used. This is not production or
long-duration model acceptance. The formal entry remains unchanged and closed.

An independent reviewer found no blocking defect within the cooperative,
single-host primitive contract and added five adversarial tests:

- a 0750 registry directory is refused;
- wrong reconciliation does not clear an unresolved reservation;
- replacing the registry inode prevents clean release;
- a separate registry does not share the gate (explicit guarantee boundary);
- `closeClean` is only a trusted caller claim, not verified child completion.

Together with the original five subprocess/lifecycle cases, the focused suite
passes 10/10. TypeScript `npm run check` passes. No full-suite or remote CI pass
is claimed by this document.

## Integration requirements (not yet implemented)

The supervisor must verify child exit and durable matching pending-free journal
and world state before clean release. Unknown results must remain unresolved via
`abandon`, without retry. A reconciliation hash cannot authenticate external
provider evidence. All cooperating worlds must use the same registry and stable
account label. The primitive is not cross-host coordination or a free-price
attestation mechanism.
