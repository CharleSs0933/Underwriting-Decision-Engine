# Underwriting Decision Engine

A production-oriented educational backend for evaluating **synthetic** applications against configurable, illustrative underwriting policies. The complete project will demonstrate raw SQL, transactions, immutable rule versions, decision history, idempotency and Redis concurrency control.

**Current milestone: Phase 2 — Feature 2.2, SQL Migration System.** The foundation and database schema design are complete; migration infrastructure is implemented. Business tables and functionality remain in later features. This project is not a real lending policy or financial advice.

## What works now

- Node.js 26 Active LTS, strict TypeScript and Express 5.
- Zod environment validation, a shared PostgreSQL `pg` pool and official Redis client.
- Bounded database/Redis connections and operations, Redis response deadlines/reconnection and pool error handling.
- Process liveness, database readiness and degraded readiness when Redis is unavailable.
- Pino request metadata, UUID correlation IDs, safe JSON errors and bounded JSON input.
- Graceful HTTP draining and dependency cleanup on SIGINT/SIGTERM with a deadline.
- Multi-stage, non-root Docker image; Compose services and PostgreSQL persistence.
- Jest/Supertest tests, ESLint, Prettier and Swagger UI for the implemented endpoints.
- Ordered SQL migrations with checksummed tracking, per-file transactions, concurrency locking and status reporting.

No ORM or query builder is used. PostgreSQL is the source of truth. Redis is supporting infrastructure.

## Architecture

```mermaid
flowchart TD
  Client --> API[API: routing, validation, authorization]
  API --> Services[Services: use cases and transactions]
  Services --> Domain[Domain: metrics, rule evaluation, aggregation]
  Services --> Repositories[Repositories: parameterized raw SQL]
  Repositories --> Pool[Shared pg connection pool]
  Pool --> PostgreSQL[(PostgreSQL source of truth)]
  API -. IP token bucket in Phase 6 .-> Redis[(Redis)]
  Services -. Immutable version cache in Phase 7 .-> Redis
```

The API runtime and infrastructure connections exist now. Business layers in this diagram are the agreed design for later phases. Module responsibilities and runtime details: [architecture](docs/architecture.md) and [full design](docs/superpowers/specs/2026-11-15-foundation-design.md).

## Run with Docker

Prerequisites: Docker Engine/Desktop running with Docker Compose.

```powershell
Copy-Item .env.example .env
# Edit .env: set POSTGRES_PASSWORD and the matching password in DATABASE_URL.
docker compose up -d --build
docker compose ps
docker compose logs -f backend
```

Open [health](http://localhost:3000/health), [readiness](http://localhost:3000/ready) and [Swagger UI](http://localhost:3000/api-docs/).

```powershell
docker compose down
```

Compose binds only the backend to `127.0.0.1:3000`. The backend joins a `frontend` bridge for host port publishing and the private `internal` network for database access. PostgreSQL and Redis join only `internal` and have **no host ports**. PostgreSQL data persists in `postgres_data`. `docker compose down` preserves that volume; do not add `-v` unless you intend to delete the database. PostgreSQL 18 stores data beneath the mounted `/var/lib/postgresql` volume.

Use URL-encoded passwords in `DATABASE_URL` when they contain reserved characters. Keep `.env` private. The example password is a replaceable local development value. Changing `POSTGRES_PASSWORD` after database initialization does not change the existing database user's password; rotate it in PostgreSQL as well. Changing PORT changes the published host port; Compose keeps the backend container port at 3000.

## Develop locally

Use Node.js 26 (`.nvmrc`) and npm. Install the lockfile dependencies:

```powershell
npm ci
Copy-Item .env.example .env
# Point DATABASE_URL and REDIS_URL at reachable local development services.
npm run dev
```

Compose's `postgres` and `redis` hostnames resolve only inside its network. Host development requires separately reachable services or an explicitly local Compose port override; the default Compose file keeps those ports private. No host database credentials are assumed.

```powershell
npm run build
npm start
```

The server checks PostgreSQL before listening and exits with code 1 on failure. Redis connects in the background and may recover independently. Invalid environment configuration reports field names without values and exits before listening.

## Configuration

See [.env.example](.env.example) for all settings.

| Setting                                        | Default / purpose                                          |
| ---------------------------------------------- | ---------------------------------------------------------- |
| `DATABASE_URL`, `REDIS_URL`                    | Required connection URLs                                   |
| `PORT`                                         | 3000                                                       |
| `NODE_ENV`                                     | development; Compose sets production                       |
| `LOG_LEVEL`                                    | info                                                       |
| `DB_POOL_MAX`                                  | 10 shared connections                                      |
| `DB_IDLE_TIMEOUT_MS`                           | 30000                                                      |
| `DB_CONNECT_TIMEOUT_MS`, `DB_QUERY_TIMEOUT_MS` | 5000 each                                                  |
| `REDIS_CONNECT_TIMEOUT_MS`                     | 2000                                                       |
| `REDIS_COMMAND_TIMEOUT_MS`                     | 1000                                                       |
| `SHUTDOWN_TIMEOUT_MS`                          | 10000                                                      |
| `TRUST_PROXY`                                  | Empty: no trusted proxies; otherwise explicit IP/CIDR list |

Do not enable blanket proxy trust. Set only known proxy addresses for the real deployment topology. No request body, authorization header, raw error message, path or query string is logged.

## Database migrations

With `DATABASE_URL` configured for the intended database, run from the project root:

```powershell
npm run db:migrate:status
npm run db:migrate
```

Both commands build and run the compiled CLI. They use a dedicated PostgreSQL connection and need no
Redis configuration. `status` reports applied/pending files without creating tables. `db:migrate`
initializes `public.schema_migrations` and applies pending SQL files atomically, one file at a time.
There are no business migration files in Feature 2.2, so an initial run creates only the tracking table.
Migrations do not run automatically when the server starts.

For Docker, build the updated image and start PostgreSQL, then use the compiled command because the
production image does not contain the TypeScript compiler:

```powershell
docker compose build backend
docker compose up -d postgres
docker compose run --rm --no-deps backend node dist/infrastructure/database/migrate.js status
docker compose run --rm --no-deps backend node dist/infrastructure/database/migrate.js up
```

Wait until PostgreSQL is healthy before invoking the CLI. Compose's default database has no host port;
use the container commands above unless you have separately configured a reachable host database.
See [migration instructions](migrations/README.md) for naming, timeouts, checksums, concurrency and
failure recovery. Applied files are immutable; corrective migrations move forward. No `down` or reset
command is provided.

## API examples

```powershell
curl.exe -i http://localhost:3000/health
curl.exe -i http://localhost:3000/ready
```

Successful readiness includes `X-Request-Id` and:

```json
{
  "success": true,
  "data": { "status": "ready", "postgres": "up", "redis": "up" },
  "requestId": "b49c448b-06d4-4d5d-994e-01899476a453"
}
```

Redis unavailable: HTTP 200 with `status: "degraded"`, `redis: "down"`. PostgreSQL unavailable or process draining: HTTP 503 with `error.code: "NOT_READY"`. `GET /health` stays independent of both services. Unknown routes return JSON 404; malformed JSON returns 400 and input over 100 KiB returns 413. Responses are not cached.

The OpenAPI document at `/openapi.json` describes only implemented system routes. [API design](docs/api-design.md) describes the response envelopes. `/api/v1` business routes are not implemented yet.

## Tests and checks

```powershell
npm run check
npm run test:coverage
```

`check` runs strict type checking, ESLint, Prettier, a production build and the unit/HTTP suite. Tests cover healthy/degraded/unready states, configuration boundaries, correlation IDs, safe parser/async errors, log privacy, request draining and shutdown deadlines. HTTP tests use the real Express application with injected dependency probes. A local TCP transport peer verifies stalled Redis response deadlines and recovery; it is not a substitute for real Redis integration tests. Startup tests launch the compiled server and verify safe exits for invalid configuration and unreachable PostgreSQL. Coverage excludes the process entry point; it is not a claim of full infrastructure coverage.

The separate integration suite requires **real PostgreSQL and Redis**, explicitly configured:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://test_user:test_password@localhost:5432/underwriting_test'
$env:TEST_REDIS_URL = 'redis://localhost:6379'
npm run test:integration
```

Create an isolated `underwriting_test` database and user first. The test refuses a database name that does not end in `_test`. Phase 1 only verifies parameterized SELECT, connectivity and Redis PING; it does not create tables or flush Redis. Missing URLs fail clearly rather than silently skip the test. Transaction/rollback, concurrency, cache and limiter integration tests arrive with those features.

## Planned database and SQL design

```mermaid
erDiagram
  USERS ||--o{ APPLICATIONS : submits
  RULE_SETS ||--o{ UNDERWRITING_RULES : contains
  RULE_SETS ||--o{ ELIGIBILITY_CRITERIA : defines
  APPLICATIONS ||--o{ EVALUATION_RESULTS : has
  RULE_SETS ||--o{ EVALUATION_RESULTS : version_used
  EVALUATION_RESULTS ||--o{ RULE_EVALUATION_RESULTS : has
  UNDERWRITING_RULES ||--o{ RULE_EVALUATION_RESULTS : explains
  EVALUATION_RESULTS ||--o| MANUAL_REVIEWS : requires
  USERS ||--o{ MANUAL_REVIEWS : resolves
  USERS ||--o{ AUDIT_LOGS : acts
  USERS ||--o{ IDEMPOTENCY_RECORDS : owns
  EVALUATION_RESULTS ||--o{ IDEMPOTENCY_RECORDS : references
```

This ERD is a design, not an installed schema. Entities will use UUIDs, TIMESTAMPTZ, constraints, foreign keys and indexes; financial columns use NUMERIC. Published rule sets will be immutable with one active version per product. See [database design](docs/database-design.md).

`pg` was selected to make SQL, transaction boundaries and connection ownership explicit. Repositories will map rows to TypeScript and bind input using `$1`, `$2`, etc. A transaction helper will acquire one client, run BEGIN, pass it through related repositories, COMMIT or ROLLBACK and always release in finally. Pool queries cannot be mixed into a transaction. Migration tooling is implemented in Feature 2.2; business SQL migrations, the shared transaction helper and seed scripts remain later features.

## Planned evaluation workflow

1. Validate/authorize an application and resolve the active rule version from PostgreSQL.
2. Load a validated immutable rule snapshot from cache or SQL.
3. Derive decimal-safe eligibility metrics and evaluate all enabled rules using typed operators.
4. Aggregate **REJECTED > MANUAL_REVIEW > APPROVED**; invalid required data cannot approve.
5. Atomically persist evaluation, rule explanations and idempotency record; preserve history.

Rules remain configurable, with no `eval()` or dynamically generated JavaScript. This workflow is implemented in later phases.

## Planned Redis behavior and limitations

The Phase 6 limiter uses only an **IP token bucket**: 100 tokens, refill of 100/60 seconds, request cost 1, all configurable. Redis TIME and Lua make refill/consume atomic; idle keys expire and rejected calls receive 429/Retry-After. Shared Wi-Fi, offices and CGNAT share a bucket; this does not provide per-user fairness or prevent IP rotation. Default fail-open means requests are **unthrottled during Redis outages**, with logged failures. No limiter exists in Phase 1.

Phase 7 uses cache-aside for immutable product/version rule snapshots with a configurable TTL, initially 300 seconds. PostgreSQL selects the active version every time; Redis cannot silently change that selection. Drafts are never cached, and Redis failures fall back to PostgreSQL. See [Redis design](docs/redis-design.md).

## Roadmap and unfinished functionality

| Phase | Deliverable                                                                            | Status                                                        |
| ----- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1     | Runtime, configuration, health, logging, connections, Docker and foundation tests      | Implemented; see verification record below                    |
| 2     | SQL migrations, normalized entities, transaction helper, repositories, synthetic seeds | Features 2.1-2.2 implemented; Feature 2.3 awaits confirmation |
| 3     | Application submission/retrieval/listing and validation                                | Planned                                                       |
| 4     | Draft rules, criteria, immutable publication/versioning                                | Planned                                                       |
| 5     | Operators, decimal metrics, decisions and history                                      | Planned                                                       |
| 6     | Redis IP token bucket, atomic/concurrent tests                                         | Planned                                                       |
| 7     | Versioned rule caching and fallback tests                                              | Planned                                                       |
| 8     | Database idempotency, secure local authentication, RBAC, reviews and audits            | Planned                                                       |
| 9     | Complete coverage/integration suite, Swagger, documentation and Docker verification    | Planned                                                       |

Authentication, authorization, applicant data, business schema migrations, seeds, business endpoints, decisions, the shared transaction helper, rate limiting and rule caching are **unfinished**. The foundation has no applicant-facing operations to expose before these controls are added.

## Files created in Phase 1

- `src/app.ts`, `src/server.ts`: application factory and process lifecycle.
- `src/config/{env,database,redis,openapi}.ts`: validation, infrastructure factories, API specification.
- `src/middleware/{request-context,error}.middleware.ts`: correlation, metadata logs, safe errors.
- `src/infrastructure/logging/logger.ts`, `src/infrastructure/http/shutdown.ts`, `src/infrastructure/redis/command.ts`, `src/shared/http-error.ts`.
- `src/tests/unit/{app,env,errors,shutdown,server,redis-timeout,logger}.test.ts`, `src/tests/integration/infrastructure.test.ts`.
- `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `.env.example`, `.nvmrc`, `.gitignore`.
- `package.json`, `package-lock.json`, `tsconfig*.json`, `jest.config.cjs`, `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore`.
- `README.md`, `docs/{architecture,database-design,api-design,redis-design,phase-1-verification}.md`, design and plan under `docs/superpowers/`.
- A private, ignored `.env` with a generated local database password was created in this workspace; no credentials are committed or documented.

## Verification record

See [Phase 1 verification](docs/phase-1-verification.md) for actual commands, results and environment limitations. Do not infer real-service or Docker runtime verification from passing unit tests.
