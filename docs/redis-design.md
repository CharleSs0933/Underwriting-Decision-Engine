# Redis design

Phase 1 creates the official Redis client with error handling, disabled offline queuing, bounded connection/command timeouts and reconnect behavior. No rate limiting or rule caching has been implemented yet.

Use `executeRedisCommand` for every operational command. Native `commandOptions.timeout` bounds queued writes only; it does not bound a reply after the command reaches the socket. The helper enforces a response deadline and resets/reconnects the connection on timeout, clearing stalled commands. In future phases, a timed-out write may already have run remotely, so callers must not blindly replay it. Readiness can degrade even when Redis keeps a TCP connection open without replying.

## IP token bucket (Phase 6)

One bucket per trusted, normalized IP is shared across protected business routes. Default capacity is 100, refill is 100 tokens per 60 seconds and cost is 1. A Redis Lua script uses Redis TIME and atomically reads tokens/time, refills, caps, consumes and updates expiry. HTTP 429 includes Retry-After and a consistent error body. Configuration will be validated from environment variables.

Users behind the same NAT, office, university, family Wi-Fi or CGNAT share tokens. IP limits do not ensure per-user fairness and clients may rotate IPs. No user/client-based identity or alternate rate-limiting algorithm is planned. Express trusts no proxies by default. `TRUST_PROXY` accepts only explicitly known IPs/CIDRs, never blanket trust or a hop count. Configure it for the actual network path before placing the service behind a proxy; `X-Forwarded-For` from untrusted clients must not determine identity. IPv4-mapped IPv6 normalization belongs in the rate-limiter phase.

The general limiter will default to fail-open and log failures: requests proceed during Redis outages and are then unthrottled. A configurable fail-closed mode will also be provided. This behavior is an educational trade-off.

## Rule cache (Phase 7)

Cache-aside keys include immutable product and rule-set version, e.g. `underwriting:rules:personal-loan:v3`. Resolve the active version from PostgreSQL, validate cached content against that version, fall back to SQL on miss/error, then cache the published snapshot with a configurable TTL (initially 300 seconds). Never cache mutable drafts or use an independently stale active-version pointer. Evaluations persist the precise version used.

The cache never becomes the source of truth. Real Redis tests will verify atomic concurrency, refill/expiry, shared-IP behavior and cache fallback when those features exist.
