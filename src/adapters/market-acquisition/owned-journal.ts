import type { AcquisitionJournal } from "./journal.js";
import { isOwnedMemoryAcquisitionJournal } from "./memory-journal.js";
import { isOwnedSqliteAcquisitionJournal } from "./sqlite-journal.js";
import type { ArtifactRetentionJournal } from "./retention/contracts.js";
import { isOwnedMemoryArtifactRetentionJournal } from "./retention/memory-journal.js";
import { isOwnedSqliteArtifactRetentionJournal } from "./retention/sqlite-journal.js";

export function assertOwnedAcquisitionJournal(value: AcquisitionJournal): void {
  if (
    !isOwnedMemoryAcquisitionJournal(value as object) &&
    !isOwnedSqliteAcquisitionJournal(value as object)
  ) {
    throw new TypeError("owned-acquisition-journal-required");
  }
}

export function assertOwnedSqliteAcquisitionJournal(value: AcquisitionJournal): void {
  if (!isOwnedSqliteAcquisitionJournal(value as object)) {
    throw new TypeError("owned-sqlite-acquisition-journal-required");
  }
}

export function assertOwnedRetentionJournal(value: ArtifactRetentionJournal): void {
  if (
    !isOwnedMemoryArtifactRetentionJournal(value as object) &&
    !isOwnedSqliteArtifactRetentionJournal(value as object)
  ) {
    throw new TypeError("owned-retention-journal-required");
  }
}

export function assertOwnedSqliteRetentionJournal(value: ArtifactRetentionJournal): void {
  if (!isOwnedSqliteArtifactRetentionJournal(value as object)) {
    throw new TypeError("owned-sqlite-retention-journal-required");
  }
}
