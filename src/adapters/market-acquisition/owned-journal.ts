import { isProxy } from "node:util/types";

import type { AcquisitionJournal } from "./journal.js";
import { MemoryAcquisitionJournal } from "./memory-journal.js";
import { SqliteAcquisitionJournal } from "./sqlite-journal.js";
import type { ArtifactRetentionJournal } from "./retention/contracts.js";
import { MemoryArtifactRetentionJournal } from "./retention/memory-journal.js";
import { SqliteArtifactRetentionJournal } from "./retention/sqlite-journal.js";

function exactInstance(value: object, prototypes: readonly object[]): boolean {
  return !isProxy(value) && prototypes.includes(Object.getPrototypeOf(value));
}

export function assertOwnedAcquisitionJournal(value: AcquisitionJournal): void {
  if (
    !exactInstance(value as object, [
      MemoryAcquisitionJournal.prototype,
      SqliteAcquisitionJournal.prototype,
    ])
  ) {
    throw new TypeError("owned-acquisition-journal-required");
  }
}

export function assertOwnedSqliteAcquisitionJournal(value: AcquisitionJournal): void {
  if (
    isProxy(value as object) ||
    Object.getPrototypeOf(value) !== SqliteAcquisitionJournal.prototype
  ) {
    throw new TypeError("owned-sqlite-acquisition-journal-required");
  }
}

export function assertOwnedRetentionJournal(value: ArtifactRetentionJournal): void {
  if (
    !exactInstance(value as object, [
      MemoryArtifactRetentionJournal.prototype,
      SqliteArtifactRetentionJournal.prototype,
    ])
  ) {
    throw new TypeError("owned-retention-journal-required");
  }
}

export function assertOwnedSqliteRetentionJournal(value: ArtifactRetentionJournal): void {
  if (
    isProxy(value as object) ||
    Object.getPrototypeOf(value) !== SqliteArtifactRetentionJournal.prototype
  ) {
    throw new TypeError("owned-sqlite-retention-journal-required");
  }
}
