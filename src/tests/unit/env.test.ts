import { parseEnv } from '../../config/env';

const valid = {
  DATABASE_URL: 'postgresql://demo:secret@localhost:5432/underwriting',
  REDIS_URL: 'redis://localhost:6379',
};

describe('configuration', () => {
  it('accepts configured pool values and keeps proxies untrusted by default', () => {
    const env = parseEnv({ ...valid, DB_POOL_MAX: '7' });
    expect(env.DB_POOL_MAX).toBe(7);
    expect(env.TRUST_PROXY).toEqual([]);
  });

  it.each([
    { PORT: '0' },
    { PORT: '65536' },
    { DB_POOL_MAX: '1.2' },
    { DB_CONNECT_TIMEOUT_MS: '0' },
    { REDIS_COMMAND_TIMEOUT_MS: '-1' },
    { DATABASE_URL: 'https://example.com' },
    { REDIS_URL: 'https://example.com' },
    { TRUST_PROXY: 'true' },
    { TRUST_PROXY: '1' },
    { TRUST_PROXY: '0.0.0.0/0' },
    { TRUST_PROXY: '::/0' },
    { TRUST_PROXY: '192.168.1.1/33' },
    { LOG_LEVEL: 'everything' },
  ])('rejects invalid configuration %j', (override) => {
    expect(() => parseEnv({ ...valid, ...override })).toThrow();
  });

  it('requires infrastructure URLs', () => {
    expect(() => parseEnv({})).toThrow();
  });

  it('accepts explicit proxy IPs and CIDRs', () => {
    expect(parseEnv({ ...valid, TRUST_PROXY: '127.0.0.1, ::1, 10.0.0.0/8' }).TRUST_PROXY).toEqual([
      '127.0.0.1',
      '::1',
      '10.0.0.0/8',
    ]);
  });
});
