import express from 'express';
import pino from 'pino';
import request from 'supertest';
import { errorHandler } from '../../middleware/error.middleware';
import { HttpError } from '../../shared/http-error';

describe('centralized errors', () => {
  it('hides unexpected async errors', async () => {
    const app = express();
    app.get('/failure', async () => {
      throw new Error('sensitive applicant data');
    });
    app.use(errorHandler(pino({ enabled: false })));
    const response = await request(app).get('/failure').expect(500);
    expect(response.body).toMatchObject({ success: false, error: { code: 'INTERNAL_ERROR' } });
    expect(JSON.stringify(response.body)).not.toContain('sensitive');
  });

  it('returns explicitly safe application errors', async () => {
    const app = express();
    app.get('/failure', () => {
      throw new HttpError(409, 'CONFLICT', 'Resource conflict');
    });
    app.use(errorHandler(pino({ enabled: false })));
    const response = await request(app).get('/failure').expect(409);
    expect(response.body.error).toEqual({ code: 'CONFLICT', message: 'Resource conflict' });
  });
});
