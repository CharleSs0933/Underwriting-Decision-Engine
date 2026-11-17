import { once } from 'node:events';
import { createServer, type Socket } from 'node:net';
import { createInterface } from 'node:readline';
import request from 'supertest';
import { createApp } from '../../app';
import { parseEnv } from '../../config/env';
import { createRedis } from '../../config/redis';
import { createLogger } from '../../infrastructure/logging/logger';
import { executeRedisCommand } from '../../infrastructure/redis/command';

it('degrades readiness on a nonresponsive Redis and recovers without retaining stalled commands', async () => {
  let ignorePings = false;
  let connections = 0;
  const sockets = new Set<Socket>();
  const peer = createServer((socket) => {
    connections++;
    sockets.add(socket);
    socket.on('close', () => {
      sockets.delete(socket);
    });
    const lines = createInterface({ input: socket, crlfDelay: Infinity });
    let remaining = 0;
    let readValue = false;
    let values: string[] = [];
    // This transport peer accepts the ASCII CLIENT/PING frames emitted by this fixture.
    lines.on('line', (line) => {
      if (remaining === 0) {
        remaining = Number(line.slice(1));
        values = [];
      } else if (!readValue) {
        readValue = true;
      } else {
        values.push(line);
        readValue = false;
        remaining--;
        if (remaining === 0) {
          if (values[0] === 'PING') {
            if (!ignorePings) socket.write('+PONG\r\n');
          } else socket.write('+OK\r\n');
        }
      }
    });
  });
  await new Promise<void>((resolve) => {
    peer.listen(0, '127.0.0.1', resolve);
  });
  const address = peer.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address');
  const env = parseEnv({
    DATABASE_URL: 'postgresql://localhost/underwriting_test',
    REDIS_URL: `redis://127.0.0.1:${address.port}`,
    REDIS_COMMAND_TIMEOUT_MS: '50',
  });
  const logger = createLogger('silent');
  const redis = createRedis(env, logger);
  const ping = () =>
    executeRedisCommand(redis, () => redis.ping(), env.REDIS_COMMAND_TIMEOUT_MS, logger);
  const app = createApp({
    logger,
    checkDatabase: async () => {},
    checkRedis: async () => {
      await ping();
    },
  });
  try {
    await redis.connect();
    expect(await ping()).toBe('PONG');
    ignorePings = true;
    const recovered = once(redis, 'ready');
    const response = await request(app).get('/ready').timeout({ deadline: 1000 }).expect(200);
    expect(response.body.data).toEqual({ status: 'degraded', postgres: 'up', redis: 'down' });
    ignorePings = false;
    await recovered;
    expect(connections).toBeGreaterThan(1);
    expect(await ping()).toBe('PONG');
  } finally {
    if (redis.isOpen) redis.destroy();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => {
      peer.close(() => {
        resolve();
      });
    });
  }
});
