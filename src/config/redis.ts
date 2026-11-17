import { createClient } from 'redis';
import type { Logger } from 'pino';
import type { Env } from './env';
import { logFailure } from '../infrastructure/logging/logger';

export function createRedis(env: Env, logger: Logger) {
  const client = createClient({
    url: env.REDIS_URL,
    socket: { connectTimeout: env.REDIS_CONNECT_TIMEOUT_MS },
    commandOptions: { timeout: env.REDIS_COMMAND_TIMEOUT_MS },
    disableOfflineQueue: true,
    commandsQueueMaxLength: 1000,
  });
  client.on('error', (error) => {
    logFailure(logger, 'redis', error);
  });
  client.on('ready', () => {
    logger.info({ component: 'redis' }, 'Redis connected');
  });
  return client;
}
