import { createLogger } from '../../infrastructure/logging/logger';
import { parseEnv } from '../../config/env';
import { createDatabase } from '../../config/database';
import { createRedis } from '../../config/redis';
import { executeRedisCommand } from '../../infrastructure/redis/command';

describe('real infrastructure connectivity', () => {
  it('connects to a dedicated PostgreSQL test database and Redis', async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    const redisUrl = process.env.TEST_REDIS_URL;
    if (!databaseUrl || !redisUrl) {
      throw new Error(
        'Set TEST_DATABASE_URL (database name ending in _test) and TEST_REDIS_URL; real services are required.',
      );
    }
    if (!new URL(databaseUrl).pathname.endsWith('_test')) {
      throw new Error('TEST_DATABASE_URL must name a dedicated database ending in _test.');
    }
    const env = parseEnv({ DATABASE_URL: databaseUrl, REDIS_URL: redisUrl });
    const logger = createLogger('silent');
    const pool = createDatabase(env, logger);
    const redis = createRedis(env, logger);
    try {
      const result = await pool.query<{ database_name: string; value: number }>(
        'SELECT current_database() AS database_name, $1::int AS value',
        [42],
      );
      expect(result.rows[0]?.value).toBe(42);
      expect(result.rows[0]?.database_name).toMatch(/_test$/);
      await redis.connect();
      expect(
        await executeRedisCommand(redis, () => redis.ping(), env.REDIS_COMMAND_TIMEOUT_MS, logger),
      ).toBe('PONG');
    } finally {
      if (redis.isOpen) redis.destroy();
      await pool.end();
    }
  });
});
