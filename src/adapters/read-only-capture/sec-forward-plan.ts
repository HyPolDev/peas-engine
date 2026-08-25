import type { SecEvidenceRole } from "../../providers/sec/contracts.js";

export type SecForwardConfig = Readonly<{
  enabled: false;
  issuerCik: string;
  expectedFiscalPeriod: string;
  windowStartMs: number;
  windowEndMs: number;
  pollIntervalMs: number;
}>;

export type SecFilingCandidate = Readonly<{
  accession: string;
  acceptedAtMs: number;
  primaryDocument: string;
}>;

export type SecPlannedMember = Readonly<{
  role: SecEvidenceRole;
  memberKey: string;
  url: string;
}>;

export type SecWindowDecision =
  | Readonly<{ status: "before-window"; nextAtMs: number }>
  | Readonly<{ status: "poll"; nextAtMs: number }>
  | Readonly<{ status: "expired"; reasonCode: "sec-forward.window-expired" }>;

export class SecForwardPlanError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "SecForwardPlanError";
  }
}

function fail(code: string): never {
  throw new SecForwardPlanError(code);
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail("sec-forward.json-invalid");
  return value as Record<string, unknown>;
}

function strings(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    fail("sec-forward.json-invalid");
  }
  return value;
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    return fail("sec-forward.json-invalid");
  }
}

export function validateSecForwardConfig(config: SecForwardConfig): void {
  if (config.enabled !== false) fail("sec-forward.must-remain-disabled");
  if (!/^\d{10}$/u.test(config.issuerCik)) fail("sec-forward.cik-invalid");
  if (!/^\d{4}-(?:Q[1-4]|FY)$/u.test(config.expectedFiscalPeriod))
    fail("sec-forward.period-invalid");
  if (
    !Number.isSafeInteger(config.windowStartMs) ||
    !Number.isSafeInteger(config.windowEndMs) ||
    config.windowStartMs >= config.windowEndMs
  ) {
    fail("sec-forward.window-invalid");
  }
  if (
    !Number.isSafeInteger(config.pollIntervalMs) ||
    config.pollIntervalMs < 1_000 ||
    config.pollIntervalMs > 300_000
  ) {
    fail("sec-forward.poll-invalid");
  }
}

export function decideSecWindow(config: SecForwardConfig, nowMs: number): SecWindowDecision {
  validateSecForwardConfig(config);
  if (!Number.isSafeInteger(nowMs)) fail("sec-forward.clock-invalid");
  if (nowMs < config.windowStartMs)
    return Object.freeze({ status: "before-window", nextAtMs: config.windowStartMs });
  if (nowMs > config.windowEndMs)
    return Object.freeze({ status: "expired", reasonCode: "sec-forward.window-expired" });
  return Object.freeze({
    status: "poll",
    nextAtMs: Math.min(nowMs + config.pollIntervalMs, config.windowEndMs),
  });
}

export function selectSec8kCandidate(
  submissionsBytes: Uint8Array,
  config: SecForwardConfig,
): SecFilingCandidate | undefined {
  validateSecForwardConfig(config);
  const root = record(parseJson(submissionsBytes));
  if (String(root["cik"]).padStart(10, "0") !== config.issuerCik) fail("sec-forward.cik-mismatch");
  const recent = record(record(root["filings"])["recent"]);
  const accessions = strings(recent["accessionNumber"]);
  const forms = strings(recent["form"]);
  const items = strings(recent["items"]);
  const accepted = strings(recent["acceptanceDateTime"]);
  const primary = strings(recent["primaryDocument"]);
  const lengths = [forms.length, items.length, accepted.length, primary.length];
  if (lengths.some((length) => length !== accessions.length)) fail("sec-forward.array-mismatch");
  const matches: SecFilingCandidate[] = [];
  for (let index = 0; index < accessions.length; index += 1) {
    const accession = accessions[index];
    const form = forms[index];
    const item = items[index];
    const acceptedText = accepted[index];
    const primaryDocument = primary[index];
    if (
      accession === undefined ||
      form === undefined ||
      item === undefined ||
      acceptedText === undefined ||
      primaryDocument === undefined
    )
      fail("sec-forward.array-mismatch");
    if (!/^(?:8-K|8-K\/A)$/u.test(form) || !/(?:^|,)\s*2\.02(?:\s*,|$)/u.test(item)) continue;
    if (
      !/^\d{10}-\d{2}-\d{6}$/u.test(accession) ||
      accession.slice(0, 10) !== config.issuerCik ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/u.test(primaryDocument)
    )
      fail("sec-forward.filing-invalid");
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?$/u.test(acceptedText))
      fail("sec-forward.accepted-at-invalid");
    const acceptedAtMs = Date.parse(acceptedText.endsWith("Z") ? acceptedText : `${acceptedText}Z`);
    if (!Number.isSafeInteger(acceptedAtMs)) fail("sec-forward.accepted-at-invalid");
    if (acceptedAtMs >= config.windowStartMs && acceptedAtMs <= config.windowEndMs) {
      matches.push(Object.freeze({ accession, acceptedAtMs, primaryDocument }));
    }
  }
  matches.sort(
    (left, right) =>
      left.acceptedAtMs - right.acceptedAtMs || left.accession.localeCompare(right.accession),
  );
  return matches[0];
}

export function planSecBundleMembers(
  indexBytes: Uint8Array,
  config: SecForwardConfig,
  candidate: SecFilingCandidate,
): readonly SecPlannedMember[] {
  validateSecForwardConfig(config);
  const root = record(parseJson(indexBytes));
  const items = record(root["directory"])["item"];
  if (!Array.isArray(items)) fail("sec-forward.index-invalid");
  const accessionPath = candidate.accession.replaceAll("-", "");
  const base = `https://www.sec.gov/Archives/edgar/data/${Number.parseInt(config.issuerCik, 10)}/${accessionPath}`;
  const files = items.map((item) => {
    const entry = record(item);
    const name = entry["name"];
    const type = entry["type"];
    if (
      typeof name !== "string" ||
      typeof type !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/u.test(name)
    )
      fail("sec-forward.index-invalid");
    return { name, type };
  });
  const primary = files.find((file) => file.name === candidate.primaryDocument);
  const exhibits = files.filter((file) => file.type.toUpperCase() === "EX-99.1");
  const xbrl = files.find((file) => file.type.toUpperCase() === "EX-101.INS");
  if (primary === undefined || exhibits.length === 0 || xbrl === undefined)
    fail("sec-forward.required-member-missing");
  const members: SecPlannedMember[] = [
    {
      role: "sec.submissions",
      memberKey: "submissions",
      url: `https://data.sec.gov/submissions/CIK${config.issuerCik}.json`,
    },
    { role: "sec.filing-index", memberKey: "filing-index", url: `${base}/index.json` },
    { role: "sec.primary-document", memberKey: "primary-document", url: `${base}/${primary.name}` },
    ...exhibits.map((file, index) => ({
      role: "sec.exhibit-99.1" as const,
      memberKey: `exhibit-${index + 1}`,
      url: `${base}/${file.name}`,
    })),
    { role: "sec.xbrl-instance", memberKey: "xbrl-instance", url: `${base}/${xbrl.name}` },
  ];
  return Object.freeze(members.map((member) => Object.freeze(member)));
}
