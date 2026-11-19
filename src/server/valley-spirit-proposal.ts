import {valleySpiritFruitFallOpportunityId} from "../shared/valley-spirit-effects.js";
export {valleySpiritFruitFallOpportunityId} from "../shared/valley-spirit-effects.js";

/** Internal only. This module has no World, storage, network, scheduler or effect access. */
const KIND = "fruit_fall" as const;
const VERSION = 1 as const;
const SCHEMA = "valley-spirit-proposal/v1" as const;
const UNIT = 1_000_000;
const MAX_SOURCE_REFS = 16;
const MAX_REASON = 240;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,199}$/;
const REF = /^[a-zA-Z0-9][a-zA-Z0-9:._/-]{0,399}$/;
const isId = (value: unknown): value is string => typeof value === "string" && ID.test(value);
const natural = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export interface ValleySpiritFruitFallOption {
  readonly worldId: string;
  readonly menuVersion: string;
  readonly inputSnapshotId: string;
  readonly permissionVersion: number;
  readonly sourceRefs: readonly string[];
  readonly rainEventId: string;
  readonly sourceResourceInstanceId: string;
  readonly targetId: string;
  readonly quantity: 1;
  readonly validFromMicroMinute: number;
  readonly validUntilMicroMinute: number;
}

export interface ValleySpiritFruitFallProposal extends ValleySpiritFruitFallOption {
  readonly schema: typeof SCHEMA;
  readonly proposalId: string;
  readonly opportunityId: string;
  readonly type: typeof KIND;
  /** Diagnostic only. Never used by policy or accepted as a command. */
  readonly rationale: string;
}

function validOption(option: ValleySpiritFruitFallOption): boolean {
  return [
    option.worldId, option.menuVersion, option.inputSnapshotId,
    option.rainEventId, option.sourceResourceInstanceId, option.targetId,
  ].every(isId) && natural(option.permissionVersion) && option.permissionVersion > 0 && option.quantity === 1 && natural(option.validFromMicroMinute) &&
    natural(option.validUntilMicroMinute) && option.validFromMicroMinute < option.validUntilMicroMinute &&
    Array.isArray(option.sourceRefs) && option.sourceRefs.length >= 1 && option.sourceRefs.length <= MAX_SOURCE_REFS &&
    [...option.sourceRefs].every(ref => typeof ref === "string" && REF.test(ref)) && new Set(option.sourceRefs).size === option.sourceRefs.length;
}

export interface ValleySpiritProposalChoice {
  readonly optionNumber: number;
  readonly rationale: string;
}

export type ValleySpiritProposalBuild =
  | {readonly status: "proposed"; readonly proposal: ValleySpiritFruitFallProposal}
  | {readonly status: "rejected"; readonly code: "invalid_choice" | "invalid_menu" | "invalid_proposal_id"};

function parseChoice(value: unknown): ValleySpiritProposalChoice | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const choice = value as Record<string, unknown>;
  const keys = Object.keys(choice);
  if (keys.length !== 2 || !keys.includes("optionNumber") || !keys.includes("rationale")) return;
  const {optionNumber, rationale} = choice;
  if (!natural(optionNumber) || optionNumber < 1 || typeof rationale !== "string" || rationale.length > MAX_REASON ||
      /[\u0000-\u001f\u007f]/u.test(rationale) || !rationale.trim()) return;
  return {optionNumber, rationale: rationale.trim()};
}

/** Only a numbered, caller-supplied option is accepted. Model-supplied IDs, quantities, and coordinates are not inputs. */
export function proposeValleySpiritFruitFall(
  proposalId: string,
  menu: readonly ValleySpiritFruitFallOption[],
  rawChoice: unknown,
): ValleySpiritProposalBuild {
  if (!isId(proposalId)) return {status: "rejected", code: "invalid_proposal_id"};
  const choice = parseChoice(rawChoice);
  if (!choice || choice.optionNumber > menu.length) return {status: "rejected", code: "invalid_choice"};
  const option = menu[choice.optionNumber - 1];
  if (!option || !validOption(option)) return {status: "rejected", code: "invalid_menu"};
  const proposal: ValleySpiritFruitFallProposal = {
    schema: SCHEMA,
    proposalId,
    worldId: option.worldId,
    menuVersion: option.menuVersion,
    inputSnapshotId: option.inputSnapshotId,
    permissionVersion: option.permissionVersion,
    sourceRefs: Object.freeze([...option.sourceRefs]),
    type: KIND,
    rainEventId: option.rainEventId,
    sourceResourceInstanceId: option.sourceResourceInstanceId,
    targetId: option.targetId,
    quantity: 1,
    validFromMicroMinute: option.validFromMicroMinute,
    validUntilMicroMinute: option.validUntilMicroMinute,
    opportunityId: valleySpiritFruitFallOpportunityId(option.worldId, option.rainEventId, option.sourceResourceInstanceId),
    rationale: choice.rationale,
  };
  return {status: "proposed", proposal: Object.freeze(proposal)};
}

/** Frozen policy values belong to the caller's independently approved/sandbox config, not model output. */
export interface ValleySpiritFruitFallPolicy {
  readonly version: typeof VERSION;
  readonly shadowEnabled: boolean;
  readonly maxAgeGameMinutes: number;
  readonly minimumCooldownGameMinutes: number;
}

export interface ValleySpiritClosedRainEvidence {
  readonly type: "committed_actual_rain";
  readonly worldId: string;
  readonly rainEventId: string;
  readonly endedUs: string;
}

/** Detached projection of authoritative facts. No DB, clock, event hooks or writable engine capability. */
export interface ValleySpiritFruitFallEvidence {
  readonly worldId: string;
  readonly nowMicroMinute: number;
  readonly approvedBasis: {
    readonly inputSnapshotId: string;
    readonly menuVersion: string;
    readonly permissionVersion: number;
    readonly sourceRefs: readonly string[];
    /** Trusted exact option from the pinned menu, not synthesized from proposal fields. */
    readonly offeredOption: Pick<ValleySpiritFruitFallOption, "rainEventId" | "sourceResourceInstanceId" |
      "targetId" | "quantity" | "validFromMicroMinute" | "validUntilMicroMinute">;
  };
  readonly rain?: ValleySpiritClosedRainEvidence;
  readonly source?: {
    readonly resourceInstanceId: string;
    readonly ownerId: string;
    readonly ripeAvailable: number;
  };
  /** Reachability for this particular source/target pair in the detached authoritative projection. */
  readonly target?: {
    readonly id: string;
    readonly freeCapacity: number;
    readonly reachable: boolean;
    readonly preservesOwnerId: string;
    readonly supportsGroundFood: boolean;
    readonly supportsDiscovery: boolean;
    readonly supportsPickup: boolean;
  };
  /** Derived from the authoritative opportunity/cooldown/quota evidence. Unknown does not pass preflight. */
  readonly opportunityConsumed?: boolean;
  readonly proposalQuotaAvailable?: boolean;
  readonly lastCommittedFruitFallMicroMinute?: number | null;
}

export const VALLEY_SPIRIT_SHADOW_REJECTIONS = Object.freeze([
  "invalid_proposal", "evidence_unavailable", "permission_or_basis_changed", "outside_time_window",
  "rain_missing_or_ineligible", "source_unavailable", "target_ineligible", "opportunity_consumed", "quota_or_cooldown",
] as const);
type Rejection = typeof VALLEY_SPIRIT_SHADOW_REJECTIONS[number];

export type ValleySpiritFruitFallPreflight =
  | {readonly status: "disabled"; readonly code: "shadow_disabled_or_policy_invalid"}
  | {readonly status: "rejected"; readonly code: Rejection}
  | {readonly status: "validated_shadow"; readonly executionAuthorized: false; readonly projection: {
    readonly debitRipeFruit: 1;
    readonly creditGroundFruit: 1;
    readonly ownerId: string;
  }};

/** Exact persisted wire form. Unknown fields must not survive an independent queue rewrite. */
export function isValleySpiritFruitFallProposal(value: unknown): value is ValleySpiritFruitFallProposal {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const fields = ["schema", "proposalId", "opportunityId", "type", "worldId", "menuVersion", "inputSnapshotId",
    "permissionVersion", "sourceRefs", "rainEventId", "sourceResourceInstanceId", "targetId", "quantity",
    "validFromMicroMinute", "validUntilMicroMinute", "rationale"];
  if (Object.keys(value).length !== fields.length || !fields.every(field => Object.hasOwn(value, field))) return false;
  const p = value as ValleySpiritFruitFallProposal;
  return p.schema === SCHEMA && p.type === KIND && isId(p.proposalId) && validOption(p) &&
    p.opportunityId === valleySpiritFruitFallOpportunityId(p.worldId, p.rainEventId, p.sourceResourceInstanceId) &&
    parseChoice({optionNumber: 1, rationale: p.rationale})?.rationale === p.rationale && typeof p.rationale === "string";
}

/** Only exact enabled policies may be retained with a proposal. */
export function isEnabledValleySpiritFruitFallPolicy(value: unknown): value is ValleySpiritFruitFallPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const fields = ["version", "shadowEnabled", "maxAgeGameMinutes", "minimumCooldownGameMinutes"];
  if (Object.keys(value).length !== fields.length || !fields.every(field => Object.hasOwn(value, field))) return false;
  const policy = value as ValleySpiritFruitFallPolicy;
  return policy.version === VERSION && policy.shadowEnabled === true && natural(policy.maxAgeGameMinutes) &&
    policy.maxAgeGameMinutes > 0 && natural(policy.minimumCooldownGameMinutes) &&
    natural(policy.maxAgeGameMinutes * UNIT) && natural(policy.minimumCooldownGameMinutes * UNIT);
}

/** Internal shadow result. It is not an acceptance, receipt, or an authorization to schedule/write. */
export function preflightValleySpiritFruitFall(
  proposal: ValleySpiritFruitFallProposal,
  evidence: ValleySpiritFruitFallEvidence | undefined,
  policy?: ValleySpiritFruitFallPolicy,
): ValleySpiritFruitFallPreflight {
  if (!isEnabledValleySpiritFruitFallPolicy(policy)) return {status: "disabled", code: "shadow_disabled_or_policy_invalid"};
  const reject = (code: Rejection): ValleySpiritFruitFallPreflight => ({status: "rejected", code});
  if (!isValleySpiritFruitFallProposal(proposal)) return reject("invalid_proposal");
  if (!evidence || evidence.worldId !== proposal.worldId || !natural(evidence.nowMicroMinute) ||
      !evidence.approvedBasis || typeof evidence.opportunityConsumed !== "boolean" ||
      typeof evidence.proposalQuotaAvailable !== "boolean" ||
      (evidence.lastCommittedFruitFallMicroMinute !== null && (!natural(evidence.lastCommittedFruitFallMicroMinute) ||
        evidence.lastCommittedFruitFallMicroMinute > evidence.nowMicroMinute))) return reject("evidence_unavailable");
  const {approvedBasis, nowMicroMinute, rain, source, target} = evidence;
  if (approvedBasis.inputSnapshotId !== proposal.inputSnapshotId || approvedBasis.menuVersion !== proposal.menuVersion ||
    approvedBasis.permissionVersion !== proposal.permissionVersion ||
    !Array.isArray(approvedBasis.sourceRefs) || approvedBasis.sourceRefs.length !== proposal.sourceRefs.length ||
    [...approvedBasis.sourceRefs].some((ref, index) => ref !== proposal.sourceRefs[index]) || !approvedBasis.offeredOption ||
    (["rainEventId", "sourceResourceInstanceId", "targetId", "quantity", "validFromMicroMinute", "validUntilMicroMinute"] as const)
      .some(field => approvedBasis.offeredOption[field] !== proposal[field])) return reject("permission_or_basis_changed");
  if (nowMicroMinute < proposal.validFromMicroMinute || nowMicroMinute >= proposal.validUntilMicroMinute) return reject("outside_time_window");
  if (!rain || rain.type !== "committed_actual_rain" || rain.worldId !== proposal.worldId ||
    rain.rainEventId !== proposal.rainEventId || typeof rain.endedUs !== "string" || !/^(0|[1-9][0-9]{0,24})$/u.test(rain.endedUs)) {
    return reject("rain_missing_or_ineligible");
  }
  const ended = BigInt(rain.endedUs);
  const age = BigInt(nowMicroMinute) - ended;
  if (age < 0n || age > BigInt(policy.maxAgeGameMinutes * UNIT)) return reject("rain_missing_or_ineligible");
  if (!source || source.resourceInstanceId !== proposal.sourceResourceInstanceId || !isId(source.ownerId) ||
    !natural(source.ripeAvailable) || source.ripeAvailable < proposal.quantity) return reject("source_unavailable");
  if (!target || target.id !== proposal.targetId || target.reachable !== true || target.preservesOwnerId !== source.ownerId ||
    !natural(target.freeCapacity) || target.freeCapacity < proposal.quantity || target.supportsGroundFood !== true ||
    target.supportsDiscovery !== true || target.supportsPickup !== true) return reject("target_ineligible");
  if (evidence.opportunityConsumed) return reject("opportunity_consumed");
  if (!evidence.proposalQuotaAvailable || (evidence.lastCommittedFruitFallMicroMinute !== null &&
    nowMicroMinute - evidence.lastCommittedFruitFallMicroMinute < policy.minimumCooldownGameMinutes * UNIT)) return reject("quota_or_cooldown");
  return {status: "validated_shadow", executionAuthorized: false, projection: {debitRipeFruit: 1, creditGroundFruit: 1, ownerId: source.ownerId}};
}
