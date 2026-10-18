## 2026-10-18 Continuation ports (session: ses_eb208c1a6ffe3twEMmRsgRZc2w)

Took over the incomplete V2 port work. Recovered the fork customizations from the old
`../opencode` tree (its committed fork commits + its 33-file dirty working tree) and
ported four onto this checkout, each typechecked and tested:

- **`opencode attach <url>` restored** (was deleted upstream). Root handler body extracted
  to `packages/cli/src/commands/handlers/launch.ts`; `default.ts` and new `attach.ts` share
  it. `attach` forces `--server` + `OPENCODE_PASSWORD`, warns on version mismatch, never
  spawns/replaces a background service. Registered in `commands.ts` + `index.ts`.
- **Question unattended deadline**: `Form.Service.wait(id)` added; the question tool waits
  5 minutes then auto-answers a sole `(Recommended)` option or cancels. `test/tool-question.test.ts`.
- **Degenerate streaming repetition abort**: publisher detects/truncates a verbatim text or
  reasoning loop and exposes `isDegenerate()`; `step.ts` stops the stream and fails with a
  `degenerate` error. `test/session-runner-tool-events.test.ts`.
- **Periodic retitling cadence**: runner regenerates a titled session every 8 turns / 15 min.
- **User-initiated tool invocation** (the old fork's `!!tool` / schema browser): `Tool.Service`
  gained `describe()` + `invoke()`; a built-in internal plugin (`core/src/tool/invoke.ts`) exposes the
  `opencode.tool` RPC (`list`, `invoke`) at `POST /api/rpc/opencode.tool/:method`; the TUI gained a
  `/tools` dialog (`component/dialog-tool.tsx`) to pick a tool, edit JSON args, run, and read the
  result — no model turn. Verified end-to-end in the built binary (list + invoking `read`).
  Exposed over RPC rather than new HttpApi endpoints because this checkout is at the Effect/tsgo
  type-complexity ceiling: any added endpoint produces phantom `Request<"Requires", Service>`
  middleware requirements across server/CLI test types and eventually a tsgo segfault (reproduced by
  adding one fully-handled endpoint to an existing group).

Verified already covered in V2 (not replayed): permission persistence (`PermissionSaved`),
loop detector (V2 already has fork logic), event-log flag (not applicable), abort-aware tool
teardown (scoped children). Full write-up, including what stays open (user-invoked MCP tools +
schema browser, background subagent controls, mux isolation test, Telegram/voice/watchdog
integration), is in `MIGRATION.md` under `## Continuation Ports`.

Core `bun typecheck` clean; targeted core tests pass. No production change, restart, build
deploy, or commit.

## Post-Cutover: attach removed, single-server rule (2026-10-18, session: ses_eb23af914ffeoxk4NBZXf69c7e)

- V2 deleted `opencode attach`. A client with no `--server` discovers or *spawns* a "background
  service"; on the `local` channel that spawn silently uses `opencode-local.db`, so the UI showed no
  history while all 2511 sessions sat in `opencode.db` on the systemd `:4096` server.
- Rule: one server (`:4096`, `OPENCODE_DB=opencode.db`); clients attach with
  `--server http://127.0.0.1:4096` + `OPENCODE_PASSWORD`. Never let two servers own one SQLite file.
- Open port: restore a verbatim `opencode attach <url>` command in the fork. Full write-up in
  `../handoff.md` and `MIGRATION.md` (`## Post-Cutover Findings`).

# Focused Session Budget Port

Session: `ses_eb474b01cffeAKm03GIzNzYEUS` (2026-10-17).

- Added optional `budget.maxCost` configuration in USD and runner enforcement via
  the existing `Session.StepFailedError` / structured `budget.exceeded` failure.
- Existing `metadata.budget.maxCost` supplies a finite per-session override;
  missing or malformed overrides fall back to configuration. No metadata API or
  database migration was needed. Zero and negative ceilings stop immediately,
  matching the legacy finite-number and `cost >= maxCost` semantics.
- Checks precede title generation, runner compaction, model steps, and retries.
  The ceiling gates new work using recorded session cost; it cannot preempt a
  running request or predict its final charge. Costs remain per-session, not a
  shared or parent-plus-child spending pool.
- Schema, config normalization, runner, focused tests, and the generated promise
  client config type changed. Client generation used `packages/client`'s
  `bun run generate`, not manual generated-file edits.
- Verification uses Bun 1.4.2 from
  `/home/gunther/opencode-v2-sandbox/toolchain/node_modules/.bin/bun` and core's
  HOME-isolating `script/test.ts`. No runtime launch, production change, or commit.
- Final checks: 341 tests passed across runner, config, error, retry, recorded
  runner, and execution test files; 160 focused budget test executions passed
  with `--rerun-each 10`. Core, schema, and client package typechecks passed;
  `git diff --check` passed.
- `MIGRATION.md`, launch files, and concurrent MCP edits are outside this port.

## Internal Request Gates (Review Follow-Up)

Session: `ses_eb474b01cffeAKm03GIzNzYEUS` (2026-10-17).

- Added `packages/core/src/session/budget.ts`: `SessionBudget.make` captures Config
  and SessionStore, returning `checkBudget(sessionID)` which reloads recorded USD
  cost and the effective ceiling on every call. It uses the existing
  `StepFailedError` with structured `budget.exceeded` diagnostics.
- Compaction now checks every delivery/retry (including native requests) and each
  summary stream, so a billed reply cannot bypass the ceiling via a summary nudge.
  Failure still projects onto the compaction message and returns a failed outcome.
- Title generation checks each actual request, including direct regeneration and
  primary-model fallback after billed title usage. Exhaustion logs the diagnostic
  and preserves the title, retaining the existing no-failure title API. Hook-supplied
  results without a model request remain allowed.
- Added exhausted and below-cap controls for summary nudges, compaction retries,
  direct title regeneration, and title fallback. Eight-file focused test run:
  334 passed; repeated title/compaction budget-or-ceiling cases: 80 passed.
- Latest core typecheck reports concurrent secure-input/MCP errors, not errors
  in this follow-up's helper/title/compaction files. Recheck once
  the other agents finish. No schema/protocol generation is needed for this follow-up.
- Coordination: did not edit `session/runner/llm.ts` or `schema/config/budget.ts` in
  this follow-up. The runner owner may replace its private budget checker with
  `const checkBudget = yield* SessionBudget.make` and `yield* checkBudget(sessionID)`;
  Config and SessionStore node dependencies are already present there.
