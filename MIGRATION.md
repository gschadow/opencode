# V2 Fork Migration

Session: `ses_eb483774effe1d64KVtiGAunle`, started 2026-10-17.

## Baseline And Safety

- Independent shallow checkout of upstream `anomalyco/opencode`, pinned at
  `86c7f7c84048d776ba94b94bfab782b2b0a6d776` (2.0.32).
- Development branch: `v2-migration`. No production cutover is authorized by this file.
- Existing production source remains in `../opencode`; do not merge, reset, rebuild,
  or modify its dirty working tree as part of this migration.
- Recovery backup and standalone recovery guide:
  `/home/gunther/opencode-recovery-20261017-ses_eb483774/README.md`.
- Isolated runtime and private Bun 1.4.2 toolchain:
  `/home/gunther/opencode-v2-sandbox`. Its `run` wrapper clears inherited environment
  variables and sets private HOME, XDG roots, DB, temp, and cache paths.
- Never use `dev:live`, bare managed-server discovery, `serve --service`, or any
  `service` command here. They can discover/replace an installed server.
- Post-cutover evidence (2026-10-18): a client launched from a plain shell auto-spawned
  `serve --service` backed by `opencode-local.db`, so the UI showed no history. The production
  server must stay the single `:4096` process; clients must attach with `--server`. See
  `## Post-Cutover Findings` below and `../../handoff.md`.
- Run runtime/auth commands from the sandbox's `work` directory, with an explicit
  isolated `--server` URL. Do not copy production credentials or database into this
  environment during initial OAuth testing.
- V2 automatically performs schema/history/credential migrations. Database path
  redirection alone is NOT adequate isolation; legacy auth uses the data root too.

## Milestones

1. Build and smoke-test the unchanged upstream baseline in isolation.
2. Confirm Console OAuth and actual model access, with human browser approval.
3. Inventory fork customizations, including uncommitted changes, against V2 equivalents.
4. Port necessary behavior with focused regression tests; do not blindly replay old patches.
5. Test integrations and history migration against copies, not production data.
6. Cut over only after explicit approval and a tested rollback path.

## Current Status

The unchanged baseline built with private Bun 1.4.2 and passed artifact validation,
`--version`, `--help`, and isolated server/auth-list smoke tests. It is listening
on `http://127.0.0.1:14096`; `/api/info` reports the expected version and process.
`debug paths` confirms every runtime root is inside the sandbox. No production
credentials/database were imported and no production services were restarted.

Console device login completed after Gunther's browser approval. `auth list`
reports OpenCode Console stored, and discovered models include the Go catalog.
A single tool-free prompt to `opencode-go/deepseek-v4.1-flash` returned exactly
`V2_OAUTH_OK` in sandbox session `ses_eb46e56d0ffeMDhgDTBZdnLDKh`.
The login client exited and a new CLI process successfully used the connection.
No production session content was used. Do not store tokens/device codes here.

## Post-Cutover Findings (2026-10-18)

The production service was cut over to the V2 build `0.0.0-local-v2-cutover-20261017`
(built 2026-10-17 16:54 from this checkout at `86c7f7c840` = 2.0.32, channel `local`).
The systemd unit plus `~/.config/systemd/user/opencode.service.d/v2.conf` run one server on
`:4096` with `OPENCODE_DB=opencode.db`, serving the full 10 GB history (2511 sessions). This is
the intended target: **one server, clients attach to it.**

Two gaps found immediately (details in `../../handoff.md`):

1. **`opencode attach` no longer exists.** Upstream V2 removed attach-to-a-server; a client
   without a target now discovers or *spawns* a "background service" of its own. That auto-spawn
   is what produced a second server. Until the fork restores an `attach` command, the supported
   connect surface is the global `--server <url>` flag plus `OPENCODE_PASSWORD` for Basic auth.
2. **Managed-service DB selection.** `packages/cli/src/database-path.ts` resolves the DB as
   `OPENCODE_DB ?? channel-default`; on the `local` channel with no `OPENCODE_DB`, it opens
   `opencode-local.db`. The systemd unit sets `OPENCODE_DB`; a client-spawned `serve --service`
   does not, so it silently opened the near-empty local DB. The client also keeps credentials in
   `~/.config/opencode/service-local.json`, separate from the systemd server's
   `~/.config/opencode/server.env`, so it does not reuse `:4096` automatically.
3. Minor: the build 500s non-`/api` paths (`/session`, `/doc`) because the web-UI SPA fallback
   tries to read `/app/dist` (`cli.app-assets.load` → `src/services/web-ui.ts:14`). Cosmetic for
   the API/TUI; the V2 API is under `/api/*` (`/api/session`, `/api/info`).

Session records can be moved between the two databases with the supported transfer path:
`opencode session export <id> --server <from>` → `opencode session import <file> --server <to>
--directory <dir>` (import preserves the session id; 409 if it already exists).

## Customization Inventory

This compares actual fork working-tree source as well as committed changes; the
old README is not a complete or current inventory.

| Requirement | V2 baseline | Migration disposition |
| --- | --- | --- |
| Console OAuth + rotating tokens + model discovery | Built in `core/src/plugin/provider/opencode.ts` | Login, discovery and actual Go model call passed; live expiration/refresh not yet observed |
| Session dollar ceiling | Absent; agent step limit is not a spending cap | Initial port/tests passed; review caught internal compaction/title bypasses, fixes in progress |
| Repeating tool-call loop protection | No equivalent active detector found | Critical port in progress |
| Degenerate streaming repetition abort | No equivalent found | Port pending |
| Secret-safe MCP password input | Custom nested protocol absent; standard forms include answers in events | Cutover blocker; port in progress, never pass passwords through ordinary forms |
| MCP session identity for Tessera | New key `ai.opencode/sessionID` replaces `opencodeSessionId` | Dual-key compatibility port implemented; full MCP test file 67/67 passes |
| Mux cross-session ownership | Historical intended scoping is absent even from current old source | Separate correctness gate; do not claim isolation without two-session test |
| User-invoked MCP tools and schema browser | No equivalent tool-call/catalog workflow | Port pending |
| Duplicate durable event payload retention | Off by default | Already covered; no old disable flag needed |
| Stalled SSE subscriber memory bound | EventFeed caps at 4096 and disconnects overflow | Already covered |
| SSE reconnect and stalled-stream recovery | Central client reconnect/watchdog implementation | Already covered |
| Clickable wrapped Markdown links | Upstream implementation and tests | Already covered |
| No-motion TUI | Supported by `animations: false` in new CLI config | Migrate preference; exact static labels optional |
| Initial session title retry | Upstream retries and has primary-model fallback | Already covered |
| Periodic topic-drift retitling | Regeneration exists; automatic cadence absent | Adapt scheduling later |
| Background subagent controls | Native background mode, but different defaults/control surface | Adapt task workflow/integrations; do not replay old runtime |
| Permission/question timeout policy | Awaited forms/permission requests have no equivalent deadline | Port policy after reconciling committed vs dirty old behavior |
| History decode cache | No equivalent found; compaction bounds history | Profile before porting |
| Stable DB naming/channel preference | Isolation now explicit in sandbox | Decide deployment preference only at cutover |
| Client `attach` to an existing server | `attach` command REMOVED in V2; replacement is global `--server <url>` + `OPENCODE_PASSWORD`, else the client auto-spawns a background service | Port a real `opencode attach <url>` command into the fork (alias for `--server` + password); document `--server` in the meantime — Gunther expects `opencode attach` verbatim |
| Single-server deployment / DB selection | Managed service defaults to `opencode-local.db` on the `local` channel unless `OPENCODE_DB` is set; a client-spawned service inherits none | Production runs exactly one server (`:4096`, `OPENCODE_DB=opencode.db`); clients attach with `--server`; never let two servers own one SQLite file |
| Telegram/voice/watchdog/session scripts | V2 routes and event contracts changed | Integration migration pending; production integrations remain on old server |
| Private-content/model restrictions | Not enforced by either inspected OpenCode tree | External Tessera/policy gate; no L1+ testing in this sandbox |

Upstream secure forms are NOT a secret-safe substitute: generic `Form.Event.Replied`
contains the answer. Preserve the fork's separation of secret replies from events,
transcript, and model input. External privacy implementation and written policy
also differ; secure-input parity alone does not prove privacy enforcement.

## Build

Dependencies are installed only in this checkout, with a separate Bun cache:

```bash
PATH=/home/gunther/opencode-v2-sandbox/toolchain/node_modules/.bin:$PATH \
  BUN_INSTALL_CACHE_DIR=/home/gunther/opencode-v2-sandbox/bun-cache \
  bun install --frozen-lockfile
```

From `/home/gunther/opencode-v2-sandbox/work`, the baseline build used:

```bash
/home/gunther/opencode-v2-sandbox/run env \
  OPENCODE_CHANNEL=local OPENCODE_VERSION=0.0.0-local-v2-86c7f7c840 \
  bun --no-env-file /home/gunther/opencode-dev/opencode-v2/packages/cli/script/build.ts \
  --target=opencode-linux-x64 --skip-install --skip-web-ui \
  --outdir=/home/gunther/opencode-v2-sandbox/build-baseline
```

The baseline binary is under `build-baseline/cli-linux-x64/bin/opencode`. Keep it
unchanged as the upstream reference; build ported code to a different directory.
This initial CLI build omits embedded web UI assets; it is not a production-ready
desktop/web release. Never point `--outdir` at a shared directory: the script
recursively removes that directory first.

## Verification

- Baseline artifact/simulation graph/native architecture validation: passed build.
- Built artifact marker scan rerun explicitly: passed.
- Baseline isolated `--version`, `--help`, `debug paths`, `auth list`: passed.
- Baseline isolated server `/api/info`: passed; production PIDs unchanged.
- MCP metadata regression: failed before port (legacy key absent), passed after.
- Full core MCP file: 67 passed, 0 failed, 325 assertions.
- Initial spending guard: 341 focused core tests passed; 160 budget-case rerun executions passed.
- Initial core/schema/client typechecks: passed; generated client config type updated via generator.
- Initial ported CLI binary: built and reports `0.0.0-local-v2-ports-20261017`.
  This is an intermediate artifact, not the final reviewed migration binary.
- Upstream SSE connection recovery: 6 passed. EventFeed overflow/encoding: 6 passed.
- Upstream clickable wrapped Markdown links: 1 passed.
- Upstream Console provider fixture tests (including refresh handling): 40 passed.
- Actual authenticated Go model call: passed; live token-expiration/refresh not yet exercised.
- Spending/title/compaction fixes, loop protection and secret input: in progress; rerun combined
  generation/typechecks/tests and build once these edits settle.
- No production cutover, commits, pushes, or production service restarts performed.

## Recovery After Interrupted Session (2026-10-17, Claude Code)

The parallel port session stopped (usage limit) with the tree not compiling. Fixed,
no runtime launch, build, commit, or production change:

- Client codegen failed (`Unportable schema: config.config.get.success`): the custom
  `makeFilter` regex check on `budget.loopDetectionExemptTools` cannot cross codegen.
  Removed it from the schema; `loop-detector.ts` now compiles the pattern safely and
  falls back to the default exempt pattern. Config test updated accordingly.
- Secure-input OpenAPI identifiers were `secureInput.*`, which the codegen does not
  strip for group `server.secure-input` (it produced `secureInput.secureInput.*`).
  Identifiers are now `secure-input.*`, giving `client.api.secureInput.{request.list,
  list, reply, reject}` as the TUI dialog expects. Client regenerated via `bun run generate`.
- `test/mcp.test.ts` now provides `SecureInput.layer` / `SecureInput.node`.
- Result: schema/protocol/core/client/server/tui typechecks all clean; focused core
  run (mcp, mcp-secure-input, secure-input, session-runner, config, compaction, title):
  419 passed, 0 failed.
- Pre-fix snapshot: `/home/gunther/opencode-v2-sandbox/wip-snapshot-20261017-1645.{tar.gz,diff}`.

Still open per the inventory: degenerate streaming repetition abort, user-invoked MCP
tools + schema browser, mux two-session isolation test, Telegram/voice/watchdog
integration migration, end-to-end secure-input test in the sandbox TUI, rebuilt
reviewed binary, and the cutover itself.

## Server Auth, Managed Service, Session Visibility (2026-10-18, Claude Code)

- Server password: upstream V2 cannot run without one (an empty `OPENCODE_PASSWORD` is replaced
  by a random one). Per Gunther it is now simply `password`, in two places that must agree:
  `~/.config/opencode/server.env` (`OPENCODE_PASSWORD=password`) and
  `~/.config/opencode/service-local.json` (`"password": "password"`). No code change.
- The systemd drop-in now runs `opencode serve --service` (managed-service mode) instead of a
  plain `serve --hostname/--port`. Host/port/password/env come from `service-local.json`
  (`127.0.0.1`, `4096`, `password`, `env.OPENCODE_DB=opencode.db`). Effect: a plain `opencode`
  (no `--server`, no env password) discovers and uses the systemd server; it no longer spawns a
  second server on `opencode-local.db`. Verified: one `serve --service` process, fds on
  `opencode.db`, `opencode session list` works from `~` and `~/opencode-dev` without flags.
  Backups: `service-local.json.bak-20261018`, `~/.config/systemd/user/v2.conf.bak-20261018`.
- FIXED: migrated non-git v1 sessions were invisible (they kept `project_id='global'` with a
  `path` like `home/gunther/opencode-dev`, while V2 resolves `~` to `78281e…` and
  `~/opencode-dev` to `caf891…`; listing filters by project). Re-homed via the supported API,
  `POST /api/session/:id/move {"directory": <its own directory>}`, which reruns V2's project
  resolver: 1341 moved, 0 failed (roots first, oldest first). 66 sessions in deleted temp dirs
  (`/tmp/opencode/wa-docs`, `/tmp/opencode/wa-scans`, old telegram-bot dir) were then moved to
  `/home/gunther` per Gunther (66/66 OK); no `global` sessions remain.
  Side effect (moves bump `time_updated`) was reverted: with the server stopped, the 1408
  moved rows got their `time_updated` back from the pre-move backup (only rows inside the
  03:22-03:27 move window; 0 differ afterwards; quick_check ok). Backups:
  `~/opencode-recovery-20261017-ses_eb483774/pre-session-move-1018-0322/` and
  `.../pre-time-restore-1018-0327/`.
- Three stale V1 `opencode attach` TUIs (started Oct 12/15) still run against the old protocol;
  they cannot talk to V2 and should be closed.

## Production Console Login (2026-10-18, Claude Code)

- Cause of "Provider request failed with HTTP 500": production never had a Console OAuth login
  (the successful one was only in the isolated sandbox). V2's one-time schema migration
  `20260805200742_import_legacy_credentials` had imported v1 `auth.json`, including the expired
  `sk-…` key as "OpenCode Go" and "OpenCode Console" API keys; opencode.ai first answered it with
  "API key has expired", later with a bare HTTP 500.
- Fixed: Console device login approved on production (`OpenCode Console / Default`, OAuth);
  expired key credentials removed with `opencode auth logout`. `opencode-go/deepseek-v4.1-flash`
  returns `PING_OK` with only the OAuth credential present. The legacy import is a one-time
  migration, so the old `auth.json` will not be re-imported.

## Continuation Ports (2026-10-18, session: ses_eb208c1a6ffe3twEMmRsgRZc2w)

Taking over the incomplete port work. Fork customizations recovered from the old
`../opencode` tree (committed fork commits plus its 33-file dirty working tree) and
ported onto this checkout, each with a focused test where practical:

1. **`opencode attach <url>` command restored.** Upstream V2 removed `attach`; a client
   without a target discovers or spawns its own background service (the defect behind the
   "no previous session" incident). The root handler body moved to
   `packages/cli/src/commands/handlers/launch.ts`; `default.ts` and the new `attach.ts`
   both call it. `opencode attach <url>` forces `--server <url>` + `OPENCODE_PASSWORD`,
   pings `/api/info`, warns on version mismatch, and never spawns or replaces a service.
   Registered in `commands.ts` and `index.ts`.
2. **Unattended question deadline + auto-answer.** `Form.Service` gained `wait(id)`;
   the question tool now creates its form explicitly and waits with a 5-minute
   `timeoutOrElse`. If every question has exactly one `"(Recommended)"` option it is
   auto-answered; otherwise the form is cancelled (the existing dismissal path). Covers
   the old `permission/question timeout policy` row. Tests in `test/tool-question.test.ts`
   (TestClock-driven).
3. **Degenerate streaming repetition abort.** `createLLMEventPublisher` detects a long
   verbatim repetition in the text or reasoning tail (`DEGENERATE_WINDOW=200`,
   `DEGENERATE_REPEATS=4`, checked every 512 chars), truncates the buffered fragment to a
   bounded prefix plus a marker, and exposes `isDegenerate()`. `SessionStep.attempt`
   stops the provider stream and fails the step with a `degenerate` structured error.
   Tests in `test/session-runner-tool-events.test.ts`.
4. **Periodic topic-drift retitling.** The runner now regenerates a titled session's title
   from recent context every 8 promoted turns / 15 minutes (`SessionTitle.generate`
   already builds the recent-conversation text); untitled sessions still retry on every
   promoted input. Covers the old cadence gap. (The old fork's separate `retitle` agent
   prompt/echo-guard is not replayed; V2 regenerates through the existing title agent.)
5. **User-initiated tool invocation.** `Tool.Service` gained `describe()` and
   `invoke(name, input, context)`; schema `Tool.Description`/`Invocation`/`InvocationResult`
   describe the wire shape. A built-in internal plugin (`core/src/tool/invoke.ts`,
   registered in `plugin/internal.ts`) exposes the `opencode.tool` RPC with `list` and
   `invoke`, reachable at `POST /api/rpc/opencode.tool/:method`. The TUI gains a `/tools`
   command (`component/dialog-tool.tsx`): pick a tool, edit JSON arguments, run, and read
   the result — no model turn.

   **Why RPC and not dedicated endpoints.** The faithful port adds `GET /api/tool` +
   `POST /api/tool/:sessionID`, but this checkout is already at the Effect/tsgo type
   complexity ceiling: any additional `HttpApi` endpoint makes `tsgo` emit phantom
   `Request<"Requires", Service>` middleware requirements across the server/CLI test types
   and eventually segfault (also reproduced by adding a single fully-handled endpoint to an
   existing group). The RPC surface already exists (`server.rpc`), so it adds no `Api`
   surface. If the `Api` complexity is later reduced (or tsgo fixed), migrating the RPC
   methods to first-class `tool.list`/`tool.invoke` endpoints is straightforward.
6. **Mux cross-session isolation.** `MCP.callTool` now scopes every logical mux session
   name with the caller's opencode session (`scopeMuxSessionArgs`), so two sessions cannot
   collide on a name like `ad00` and mutate shared pty state. Idempotent; non-mux servers
   untouched. Two-session behavior covered by `test/mcp-session-scope.test.ts`.
7. **Integration migration.** Voice daemon (`voice/voice-daemon.py`) moved to the v2 API
   (`/api/*`, basic auth from `server.env`, V2 event envelope/`session.text.delta`, interrupt
   route). Infra watchdog/restart probe `/api/info` with auth; the event-prune script now
   refuses to run on v2 (the `event` table is the durable system of record). Situation-report
   helpers (`oc-dispatch`, `oc-sessions`, `oc-ledger`, `oc-session-state`, `oc-move-session`)
   moved to `/api/*` and the `session_v2`/`session_message` tables; the move script now uses
   `POST /api/session/:id/move` + `PATCH /api/session/:id`. The Telegram bot was already on the
   v2 SDK. Note: `voice/`, `situation-report/` are not git repos, so those files are not
   committed (the repos that are — opencode-v2, infra, mux, bot — are).

Dispositions from the old inventory that are composed differently in V2 and were verified
as already covered, so they were intentionally NOT replayed:

- **Permission "always" persistence** — V2 already has `PermissionSaved` (schema,
  service, sql), `Permission.Request.save`, and `Permission.reply` persistence.
- **Loop detection** — V2's `session/runner/loop-detector.ts` already carries the exact
  signature, target-aware signature, long-argument hashing, exempt-tools pattern, and
  repeated-parallel-call burst detection from the fork.
- **`OPENCODE_DISABLE_EVENT_LOG`** — architecture-specific to the old event log; V2's
  durable events are the system of record, so disabling the log is neither safe nor
  meaningful here.
- **Abort-aware tool interruption** — V2 forks tool executions as scoped children of the
  step (`Effect.forkScoped`), so interrupting the step already tears down in-flight tool
  fibers; the old global-runtime `interruptible` wrapper is unnecessary.

Still open after this session: background subagent controls
(`tasks`/`task_status`/`task_wait`/`task_cancel`) — deliberately NOT replayed, since V2's
`subagent` tool auto-notifies on completion and its own guidance forbids polling; an
end-to-end sandbox secure-input test through an interactive client (automated coverage
exists; see `MIGRATION-INVENTORY.md`); and the final cutover.

Verification for this session: `packages/core` `bun run test` = 6379 pass / 0 fail / 365 skip;
root `bun run typecheck` = 34/34 packages; `oxlint` clean on changed files; CLI built to
`/home/gunther/opencode-v2-sandbox/build-ports-202610181012` reporting
`0.0.0-local-v2-ports-202610181012`, with `opencode attach` registered, the `opencode.tool` RPC
listing and invoking a tool end to end, and mux tools registering. No production service was
built, deployed, restarted, or committed (except the local repo commits below).

## Deploying the reviewed binary (not yet done)

Production already runs v2 (the `opencode-v2-cutover-20261017` binary via the `v2.conf`
drop-in). Deploying this session's reviewed build is the remaining operational step and needs
explicit go-ahead; it restarts `opencode.service` (and, via `BindsTo`, the Telegram bot), which
ends any in-flight session. Use `opencode-restart.sh --delayed` so the restart survives the
session it triggers, and keep the rollback path.

```bash
# 1. back up the running binary (it is a symlink; copy the real file)
cp -L ~/.opencode/bin/opencode ~/.opencode/bin/opencode.backup-$(date +%Y%m%d%H%M)

# 2. stage the reviewed build and repoint the symlink
cp /home/gunther/opencode-v2-sandbox/build-ports-202610181012/cli-linux-x64/bin/opencode \
   ~/.opencode/bin/opencode-v2-ports-202610181012
ln -sfn ~/.opencode/bin/opencode-v2-ports-202610181012 ~/.opencode/bin/opencode

# 3. ordered delayed restart (waits for /api/info, then starts the bot)
~/opencode-dev/infra/opencode-restart.sh --delayed

# 4. verify
~/.opencode/bin/opencode --version   # expect 0.0.0-local-v2-ports-202610181012
```

Rollback:

```bash
cp -L ~/.opencode/bin/opencode.backup-<stamp> ~/.opencode/bin/opencode
~/opencode-dev/infra/opencode-restart.sh --delayed
```

Note: the base unit still sets `OPENCODE_DISABLE_EVENT_LOG=1` (inherited from v1). v2 ignores
it (the durable `event` table is the system of record), so it is harmless but misleading; drop
it from the unit when convenient.
