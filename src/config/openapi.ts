const successSchema = {
  type: 'object',
  required: ['success', 'data', 'requestId'],
  properties: {
    success: { type: 'boolean', enum: [true] },
    data: { type: 'object' },
    requestId: { type: 'string', format: 'uuid' },
  },
};

export const openapi = {
  openapi: '3.0.3',
  info: {
    title: 'Underwriting Decision Engine',
    version: '0.1.0',
    description: 'Phase 1 foundation. Synthetic data only; business APIs arrive in later phases.',
  },
  paths: {
    '/health': {
      get: {
        summary: 'Process liveness, independent of dependency health',
        responses: {
          '200': {
            description: 'Process is alive',
            content: { 'application/json': { schema: successSchema } },
          },
        },
      },
    },
    '/ready': {
      get: {
        summary: 'PostgreSQL readiness with optional Redis degradation',
        responses: {
          '200': {
            description: 'Ready (or degraded when Redis is unavailable)',
            content: { 'application/json': { schema: successSchema } },
          },
          '503': {
            description: 'PostgreSQL unavailable or process shutting down',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['success', 'error', 'requestId'],
                  properties: {
                    success: { type: 'boolean', enum: [false] },
                    error: {
                      type: 'object',
                      properties: {
                        code: { type: 'string', enum: ['NOT_READY'] },
                        message: { type: 'string' },
                      },
                    },
                    requestId: { type: 'string', format: 'uuid' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};
