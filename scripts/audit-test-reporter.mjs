let finalSummary;
let coverage;

export default async function* auditTestReporter(source) {
  for await (const event of source) {
    if (event.type === "test:coverage") {
      const { totals, thresholds } = event.data.summary;
      coverage = {
        lines: {
          covered: totals.coveredLineCount,
          total: totals.totalLineCount,
          percent: totals.coveredLinePercent,
          threshold: thresholds.line,
        },
        branches: {
          covered: totals.coveredBranchCount,
          total: totals.totalBranchCount,
          percent: totals.coveredBranchPercent,
          threshold: thresholds.branch,
        },
        functions: {
          covered: totals.coveredFunctionCount,
          total: totals.totalFunctionCount,
          percent: totals.coveredFunctionPercent,
          threshold: thresholds.function,
        },
      };
    }
    if (event.type === "test:summary" && event.data.file === undefined) {
      finalSummary = event.data;
    }
  }

  if (coverage === undefined) throw new Error("Coverage event was not reported");
  if (finalSummary === undefined) throw new Error("Final test summary was not reported");
  const result = {
    resultVersion: 1,
    status: finalSummary.success ? "passed" : "failed",
    tests: finalSummary.counts,
    durationMs: finalSummary.duration_ms,
    coverage,
  };
  yield `${JSON.stringify(result, null, 2)}\n`;
}
