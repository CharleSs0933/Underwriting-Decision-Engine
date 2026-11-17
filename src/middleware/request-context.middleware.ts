import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { Logger } from 'pino';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requestContext(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const supplied = req.get('X-Request-Id');
    const requestId = supplied && uuid.test(supplied) ? supplied : randomUUID();
    res.locals.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const start = performance.now();
    res.on('finish', () => {
      logger.info(
        {
          requestId,
          method: req.method,
          statusCode: res.statusCode,
          durationMs: Math.round(performance.now() - start),
        },
        'Request completed',
      );
    });
    next();
  };
}
