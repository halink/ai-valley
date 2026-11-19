import {randomUUID} from "node:crypto";
import {closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readSync, renameSync, unlinkSync, writeFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {
  isEnabledValleySpiritFruitFallPolicy, isValleySpiritFruitFallProposal, preflightValleySpiritFruitFall,
  VALLEY_SPIRIT_SHADOW_REJECTIONS, type ValleySpiritFruitFallEvidence, type ValleySpiritFruitFallPolicy,
  type ValleySpiritFruitFallPreflight, type ValleySpiritFruitFallProposal,
} from "./valley-spirit-proposal.js";

const SCHEMA = "valley-spirit-shadow-queue/v1" as const;
const MAX_BYTES = 1024 * 1024;
const MAX_ENTRIES = 256;
type Rejection = Extract<ValleySpiritFruitFallPreflight, {status: "rejected"}>["code"];
type Pending = Readonly<{status: "proposed"}>;
type Terminal = Readonly<
  | {status: "validated_shadow"; checkedAtMicroMinute: number}
  | {status: "rejected"; checkedAtMicroMinute: number; code: Rejection}
  | {status: "expired"; checkedAtMicroMinute: number}
>;
export interface ValleySpiritShadowEntry {
  readonly proposal: ValleySpiritFruitFallProposal;
  readonly policy: ValleySpiritFruitFallPolicy;
  readonly appendedAtMicroMinute: number;
  /** Advisory workflow state, not world history. No effect ID, accepted, scheduled, or execution state. */
  readonly assessment: Pending | Terminal;
}

interface QueueState {
  readonly schema: typeof SCHEMA;
  readonly worldId: string;
  readonly entries: readonly ValleySpiritShadowEntry[];
}

export interface ValleySpiritShadowEvidenceReader {
  /** Trusted adapter must be detached/read-only and match the exact pinned option; no live service or write capabilities. */
  readFruitFallEvidence(proposal: ValleySpiritFruitFallProposal): ValleySpiritFruitFallEvidence | undefined;
}

export type ValleySpiritShadowCheck =
  | ValleySpiritFruitFallPreflight
  | {status: "unavailable"; code: "evidence_unavailable"};

/** Scientific projection only; never persists a review, reserves quota, or schedules activity. */
export function inspectValleySpiritShadow(
  entry: ValleySpiritShadowEntry,
  evidenceReader: ValleySpiritShadowEvidenceReader,
  currentPolicy?: ValleySpiritFruitFallPolicy,
): ValleySpiritShadowCheck {
  if (!isEnabledValleySpiritFruitFallPolicy(currentPolicy) || !isEnabledValleySpiritFruitFallPolicy(entry.policy) ||
      !isEqualRecord(entry.policy, currentPolicy)) return {status: "disabled", code: "shadow_disabled_or_policy_invalid"};
  try {
    const evidence = evidenceReader.readFruitFallEvidence(structuredClone(entry.proposal));
    if (!evidence) return {status: "unavailable", code: "evidence_unavailable"};
    const result = preflightValleySpiritFruitFall(entry.proposal, structuredClone(evidence), entry.policy);
    return result.status === "rejected" && result.code === "evidence_unavailable"
      ? {status: "unavailable", code: "evidence_unavailable"} : result;
  } catch {
    return {status: "unavailable", code: "evidence_unavailable"};
  }
}

type Failure = {readonly status: "blocked"; readonly code:
  "queue_isolated" | "invalid_request" | "capacity" | "proposal_conflict" | "not_found" | "evidence_unavailable" | "shadow_disabled"};
type QueueWrite = Failure | {readonly status: "stored" | "unchanged"; readonly entry: ValleySpiritShadowEntry};
const blocked = (code: Failure["code"]): Failure => ({status: "blocked", code});
const natural = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const exact = (v: unknown, keys: readonly string[]): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === keys.length &&
  keys.every(k => Object.hasOwn(v, k));

function validEntry(v: unknown, worldId: string): v is ValleySpiritShadowEntry {
  if (!exact(v, ["proposal", "policy", "appendedAtMicroMinute", "assessment"]) ||
      !isValleySpiritFruitFallProposal(v.proposal) || v.proposal.worldId !== worldId ||
      !isEnabledValleySpiritFruitFallPolicy(v.policy) || !natural(v.appendedAtMicroMinute) ||
      v.appendedAtMicroMinute >= v.proposal.validUntilMicroMinute) return false;
  const a = v.assessment as Record<string, unknown> | undefined;
  if (!a || typeof a !== "object") return false;
  if (a.status === "proposed") return exact(a, ["status"]);
  if (!natural(a.checkedAtMicroMinute) || a.checkedAtMicroMinute < v.appendedAtMicroMinute) return false;
  if (a.status === "validated_shadow") return exact(a, ["status", "checkedAtMicroMinute"]) &&
    a.checkedAtMicroMinute >= v.proposal.validFromMicroMinute && a.checkedAtMicroMinute < v.proposal.validUntilMicroMinute;
  if (a.status === "expired") return exact(a, ["status", "checkedAtMicroMinute"]) &&
    a.checkedAtMicroMinute >= v.proposal.validUntilMicroMinute;
  return a.status === "rejected" && exact(a, ["status", "checkedAtMicroMinute", "code"]) &&
    VALLEY_SPIRIT_SHADOW_REJECTIONS.includes(a.code as Rejection) && a.code !== "invalid_proposal" &&
    a.code !== "evidence_unavailable" && a.checkedAtMicroMinute < v.proposal.validUntilMicroMinute;
}

function readState(bytes: Buffer, worldId: string): QueueState {
  const state: unknown = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));
  if (!exact(state, ["schema", "worldId", "entries"]) || state.schema !== SCHEMA || state.worldId !== worldId ||
      !Array.isArray(state.entries) || state.entries.length > MAX_ENTRIES ||
      !state.entries.every(e => validEntry(e, worldId)) ||
      new Set(state.entries.map(e => e.proposal.proposalId)).size !== state.entries.length) throw Error("unknown_shadow_queue");
  if (!bytes.equals(Buffer.from(JSON.stringify(state), "utf8"))) throw Error("noncanonical_shadow_queue");
  return {schema: SCHEMA, worldId, entries: state.entries};
}

function readBytes(path: string): Buffer | null {
  let stat;
  try { stat = lstatSync(path); }
  catch (err) { if ((err as NodeJS.ErrnoException).code === "ENOENT") return null; throw err; }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > MAX_BYTES) throw Error("unsafe_shadow_queue");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1 || opened.ino !== stat.ino || opened.dev !== stat.dev ||
        opened.size !== stat.size) throw Error("shadow_queue_changed");
    const bytes = Buffer.allocUnsafe(opened.size + 1);
    let count = 0;
    while (count < bytes.length) {
      const read = readSync(fd, bytes, count, bytes.length - count, count);
      if (read === 0) break;
      count += read;
    }
    const final = fstatSync(fd);
    if (count !== opened.size || final.mtimeMs !== opened.mtimeMs ||
      final.ctimeMs !== opened.ctimeMs || final.nlink !== 1) throw Error("shadow_queue_changed");
    return bytes.subarray(0, count);
  } finally {closeSync(fd);}
}

const sameBytes = (a: Buffer | null, b: Buffer | null) => a === null || b === null ? a === b : a.equals(b);

/** Independent private G1 sidecar. The supplied ownership check protects the path for the entire runtime lock lifetime. */
export class ValleySpiritShadowQueue {
  private readonly path: string;
  private isolated = false;
  private state: QueueState;
  private disk: Buffer | null = null;

  constructor(worldDatabase: string, readonly worldId: string, private readonly assertOwned: () => void) {
    this.path = resolve(worldDatabase) + ".valley-spirit-shadow-v1.json";
    this.state = {schema: SCHEMA, worldId, entries: []};
    try {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,199}$/u.test(worldId)) throw Error("invalid_world_id");
      assertOwned();
      this.disk = readBytes(this.path);
      if (this.disk) this.state = readState(this.disk, worldId);
    } catch {this.isolated = true;}
  }

  /** No list/export route. Internal callers must reapply current permissions before exposing any proposal content. */
  get(proposalId: string): {status: "found"; entry: ValleySpiritShadowEntry} | Failure {
    if (!this.current()) return blocked("queue_isolated");
    const entry = this.state.entries.find(e => e.proposal.proposalId === proposalId);
    return entry ? {status: "found", entry: structuredClone(entry)} : blocked("not_found");
  }

  private current(): boolean {
    if (this.isolated) return false;
    try {
      this.assertOwned();
      if (!sameBytes(readBytes(this.path), this.disk)) throw Error("external_shadow_queue_change");
      return true;
    } catch {this.isolated = true; return false;}
  }

  append(proposal: ValleySpiritFruitFallProposal, policy: ValleySpiritFruitFallPolicy, atMicroMinute: number): QueueWrite {
    if (!this.current()) return blocked("queue_isolated");
    const entry: ValleySpiritShadowEntry = {proposal, policy, appendedAtMicroMinute: atMicroMinute, assessment: {status: "proposed"}};
    if (!validEntry(entry, this.worldId)) return blocked("invalid_request");
    const old = this.state.entries.find(e => e.proposal.proposalId === proposal.proposalId);
    if (old) {
      // Same proposal ID may be retried exactly, never re-open or opportunistically change its terms.
      return old.appendedAtMicroMinute === atMicroMinute &&
        isEqualRecord(old.proposal, proposal) && isEqualRecord(old.policy, policy)
        ? {status: "unchanged", entry: structuredClone(old)} : blocked("proposal_conflict");
    }
    if (this.state.entries.length >= MAX_ENTRIES) return blocked("capacity");
    return this.write(entry, [...this.state.entries, entry]);
  }

  /** Separate from read-only inspect. Recomputes the advisory assessment from detached facts;
   * no prior caller result can be promoted, and no unknown evidence is terminalized. */
  recordAssessment(proposalId: string, evidence: ValleySpiritFruitFallEvidence | undefined,
    currentPolicy?: ValleySpiritFruitFallPolicy): QueueWrite {
    if (!this.current()) return blocked("queue_isolated");
    const old = this.state.entries.find(e => e.proposal.proposalId === proposalId);
    if (!old) return blocked("not_found");
    if (!isEnabledValleySpiritFruitFallPolicy(currentPolicy) || !isEqualRecord(old.policy, currentPolicy)) return blocked("shadow_disabled");
    if (old.assessment.status !== "proposed") return {status: "unchanged", entry: structuredClone(old)};
    let facts;
    try {facts = structuredClone(evidence);} catch {return blocked("evidence_unavailable");}
    const result = preflightValleySpiritFruitFall(old.proposal, facts, old.policy);
    if (!facts || !natural(facts.nowMicroMinute) || facts.nowMicroMinute < old.appendedAtMicroMinute ||
        result.status === "disabled" || (result.status === "rejected" &&
          (result.code === "evidence_unavailable" || result.code === "invalid_proposal"))) return blocked("evidence_unavailable");
    const checkedAtMicroMinute = facts.nowMicroMinute;
    const assessment: Terminal = result.status === "validated_shadow" ? {status: "validated_shadow", checkedAtMicroMinute}
      : checkedAtMicroMinute >= old.proposal.validUntilMicroMinute ? {status: "expired", checkedAtMicroMinute}
        : {status: "rejected", checkedAtMicroMinute, code: result.code};
    const entry = {...old, assessment};
    return this.write(entry, this.state.entries.map(e => e === old ? entry : e));
  }

  private write(entry: ValleySpiritShadowEntry, entries: readonly ValleySpiritShadowEntry[]): QueueWrite {
    if (!validEntry(entry, this.worldId)) return blocked("invalid_request");
    const next = {...this.state, entries};
    const bytes = Buffer.from(JSON.stringify(next), "utf8");
    if (bytes.length > MAX_BYTES) return blocked("capacity");
    let validated: QueueState;
    try {validated = readState(bytes, this.worldId);} catch {return blocked("invalid_request");}
    let tmp: string | undefined;
    let fd: number | undefined;
    try {
      if (!this.current()) return blocked("queue_isolated");
      tmp = this.path + "." + randomUUID() + ".tmp";
      fd = openSync(tmp, constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_WRONLY, 0o600);
      writeFileSync(fd, bytes);
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      if (!this.current()) return blocked("queue_isolated");
      renameSync(tmp, this.path);
      tmp = undefined;
      const parent = openSync(dirname(this.path), constants.O_RDONLY | constants.O_DIRECTORY);
      try {fsyncSync(parent);} finally {closeSync(parent);}
      this.disk = bytes;
      this.state = validated;
      return {status: "stored", entry: structuredClone(entry)};
    } catch {
      this.isolated = true;
      return blocked("queue_isolated");
    } finally {
      if (fd !== undefined) try {closeSync(fd);} catch {/* preserve primary failure */}
      if (tmp !== undefined) try {unlinkSync(tmp);} catch {/* never read an uncommitted tmp file */}
    }
  }
}

function isEqualRecord(a: object, b: object): boolean {
  const key = (v: object) => JSON.stringify(Object.entries(v).sort(([x], [y]) => x < y ? -1 : x === y ? 0 : 1));
  return key(a) === key(b);
}
