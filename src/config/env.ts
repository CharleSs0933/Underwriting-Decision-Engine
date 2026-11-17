import { isIP } from 'node:net';
import { z } from 'zod';

const positiveInt = z.coerce.number().int().min(1).max(2_147_483_647);
const connectionUrl = (protocols: string[]) =>
  z.url().refine((value) => {
    const url = new URL(value);
    return protocols.includes(url.protocol) && url.hostname.length > 0;
  }, 'Invalid connection URL protocol or host');

const trustedProxy = z.string().refine((value) => {
  const [address = '', prefix, extra] = value.split('/');
  const family = isIP(address);
  if (!family || extra !== undefined) return false;
  return (
    prefix === undefined ||
    (/^\d+$/.test(prefix) && Number(prefix) > 0 && Number(prefix) <= (family === 4 ? 32 : 128))
  );
}, 'Use explicit proxy IPs or CIDRs with a nonzero prefix');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: positiveInt.max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: connectionUrl(['postgres:', 'postgresql:']),
  DB_POOL_MAX: positiveInt.default(10),
  DB_IDLE_TIMEOUT_MS: positiveInt.default(30000),
  DB_CONNECT_TIMEOUT_MS: positiveInt.default(5000),
  DB_QUERY_TIMEOUT_MS: positiveInt.default(5000),
  REDIS_URL: connectionUrl(['redis:', 'rediss:']),
  REDIS_CONNECT_TIMEOUT_MS: positiveInt.default(2000),
  REDIS_COMMAND_TIMEOUT_MS: positiveInt.default(1000),
  SHUTDOWN_TIMEOUT_MS: positiveInt.default(10000),
  TRUST_PROXY: z
    .string()
    .default('')
    .transform((value) =>
      value.trim() === '' ? [] : value.split(',').map((proxy) => proxy.trim()),
    )
    .pipe(z.array(trustedProxy)),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv): Env {
  return envSchema.parse(source);
}
