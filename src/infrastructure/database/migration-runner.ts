import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Client } from 'pg';

export class MigrationError extends Error {}

export interface MigrationStatus {
  version: number;
  filename: string;
  applied: boolean;
}

interface Migration extends MigrationStatus {
  checksum: string;
  sql: string;
}

interface AppliedMigration {
  version: number;
  filename: string;
  checksum: string;
}

async function discoverMigrations(directory: string): Promise<Migration[]> {
  const migrations: Migration[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.name.toLowerCase().endsWith('.sql')) continue;
    const match = /^(\d{4})_[a-z][a-z0-9_]*\.sql$/.exec(entry.name);
    const version = Number(match?.[1]);
    if (!entry.isFile() || !match || version < 1) {
      throw new MigrationError(
        'Invalid migration filename; use 0001_description.sql through 9999.',
      );
    }
    if (migrations.some((migration) => migration.version === version)) {
      throw new MigrationError('Duplicate migration version.');
    }
    // Git checkouts may use CRLF on Windows and LF in Docker; hash and execute the same normalized SQL.
    const sql = (await readFile(join(directory, entry.name), 'utf8')).replace(/\r\n/g, '\n');
    if (!sql.trim()) throw new MigrationError('Empty SQL migration.');
    migrations.push({
      version,
      filename: entry.name,
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
      applied: false,
    });
  }
  return migrations.sort((left, right) => left.version - right.version);
}

/** The caller owns one connected, dedicated Client and must close it even if cleanup fails. */
export async function runMigrations(
  client: Client,
  directory: string,
  command: 'up' | 'status',
): Promise<MigrationStatus[]> {
  const migrations = await discoverMigrations(directory);
  // Fixed application namespace; session ownership spans the per-migration transactions.
  const lockKey = [5588037, 1];
  const lock = await client.query<{ locked: boolean }>(
    'SELECT pg_try_advisory_lock($1::int, $2::int) AS locked',
    lockKey,
  );
  if (!lock.rows[0]?.locked) throw new MigrationError('Another migration command is running.');

  try {
    const table = await client.query<{ exists: boolean }>(
      "SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists",
    );
    const applied = table.rows[0]?.exists
      ? (
          await client.query<AppliedMigration>(
            'SELECT version, filename, checksum FROM public.schema_migrations ORDER BY version',
          )
        ).rows
      : [];

    // Applied history must be an unchanged prefix: no renames, deletions, edits or backfilled versions.
    for (const [index, row] of applied.entries()) {
      const migration = migrations[index];
      if (
        !migration ||
        migration.version !== row.version ||
        migration.filename !== row.filename ||
        migration.checksum !== row.checksum
      ) {
        throw new MigrationError(
          'Migration history does not match local files; restore applied files.',
        );
      }
      migration.applied = true;
    }

    if (command === 'up') {
      await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
        version INTEGER PRIMARY KEY CHECK (version > 0),
        filename TEXT NOT NULL UNIQUE,
        checksum TEXT NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);

      for (const migration of migrations) {
        if (migration.applied) continue;
        await client.query('BEGIN');
        try {
          await client.query(migration.sql);
          await client.query(
            'INSERT INTO public.schema_migrations (version, filename, checksum) VALUES ($1, $2, $3)',
            [migration.version, migration.filename, migration.checksum],
          );
          await client.query('COMMIT');
          migration.applied = true;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      }
    }

    return migrations.map(({ version, filename, applied }) => ({ version, filename, applied }));
  } finally {
    await client.query('SELECT pg_advisory_unlock($1::int, $2::int)', lockKey);
  }
}
