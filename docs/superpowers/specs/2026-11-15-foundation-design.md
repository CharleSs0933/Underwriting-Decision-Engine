# Underwriting Decision Engine design

Educational portfolio backend for synthetic applicants and illustrative policies. The supplied Master Prompt V3.0 is the project specification. This iteration implements Phase 1 only, and stops before Phase 2 pending user confirmation.

## Approach and boundaries

Use the requested modular monolith and layered architecture. Microservices add deployment and consistency overhead with no benefit for this portfolio. An ORM conflicts with the requested raw SQL learning goals. Express controllers delegate to services, which coordinate pure domain logic and parameterized SQL repositories. PostgreSQL owns durable state; Redis supports cache and rate limiting.

Phase 1 creates the runnable foundation: strict TypeScript, Express, validated configuration, a shared pg Pool, official Redis client, Pino, correlation IDs, centralized errors, liveness/readiness, shutdown, Docker Compose and Jest/Supertest tests. No business routes, migrations, seeds, authentication, rule evaluation, transaction helper, rate limiter or caching are claimed in this phase.

## Module responsibilities

| Module         | Responsibility in later phases                                               |
| -------------- | ---------------------------------------------------------------------------- |
| Authentication | Local password hashing, authenticated principals and role permissions        |
| Applications   | Validate, store, list and retrieve authorized synthetic applications         |
| Rules          | Manage drafts, publish immutable versions, archive and cache published rules |
| Underwriting   | Derive decimal-safe metrics, evaluate rules, aggregate and persist decisions |
| Manual review  | Resolve pending reviews while preserving automated decision history          |
| Audit          | Persist security-relevant changes without logging applicant payloads         |

## Initial entities (Phase 2 design)

All entities use UUID primary keys and TIMESTAMPTZ. Use foreign keys, indexes and checks. Money uses NUMERIC, with decimal-safe arithmetic selected before the engine phase. JSONB is reserved for rule operands, immutable snapshots and appropriate audit metadata.

| Entity                  | Principal attributes / relationships                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------- |
| users                   | unique login, password hash, role, active status                                                         |
| applications            | submitting user, applicant and loan attributes; financial columns use NUMERIC                            |
| rule_sets               | product code, unique product/version, DRAFT/ACTIVE/ARCHIVED, publication time                            |
| underwriting_rules      | rule-set FK, unique set/code, priority, enabled, allowed field/operator, expected value, failure outcome |
| eligibility_criteria    | rule-set FK, named configurable eligibility thresholds; exact relation refined in Phase 2                |
| evaluation_results      | application and exact rule-set FKs, decision, derived metrics, counts, timestamp                         |
| rule_evaluation_results | evaluation and rule FKs, observed value, passed/outcome/reason                                           |
| manual_reviews          | evaluation FK, reviewer FK, resolution and timestamps                                                    |
| audit_logs              | actor FK, action, target identifier, safe metadata, timestamp                                            |
| idempotency_records     | principal/scope/key uniqueness, request fingerprint, evaluation reference                                |

A partial unique index will permit one ACTIVE set per product. Publication uses a transaction; immutable published rows need database enforcement. Related evaluation, rule-result, review and idempotency writes share a transaction.

## Raw SQL repositories

Repositories map rows to typed objects and bind untrusted values as $1, $2, etc. They use the shared pool for standalone operations and receive one PoolClient for transactions. The Phase 2 helper owns BEGIN, COMMIT, ROLLBACK and release in finally; no pool.query calls inside a transaction. No ORM or query builder.

## Redis design (later phases)

One atomic Lua script uses Redis TIME to refill tokens, cap capacity and consume a token. Each normalized trusted IP has one bucket across protected routes, initially 100 tokens with 100 tokens/60 seconds refill and cost 1. Idle buckets expire. A rejected request gets 429 and Retry-After. Timeouts and fail-open/fail-closed configuration are explicit; default fail-open logs failures. Shared Wi-Fi, offices and CGNAT users share capacity. This cannot provide per-user fairness or stop clients rotating IPs. Trust proxy is disabled until deployment-specific proxy IPs/CIDRs are configured; arbitrary forwarding headers are not trusted.

Cache-aside keys identify immutable product/version rules. Active-version lookup stays in PostgreSQL; a Redis outage falls back to PostgreSQL. Drafts are not cached and cache payloads are validated.

## Phase 1 operational choices

- Node 26 Active LTS container, Express 5, current compatible dependencies captured by package-lock.json.
- GET /health is process liveness. GET /ready requires PostgreSQL; Redis failure returns 200 with degraded status. Shutdown readiness returns 503.
- Redis reconnects in the background and cannot prevent startup when PostgreSQL is healthy. Disable offline command queuing; enforce command and connection timeouts.
- Request logs include correlation ID, method, status and duration only. No bodies, headers, credentials, query strings or raw error messages.
- JSON parser failures become safe 400/413 responses; unknown errors become generic 500. Unknown routes are JSON 404.
- Compose publishes the backend on loopback only, has no database/Redis published ports, uses a persistent PostgreSQL volume and a non-root backend.
- SIGINT/SIGTERM stop accepting traffic, drain HTTP, close Redis and PostgreSQL, with a forced shutdown deadline.
- Minimal Swagger/OpenAPI covers the implemented system endpoints only. No placeholder business endpoints.

## Roadmap

1. Foundation (this iteration).
2. Database migrations, entities, raw SQL repositories, transactions and synthetic seeds.
3. Application management and validation.
4. Draft rules, eligibility criteria, publication and versioning.
5. Rule engine, decimal metrics, persistence and history.
6. Atomic Redis token bucket and concurrency tests.
7. Validated versioned cache-aside and fallback tests.
8. Idempotency, local authentication/RBAC, manual review and auditing.
9. Complete integration/coverage testing, OpenAPI and documentation.

## Validation and limits

Unit/HTTP tests use injected dependency probes to test success, degraded Redis, database failure, safe errors and logging without replacing Express. Integration tests explicitly require a dedicated test database and real Redis; never substitute mocks for integration verification. Docker execution depends on an available daemon. Record commands actually run and any unverified runtime assumptions. No deployments, commits or additional phases are required for Phase 1.
