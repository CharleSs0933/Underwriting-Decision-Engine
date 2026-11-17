import 'dotenv/config';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { envSchema } from '../../config/env';
import { createLogger, logFailure } from '../logging/logger';
import { MigrationError, runMigrations } from './migration-runner';

async function main(): Promise<void> {
  const command = process.argv[2];
  if ((command !== 'up' && command !== 'status') || process.argv.length !== 3) {
    createLogger('info').error('Usage: node dist/infrastructure/database/migrate.js <up|status>');
    process.exitCode = 1;
    return;
  }

  const parsed = envSchema
    .pick({
      DATABASE_URL: true,
      DB_CONNECT_TIMEOUT_MS: true,
      DB_QUERY_TIMEOUT_MS: true,
      LOG_LEVEL: true,
    })
    .safeParse(process.env);
  if (!parsed.success) {
    createLogger('info').error(
      { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
      'Invalid migration configuration',
    );
    process.exitCode = 1;
    return;
  }

  const env = parsed.data;
  const logger = createLogger(env.LOG_LEVEL);
  let client: Client | undefined;
  try {
    client = new Client({
      connectionString: env.DATABASE_URL,
      connectionTimeoutMillis: env.DB_CONNECT_TIMEOUT_MS,
      query_timeout: env.DB_QUERY_TIMEOUT_MS,
      statement_timeout: env.DB_QUERY_TIMEOUT_MS,
      application_name: 'underwriting-migrations',
    });
    client.on('error', (error) => {
      logFailure(logger, 'migration_connection', error);
      process.exitCode = 1;
    });
    await client.connect();
    const migrations = await runMigrations(
      client,
      resolve(__dirname, '../../../migrations'),
      command,
    );
    for (const migration of migrations) {
      logger.info(migration, migration.applied ? 'Migration applied' : 'Migration pending');
    }
    logger.info({ command, total: migrations.length }, 'Migration command complete');
  } catch (error) {
    if (error instanceof MigrationError) logger.error(error.message);
    else logFailure(logger, 'migration', error);
    process.exitCode = 1;
  } finally {
    await client?.end().catch((error: unknown) => {
      logFailure(logger, 'migration_cleanup', error);
      process.exitCode = 1;
    });
  }
}

void main();
