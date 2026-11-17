import type { ErrorRequestHandler } from 'express';
import type { Logger } from 'pino';
import { HttpError } from '../shared/http-error';

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, _req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    let safe = new HttpError(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
    if (error instanceof HttpError) safe = error;
    else if (typeof error === 'object' && error !== null) {
      const type = 'type' in error ? error.type : undefined;
      if (type === 'entity.parse.failed') {
        safe = new HttpError(400, 'INVALID_JSON', 'Request body must be valid JSON');
      } else if (type === 'entity.too.large') {
        safe = new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds the size limit');
      } else if (type === 'encoding.unsupported' || type === 'charset.unsupported') {
        safe = new HttpError(415, 'UNSUPPORTED_ENCODING', 'Unsupported request encoding');
      } else if ('status' in error && error.status === 400) {
        safe = new HttpError(400, 'INVALID_REQUEST_BODY', 'Request body is invalid');
      }
    }
    if (safe.status >= 500) {
      logger.error({ requestId: res.locals.requestId, code: safe.code }, 'Request failed');
    }
    res.status(safe.status).json({
      success: false,
      error: { code: safe.code, message: safe.message },
      requestId: res.locals.requestId,
    });
  };
}
