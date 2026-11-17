import express from 'express';
import type { Logger } from 'pino';
import swaggerUi from 'swagger-ui-express';
import { openapi } from './config/openapi';
import { errorHandler } from './middleware/error.middleware';
import { requestContext } from './middleware/request-context.middleware';
import { HttpError } from './shared/http-error';

interface AppDependencies {
  logger: Logger;
  checkDatabase: () => Promise<void>;
  checkRedis: () => Promise<void>;
  isShuttingDown?: () => boolean;
  trustProxy?: string[];
}

export function createApp(deps: AppDependencies): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', deps.trustProxy?.length ? deps.trustProxy : false);
  app.use(requestContext(deps.logger));
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => {
    res.json({ success: true, data: { status: 'ok' }, requestId: res.locals.requestId });
  });

  app.get('/ready', async (_req, res) => {
    if (deps.isShuttingDown?.()) throw new HttpError(503, 'NOT_READY', 'Service is shutting down');
    const [postgres, redis] = await Promise.allSettled([deps.checkDatabase(), deps.checkRedis()]);
    if (postgres.status === 'rejected' || deps.isShuttingDown?.()) {
      throw new HttpError(503, 'NOT_READY', 'Service is not ready');
    }
    res.json({
      success: true,
      data: {
        status: redis.status === 'fulfilled' ? 'ready' : 'degraded',
        postgres: 'up',
        redis: redis.status === 'fulfilled' ? 'up' : 'down',
      },
      requestId: res.locals.requestId,
    });
  });

  app.get('/openapi.json', (_req, res) => {
    res.json(openapi);
  });
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openapi));
  app.use((_req, _res, next) => {
    next(new HttpError(404, 'NOT_FOUND', 'Route not found'));
  });
  app.use(errorHandler(deps.logger));
  return app;
}
