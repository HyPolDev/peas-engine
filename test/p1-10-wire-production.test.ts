import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { canonicalHash } from "../src/core/hash.js";
import { canonicalJson, type JsonValue } from "../src/core/json.js";
import { normalizeRecordedMarketRecords } from "../src/providers/market-reference/normalization.js";
import {
  AlpacaWireContractError,
  admitAlpacaHistoricalPage,
  decodeAlpacaHistoricalJson,
  parseAlpacaHistoricalJson,
  parseAndAdmitAlpacaHistoricalPage,
  parseAlpacaWireTimestamp,
  resolveAlpacaHistoricalChain,
  type AlpacaWireEndpointKind,
  type AlpacaWireParseContext,
} from "../src/adapters/market-acquisition/alpaca/wire.js";

type PlainRecord = Record<string, unknown>;
type ValidCase = Readonly<{
  caseId: string;
  endpointKind: AlpacaWireEndpointKind;
  expectedGrammarDisposition: "accept";
  expectedTranslationDisposition: string;
  wire: PlainRecord;
}>;

const ROOT = "fixtures/market-acquisition/v1/wire-grammar";
const valid = JSON.parse(readFileSync(`${ROOT}/valid-pages.json`, "utf8")) as Readonly<{
  cases: readonly ValidCase[];
}>;
const translation = JSON.parse(readFileSync(`${ROOT}/bar-translation.json`, "utf8")) as Readonly<{
  cases: readonly Readonly<{
    wireCaseId: string;
    itemIndex: number;
    expectedRecord: unknown;
  }>[];
}>;

const dataField = Object.freeze({ quotes: "quotes", trades: "trades", bars: "bars" });
const symbols = Object.freeze(
  [
    ...new Set(
      valid.cases.flatMap((entry) =>
        Object.keys(entry.wire[dataField[entry.endpointKind]] as PlainRecord),
      ),
    ),
  ].sort(),
);
const instrumentIds = Object.freeze(
  Object.fromEntries(
    symbols.map((symbol) => [
      symbol,
      symbol === "PEASIVY"
        ? `min1_${"b".repeat(64)}`
        : `min1_${canonicalHash("peas/p1-10-wire-test-instrument/v1", symbol)}`,
    ]),
  ),
);
const startNs = BigInt(parseAlpacaWireTimestamp("2033-05-06T00:00:00Z").timestamp.epochNs);
const endNs = BigInt(parseAlpacaWireTimestamp("2033-05-07T00:00:00Z").timestamp.epochNs);
const context: AlpacaWireParseContext = Object.freeze({
  requestedSymbols: symbols,
  instrumentIds,
  queryStartNs: startNs,
  queryEndNs: endNs,
  entitlementSnapshotId: `ent1_${"a".repeat(64)}`,
  marketAcquisitionId: `maq1_${"d".repeat(64)}`,
  rawArtifactId: `mar1_${"c".repeat(64)}`,
  calendarVersion: "peas-p1-10-original-synthetic-calendar-v1",
  durableClockBasisId: `clk1_${"e".repeat(64)}`,
  durablyRecordedAtMs: 1_998_976_380_000,
  durableLogicalAtMs: 1_998_976_380_000,
  sessionKind: "regular-continuous",
  primaryCorpusMember: true,
  timeframe: "1Min",
  adjustment: "raw",
});

function parsed(caseId: string): PlainRecord {
  const fixture = valid.cases.find((entry) => entry.caseId === caseId);
  assert.ok(fixture);
  return parseAlpacaHistoricalJson(JSON.stringify(fixture.wire)) as PlainRecord;
}

function firstItem(page: PlainRecord, endpointKind: AlpacaWireEndpointKind): PlainRecord {
  const groups = page[dataField[endpointKind]] as PlainRecord;
  const symbol = Object.keys(groups)[0];
  assert.ok(symbol);
  return (groups[symbol] as PlainRecord[])[0] as PlainRecord;
}

function expectWireCode(code: string, operation: () => unknown): void {
  assert.throws(
    operation,
    (error: unknown) => error instanceof AlpacaWireContractError && error.code === code,
  );
}

test("production parser admits every accepted original-synthetic valid page", () => {
  for (const fixture of valid.cases) {
    const result = admitAlpacaHistoricalPage(
      fixture.endpointKind,
      parseAlpacaHistoricalJson(JSON.stringify(fixture.wire)),
      context,
    );
    assert.equal(result.endpointKind, fixture.endpointKind, fixture.caseId);
    if (fixture.expectedTranslationDisposition === "terminal-correction-unsupported") {
      assert.equal(result.terminalReason, "correction-unsupported", fixture.caseId);
      assert.equal(result.privateNextToken, null, fixture.caseId);
      assert.deepEqual(result.records, [], fixture.caseId);
      continue;
    }
    assert.equal(result.terminalReason, null, fixture.caseId);
    if (fixture.endpointKind === "bars") {
      assert.equal(
        result.records.length > 0,
        fixture.expectedTranslationDisposition === "emit-recorded-market-record-v1",
        fixture.caseId,
      );
      assert.equal(normalizeRecordedMarketRecords(result.records).length, result.records.length);
    } else {
      assert.deepEqual(result.records, [], fixture.caseId);
      assert.ok(result.quarantines.length > 0, fixture.caseId);
    }
  }
});

test("production bar projection is byte-identical to the accepted translation fixture", () => {
  const admission = admitAlpacaHistoricalPage(
    "bars",
    parsed("wire-bars-terminal-grouped"),
    context,
  );
  for (const expected of translation.cases.filter(
    (entry) => entry.wireCaseId === "wire-bars-terminal-grouped",
  )) {
    const actual = admission.records.find((record) =>
      record.memberKey.endsWith(`[${expected.itemIndex}]`),
    );
    assert.ok(actual);
    assert.equal(
      canonicalJson(actual as unknown as JsonValue),
      canonicalJson(expected.expectedRecord as JsonValue),
    );
  }
});

test("production complete-chain resolution deduplicates and quarantines globally", () => {
  const source = valid.cases.find((entry) => entry.caseId === "wire-bars-terminal-grouped");
  assert.ok(source);
  const raw = JSON.stringify(source.wire);
  const first = admitAlpacaHistoricalPage("bars", parseAlpacaHistoricalJson(raw), context);
  const redelivery = admitAlpacaHistoricalPage("bars", parseAlpacaHistoricalJson(raw), {
    ...context,
    rawArtifactId: `mar1_${"f".repeat(64)}`,
  });
  const duplicateResolution = resolveAlpacaHistoricalChain("bars", [first, redelivery]);
  assert.equal(duplicateResolution.records.length, 2);
  assert.equal(duplicateResolution.quarantines.length, 0);
  assert.equal(duplicateResolution.barObservationCount, 4);

  const conflict = admitAlpacaHistoricalPage(
    "bars",
    parseAlpacaHistoricalJson(raw.replace('"h":62.875', '"h":63.875')),
    { ...context, rawArtifactId: `mar1_${"9".repeat(64)}` },
  );
  const conflictResolution = resolveAlpacaHistoricalChain("bars", [first, conflict]);
  assert.equal(conflictResolution.records.length, 1);
  assert.equal(conflictResolution.quarantines.length, 2);
  assert.equal(new Set(conflictResolution.quarantines.map((entry) => entry.reason)).size, 1);
  assert.equal(
    conflictResolution.quarantines[0]?.reason,
    "market.provider-observation-invalid/conflicting-content",
  );
});

test("production tokenizer rejects duplicate names, noncanonical numbers, and invalid UTF-8", () => {
  assert.throws(
    () => parseAlpacaHistoricalJson('{"bars":{},"bars":{},"next_page_token":null}'),
    (error: unknown) =>
      error instanceof AlpacaWireContractError && error.code === "duplicate-json-name",
  );
  const exponent = JSON.stringify(
    valid.cases.find((entry) => entry.caseId === "wire-bars-terminal-grouped")?.wire,
  ).replace('"o":61.125', '"o":6.1125e1');
  assert.throws(
    () => admitAlpacaHistoricalPage("bars", parseAlpacaHistoricalJson(exponent), context),
    (error: unknown) =>
      error instanceof AlpacaWireContractError && error.code === "market.decimal-invalid",
  );
  const invalid = new Uint8Array([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xc3, 0x28, 0x7d]);
  assert.throws(
    () => decodeAlpacaHistoricalJson(invalid),
    (error: unknown) => error instanceof AlpacaWireContractError && error.code === "schema-invalid",
  );
});

test("production parser reject and quarantine branches remain executable and inert", () => {
  for (const raw of [
    "",
    '"unterminated',
    '"line\nbreak"',
    '"\\uD800"',
    "[1,]",
    '{"x" 1}',
    '{"x":1,}',
    '{"x":1',
  ]) {
    expectWireCode("malformed-json", () => parseAlpacaHistoricalJson(raw));
  }
  assert.deepEqual(parseAlpacaHistoricalJson("[]"), []);
  assert.deepEqual(parseAlpacaHistoricalJson("[true,false,null]"), [true, false, null]);
  expectWireCode("genericStringBytes", () =>
    parseAlpacaHistoricalJson(JSON.stringify("x".repeat(1_025))),
  );
  expectWireCode("pageTokenInputBytes", () =>
    parseAlpacaHistoricalJson(JSON.stringify({ bars: {}, next_page_token: "x".repeat(4_097) })),
  );

  for (const hostile of [null, [], Object.create({ inherited: true })]) {
    expectWireCode("schema-invalid", () => admitAlpacaHistoricalPage("bars", hostile, context));
  }
  const symbolPage = parsed("wire-bars-empty-terminal");
  Object.defineProperty(symbolPage, Symbol("synthetic"), { value: true });
  expectWireCode("schema-invalid", () => admitAlpacaHistoricalPage("bars", symbolPage, context));
  let getterCalls = 0;
  const accessorGroups = Object.create(null) as PlainRecord;
  Object.defineProperty(accessorGroups, "PEASIVY", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return [];
    },
  });
  expectWireCode("schema-invalid", () =>
    admitAlpacaHistoricalPage("bars", { bars: accessorGroups, next_page_token: null }, context),
  );
  assert.equal(getterCalls, 0);

  for (const malformedGroup of [null, {}, new Array(1)]) {
    expectWireCode("schema-invalid", () =>
      admitAlpacaHistoricalPage(
        "bars",
        { bars: { PEASIVY: malformedGroup }, next_page_token: null },
        context,
      ),
    );
  }
  const extraProperty: unknown[] = [];
  Object.defineProperty(extraProperty, "extra", { enumerable: true, value: null });
  expectWireCode("schema-invalid", () =>
    admitAlpacaHistoricalPage(
      "bars",
      { bars: { PEASIVY: extraProperty }, next_page_token: null },
      context,
    ),
  );
  const wrongPrototype: unknown[] = [];
  Object.setPrototypeOf(wrongPrototype, null);
  expectWireCode("schema-invalid", () =>
    admitAlpacaHistoricalPage(
      "bars",
      { bars: { PEASIVY: wrongPrototype }, next_page_token: null },
      context,
    ),
  );

  const barSource = valid.cases.find((entry) => entry.caseId === "wire-bars-terminal-grouped");
  assert.ok(barSource);
  const duplicateWire = structuredClone(barSource.wire);
  const duplicateBars = (duplicateWire["bars"] as PlainRecord)["PEASIVY"] as PlainRecord[];
  const firstBar = duplicateBars[0];
  assert.ok(firstBar);
  duplicateBars.push(structuredClone(firstBar));
  const duplicate = admitAlpacaHistoricalPage(
    "bars",
    parseAlpacaHistoricalJson(JSON.stringify(duplicateWire)),
    context,
  );
  assert.equal(duplicate.records.length, 2);
  assert.equal(duplicate.barObservations.length, 3);

  const conflictWire = structuredClone(duplicateWire);
  const conflictBars = (conflictWire["bars"] as PlainRecord)["PEASIVY"] as PlainRecord[];
  (conflictBars[1] as PlainRecord)["h"] = 63.875;
  const conflict = admitAlpacaHistoricalPage(
    "bars",
    parseAlpacaHistoricalJson(JSON.stringify(conflictWire)),
    context,
  );
  assert.equal(conflict.records.length, 1);
  assert.equal(conflict.quarantines.length, 2);

  const unknownCalendar = admitAlpacaHistoricalPage("bars", parsed("wire-bars-terminal-grouped"), {
    ...context,
    sessionKind: "unknown",
  });
  assert.equal(unknownCalendar.records.length, 0);
  assert.equal(unknownCalendar.quarantines.length, 2);

  const quote = admitAlpacaHistoricalPage(
    "quotes",
    parsed("wire-quotes-terminal-grouped"),
    context,
  );
  assert.equal(resolveAlpacaHistoricalChain("quotes", [quote]).records.length, 0);
  expectWireCode("schema-invalid", () => resolveAlpacaHistoricalChain("bars", [quote]));
  assert.equal(
    parseAndAdmitAlpacaHistoricalPage(
      "bars",
      Buffer.from(JSON.stringify(barSource.wire), "utf8"),
      context,
    ).records.length,
    2,
  );
  assert.ok(BigInt(parseAlpacaWireTimestamp("1960-01-02T00:00:00Z").timestamp.epochNs) < 0n);
});

test("canonical trade u wins before every later semantic value without getter or Proxy traps", () => {
  const normal = structuredClone(firstItem(parsed("wire-trades-terminal-grouped"), "trades"));
  const outcomes = new Set<string>();
  let vectors = 0;
  for (const update of ["canceled", "incorrect", "corrected"] as const) {
    for (const placement of ["first", "middle", "last"] as const) {
      for (const successor of ["malformed", "getter", "proxy"] as const) {
        vectors += 1;
        let getterCalls = 0;
        let proxyCalls = 0;
        const later = (): unknown => {
          if (successor === "malformed") return null;
          if (successor === "getter") {
            const value = Object.create(null) as PlainRecord;
            Object.defineProperty(value, "later", {
              enumerable: true,
              get() {
                getterCalls += 1;
                throw new Error("synthetic-later-getter");
              },
            });
            return value;
          }
          return new Proxy(
            {},
            {
              getPrototypeOf() {
                proxyCalls += 1;
                throw new Error("synthetic-later-proxy");
              },
              ownKeys() {
                proxyCalls += 1;
                throw new Error("synthetic-later-proxy");
              },
              getOwnPropertyDescriptor() {
                proxyCalls += 1;
                throw new Error("synthetic-later-proxy");
              },
              get() {
                proxyCalls += 1;
                throw new Error("synthetic-later-proxy");
              },
            },
          );
        };
        const updateItem = structuredClone(normal);
        updateItem["u"] = update;
        const itemIndex = placement === "first" ? 0 : placement === "middle" ? 1 : 2;
        const earlier =
          placement === "first"
            ? [updateItem, later()]
            : placement === "middle"
              ? [structuredClone(normal), updateItem, later()]
              : [structuredClone(normal), structuredClone(normal), updateItem];
        const groups: PlainRecord = {};
        groups["PEASUMB"] = placement === "last" ? later() : [];
        groups["PEASLIL"] = earlier;
        assert.deepEqual(Object.keys(groups), ["PEASUMB", "PEASLIL"]);
        const result = admitAlpacaHistoricalPage(
          "trades",
          {
            trades: groups,
            next_page_token: "synthetic-token-must-clear",
          },
          context,
        );
        assert.equal(result.terminal, true);
        assert.equal(result.privateNextToken, null);
        assert.equal(result.terminalReason, "correction-unsupported");
        assert.deepEqual(result.records, []);
        assert.deepEqual(result.barObservations, []);
        assert.deepEqual(result.quarantines, [
          {
            endpointKind: "trades",
            reason: "correction-unsupported",
            symbol: "PEASLIL",
            itemIndex,
          },
        ]);
        assert.equal(getterCalls, 0);
        assert.equal(proxyCalls, 0);
        outcomes.add(canonicalJson(result.publicSummary as unknown as JsonValue));
      }
    }
  }
  assert.equal(vectors, 27);
  assert.equal(outcomes.size, 1);
});
