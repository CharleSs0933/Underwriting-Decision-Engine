import pino, { type DestinationStream, type Logger } from 'pino';

const errorReasons: Record<string, string> = {
  '3D000': 'Configured database does not exist',
  '28P01': 'Database authentication failed',
  '28000': 'Database authentication failed',
  '53300': 'Database connection limit reached',
  '57P03': 'Database is not accepting connections',
  ENOTFOUND: 'Host could not be resolved',
  ECONNREFUSED: 'Connection refused',
  ETIMEDOUT: 'Connection timed out',
  EADDRINUSE: 'Listen address is already in use',
  EACCES: 'Permission denied',
};

export function createLogger(level: string, destination?: DestinationStream): Logger {
  const options: pino.LoggerOptions = {
    level,
    base: { service: 'underwriting-decision-engine' },
    redact: ['password', 'authorization', 'cookie', 'DATABASE_URL', 'REDIS_URL'],
  };
  return destination ? pino(options, destination) : pino(options);
}

export function logFailure(logger: Logger, component: string, error: unknown): void {
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  const reason =
    typeof code === 'string' && Object.hasOwn(errorReasons, code) ? errorReasons[code] : undefined;
  // Raw driver/parser errors can contain credentials, SQL values or request payloads.
  logger.error(
    {
      component,
      errorType: error instanceof Error ? 'Error' : 'Unknown',
      errorCode: reason ? code : undefined,
      reason,
    },
    'Operation failed',
  );
}
