import {
  HOLM_SLOT_IDS,
  bootstrapPoolIndex,
  deriveBootstrapSeed,
  deriveBootstrapWord,
  validateHolmFamilySlots,
} from "./algorithms.js";
import { evaluateStudyBound } from "./bounds.js";
import {
  STUDY_BOOTSTRAP_REPLICATES,
  STUDY_HOLM_SLOTS,
  StudyContractError,
  type StudyLaneV1,
} from "./contracts.js";

export type StudyRationalV1 = Readonly<{ numerator: bigint; denominator: bigint }>;

function gcd(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

export function rational(numerator: bigint, denominator = 1n): StudyRationalV1 {
  if (denominator === 0n) {
    throw new StudyContractError("study.input-invalid", "rational denominator cannot be zero");
  }
  const sign = denominator < 0n ? -1n : 1n;
  const divisor = gcd(numerator, denominator);
  return { numerator: (numerator * sign) / divisor, denominator: (denominator * sign) / divisor };
}

export function compareRational(left: StudyRationalV1, right: StudyRationalV1): number {
  const difference = left.numerator * right.denominator - right.numerator * left.denominator;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function addRational(left: StudyRationalV1, right: StudyRationalV1): StudyRationalV1 {
  return rational(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

function multiplyRational(left: StudyRationalV1, right: StudyRationalV1): StudyRationalV1 {
  return rational(left.numerator * right.numerator, left.denominator * right.denominator);
}

export function exactMedian(values: readonly StudyRationalV1[]): StudyRationalV1 {
  if (values.length === 0) {
    throw new StudyContractError("study.input-invalid", "median requires a nonempty set");
  }
  const sorted = [...values].sort(compareRational);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] as StudyRationalV1;
  if (sorted.length % 2 === 1) return upper;
  return multiplyRational(
    addRational(sorted[middle - 1] as StudyRationalV1, upper),
    rational(1n, 2n),
  );
}

export function type7Quantile(
  sortedValues: readonly StudyRationalV1[],
  probability: StudyRationalV1,
): StudyRationalV1 {
  if (
    sortedValues.length === 0 ||
    probability.numerator < 0n ||
    probability.numerator > probability.denominator
  ) {
    throw new StudyContractError("study.input-invalid", "type-7 quantile input is invalid");
  }
  for (let index = 1; index < sortedValues.length; index += 1) {
    if (
      compareRational(
        sortedValues[index - 1] as StudyRationalV1,
        sortedValues[index] as StudyRationalV1,
      ) > 0
    ) {
      throw new StudyContractError("study.input-invalid", "quantile values are not sorted");
    }
  }
  const nMinusOne = BigInt(sortedValues.length - 1);
  const offsetNumerator = nMinusOne * probability.numerator;
  const lowerIndex = Number(offsetNumerator / probability.denominator);
  const remainder = offsetNumerator % probability.denominator;
  const lower = sortedValues[lowerIndex] as StudyRationalV1;
  if (remainder === 0n || lowerIndex === sortedValues.length - 1) return lower;
  const upper = sortedValues[lowerIndex + 1] as StudyRationalV1;
  return addRational(
    multiplyRational(lower, rational(probability.denominator - remainder, probability.denominator)),
    multiplyRational(upper, rational(remainder, probability.denominator)),
  );
}

export type BootstrapMetricRowV1 = Readonly<{
  studyClusterId: string;
  lane: StudyLaneV1;
  value: StudyRationalV1 | null;
}>;

export type BootstrapIntervalV1 =
  | Readonly<{ status: "unavailable"; replicates: null; lower: null; median: null; upper: null }>
  | Readonly<{
      status: "available";
      replicates: readonly StudyRationalV1[];
      lower: StudyRationalV1;
      median: StudyRationalV1;
      upper: StudyRationalV1;
    }>;

export function laneStratifiedBootstrap(
  input: Readonly<{
    rankSeedHex: string;
    studyDesignId: string;
    metricId:
      | "priorCloseMovementAtFirstObservation"
      | "releaseGapMovement"
      | "residualMovement1m"
      | "residualMovement5m"
      | "residualMovement30m";
    rows: readonly BootstrapMetricRowV1[];
    replicateCount?: number;
  }>,
): BootstrapIntervalV1 {
  const replicateCount = input.replicateCount ?? STUDY_BOOTSTRAP_REPLICATES;
  if (!evaluateStudyBound("bootstrapReplicates", replicateCount).accepted) {
    throw new StudyContractError(
      "study.input-invalid",
      "bootstrap must contain exactly 10000 replicates",
    );
  }
  if (
    input.rows.length !== 180 ||
    new Set(input.rows.map(({ studyClusterId }) => studyClusterId)).size !== 180
  ) {
    throw new StudyContractError(
      "study.input-invalid",
      "bootstrap input must retain 180 unique frozen clusters",
    );
  }
  for (const row of input.rows) {
    if (
      !["standard", "specialized", "prospective-control"].includes(row.lane) ||
      (row.value !== null && row.value.denominator <= 0n)
    ) {
      throw new StudyContractError("study.input-invalid", "bootstrap row is invalid");
    }
  }
  const lanes = ["standard", "specialized", "prospective-control"] as const;
  const pools = lanes.map((lane) =>
    input.rows
      .filter((row) => row.lane === lane && row.value !== null)
      .sort((left, right) =>
        Buffer.compare(Buffer.from(left.studyClusterId), Buffer.from(right.studyClusterId)),
      ),
  );
  if (pools.every((pool) => pool.length === 0)) {
    return { status: "unavailable", replicates: null, lower: null, median: null, upper: null };
  }
  const seed = deriveBootstrapSeed(input.rankSeedHex, input.studyDesignId);
  const replicates: StudyRationalV1[] = [];
  for (let replicateIndex = 0; replicateIndex < replicateCount; replicateIndex += 1) {
    const sample: StudyRationalV1[] = [];
    for (const [laneOrdinal, pool] of pools.entries()) {
      for (let drawIndex = 0; drawIndex < pool.length; drawIndex += 1) {
        let counter = 0n;
        for (;;) {
          const { word } = deriveBootstrapWord({
            bootstrapSeedHex: seed,
            metricId: input.metricId,
            replicateIndex,
            laneOrdinal: laneOrdinal as 0 | 1 | 2,
            drawIndex,
            counter,
          });
          const selectedIndex = bootstrapPoolIndex(word, pool.length);
          if (selectedIndex !== null) {
            sample.push(pool[selectedIndex]?.value as StudyRationalV1);
            break;
          }
          if (counter === 0xffff_ffff_ffff_ffffn) {
            throw new StudyContractError("study.input-invalid", "bootstrap counter overflow");
          }
          counter += 1n;
        }
      }
    }
    replicates.push(exactMedian(sample));
  }
  const sorted = replicates
    .map((value, replicateIndex) => ({ value, replicateIndex }))
    .sort(
      (left, right) =>
        compareRational(left.value, right.value) || left.replicateIndex - right.replicateIndex,
    )
    .map(({ value }) => value);
  return {
    status: "available",
    replicates,
    lower: type7Quantile(sorted, rational(1n, 40n)),
    median: exactMedian(sorted),
    upper: type7Quantile(sorted, rational(39n, 40n)),
  };
}

const DECIMAL_SCALE = 10n ** 36n;
const Z = 1_959_963_984_540_054n * 10n ** 21n;

function fixedMultiply(left: bigint, right: bigint): bigint {
  return (left * right) / DECIMAL_SCALE;
}

function integerSquareRoot(value: bigint): bigint {
  if (value < 0n) throw new StudyContractError("study.input-invalid", "square root is negative");
  if (value < 2n) return value;
  let prior = value;
  let next = (prior + value / prior) / 2n;
  while (next < prior) {
    prior = next;
    next = (prior + value / prior) / 2n;
  }
  return prior;
}

function fixedSquareRoot(value: bigint): bigint {
  return integerSquareRoot(value * DECIMAL_SCALE);
}

function serializeFixed18(value: bigint): string {
  const divisor = 10n ** 18n;
  let quotient = value / divisor;
  const remainder = value % divisor;
  const halfway = divisor / 2n;
  if (remainder > halfway || (remainder === halfway && quotient % 2n !== 0n)) quotient += 1n;
  return `${quotient / 10n ** 18n}.${(quotient % 10n ** 18n).toString().padStart(18, "0")}`;
}

export type WilsonIntervalV1 = Readonly<{
  lower: string;
  upper: string;
  lowerFixed36: bigint;
  upperFixed36: bigint;
}>;

export function wilsonInterval95(successes: number, denominator: 180): WilsonIntervalV1 {
  if (
    !Number.isSafeInteger(successes) ||
    successes < 0 ||
    successes > denominator ||
    denominator !== 180
  ) {
    throw new StudyContractError("study.input-invalid", "Wilson input must use fixed n=180");
  }
  const n = BigInt(denominator);
  const p = (BigInt(successes) * DECIMAL_SCALE) / n;
  const zSquared = fixedMultiply(Z, Z);
  const denominatorFixed = DECIMAL_SCALE + zSquared / n;
  const center = p + zSquared / (2n * n);
  const variance = fixedMultiply(p, DECIMAL_SCALE - p) / n + zSquared / (4n * n * n);
  const margin = fixedMultiply(Z, fixedSquareRoot(variance));
  const lower = ((center - margin) * DECIMAL_SCALE) / denominatorFixed;
  const upper = ((center + margin) * DECIMAL_SCALE) / denominatorFixed;
  return {
    lower: serializeFixed18(lower < 0n ? 0n : lower),
    upper: serializeFixed18(upper > DECIMAL_SCALE ? DECIMAL_SCALE : upper),
    lowerFixed36: lower,
    upperFixed36: upper,
  };
}

export type GateDecisionV1 = "GO" | "NO_GO" | "INCONCLUSIVE";

export type ClusterReadinessMetricsV1 = Readonly<{
  E1: boolean;
  E2: boolean;
  E3: boolean;
  E4: boolean;
}>;

export function evaluateClusterReadinessMetrics(
  input: Readonly<{
    trustedPublication: boolean;
    trustedDurableAnchor: boolean;
    requiredPrimaryReferencesComplete: boolean;
    primaryCorrectionSemanticsComplete: boolean;
    latencyUpperMs: number | null;
    q0: StudyRationalV1 | null;
    q5: StudyRationalV1 | null;
    bid0: StudyRationalV1 | null;
    ask0: StudyRationalV1 | null;
    bid5: StudyRationalV1 | null;
    ask5: StudyRationalV1 | null;
    requiredVariantsByteIdentical: boolean;
  }>,
): ClusterReadinessMetricsV1 {
  const E1 =
    input.trustedPublication &&
    input.trustedDurableAnchor &&
    input.requiredPrimaryReferencesComplete &&
    input.primaryCorrectionSemanticsComplete;
  const E2 =
    input.latencyUpperMs !== null &&
    Number.isSafeInteger(input.latencyUpperMs) &&
    input.latencyUpperMs >= 0 &&
    input.latencyUpperMs <= 900_000;
  let E3 = false;
  if (
    input.q0 !== null &&
    input.q5 !== null &&
    input.bid0 !== null &&
    input.ask0 !== null &&
    input.bid5 !== null &&
    input.ask5 !== null
  ) {
    const movement = addRational(input.q5, rational(-input.q0.numerator, input.q0.denominator));
    const absoluteMovement =
      movement.numerator < 0n ? rational(-movement.numerator, movement.denominator) : movement;
    const spread0 = addRational(
      input.ask0,
      rational(-input.bid0.numerator, input.bid0.denominator),
    );
    const spread5 = addRational(
      input.ask5,
      rational(-input.bid5.numerator, input.bid5.denominator),
    );
    const halfSpreadSum = multiplyRational(addRational(spread0, spread5), rational(1n, 2n));
    E3 = compareRational(absoluteMovement, halfSpreadSum) > 0;
  }
  return { E1, E2, E3, E4: input.requiredVariantsByteIdentical };
}

export function aggregateReadinessMetrics(rows: readonly ClusterReadinessMetricsV1[]): Readonly<{
  e1Successes: number;
  e2Successes: number;
  e3Successes: number;
  e4Reproduced: number;
}> {
  if (rows.length !== 180) {
    throw new StudyContractError("study.input-invalid", "readiness metrics require fixed N=180");
  }
  return {
    e1Successes: rows.filter(({ E1 }) => E1).length,
    e2Successes: rows.filter(({ E2 }) => E2).length,
    e3Successes: rows.filter(({ E3 }) => E3).length,
    e4Reproduced: rows.filter(({ E4 }) => E4).length,
  };
}

function thresholdFixed18(text: string): bigint {
  const [whole, fraction] = text.split(".");
  return (
    BigInt(whole ?? "0") * DECIMAL_SCALE + BigInt((fraction ?? "").padEnd(36, "0").slice(0, 36))
  );
}

export function evaluateReadinessGates(
  input: Readonly<{
    e1Successes: number;
    e2Successes: number;
    e3Successes: number;
    e4Reproduced: number;
  }>,
): Readonly<{
  E1: GateDecisionV1;
  E2: GateDecisionV1;
  E3: GateDecisionV1;
  E4: Exclude<GateDecisionV1, "INCONCLUSIVE">;
  overall: GateDecisionV1;
  intervals: Readonly<{ E1: WilsonIntervalV1; E2: WilsonIntervalV1; E3: WilsonIntervalV1 }>;
}> {
  const intervals = {
    E1: wilsonInterval95(input.e1Successes, 180),
    E2: wilsonInterval95(input.e2Successes, 180),
    E3: wilsonInterval95(input.e3Successes, 180),
  };
  const decide = (interval: WilsonIntervalV1, threshold: string): GateDecisionV1 => {
    const frozen = thresholdFixed18(threshold);
    if (interval.lowerFixed36 >= frozen) return "GO";
    if (interval.upperFixed36 < frozen) return "NO_GO";
    return "INCONCLUSIVE";
  };
  const E1 = decide(intervals.E1, "0.750000000000000000");
  const E2 = decide(intervals.E2, "0.700000000000000000");
  const E3 = decide(intervals.E3, "0.250000000000000000");
  const E4 = input.e4Reproduced === 180 ? "GO" : "NO_GO";
  const components = [E1, E2, E3, E4];
  const overall = components.includes("NO_GO")
    ? "NO_GO"
    : components.every((decision) => decision === "GO")
      ? "GO"
      : "INCONCLUSIVE";
  return { E1, E2, E3, E4, overall, intervals };
}

export type HolmInputV1 = Readonly<{
  slotId: (typeof HOLM_SLOT_IDS)[number];
  rawP: StudyRationalV1 | null;
}>;

export type HolmResultV1 = Readonly<{
  slotId: (typeof HOLM_SLOT_IDS)[number];
  rawP: StudyRationalV1;
  adjustedP: StudyRationalV1;
  rejected: boolean;
}>;

export function evaluateHolm24(inputs: readonly HolmInputV1[]): readonly HolmResultV1[] {
  validateHolmFamilySlots(inputs.map(({ slotId }) => slotId));
  for (const { rawP } of inputs) {
    if (
      rawP !== null &&
      (compareRational(rawP, rational(0n)) < 0 || compareRational(rawP, rational(1n)) > 0)
    ) {
      throw new StudyContractError("study.input-invalid", "Holm p-value is outside [0,1]");
    }
  }
  const ordered = inputs
    .map((input) => ({ ...input, rawP: input.rawP ?? rational(1n) }))
    .sort(
      (left, right) =>
        compareRational(left.rawP, right.rawP) ||
        Buffer.compare(Buffer.from(left.slotId), Buffer.from(right.slotId)),
    );
  let canReject = true;
  let runningAdjusted = rational(0n);
  const resultById = new Map<string, HolmResultV1>();
  for (const [index, row] of ordered.entries()) {
    const remaining = BigInt(STUDY_HOLM_SLOTS - index);
    const critical = rational(1n, 20n * remaining);
    const rejected = canReject && compareRational(row.rawP, critical) <= 0;
    if (!rejected) canReject = false;
    const scaled = multiplyRational(row.rawP, rational(remaining));
    const capped = compareRational(scaled, rational(1n)) > 0 ? rational(1n) : scaled;
    if (compareRational(capped, runningAdjusted) > 0) runningAdjusted = capped;
    resultById.set(row.slotId, {
      slotId: row.slotId,
      rawP: row.rawP,
      adjustedP: runningAdjusted,
      rejected,
    });
  }
  return HOLM_SLOT_IDS.map((slotId) => resultById.get(slotId) as HolmResultV1);
}

export function studySensitivitySummary(
  input: Readonly<{
    fixedDenominator: 180;
    primaryGate: GateDecisionV1;
    missingCount: number;
    outlierCount: number;
    providerComparison: Readonly<{ agree: number; disagree: number; notComparable: number }>;
  }>,
): Readonly<{
  primaryGate: GateDecisionV1;
  missingWorstCaseRetained: true;
  outliersRetainedInPrimary: true;
  secondaryCannotChangeGate: true;
  providerComparison: Readonly<{ agree: number; disagree: number; notComparable: number }>;
}> {
  if (
    input.fixedDenominator !== 180 ||
    !Number.isSafeInteger(input.missingCount) ||
    input.missingCount < 0 ||
    !Number.isSafeInteger(input.outlierCount) ||
    input.outlierCount < 0
  ) {
    throw new StudyContractError("study.input-invalid", "sensitivity summary input is invalid");
  }
  return {
    primaryGate: input.primaryGate,
    missingWorstCaseRetained: true,
    outliersRetainedInPrimary: true,
    secondaryCannotChangeGate: true,
    providerComparison: input.providerComparison,
  };
}
