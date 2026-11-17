# Phase 1 API

Swagger UI: `GET /api-docs/`. OpenAPI JSON: `GET /openapi.json`.

| Route         | Success                     | Failure                                     |
| ------------- | --------------------------- | ------------------------------------------- |
| `GET /health` | 200 process alive           | Independent of dependencies                 |
| `GET /ready`  | 200 ready or Redis degraded | 503 PostgreSQL unavailable or shutting down |

Success envelope: `{ "success": true, "data": { ... }, "requestId": "UUID" }`.

Error envelope: `{ "success": false, "error": { "code": "NOT_FOUND", "message": "Route not found" }, "requestId": "UUID" }`.

Responses include `X-Request-Id` and `Cache-Control: no-store`. Clients may supply a UUID `X-Request-Id`; malformed IDs are replaced. JSON requests have a 100 KiB limit, malformed JSON returns 400, oversized input returns 413, unknown routes return 404, unexpected errors return a generic 500. Logs and error responses exclude applicant payloads and credentials.

Health and documentation endpoints are public. Business endpoints, authentication, RBAC, pagination and application/rule validation will be added in subsequent phases under `/api/v1`. The current server deliberately has no unauthenticated applicant access.
