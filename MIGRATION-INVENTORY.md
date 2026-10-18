# Fork Customization Inventory (fine comb)

Session: `ses_eb208c1a6ffe3twEMmRsgRZc2w`, 2026-10-18. Companion to `MIGRATION.md`.

Sources of truth for the fork's customizations:

- `../opencode` git: fork-only commits since `upstream/dev`, plus its 33-file dirty working tree
  (never committed before the forced V2 cutover). Captured `git diff` at
  `/tmp/opencode/old-uncommitted.diff`.
- The old `../README.md` fork section is incomplete/stale; this inventory follows the code.

Legend: **done** = ported and tests/typecheck pass · **covered** = V2 already implements the
behavior (verified in V2 source) · **n/a** = architecture-specific, intentionally not replayed ·
**open** = still to do.

## Committed fork commits (oldest → newest)

| Commit | Subject | Status |
| --- | --- | --- |
| 5297cc264f | secure input interception for mux MCP password prompts | **covered** — V2 `core/src/secure-input.ts` + MCP `opencode/secure-input` handler; applies to all local MCP servers |
| bdb8b894b1 | replace `__SECURE_INPUT__` marker with trusted nested MCP requests | **covered** — same V2 secure-input architecture |
| 4f09d6a361 | pending fork modifications (database, attach, session, openai-chat) | mixed: DB naming **covered**; `attach` **done** (restored); openai-chat provider n/a |
| dabec2c9d3 | docs: fork notice | n/a |
| 4256506ce9 | auto-scope mux session names per opencode session | **open** — V2 sends `ai.opencode/sessionID` (dual-key port done); mux-side isolation test gate remains |
| abfd6cc504 | transparent mux session scoping | **open** — same gate |
| 505a92a811 | MCP tool results show expandable output in TUI | **open** — V2 TUI tool rendering differs; verify |
| 4567245c62 | default generic tool output to visible so mux results are shown | **open** — verify V2 TUI |
| 3b2463237c | strip session prefix from mux tool responses | **open** — verify V2 TUI |
| 73e0c877cc | enable secure-input for all local MCP servers, not just mux | **covered** — V2 gates on `config.type === "local"` |
| 5a8e694cd2 | session budget limits and loop detection | **covered/done** — `session/budget.ts` + `runner/loop-detector.ts` present; runner enforces |
| 64a43a2b9a | session budget limits, permission/question timeouts, history cache | budget **covered**; question timeout **done**; permission timeout not in fork; history cache **n/a** (V2 compaction bounds history) |
| 19584c764e | user-initiated MCP tool calls via `!!` prefix in shell mode | **done (adapted)** — `opencode.tool` RPC (`list`/`invoke`) + TUI `/tools` dialog; see `MIGRATION.md` for why RPC not endpoints |
| 680c136214 | docs: budget/loop-detection + user-initiated MCP tools | n/a |
| 514947fcb1 | update catalog.ts/index.ts for MCP client SDK v2 API | **covered** — V2 uses SDK v2 |
| 2fca0a9d30 | use all tool arguments in loop-detector signature | **covered** |
| e33627e30c | target-aware loop detector | **covered** |
| 89ac9ed11b | rename `maxConsecutiveSteps` → `loopDetectionThreshold` | **covered** |
| 585731df6b | `loopDetectionExemptTools` config | **covered** |
| 9636e4a5d2 | hash long arguments in loop detector | **covered** (sha256 signature) |
| 688cbea494 | keep SSE reconnection alive after server restart | **covered** |
| 3b48d8e21a | make `revert.cleanup` a deliberate no-op (non-destructive undo) | **covered** — V2 `session/revert.ts` clear/stage; cleanup timing differs |
| 023ebbf34c | clear revert marker in cleanup | **covered** — see above |
| 4032bdd864 | session loop hardening — tool-call sigs, compaction retry, degenerate-reasoning abort, BTW handling | loop sigs/compaction retry **covered**; degenerate abort **done**; BTW handling n/a |
| 38512989b8 | Merge upstream/dev | n/a |
| d273bfdef6 | chore(ci): remove issue-closing and stats workflows | n/a |
| 1d27541779 | bound SSE event queues to stop unbounded memory growth | **covered** — V2 EventFeed caps at 4096 and disconnects overflow |
| 0fdcdb7e60 | report post-compaction context size instead of stale peak | **covered** — V2 recomputes context from history; no cached peak |

## Dirty working-tree changes (old `../opencode`), by area

| Area | Files | Disposition |
| --- | --- | --- |
| Event log disable flag | `core/src/event.ts`, `core/src/flag/flag.ts` (`OPENCODE_DISABLE_EVENT_LOG`) | **n/a** — V2 durable events are the system of record |
| Retitle agent + cadence | `opencode/src/agent/agent.ts`, `agent/prompt/retitle.txt`, `session/prompt.ts` | **done (cadence)** — V2 regenerates titled sessions every 8 turns/15 min; separate retitle agent prompt not replayed |
| Permission persistence + pattern narrowing | `permission/index.ts`, server routes, `schema/v1/permission.ts`, `tui/routes/session/permission.tsx`, `cli/cmd/run/*permission*` | **covered** — V2 `PermissionSaved` + `Permission.Request.save` + TUI; pattern narrowing UI differs |
| Question auto-answer on timeout | `question/index.ts` | **done** — `Form.Service.wait` + 5-min deadline + Recommended auto-answer |
| Interruptible async iterable (`/abort` in-flight tool deadlock) | `session/llm.ts` | **n/a** — V2 tools are scoped children of the step |
| Interruptible tool wrapper | `session/tools.ts` | **n/a** — same reason |
| Degenerate repetition abort (text + reasoning) | `session/processor.ts` | **done** — publisher detection + `step.ts` stop |
| Retitle prompt/echo guard, empty-turn reset, burst loop detection | `session/prompt.ts` | burst **covered** (V2 loop detector); empty-turn n/a; echo guard **open (minor)** |
| Background task controls | `tool/registry.ts`, `tool/task.ts`, `tool/task.txt`, `session/tools.ts` | **open** — V2 native background subagents use a different control surface (`session.background`, `subagent` tool) |
| Session revert time on wire | `schema/v1/session.ts` | **n/a** — V2 current session schema |
| TUI abort/sync/sdk/permission/link/spinner/app | `tui/src/**` | link-click, no-motion spinner, animations-off **covered**; permission UI **covered** by V2 forms; remainder architectural |
| SSE/queue and generated SDK types | `core/src/event.ts`, `sdk/js/src/v2/gen/*` | **n/a** — regenerated in V2 |

## Open items to continue

1. Background subagent controls (`tasks`/`task_status`/`task_wait`/`task_cancel`) — deliberately
   NOT replayed: V2's `subagent` tool auto-notifies on completion and its guidance forbids polling.
2. Mux two-session isolation end-to-end test.
3. Telegram / voice / watchdog integration migration off the hard-coded `:4096`.
4. Sandbox TUI end-to-end secure-input test; rebuilt reviewed binary; final cutover.
5. Optional: if the `Api` type complexity is reduced, move the `opencode.tool` RPC methods to
   first-class `tool.list`/`tool.invoke` HttpApi endpoints (currently blocked by a tsgo ceiling).
