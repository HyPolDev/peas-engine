import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { prepareCalendarEvent } from "../dist/src/domain/calendar-event-preparation.js";

function parseArguments(values) {
  const options = { input: null, output: null };
  for (const value of values) {
    if (value.startsWith("--input=")) options.input = value.slice("--input=".length);
    else if (value.startsWith("--output=")) options.output = value.slice("--output=".length);
    else throw new Error("calendar-preparation.argument-invalid");
  }
  if (!options.input || !options.output) throw new Error("calendar-preparation.argument-missing");
  return options;
}

const options = parseArguments(process.argv.slice(2));
const inputPath = path.resolve(options.input);
const outputRoot = path.resolve(options.output);
const input = JSON.parse(readFileSync(inputPath, "utf8"));
const result = prepareCalendarEvent(input);

mkdirSync(outputRoot, { recursive: true });
writeFileSync(path.join(outputRoot, "event-preparation.json"), result.preparationJson, {
  encoding: "utf8",
  flag: "wx",
});
writeFileSync(path.join(outputRoot, "provider-readiness.md"), result.checklistMarkdown, {
  encoding: "utf8",
  flag: "wx",
});

process.stdout.write(
  `${JSON.stringify({
    configurationDigest: result.preparation.configurationDigest,
    planId: result.preparation.eventPlan.planId,
    revisionDigest: result.preparation.eventPlan.revisionDigest,
    outputRoot,
  })}\n`,
);
