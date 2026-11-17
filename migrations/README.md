# SQL migrations

Feature 2.2 installs the runner only. This directory intentionally contains no SQL migrations yet;
Feature 2.3 will add the approved business schema. Do not add an empty placeholder migration.

## Commands

From the repository root, with `DATABASE_URL` pointing at the intended reachable database:

```powershell
npm run db:migrate:status
npm run db:migrate
```

These commands build TypeScript before executing the compiled CLI. They load `.env` from the current
working directory; exported environment variables take precedence. Only `DATABASE_URL`,
`DB_CONNECT_TIMEOUT_MS`, `DB_QUERY_TIMEOUT_MS` and `LOG_LEVEL` are validated. Redis is unnecessary.
The two timeouts default to 5000 ms. Set `DB_QUERY_TIMEOUT_MS` high enough for an entire migration file,
including lock waits: each file is one client query, so the client timeout covers the whole file. The
same setting supplies PostgreSQL's per-statement timeout.

The CLI finds this directory relative to its compiled location, independent of the current working
directory. Keep `migrations/` beside `dist/` when distributing the build. In Docker, rebuild the backend
image after adding migrations, then run:

```powershell
docker compose run --rm --no-deps backend node dist/infrastructure/database/migrate.js status
docker compose run --rm --no-deps backend node dist/infrastructure/database/migrate.js up
```

The Compose PostgreSQL service must already be healthy. The commands use the backend service's existing
environment and internal network. Production images omit the TypeScript compiler, so use the direct
compiled command above instead of the npm scripts inside the container. Migration execution is manual
and is never part of application startup. Do not bake credentials into an image or a migration file.

## Authoring contract

- Use a unique four-digit positive version and a lowercase description:
  `0001_initial_schema.sql`, `0002_add_example_index.sql`, through version `9999`.
- Versions execute numerically. Gaps are allowed; every new migration must come after applied history.
- SQL files must be nonempty UTF-8 regular files. SQL-like filenames with invalid names, directories or
  symbolic links ending in `.sql` are rejected. Non-SQL files such as this README are ignored.
- Each file contains trusted PostgreSQL SQL, including multiple statements and trigger/function
  bodies if needed. The runner owns `BEGIN`, `COMMIT` and `ROLLBACK`; never put transaction-control
  commands in migration SQL. Do not manipulate the tracking table or session/advisory-lock settings.
- All SQL must support running inside a transaction. Operations such as `CREATE INDEX CONCURRENTLY`
  cannot use this runner. Nontransactional migrations need a separately approved extension.
- Use schema-qualified objects such as `public.users`; the runner does not change `search_path`.
- Files run verbatim after CRLF-to-LF normalization; SQL placeholders and psql commands such as `\i`
  are not expanded. Tracking inserts use parameterized queries.
- Never edit, rename or delete an applied migration. Add a corrective migration instead. There is no
  `down`, reset, automatic retry, repair or checksum-overwrite command.

## Tracking, locking and failure behavior

`up` creates only `public.schema_migrations` automatically:

| Column       | Definition                                          |
| ------------ | --------------------------------------------------- |
| `version`    | Positive `INTEGER` primary key                      |
| `filename`   | Unique, required `TEXT`                             |
| `checksum`   | Required lowercase SHA-256 hex `TEXT`, length 64    |
| `applied_at` | Required `TIMESTAMPTZ`, default `CURRENT_TIMESTAMP` |

Checksums cover SQL text with CRLF normalized to LF, so Windows and Linux checkouts agree. Other
whitespace and content changes affect the checksum. Applied rows must match an unchanged prefix of
the local files, including version, filename and checksum. Missing/renamed/modified files and newly
inserted earlier versions fail before new migrations run. Do not restore only half of the schema and
tracking history from a backup.

One dedicated connection holds a session advisory lock with application key `(5588037, 1)` across
tracking initialization and all migration transactions. Both commands acquire it before reading
history. A competing command fails immediately instead of waiting; rerun it after the other finishes.
The caller must close the dedicated connection, which also releases a lock if explicit unlock fails.

Each pending file and its tracking insert commit in one transaction. A failure rolls that file back,
stops subsequent files and exits nonzero. Earlier successful files remain committed and are skipped on
the next run. The tracking table can remain after a failed first migration. If a connection fails near
commit, inspect status after reconnection before retrying; the database may have committed already.
This atomicity relies on the authoring contract: PostgreSQL transactions cannot undo external effects
or a migration that deliberately commits itself.

`status` reports applied/pending files without executing migration SQL or creating the tracking table.
An empty directory succeeds: `up` initializes tracking, while `status` reports a total of zero. A missing
directory fails. Output uses the existing structured logger; `LOG_LEVEL=info` displays successful
status/completion messages. Errors use safe diagnostics and do not print SQL, raw driver messages or
connection URLs.

The broader real-PostgreSQL migration/concurrency suite belongs to Feature 2.8. Smoke verification must
use an isolated database ending in `_test`; never use development data as a test fixture.

## Feature 2.2 verification record

Verified on 2026-11-17 (Asia/Saigon) using the host's Node 25.9.0:

- Final `npm run check` passed strict type checking, ESLint, Prettier, the production build and all
  67 tests across eight suites, including 24 migration runner/CLI tests.
- `git diff --check` passed. No dependencies were added and no business SQL files were created.
- An initial full-suite run timed out in the existing server configuration-failure process test.
  That test passed in isolation and the final full-suite run passed without changing it.
- No `TEST_DATABASE_URL` is configured. Docker's default and Desktop Linux endpoints have no reachable
  daemon, so real PostgreSQL apply/rerun/rollback behavior and a fresh Docker image build remain
  unverified. The SQL-boundary unit doubles do not substitute for these checks.
- Node 26, the declared target runtime, is not installed on this host and was not verified here.

No development database was changed. Feature 2.3 requires explicit confirmation before work starts.
