import type { Logger } from 'pino';
import type { createRedis } from '../../config/redis';
import { logFailure } from '../logging/logger';

export async function executeRedisCommand<T>(
  client: ReturnType<typeof createRedis>,
  command: () => Promise<T>,
  timeoutMs: number,
  logger: Logger,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      command(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          const error = new Error('Redis command deadline exceeded');
          reject(error);
          logFailure(logger, 'redis_command_timeout', error);
          // Driver timeouts cover queued writes only; reset the socket to discard stalled replies.
          if (client.isOpen) {
            client.destroy();
            void client.connect().catch((cause: unknown) => {
              logFailure(logger, 'redis_reconnect', cause);
            });
          }
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
