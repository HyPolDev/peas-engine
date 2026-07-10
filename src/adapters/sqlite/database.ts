import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

import Database from "better-sqlite3";

import { hashParts } from "../../core/hash.js";

export type SqliteDatabase = Database.Database;

export type Migration = Readonly<{
  version: number;
  name: string;
  sql: string;
}>;

type MigrationRow = {
  version: bigint;
  name: string;
  checksum: string;
};

export function loadMigrations(directory: string): readonly Migration[] {
  return readdirSync(directory)
    .filter((filename) => /^\d{3}_.+\.sql$/u.test(filename))
    .sort()
    .map((filename) => {
      const version = Number(filename.slice(0, 3));
      if (!Number.isSafeInteger(version) || version < 1) {
        throw new Error(`Invalid migration version in ${filename}`);
      }
      return {
        version,
        name: basename(filename),
        sql: readFileSync(join(directory, filename), "utf8"),
      };
    });
}

export function openSqliteDatabase(
  filename: string,
  migrations: readonly Migration[],
): SqliteDatabase {
  const database = new Database(filename);
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  database.pragma("synchronous = FULL");
  if (filename !== ":memory:") database.pragma("journal_mode = WAL");
  database.defaultSafeIntegers(true);
  applyMigrations(database, migrations);
  return database;
}

export function applyMigrations(database: SqliteDatabase, migrations: readonly Migration[]): void {
  let previousVersion = 0;
  const plan = migrations.map((migration) => {
    if (migration.version !== previousVersion + 1) {
      throw new Error("Migrations must be contiguous, ordered, and start at version 1");
    }
    previousVersion = migration.version;
    const checksum = hashParts(
      "peas/sqlite-migration/v1",
      String(migration.version),
      migration.name,
      migration.sql,
    );
    return { migration, checksum };
  });

  database
    .transaction(() => {
      database.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          checksum TEXT NOT NULL,
          applied_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        ) STRICT;

        CREATE TRIGGER IF NOT EXISTS schema_migrations_no_update
        BEFORE UPDATE ON schema_migrations
        BEGIN
          SELECT RAISE(ABORT, 'migration history is immutable');
        END;

        CREATE TRIGGER IF NOT EXISTS schema_migrations_no_delete
        BEFORE DELETE ON schema_migrations
        BEGIN
          SELECT RAISE(ABORT, 'migration history is immutable');
        END;
      `);

      const applied = database
        .prepare("SELECT version, name, checksum FROM schema_migrations ORDER BY version")
        .all() as MigrationRow[];
      if (applied.length > plan.length) {
        throw new Error(
          `Migration history/file count mismatch: database has ${applied.length}, repository has ${plan.length}`,
        );
      }
      for (const [index, row] of applied.entries()) {
        const expected = plan[index];
        if (
          expected === undefined ||
          row.version !== BigInt(expected.migration.version) ||
          row.name !== expected.migration.name ||
          row.checksum !== expected.checksum
        ) {
          throw new Error(`Migration history diverges at applied position ${index + 1}`);
        }
      }

      const insert = database.prepare(
        "INSERT INTO schema_migrations (version, name, checksum) VALUES (?, ?, ?)",
      );
      for (const entry of plan.slice(applied.length)) {
        database.exec(entry.migration.sql);
        insert.run(BigInt(entry.migration.version), entry.migration.name, entry.checksum);
      }

      const verified = database
        .prepare("SELECT version, name, checksum FROM schema_migrations ORDER BY version")
        .all() as MigrationRow[];
      if (verified.length !== plan.length) {
        throw new Error(
          `Migration history/file count mismatch: database has ${verified.length}, repository has ${plan.length}`,
        );
      }
      for (const [index, row] of verified.entries()) {
        const expected = plan[index];
        if (
          expected === undefined ||
          row.version !== BigInt(expected.migration.version) ||
          row.name !== expected.migration.name ||
          row.checksum !== expected.checksum
        ) {
          throw new Error(`Migration verification failed at position ${index + 1}`);
        }
      }
    })
    .immediate();
}
