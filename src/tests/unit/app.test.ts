import { Writable } from 'node:stream';
import pino from 'pino';
import request from 'supertest';
import { createApp } from '../../app';
import { createLogger, logFailure } from '../../infrastructure/logging/logger';

const healthy = async () => {};
const unavailable = async () => {
  throw new Error('secret database connection string');
};
const logger = pino({ enabled: false });

describe('system HTTP API', () => {
  it('serves liveness independently of dependencies and hides Express fingerprint', async () => {
    const app = createApp({ logger, checkDatabase: unavailable, checkRedis: unavailable });
    const response = await request(app).get('/health').expect(200);
    expect(response.body).toMatchObject({ success: true, data: { status: 'ok' } });
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('reports healthy dependencies', async () => {
    const response = await request(
      createApp({ logger, checkDatabase: healthy, checkRedis: healthy }),
    )
      .get('/ready')
      .expect(200);
    expect(response.body.data).toEqual({ status: 'ready', postgres: 'up', redis: 'up' });
  });

  it('remains ready with degraded Redis', async () => {
    const response = await request(
      createApp({ logger, checkDatabase: healthy, checkRedis: unavailable }),
    )
      .get('/ready')
      .expect(200);
    expect(response.body.data).toEqual({ status: 'degraded', postgres: 'up', redis: 'down' });
  });

  it('denies readiness when PostgreSQL fails without exposing error details', async () => {
    const response = await request(
      createApp({ logger, checkDatabase: unavailable, checkRedis: healthy }),
    )
      .get('/ready')
      .expect(503);
    expect(response.body.error.code).toBe('NOT_READY');
    expect(JSON.stringify(response.body)).not.toContain('secret');
  });

  it('denies readiness while shutting down', async () => {
    const app = createApp({
      logger,
      checkDatabase: healthy,
      checkRedis: healthy,
      isShuttingDown: () => true,
    });
    await request(app).get('/ready').expect(503);
  });

  it('returns JSON 404 with a generated correlation ID', async () => {
    const response = await request(
      createApp({ logger, checkDatabase: healthy, checkRedis: healthy }),
    )
      .get('/unknown')
      .set('X-Request-Id', 'untrusted input')
      .expect(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.body.requestId).toBe(response.headers['x-request-id']);
  });

  it('preserves a valid UUID correlation ID', async () => {
    const response = await request(
      createApp({ logger, checkDatabase: healthy, checkRedis: healthy }),
    )
      .get('/health')
      .set('X-Request-Id', 'b49c448b-06d4-4d5d-994e-01899476a453')
      .expect(200);
    expect(response.headers['x-request-id']).toBe('b49c448b-06d4-4d5d-994e-01899476a453');
  });

  it.each([
    ['{"password":"sensitive",', 400, 'INVALID_JSON'],
    [JSON.stringify({ payload: 'x'.repeat(110_000) }), 413, 'PAYLOAD_TOO_LARGE'],
  ])('rejects invalid JSON input with safe errors', async (body, status, code) => {
    const app = createApp({ logger, checkDatabase: healthy, checkRedis: healthy });
    const response = await request(app)
      .post('/unknown')
      .set('Content-Type', 'application/json')
      .send(body)
      .expect(Number(status));
    expect(response.body.error.code).toBe(code);
    expect(JSON.stringify(response.body)).not.toContain('sensitive');
  });

  it('serves OpenAPI only for implemented system routes', async () => {
    const app = createApp({ logger, checkDatabase: healthy, checkRedis: healthy });
    const response = await request(app).get('/openapi.json').expect(200);
    expect(Object.keys(response.body.paths).sort()).toEqual(['/health', '/ready']);
    await request(app).get('/api-docs/').expect(200);
  });

  it('treats invalid compressed JSON as a safe client error', async () => {
    const app = createApp({ logger, checkDatabase: healthy, checkRedis: healthy });
    const response = await request(app)
      .post('/unknown')
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'gzip')
      .send(Buffer.from('sensitive invalid gzip'))
      .expect(400);
    expect(response.body.error.code).toBe('INVALID_REQUEST_BODY');
    expect(JSON.stringify(response.body)).not.toContain('sensitive');
  });

  it('logs request metadata without credentials, body, path or query data', async () => {
    let output = '';
    const sink = new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    });
    const app = createApp({
      logger: createLogger('info', sink),
      checkDatabase: healthy,
      checkRedis: healthy,
    });
    await request(app)
      .post('/private-name?token=querysecret')
      .auth('name', 'passwordsecret')
      .send({ applicant: 'bodysecret' })
      .expect(404);
    const entry = JSON.parse(output.trim());
    expect(entry).toMatchObject({ method: 'POST', statusCode: 404 });
    expect(output).not.toMatch(/private-name|querysecret|passwordsecret|bodysecret/);
  });

  it('sanitizes infrastructure error logging and redacts sensitive structured fields', () => {
    let output = '';
    const sink = new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    });
    const log = createLogger('info', sink);
    logFailure(log, 'postgres', new Error('postgresql://user:secret@host/db'));
    log.info({ password: 'passwordsecret', authorization: 'bearersecret' }, 'redaction');
    expect(output).not.toMatch(/postgresql:|passwordsecret|bearersecret/);
    expect(JSON.parse(output.trim().split('\n')[0] ?? '').component).toBe('postgres');
  });
});
