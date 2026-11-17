import { spawnSync } from 'node:child_process';

function startWith(env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, ['dist/server.js'], {
    env: { ...process.env, DOTENV_CONFIG_QUIET: 'true', LOG_LEVEL: 'info', ...env },
    encoding: 'utf8',
    timeout: 10000,
  });
}

describe('server startup failure', () => {
  it('exits before listening when configuration is invalid without printing values', () => {
    const result = startWith({ DATABASE_URL: 'https://user:configsecret@example.com/db' });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Invalid environment configuration');
    expect(result.stdout + result.stderr).not.toContain('configsecret');
    expect(result.stdout).not.toContain('HTTP server listening');
  });

  it('exits cleanly when PostgreSQL is unreachable without leaking the connection URL', () => {
    const result = startWith({
      DATABASE_URL: 'postgresql://test:dbsecret@127.0.0.1:1/underwriting_test',
      REDIS_URL: 'redis://127.0.0.1:1',
      DB_CONNECT_TIMEOUT_MS: '200',
      DB_QUERY_TIMEOUT_MS: '200',
      SHUTDOWN_TIMEOUT_MS: '1000',
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('startup_failure');
    expect(result.stdout).toContain('ECONNREFUSED');
    expect(result.stdout).toContain('Shutdown complete');
    expect(result.stdout + result.stderr).not.toContain('dbsecret');
    expect(result.stdout).not.toContain('HTTP server listening');
  });
});
