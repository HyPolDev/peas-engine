import Database from "better-sqlite3";

export type SqliteDatabase = Database.Database;

export function openSqliteDatabase(filename: string, migrationSql: string): SqliteDatabase {
  const database = new Database(filename);
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  database.pragma("synchronous = FULL");
  if (filename !== ":memory:") database.pragma("journal_mode = WAL");
  database.exec(migrationSql);
  database.defaultSafeIntegers(true);
  return database;
}
