# Phase 1 verification

Date: 2026-11-15 (Asia/Saigon).

Latest runtime status: the Docker network correction below has now been verified with all three containers healthy and host `/ready` returning 200. Earlier daemon-access limits describe the original implementation session.

## Evidence collected

- Initial unit run failed because the implementation modules did not yet exist. After implementation and review fixes, 37 tests passed across six suites.
- Strict TypeScript checking, ESLint and the production build passed.
- Coverage excludes the server process entry point. The Redis factory is exercised with a local transport peer; database/Redis factories have not yet been verified against real services.
- Final `npm run check`: passed typecheck, lint, format check, production build and all 37 unit/HTTP/process/transport tests. Final coverage: 90.57% statements, 84.61% branches, 90.97% lines.
- `npm audit --omit=dev`: zero production vulnerabilities. Full dependency audit reports development-only advisories through Jest/TypeScript ESLint transitive dependencies; no forced major downgrades or untested overrides were applied.
- Host runtime is Node 25.9.0. An isolated Node 26.13.1 runtime was downloaded for target-LTS checks.
- On Node 26.13.1, all 37 tests passed and `tsc --noEmit` passed. A target-runtime production build also passed before the review fixes; the final build was run by `npm run check` on the host runtime.
- Compose configuration validates with the generated, private `.env`. A backend image build was attempted but could not connect to the Docker daemon.

## Review corrections

- Invalid compressed JSON initially returned a generic 500. A regression test reproduced the error, then the handler was changed to return safe 400 `INVALID_REQUEST_BODY` for request-decoding failures.
- Native Redis command timeout did not bound an already-written command's response. A local TCP peer completed the actual client handshake and withheld PING replies, reproducing a hung readiness request. The response deadline helper now makes that request return degraded readiness, flushes the stalled connection and reconnects; the same test verifies recovered PING succeeds. This is a transport regression test, not a real Redis integration claim.
- Startup tests run compiled production code. An initial source-run attempt failed inside `tsx` because the sandbox blocks its user-account lookup; testing the compiled entry point avoids that unrelated development-runner limitation.

## Phase decisions

- Kept business modules/security controls in their explicitly assigned later phases; no applicant operations exist in Phase 1.
- Retained forced process exit after the shutdown deadline to prevent indefinite container termination.
- Kept real-service and Docker runtime verification outstanding rather than substituting fake services or assuming access to a host database.

## Environment limits

- Docker CLI and Compose exist; Docker Desktop/service is stopped and no Docker daemon pipe is available. Image build, container health/networking, real PostgreSQL/Redis connectivity and end-to-end signal handling in Linux containers are unverified.
- The real-service integration command was attempted and failed its explicit configuration guard: `TEST_DATABASE_URL` and `TEST_REDIS_URL` are absent. No real-service success is claimed. A host PostgreSQL service exists, but no credentials or permission to reuse its databases were assumed.
- Failing integration test: `real infrastructure connectivity › connects to a dedicated PostgreSQL test database and Redis`. It remains blocked on those two URLs and reachable real test services.

## Reproduce

Run `npm run check` and `npm run test:coverage` with Node 26. Start Docker Desktop, configure `.env`, then run `docker compose up -d --build`, `docker compose ps` and inspect `/health`, `/ready`, `/api-docs/`. Stop/restart Redis and verify degraded/recovered readiness. Send SIGTERM in the container and inspect shutdown logs.

Provision a dedicated database ending in `_test` and reachable Redis, set the two test URLs, then run `npm run test:integration`. The test uses real drivers and performs read-only database/PING probes. Later phases add migration, transaction, concurrency, cache and limiter verification.

## Follow-up: startup diagnostics

The reported generic startup failure was reproduced against the local configuration: PostgreSQL on localhost returned `3D000` for the configured `underwriting` database. A later read-only check found the database present and `SELECT 1` succeeded; no database was created or altered by the agent.

The shared error logger now retains allowlisted connection error codes and fixed diagnostic reasons, while continuing to omit raw driver messages, credentials and unknown codes. Regression tests cover missing database, authentication, DNS, refused connections, occupied HTTP port and sensitive unknown codes.

A compiled-server probe against the current real PostgreSQL configuration verified startup, `/health` 200 and `/ready` 200 with `postgres: up`, `redis: down`, `status: degraded`. The probe used a temporary HTTP port and stopped its own process afterward. Redis is still unavailable from the host configuration; this does not prevent PostgreSQL-backed readiness. This follow-up does not verify the dedicated integration suite or Docker runtime.

## Follow-up: Docker host access

Elevated read-only Docker inspection found all containers healthy, but the backend showed only `3000/tcp`: HostConfig requested the loopback binding while NetworkSettings had an empty published-port list. Both host URLs returned ECONNREFUSED. The backend was attached exclusively to the isolated `internal` network.

Added a `frontend` bridge for the backend while retaining its `internal` connection. PostgreSQL and Redis remain exclusively on `internal` without published ports. Recreated only the backend with `docker compose up -d --no-deps --force-recreate backend`; database/Redis containers and the persistent volume were unchanged.

Verified after the correction:

- `docker compose config --quiet` passed.
- All three containers report healthy; backend maps `127.0.0.1:3000->3000/tcp`.
- Both `http://127.0.0.1:3000/ready` and `http://localhost:3000/ready` return HTTP 200 with `{ "status": "ready", "postgres": "up", "redis": "up" }`.
- Prettier checks passed for the changed Compose file and README. Application unit tests were not repeated for this networking/documentation-only change.

This verifies the running Docker stack and real dependency readiness. Dedicated test-database integration tests and a fresh image build remain separate checks.
