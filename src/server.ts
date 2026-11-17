import 'dotenv/config';
import { createServer } from 'node:http';
import { createApp } from './app';
import { createDatabase } from './config/database';
import { envSchema } from './config/env';
import { createRedis } from './config/redis';
import { shutdownServer } from './infrastructure/http/shutdown';
import { createLogger, logFailure } from './infrastructure/logging/logger';
import { executeRedisCommand } from './infrastructure/redis/command';

async function main(): Promise<void> {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    createLogger('info').fatal(
      { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
      'Invalid environment configuration',
    );
    process.exitCode = 1;
    return;
  }
  const env = parsed.data;
  const logger = createLogger(env.LOG_LEVEL);
  const pool = createDatabase(env, logger);
  const redis = createRedis(env, logger);
  let shuttingDown = false;
  const checkDatabase = async () => {
    await pool.query('SELECT 1');
  };
  const checkRedis = async () => {
    await executeRedisCommand(redis, () => redis.ping(), env.REDIS_COMMAND_TIMEOUT_MS, logger);
  };
  const app = createApp({
    logger,
    checkDatabase,
    checkRedis,
    trustProxy: env.TRUST_PROXY,
    isShuttingDown: () => shuttingDown,
  });
  const server = createServer(
    { requestTimeout: 30000, headersTimeout: 10000, keepAliveTimeout: 5000 },
    app,
  );

  const closeDependencies = async () => {
    const results = await Promise.allSettled([
      pool.end(),
      (async () => {
        if (redis.isOpen) await redis.close();
      })(),
    ]);
    for (const result of results) {
      if (result.status === 'rejected') throw result.reason;
    }
  };

  const shutdown = async (reason: string, exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ reason }, 'Shutting down');
    try {
      await shutdownServer(server, closeDependencies, env.SHUTDOWN_TIMEOUT_MS);
      process.exitCode = exitCode;
      logger.info('Shutdown complete');
    } catch (error) {
      logFailure(logger, 'shutdown', error);
      if (redis.isOpen) redis.destroy();
      process.exit(1);
    }
  };

  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });

  try {
    await checkDatabase();
    if (shuttingDown) return;
    void redis.connect().catch((error: unknown) => {
      if (!shuttingDown) logFailure(logger, 'redis_connect', error);
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(env.PORT, '0.0.0.0', () => {
        server.off('error', reject);
        resolve();
      });
    });
    server.on('error', (error) => {
      logFailure(logger, 'http_server', error);
      void shutdown('server_error', 1);
    });
    logger.info({ port: env.PORT }, 'HTTP server listening');
  } catch (error) {
    logFailure(logger, 'startup', error);
    await shutdown('startup_failure', 1);
  }
}

void main().catch((error: unknown) => {
  logFailure(createLogger('info'), 'fatal_startup', error);
  process.exit(1);
});
