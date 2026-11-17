import { Pool } from 'pg';
import type { Logger } from 'pino';
import type { Env } from './env';
import { logFailure } from '../infrastructure/logging/logger';

export function createDatabase(env: Env, logger: Logger): Pool {
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: env.DB_POOL_MAX,
    idleTimeoutMillis: env.DB_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: env.DB_CONNECT_TIMEOUT_MS,
    query_timeout: env.DB_QUERY_TIMEOUT_MS,
    statement_timeout: env.DB_QUERY_TIMEOUT_MS,
    application_name: 'underwriting-decision-engine',
  });
  pool.on('error', (error) => {
    logFailure(logger, 'postgres_pool', error);
  });
  return pool;
}
