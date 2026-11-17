import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Client } from 'pg';
import { runMigrations } from '../../infrastructure/database/migration-runner';

const checksum = (sql: string) => createHash('sha256').update(sql).digest('hex');
const first = { version: 1, filename: '0001_first.sql', checksum: checksum('SELECT 1;') };

describe('SQL migrations', () => {
  let directory: string;
  let client: Client;
  let statements: { sql: string; values?: unknown[] }[];
  let history: (typeof first)[];
  let tableExists: boolean;
  let locked: boolean;
  let failOn: string | undefined;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'underwriting-migrations-'));
    statements = [];
    history = [];
    tableExists = false;
    locked = true;
    failOn = undefined;
    client = new Client();
    // Replace only the external SQL boundary; filesystem discovery and validation stay real.
    client.query = jest.fn(async (sql: string, values?: unknown[]) => {
      statements.push({ sql, values });
      if (failOn && sql.startsWith(failOn)) throw new Error('SQL failed with private fixture data');
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked }] };
      if (sql.includes('to_regclass')) return { rows: [{ exists: tableExists }] };
      if (sql.startsWith('SELECT version')) return { rows: history };
      return { rows: [] };
    }) as unknown as Client['query'];
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const sqls = () => statements.map((statement) => statement.sql);
  const mutationSqls = () =>
    sqls().filter((sql) => /^(CREATE|INSERT|BEGIN|COMMIT|ROLLBACK)/.test(sql));

  it('reports an empty directory without creating the tracking table in status mode', async () => {
    expect(await runMigrations(client, directory, 'status')).toEqual([]);
    expect(mutationSqls()).toEqual([]);
  });

  it('initializes tracking for an empty migration directory', async () => {
    await writeFile(join(directory, 'README.md'), 'No business migrations yet.');
    expect(await runMigrations(client, directory, 'up')).toEqual([]);
    expect(sqls().some((sql) => sql.startsWith('CREATE TABLE'))).toBe(true);
    expect(sqls()).not.toContain('BEGIN');
  });

  it('runs files in version order and records each inside its own transaction', async () => {
    await writeFile(join(directory, '0002_second.sql'), 'SELECT 2;');
    await writeFile(join(directory, first.filename), 'SELECT 1;');
    const result = await runMigrations(client, directory, 'up');
    expect(result.map(({ version, applied }) => ({ version, applied }))).toEqual([
      { version: 1, applied: true },
      { version: 2, applied: true },
    ]);
    const begin = sqls().indexOf('BEGIN');
    const work = statements.slice(begin);
    expect(work.map(({ sql }) => (sql.startsWith('INSERT') ? 'INSERT' : sql))).toEqual([
      'BEGIN',
      'SELECT 1;',
      'INSERT',
      'COMMIT',
      'BEGIN',
      'SELECT 2;',
      'INSERT',
      'COMMIT',
      expect.stringContaining('pg_advisory_unlock'),
    ]);
    expect(work[2]?.values).toEqual([1, first.filename, first.checksum]);
  });

  it('skips applied files and reports pending files without writing in status mode', async () => {
    tableExists = true;
    history = [first];
    await writeFile(join(directory, first.filename), 'SELECT 1;');
    await writeFile(join(directory, '0002_second.sql'), 'SELECT 2;');
    const result = await runMigrations(client, directory, 'status');
    expect(result.map(({ applied }) => applied)).toEqual([true, false]);
    expect(mutationSqls()).toEqual([]);
    expect(sqls()).not.toContain('SELECT 1;');
    expect(sqls()).not.toContain('SELECT 2;');
  });

  it('does not repeat previously applied SQL on an up rerun', async () => {
    tableExists = true;
    history = [first];
    await writeFile(join(directory, first.filename), 'SELECT 1;');
    await runMigrations(client, directory, 'up');
    expect(sqls()).not.toContain('BEGIN');
    expect(sqls()).not.toContain('SELECT 1;');
    expect(sqls().some((sql) => sql.startsWith('INSERT'))).toBe(false);
  });

  it.each(['invalid.sql', '0000_zero.sql', '0001_UPPER.sql', '0001_bad-name.sql'])(
    'rejects malformed SQL filename %s before SQL execution',
    async (filename) => {
      await writeFile(join(directory, filename), 'SELECT 1;');
      await expect(runMigrations(client, directory, 'up')).rejects.toThrow(/filename/i);
      expect(statements).toEqual([]);
    },
  );

  it('rejects duplicate versions', async () => {
    await writeFile(join(directory, first.filename), 'SELECT 1;');
    await writeFile(join(directory, '0001_duplicate.sql'), 'SELECT 2;');
    await expect(runMigrations(client, directory, 'up')).rejects.toThrow(/duplicate/i);
    expect(statements).toEqual([]);
  });

  it('rejects empty SQL before SQL execution', async () => {
    await writeFile(join(directory, first.filename), '\r\n  ');
    await expect(runMigrations(client, directory, 'up')).rejects.toThrow(/empty/i);
    expect(statements).toEqual([]);
  });

  it.each(['modified', 'missing', 'renamed', 'out-of-order'])(
    'rejects %s applied history before applying any new migration',
    async (kind) => {
      tableExists = true;
      history = [first];
      if (kind !== 'missing') {
        await writeFile(
          join(directory, kind === 'renamed' ? '0001_renamed.sql' : first.filename),
          kind === 'modified' ? 'SELECT 99;' : 'SELECT 1;',
        );
      }
      if (kind === 'out-of-order') {
        history = [{ version: 2, filename: '0002_second.sql', checksum: checksum('SELECT 2;') }];
        await writeFile(join(directory, '0002_second.sql'), 'SELECT 2;');
      }
      await expect(runMigrations(client, directory, 'up')).rejects.toThrow(/history/i);
      expect(sqls()).not.toContain('BEGIN');
      expect(sqls().at(-1)).toContain('pg_advisory_unlock');
    },
  );

  it('normalizes CRLF so Windows and Linux agree on applied checksums', async () => {
    tableExists = true;
    history = [{ ...first, checksum: checksum('SELECT 1;\n') }];
    await writeFile(join(directory, first.filename), 'SELECT 1;\r\n');
    expect((await runMigrations(client, directory, 'up'))[0]?.applied).toBe(true);
    expect(sqls()).not.toContain('BEGIN');
  });

  it('refuses a competing runner without writing or unlocking another session', async () => {
    locked = false;
    await expect(runMigrations(client, directory, 'up')).rejects.toThrow(/another migration/i);
    expect(mutationSqls()).toEqual([]);
    expect(sqls().some((sql) => sql.includes('pg_advisory_unlock'))).toBe(false);
  });

  it('rolls back failed SQL without recording it or running subsequent files', async () => {
    await writeFile(join(directory, first.filename), 'SELECT 1;');
    await writeFile(join(directory, '0002_second.sql'), 'SELECT 2;');
    failOn = 'SELECT 1;';
    await expect(runMigrations(client, directory, 'up')).rejects.toThrow('SQL failed');
    expect(sqls()).toContain('ROLLBACK');
    expect(sqls()).not.toContain('COMMIT');
    expect(sqls()).not.toContain('SELECT 2;');
    expect(sqls().some((sql) => sql.startsWith('INSERT'))).toBe(false);
    expect(sqls().at(-1)).toContain('pg_advisory_unlock');
  });

  it('rolls back when recording a migration fails', async () => {
    await writeFile(join(directory, first.filename), 'SELECT 1;');
    failOn = 'INSERT';
    await expect(runMigrations(client, directory, 'up')).rejects.toThrow('SQL failed');
    expect(sqls()).toContain('ROLLBACK');
    expect(sqls()).not.toContain('COMMIT');
  });

  it('fails for a missing migration directory instead of silently doing nothing', async () => {
    await expect(runMigrations(client, join(directory, 'absent'), 'up')).rejects.toThrow();
    expect(statements).toEqual([]);
  });
});

describe('migration CLI', () => {
  const run = (args: string[], env: NodeJS.ProcessEnv) =>
    spawnSync(process.execPath, [resolve('dist/infrastructure/database/migrate.js'), ...args], {
      env: { ...process.env, DOTENV_CONFIG_QUIET: 'true', LOG_LEVEL: 'info', ...env },
      encoding: 'utf8',
      timeout: 10000,
    });

  it('rejects unsupported commands without connecting', () => {
    const result = run(['down'], { DATABASE_URL: 'https://private:secret@example.com/db' });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Usage:');
    expect(result.stdout + result.stderr).not.toContain('secret');
  });

  it('rejects invalid database configuration without leaking values', () => {
    const result = run(['up'], { DATABASE_URL: 'https://private:secret@example.com/db' });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Invalid migration configuration');
    expect(result.stdout + result.stderr).not.toContain('secret');
  });

  it('requires no Redis configuration and exits cleanly for an unreachable database', () => {
    const result = run(['status'], {
      DATABASE_URL: 'postgresql://test:dbsecret@127.0.0.1:1/underwriting_test',
      REDIS_URL: '',
      DB_CONNECT_TIMEOUT_MS: '200',
      DB_QUERY_TIMEOUT_MS: '200',
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('ECONNREFUSED');
    expect(result.stdout).not.toContain('Invalid migration configuration');
    expect(result.stdout + result.stderr).not.toContain('dbsecret');
  });

  it('sanitizes synchronous pg constructor failures as well as connection failures', () => {
    const result = run(['status'], {
      DATABASE_URL:
        'postgresql://test:dbsecret@127.0.0.1:1/underwriting_test?sslnegotiation=private-constructor-secret',
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Operation failed');
    expect(result.stdout + result.stderr).not.toContain('private-constructor-secret');
    expect(result.stdout + result.stderr).not.toContain('dbsecret');
  });
});
