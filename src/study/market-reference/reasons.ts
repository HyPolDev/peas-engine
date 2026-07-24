import { assertJsonWithinLimits, canonicalJson, type JsonValue } from "../../core/json.js";
import { validateCanonicalMarketReason } from "../../providers/market-reference/contracts.js";
import { STUDY_BOUND_IDS } from "./bounds.js";
import { StudyContractError } from "./contracts.js";

type StudyReasonDefinition = Readonly<{
  disposition: "fatal" | "frame-disposition" | "retained-outcome" | "metric-missing" | "annotation";
  scopes: readonly (
    | "design"
    | "frame"
    | "candidate"
    | "cluster"
    | "metric"
    | "dataset"
    | "replay"
  )[];
  detail: null | Readonly<{ key: string; values: readonly string[] }>;
  marketEvidence: boolean;
}>;

const detail = (key: string, values: readonly string[]) => ({ key, values }) as const;
const definition = (
  disposition: StudyReasonDefinition["disposition"],
  scopes: StudyReasonDefinition["scopes"],
  reasonDetail: StudyReasonDefinition["detail"] = null,
  marketEvidence = false,
): StudyReasonDefinition => ({ disposition, scopes, detail: reasonDetail, marketEvidence });

export const STUDY_REASON_CATALOG = Object.freeze({
  "study.bound-exceeded": definition(
    "fatal",
    ["design", "frame", "cluster", "metric", "dataset"],
    detail("limitKind", STUDY_BOUND_IDS),
  ),
  "study.input-invalid": definition("fatal", ["design", "frame", "cluster", "metric", "dataset"]),
  "study.frame-not-frozen": definition(
    "fatal",
    ["design", "frame"],
    detail("frameFailureKind", [
      "snapshot-missing",
      "snapshot-mutable",
      "seed-unfrozen",
      "policy-unfrozen",
      "contract-unbound",
    ]),
  ),
  "study.freeze-after-outcome": definition(
    "fatal",
    ["design", "frame"],
    detail("freezeFailureKind", ["equal-to-first-outcome", "after-first-outcome"]),
  ),
  "study.outcome-leakage": definition(
    "fatal",
    ["design", "frame", "candidate"],
    detail("leakageFieldKind", [
      "actual-release",
      "price",
      "latency",
      "condition",
      "availability",
      "correction",
      "market-result",
      "post-frame",
    ]),
  ),
  "study.duplicate-cluster": definition(
    "fatal",
    ["frame", "cluster"],
    detail("duplicateFailureKind", ["duplicate-identity", "conflicting-preimage"]),
  ),
  "study.quota-insufficient": definition(
    "fatal",
    ["frame"],
    detail("quotaKind", ["lane", "control", "stratum"]),
  ),
  "study.rank-invalid": definition(
    "fatal",
    ["frame"],
    detail("rankFailureKind", ["seed", "hash", "ordering", "allocation"]),
  ),
  "study.primary-provider-unfrozen": definition(
    "fatal",
    ["design", "frame"],
    detail("providerFreezeKind", [
      "provider",
      "dataset",
      "feed",
      "endpoint",
      "entitlement",
      "fallback",
    ]),
  ),
  "study.anchor-policy-invalid": definition(
    "fatal",
    ["design", "frame"],
    detail("anchorFailureKind", [
      "capture-not-primary",
      "retrieval-not-required",
      "policy-missing",
      "retrieved-at-reinterpreted",
    ]),
  ),
  "study.replay-mismatch": definition("fatal", ["replay", "dataset"]),
  "study.frame-candidate-invalid": definition(
    "frame-disposition",
    ["candidate"],
    detail("candidateFailureKind", [
      "schedule",
      "issuer",
      "instrument",
      "fiscal-period",
      "source-conflict",
    ]),
  ),
  "study.instrument-out-of-scope": definition("frame-disposition", ["candidate"]),
  "study.share-class-not-selected": definition("frame-disposition", ["candidate"]),
  "study.release-not-observed": definition(
    "retained-outcome",
    ["cluster"],
    detail("releaseFailureKind", ["cancelled", "postponed", "outside-window", "not-captured"]),
  ),
  "study.timeliness-threshold-not-met": definition("retained-outcome", ["metric"]),
  "study.publication-time-insufficient": definition("metric-missing", ["metric"]),
  "study.anchor-clock-insufficient": definition(
    "metric-missing",
    ["metric"],
    detail("basisKind", ["capture", "retrieval", "capture-minus-retrieval"]),
  ),
  "study.latency-ambiguous": definition("metric-missing", ["metric"]),
  "study.prior-close-missing": definition("metric-missing", ["metric"], null, true),
  "study.reference-window-missing": definition(
    "metric-missing",
    ["metric"],
    detail("endpointKind", [
      "pre-release",
      "first-observation",
      "plus-1m",
      "plus-5m",
      "plus-30m",
      "sensitivity",
    ]),
    true,
  ),
  "study.correction-semantics-unknown": definition(
    "metric-missing",
    ["metric"],
    detail("correctionFailureKind", [
      "original-admission",
      "revision-arrival",
      "cancellation",
      "cutoff-evidence",
    ]),
    true,
  ),
  "study.metric-not-evaluable": definition("metric-missing", ["metric"]),
  "study.schedule-changed": definition("annotation", ["cluster"]),
  "study.t-minus-one-missing": definition("annotation", ["cluster"]),
  "study.identity-changed": definition(
    "annotation",
    ["cluster"],
    detail("identityChangeKind", ["issuer", "instrument", "share-class"]),
  ),
  "study.provider-disagreement": definition("annotation", ["metric", "cluster"], null, true),
  "study.provider-not-comparable": definition("annotation", ["metric", "cluster"], null, true),
  "study.correction-after-cutoff": definition("annotation", ["metric", "cluster"], null, true),
  "study.concurrent-event": definition(
    "annotation",
    ["cluster"],
    detail("contaminationKind", [
      "issuer-release",
      "macro-release",
      "trading-halt",
      "corporate-action",
    ]),
  ),
  "study.market-quality-degraded": definition(
    "annotation",
    ["metric", "cluster"],
    detail("qualityKind", [
      "halt",
      "stale",
      "locked",
      "crossed",
      "one-sided",
      "condition-ineligible",
    ]),
    true,
  ),
  "study.outlier-retained": definition("annotation", ["metric"]),
  "study.liquidity-unknown": definition("annotation", ["candidate", "cluster"]),
} as const satisfies Readonly<Record<string, StudyReasonDefinition>>);

export type StudyReasonCodeV1 = keyof typeof STUDY_REASON_CATALOG;

export type StudyReasonV1 = Readonly<{
  code: StudyReasonCodeV1;
  disposition: StudyReasonDefinition["disposition"];
  scope: StudyReasonDefinition["scopes"][number];
  detail: Readonly<Record<string, string>> | null;
  marketResultId: string | null;
  preservedMarketReason: Readonly<{
    code: string;
    disposition: "rejected" | "ineligible" | "missing" | "degraded" | "annotation";
    scope: string;
    detail: JsonValue;
  }> | null;
}>;

function exactRecord(
  value: unknown,
  keys: readonly string[],
  path: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new StudyContractError("study.input-invalid", `${path} must be an exact object`);
  }
  const actual = Object.keys(value).sort();
  if (canonicalJson(actual) !== canonicalJson([...keys].sort())) {
    throw new StudyContractError("study.input-invalid", `${path} has missing or extra keys`);
  }
  return value as Record<string, unknown>;
}

export function validateStudyReason(value: unknown): StudyReasonV1 {
  assertJsonWithinLimits(
    value,
    {
      maxDepth: 5,
      maxNodes: 32,
      maxArrayLength: 1,
      maxObjectKeys: 6,
      maxStringBytes: 512,
      maxCanonicalBytes: 4_096,
    },
    "studyReason",
  );
  const record = exactRecord(
    value,
    ["code", "disposition", "scope", "detail", "marketResultId", "preservedMarketReason"],
    "studyReason",
  );
  if (
    typeof record["code"] !== "string" ||
    !(record["code"] in STUDY_REASON_CATALOG) ||
    record["code"] === "study.anchor-human-decision-unresolved"
  ) {
    throw new StudyContractError("study.input-invalid", "study reason code is not canonical");
  }
  const code = record["code"] as StudyReasonCodeV1;
  const rule = STUDY_REASON_CATALOG[code];
  if (
    record["disposition"] !== rule.disposition ||
    !rule.scopes.includes(record["scope"] as never)
  ) {
    throw new StudyContractError("study.input-invalid", "study reason disposition/scope mismatch");
  }
  if (rule.detail === null) {
    if (record["detail"] !== null) {
      throw new StudyContractError("study.input-invalid", "study reason detail must be null");
    }
  } else {
    const reasonDetail = exactRecord(record["detail"], [rule.detail.key], "studyReason.detail");
    if (
      typeof reasonDetail[rule.detail.key] !== "string" ||
      !rule.detail.values.includes(reasonDetail[rule.detail.key] as never)
    ) {
      throw new StudyContractError("study.input-invalid", "study reason detail is not canonical");
    }
  }
  const hasMarketId = record["marketResultId"] !== null;
  const hasPreserved = record["preservedMarketReason"] !== null;
  if (hasMarketId !== hasPreserved || hasMarketId !== rule.marketEvidence) {
    throw new StudyContractError(
      "study.input-invalid",
      "study reason market evidence nullability is invalid",
    );
  }
  if (hasMarketId) {
    if (
      typeof record["marketResultId"] !== "string" ||
      !/^(?:msr1|mmr1)_[0-9a-f]{64}$/u.test(record["marketResultId"])
    ) {
      throw new StudyContractError("study.input-invalid", "study market result ID is invalid");
    }
    const preserved = exactRecord(
      record["preservedMarketReason"],
      ["code", "disposition", "scope", "detail"],
      "preservedMarketReason",
    );
    validateCanonicalMarketReason({ code: preserved["code"], detail: preserved["detail"] });
    if (
      !["rejected", "ineligible", "missing", "degraded", "annotation"].includes(
        preserved["disposition"] as string,
      ) ||
      typeof preserved["scope"] !== "string" ||
      preserved["scope"].length === 0
    ) {
      throw new StudyContractError("study.input-invalid", "preserved market reason is invalid");
    }
  }
  return value as StudyReasonV1;
}

export function validateStudyErrorReason(
  code: string,
  detailValue: Readonly<Record<string, string>> | null,
): void {
  const rule = STUDY_REASON_CATALOG[code as StudyReasonCodeV1];
  if (rule === undefined || rule.disposition !== "fatal") {
    throw new TypeError(`StudyContractError code is not a closed fatal study reason: ${code}`);
  }
  const scope = rule.scopes[0];
  validateStudyReason({
    code,
    disposition: "fatal",
    scope,
    detail: detailValue,
    marketResultId: null,
    preservedMarketReason: null,
  });
}
