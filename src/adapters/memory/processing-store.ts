import type {
  Checkpoint,
  ImmutableOutput,
  ProcessingCommit,
  ProcessingStore,
} from "../../core/processor.js";
import { canonicalJson, cloneJson, type JsonObject, type JsonValue } from "../../core/json.js";

export class InMemoryProcessingStore<TState extends JsonObject> implements ProcessingStore<TState> {
  #checkpoint: Checkpoint<TState> | undefined;
  #outputs: ImmutableOutput[] = [];

  loadCheckpoint(): Checkpoint<TState> | undefined {
    return this.#checkpoint === undefined
      ? undefined
      : (cloneJson(this.#checkpoint as unknown as JsonValue) as Checkpoint<TState>);
  }

  readOutputs(): readonly ImmutableOutput[] {
    return this.#outputs.map(
      (output) => cloneJson(output as unknown as JsonValue) as ImmutableOutput,
    );
  }

  commit(value: ProcessingCommit<TState>): void {
    const currentPosition = this.#checkpoint?.processedPosition ?? "0";
    if (currentPosition !== value.expectedPosition) {
      throw new Error(
        `Checkpoint concurrency conflict: expected ${value.expectedPosition}, found ${currentPosition}`,
      );
    }
    if (value.checkpoint.processedPosition !== value.event.position) {
      throw new Error("Checkpoint position must equal the processed event position");
    }

    const nextOutputs = [...this.#outputs];
    for (const output of value.outputs) {
      const existing = nextOutputs.find((candidate) => candidate.outputId === output.outputId);
      if (existing !== undefined) {
        if (
          canonicalJson(existing as unknown as JsonValue) !==
          canonicalJson(output as unknown as JsonValue)
        ) {
          throw new Error(`Output ID collision for ${output.outputId}`);
        }
        continue;
      }
      nextOutputs.push(cloneJson(output as unknown as JsonValue) as ImmutableOutput);
    }

    this.#outputs = nextOutputs;
    this.#checkpoint = cloneJson(value.checkpoint as unknown as JsonValue) as Checkpoint<TState>;
  }
}
