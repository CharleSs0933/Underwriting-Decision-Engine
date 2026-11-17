# Foundation Implementation Plan

> Execute inline with superpowers:executing-plans. User explicitly requested design followed by Phase 1 implementation in this turn; pause after Phase 1.

**Goal:** Deliver a runnable, tested backend foundation without business features.

**Architecture:** Express application factory receives PostgreSQL/Redis probes and a Pino logger. The server owns real infrastructure and lifecycle. Configuration is validated before startup.

**Tech Stack:** Node 26, strict TypeScript, Express, Zod, pg, redis, Pino, Jest, Supertest, Docker Compose.

**Spec:** ../specs/2026-11-15-foundation-design.md

## Global constraints

- Phase 1 only; PostgreSQL source of truth, raw SQL, no ORM.
- One shared pool, no infrastructure startup side effects when importing the app.
- Sensitive payloads and connection strings never enter request/error logs.
- No public PostgreSQL/Redis ports; non-root backend container.

## Review focus

- Redis unavailable: readiness degrades without denying PostgreSQL-backed traffic.
- PostgreSQL unavailable: readiness is 503, process liveness remains 200.
- Malformed/oversized JSON: safe 400/413, never reflected payloads.
- Invalid configuration: fail before listening without printing secrets.
- Shutdown: bounded drain, readiness 503, infrastructure released.

### Task 1: Configuration and HTTP contract

Files: package/tool configs; src/config/env.ts, src/app.ts, src/middleware/_, src/infrastructure/logging/logger.ts, src/shared/http-error.ts; src/tests/unit/_.test.ts.

Interfaces: parseEnv(source: NodeJS.ProcessEnv): Env; createApp({ logger, checkDatabase, checkRedis, isShuttingDown?, trustProxy? }): Express.

- [x] Write tests for configuration boundaries, health/readiness, correlation IDs, errors and safe logging.
- [x] Run npm test and observe missing implementation failures.
- [x] Implement the minimum validated environment, app, middleware and logger.
- [x] Run npm test and typecheck; inspect failures before correcting them.

### Task 2: Infrastructure and runtime

Files: src/config/database.ts, src/config/redis.ts, src/server.ts, src/tests/integration/infrastructure.test.ts.

Interfaces: createDatabase(env, logger): Pool; createRedis(env, logger): Redis client. Server uses the Task 1 application factory.

- [x] Write real PostgreSQL/Redis connectivity tests gated by explicit test URLs.
- [x] Implement bounded connections/commands, idle-pool error handling, startup and signal shutdown.
- [ ] Run integration tests when real services are available; record unavailable prerequisites honestly.

### Task 3: Docker and handoff

Files: Dockerfile, docker-compose.yml, .env.example, README.md, docs/{architecture,database-design,api-design,redis-design}.md.

- [x] Configure multi-stage image, health checks, persistent database and private service networking.
- [x] Document architecture/ERD, startup, testing, Phase 1 files and remaining roadmap.
- [x] Run npm run check, npm run test:coverage and docker compose config.
- [x] Attempt Docker build/runtime when daemon is available; review the code and record limits.
- [x] Stop before Phase 2 and wait for user confirmation.

## Execution record

- Configuration/HTTP/runtime implementation is in place. 37 tests pass, including compiled-process startup failures, HTTP shutdown, malformed compression and a stalled Redis transport with reconnection.
- `npm run check`, coverage and Compose config pass. Node 26.13.1 tests and typecheck pass. See [verification record](../../phase-1-verification.md) for coverage and actual environment limits.
- Real PostgreSQL/Redis connectivity remains unchecked: the dedicated test URLs are absent. Docker image build was attempted; the daemon is unavailable.
- Review found two defects and both were reproduced then fixed: malformed compressed JSON classification and the Redis queued-timeout/response-deadline distinction.
- Runtime tests use compiled `dist/server.js`; npm test/coverage build first. This avoids a sandbox-specific tsx user-account lookup failure and exercises the production entry point.
- No git repository existed, so no worktree, branch, commit or merge was created. Work stays in the user-supplied empty workspace.
- No further business functionality was implemented; the next phase requires user confirmation.
