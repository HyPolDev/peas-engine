import { createHash } from "node:crypto";

import {
  type AppendResult,
  type EventDraft,
  type EventLog,
  validateEventDraft,
} from "../../core/event.js";
import {
  P1_03_EFFECTS_ZERO,
  type P103CaptureReceipt,
  type P103CaptureRequest,
  type ProviderFreeCaptureSession,
} from "./contracts.js";

export type P103OfflineNormalizer = (bytes: Uint8Array, receipt: P103CaptureReceipt) => EventDraft;

export type P103OfflinePipelineResult = Readonly<{
  receipt: P103CaptureReceipt;
  capture: AppendResult;
  effects: typeof P1_03_EFFECTS_ZERO;
}>;

function assertCapturedProvenance(receipt: P103CaptureReceipt, draft: EventDraft): void {
  if (
    draft.provider.provider !== receipt.sourceId ||
    draft.provider.artifactHash !== receipt.rawSha256 ||
    draft.provider.recordId !== receipt.recordId ||
    draft.provider.revisionId !== receipt.revisionId ||
    draft.correlationId !== receipt.captureId
  ) {
    throw new Error("p1-03.normalized-provenance-mismatch");
  }
}

/**
 * Provider-free vertical slice: capture immutable fixture bytes, normalize them, and append the
 * normalized event to the supplied event log. The caller supplies both the normalizer and event
 * log; this adapter has no transport, credential, account, or provider capability.
 */
export async function runProviderFreeCapturePipeline(
  options: Readonly<{
    session: ProviderFreeCaptureSession;
    request: P103CaptureRequest;
    normalize: P103OfflineNormalizer;
    eventLog: EventLog;
  }>,
): Promise<P103OfflinePipelineResult> {
  const receipt = options.session.capture(options.request);
  const retained = options.session.readRaw(receipt.rawSha256);
  if (retained === undefined) throw new Error("p1-03.retained-artifact-missing");

  const observedDigest = createHash("sha256").update(retained).digest("hex");
  if (observedDigest !== receipt.rawSha256 || retained.byteLength !== receipt.rawSizeBytes) {
    throw new Error("p1-03.retained-artifact-mismatch");
  }

  const draft = validateEventDraft(options.normalize(Uint8Array.from(retained), receipt));
  assertCapturedProvenance(receipt, draft);
  const capture = await options.eventLog.append(draft);
  return Object.freeze({ receipt, capture, effects: P1_03_EFFECTS_ZERO });
}
