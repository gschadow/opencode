import * as Tool from "./tool"
import DESCRIPTION from "./task.txt"
import { ToolJsonSchema } from "./json-schema"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { BackgroundJob } from "@/background/job"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import { deriveSubagentSessionPermission } from "../agent/subagent-permissions"
import type { SessionPrompt } from "../session/prompt"
import { Config } from "@/config/config"
import { Effect, Exit, Fiber, Schema, Scope, Stream } from "effect"
import { EffectBridge } from "@/effect/bridge"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2Bridge } from "@/event-v2-bridge"
import { SessionStatusEvent } from "@opencode-ai/schema/session-status-event"

export interface TaskPromptOps {
  cancel(sessionID: SessionID): Effect.Effect<void>
  resolvePromptParts(template: string): Effect.Effect<SessionPrompt.PromptInput["parts"]>
  prompt(input: SessionPrompt.PromptInput): Effect.Effect<SessionV1.WithParts>
}

const id = "task"

// Results the parent already pulled via `task_wait` are never auto-injected
// again when the parent later goes idle.
const collected = new Set<string>()

const SPAWN_STARTED = [
  "The task is running in the background (task_id=<id>). Keep doing other work.",
  "Check back with: `tasks` (list all subagents), `task_status` (one, non-blocking),",
  "`task_wait` (blocks until done, returns the result), `task_cancel` (abort),",
  "or `task` with task_id to steer a running one / resume a finished one.",
  "If you end your turn without collecting, the result is injected when the session is idle.",
].join("\n")
const SPAWN_UPDATED = [
  "Additional context sent to the running background task (task_id=<id>).",
  "It is still working. Use `task_wait` when you need the result, or `tasks` to check status.",
].join("\n")

const BaseParameterFields = {
  description: Schema.String.annotate({ description: "A short (3-5 words) description of the task" }),
  prompt: Schema.String.annotate({ description: "The task for the agent to perform" }),
  subagent_type: Schema.String.annotate({ description: "The type of specialized agent to use for this task" }),
  task_id: Schema.optional(Schema.String).annotate({
    description:
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
  }),
  command: Schema.optional(Schema.String).annotate({ description: "The command that triggered this task" }),
}

export const Parameters = Schema.Struct(BaseParameterFields)

export const TasksParameters = Schema.Struct({})

export const TaskStatusParameters = Schema.Struct({
  task_id: Schema.String.annotate({ description: "The task_id returned by the task tool" }),
})

export const TaskWaitParameters = Schema.Struct({
  task_id: Schema.String.annotate({ description: "The task_id returned by the task tool" }),
  timeout: Schema.optional(Schema.Int).annotate({
    description: "Max seconds to wait for the task to finish (default 300)",
  }),
})

export const TaskCancelParameters = Schema.Struct({
  task_id: Schema.String.annotate({ description: "The task_id returned by the task tool" }),
})

function renderOutput(input: {
  sessionID: SessionID
  state: "running" | "completed" | "error"
  summary?: string
  text: string
}) {
  const tag = input.state === "error" ? "task_error" : "task_result"
  return [
    `<task id="${input.sessionID}" state="${input.state}">`,
    ...(input.summary ? [`<summary>${input.summary}</summary>`] : []),
    `<${tag}>`,
    input.text,
    `</${tag}>`,
    "</task>",
  ].join("\n")
}

// Recent text parts of a subagent session, newest last — the durable "ring
// buffer" equivalent of mux output. Works for running and finished subagents.
const tailText = Effect.fn("Task.tailText")(function* (
  sessions: Session.Interface,
  database: Database.Interface,
  sessionID: SessionID,
  maxParts = 8,
) {
  const msgs = yield* sessions
    .messages({ sessionID, limit: 20 })
    .pipe(Effect.provideService(Database.Service, database), Effect.catch(() => Effect.succeed([])))
  const parts: string[] = []
  for (const msg of msgs) {
    for (const part of msg.parts) {
      if (part.type === "text" && part.text.trim()) {
        parts.push(part.text)
        if (parts.length >= maxParts) break
      }
    }
    if (parts.length >= maxParts) break
  }
  return parts.reverse().join("\n---\n").slice(0, 8000)
})

const sessionStatus = Effect.fn("Task.sessionStatus")(function* (
  sessions: Session.Interface,
  parentSessionID: SessionID,
  taskId: string,
) {
  const session = yield* sessions.get(SessionID.make(taskId)).pipe(Effect.catch(() => Effect.succeed(undefined)))
  if (!session || session.parentID !== parentSessionID) return undefined
  return session
})

// Combined status + recent output for a subagent of this parent. Durable (reads
// the subagent's message stream) so it survives registry loss on restart.
const taskInfo = Effect.fn("Task.taskInfo")(function* (
  sessions: Session.Interface,
  background: BackgroundJob.Interface,
  database: Database.Interface,
  parentSessionID: SessionID,
  taskId: string,
  maxParts = 8,
) {
  const session = yield* sessionStatus(sessions, parentSessionID, taskId)
  if (!session) return undefined
  const job = yield* background.get(taskId)
  const msgs = yield* sessions
    .messages({ sessionID: session.id, limit: 5 })
    .pipe(Effect.provideService(Database.Service, database), Effect.catch(() => Effect.succeed([])))
  const last = msgs[0]
  let state: "running" | "completed" | "error" | "idle" = "idle"
  if (job) {
    if (job.status === "error") state = "error"
    else if (job.status === "completed") state = "completed"
    else if (job.status === "running") state = "running"
  } else if (last?.info.role === "assistant") {
    state = last.info.finish && !["tool-calls", "unknown"].includes(last.info.finish) ? "completed" : "running"
  }
  const tail = yield* tailText(sessions, database, session.id, maxParts)
  return { session, job, state, tail }
})

export const TaskTool = Tool.define(
  id,
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const background = yield* BackgroundJob.Service
    const config = yield* Config.Service
    const sessions = yield* Session.Service
    const scope = yield* Scope.Scope
    const database = yield* Database.Service
    const status = yield* SessionStatus.Service
    const events = yield* EventV2Bridge.Service

    const run = Effect.fn("TaskTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      const cfg = yield* config.get()

      const parent = yield* sessions.get(ctx.sessionID)
      let current = parent
      let depth = 0
      while (current.parentID) {
        depth++
        current = yield* sessions.get(current.parentID)
      }
      if (depth >= (cfg.subagent_depth ?? 1)) {
        return yield* Effect.fail(
          new Error(
            `Subagent depth limit reached (${cfg.subagent_depth ?? 1}). Increase "subagent_depth" to allow nested subagents.`,
          ),
        )
      }

      if (!ctx.extra?.bypassAgentCheck) {
        yield* ctx.ask({
          permission: id,
          patterns: [params.subagent_type],
          always: ["*"],
          metadata: {
            description: params.description,
            subagent_type: params.subagent_type,
          },
        })
      }

      const next = yield* agent.get(params.subagent_type)
      if (!next) {
        return yield* Effect.fail(new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`))
      }

      const session = params.task_id
        ? yield* sessions.get(SessionID.make(params.task_id)).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        : undefined
      const childPermission = deriveSubagentSessionPermission({
        parentSessionPermission: parent.permission ?? [],
        subagent: next,
      })
      const childToolDenies = [
        ...(next.permission.some((rule) => rule.permission === "todowrite")
          ? []
          : [{ permission: "todowrite" as const, pattern: "*" as const, action: "deny" as const }]),
        ...(next.permission.some((rule) => rule.permission === id)
          ? []
          : [{ permission: id, pattern: "*" as const, action: "deny" as const }]),
        ...(cfg.experimental?.primary_tools?.map((permission) => ({
          permission,
          pattern: "*" as const,
          action: "deny" as const,
        })) ?? []),
      ]
      const nextSession =
        session ??
        (yield* sessions.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${next.name} subagent)`,
          agent: next.name,
          permission: [
            ...childPermission,
            ...childToolDenies.filter(
              (deny) =>
                !childPermission.some(
                  (rule) =>
                    rule.permission === deny.permission && rule.pattern === deny.pattern && rule.action === deny.action,
                ),
            ),
          ],
        }))

      const msg = yield* MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }).pipe(
        Effect.provideService(Database.Service, database),
        Effect.orDie,
      )
      if (msg.info.role !== "assistant") return yield* Effect.fail(new Error("Not an assistant message"))
      const variant = msg.info.variant

      const model = next.model ?? {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }
      const blocking = ctx.extra?.bypassAgentCheck === true
      const metadata = {
        parentSessionId: ctx.sessionID,
        sessionId: nextSession.id,
        model,
        ...(blocking ? {} : { background: true }),
      }

      yield* ctx.metadata({
        title: params.description,
        metadata,
      })

      const ops = ctx.extra?.promptOps as TaskPromptOps
      if (!ops) return yield* Effect.fail(new Error("TaskTool requires promptOps in ctx.extra"))

      const runTask = Effect.fn("TaskTool.runTask")(function* () {
        const parts = yield* ops.resolvePromptParts(params.prompt)
        const result = yield* ops.prompt({
          messageID: MessageID.ascending(),
          sessionID: nextSession.id,
          model: {
            modelID: model.modelID,
            providerID: model.providerID,
          },
          variant: next.model ? undefined : variant,
          agent: next.name,
          parts,
        })
        if (result.info.role === "assistant" && result.info.error) {
          const message =
            "message" in result.info.error.data && typeof result.info.error.data.message === "string"
              ? result.info.error.data.message
              : result.info.error.name
          return yield* Effect.fail(new Error(`Subagent failed (task_id: ${nextSession.id}): ${message}`))
        }
        const failed = result.parts.findLast((item) => item.type === "tool" && item.state.status === "error")
        if (failed?.type === "tool" && failed.state.status === "error") {
          return yield* Effect.fail(new Error(`Subagent failed (task_id: ${nextSession.id}): ${failed.state.error}`))
        }
        return result.parts.findLast((item) => item.type === "text")?.text ?? ""
      })

      // Wait until the parent session is idle (its current turn finished) so a
      // completed background task never interrupts work the parent is doing.
      const waitParentIdle = Effect.fn("TaskTool.waitParentIdle")(function* () {
        const stream = events.subscribe(SessionStatusEvent.Idle).pipe(
          Stream.filter((event) => event.data.sessionID === ctx.sessionID),
          Stream.take(1),
        )
        const waiting = yield* stream.pipe(Stream.runDrain).pipe(Effect.forkIn(scope, { startImmediately: true }))
        if ((yield* status.get(ctx.sessionID)).type === "idle") {
          yield* Fiber.interrupt(waiting)
          return true
        }
        const gotIdle = yield* Fiber.await(waiting).pipe(
          Effect.timeout("30 minutes"),
          Effect.match({
            onSuccess: () => true,
            onFailure: () => false,
          }),
        )
        return gotIdle
      })

      const inject = Effect.fn("TaskTool.injectBackgroundResult")(function* (state: "completed" | "error", text: string) {
        if (collected.has(nextSession.id)) return Effect.void
        if (!(yield* waitParentIdle())) return Effect.void
        if (collected.has(nextSession.id)) return Effect.void
        const currentParent = yield* sessions.get(ctx.sessionID)
        yield* ops
          .prompt({
            sessionID: ctx.sessionID,
            agent: currentParent.agent ?? ctx.agent,
            variant,
            parts: [
              {
                type: "text",
                synthetic: true,
                text: renderOutput({
                  sessionID: nextSession.id,
                  state,
                  summary:
                    state === "completed"
                      ? `Background task completed: ${params.description}`
                      : `Background task failed: ${params.description}`,
                  text,
                }),
              },
            ],
          })
          .pipe(Effect.ignore, Effect.forkIn(scope, { startImmediately: true }))
        return Effect.void
      })

      const notify = Effect.fn("TaskTool.notifyBackgroundResult")(function* (jobID: string) {
        yield* background.wait({ id: jobID }).pipe(
          Effect.flatMap((result) => {
            if (result.info?.status === "completed") return inject("completed", result.info.output ?? "")
            if (result.info?.status === "error") return inject("error", result.info.error ?? "")
            return Effect.void
          }),
          Effect.forkIn(scope, { startImmediately: true }),
        )
      })

      if (yield* background.extend({ id: nextSession.id, run: runTask() })) {
        return {
          title: params.description,
          metadata: {
            ...metadata,
            background: true,
            jobId: nextSession.id,
          },
          output: renderOutput({
            sessionID: nextSession.id,
            state: "running",
            summary: "Background task updated",
            text: SPAWN_UPDATED,
          }),
        }
      }

      const info = yield* background.start({
        id: nextSession.id,
        type: id,
        title: params.description,
        metadata,
        onPromote: Effect.all([
          ctx.metadata({
            title: params.description,
            metadata: { ...metadata, background: true, jobId: nextSession.id },
          }),
          notify(nextSession.id),
        ]).pipe(Effect.asVoid),
        run: runTask().pipe(Effect.onInterrupt(() => ops.cancel(nextSession.id))),
      })

      function backgroundResult() {
        return {
          title: params.description,
          metadata: {
            ...metadata,
            background: true,
            jobId: info.id,
          },
          output: renderOutput({
            sessionID: nextSession.id,
            state: "running",
            summary: "Background task started",
            text: SPAWN_STARTED,
          }),
        }
      }

      if (!blocking) {
        yield* notify(info.id)
        return backgroundResult()
      }

      const runCancel = yield* EffectBridge.make()
      const cancel = ops.cancel(nextSession.id)

      function onAbort() {
        runCancel.fork(cancel)
      }

      return yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          ctx.abort.addEventListener("abort", onAbort)
        }),
        () =>
          Effect.gen(function* () {
            const result = yield* Effect.raceFirst(
              background.wait({ id: nextSession.id }).pipe(Effect.map((waited) => waited.info)),
              background.waitForPromotion(nextSession.id),
            )
            if (result?.metadata?.background === true) return backgroundResult()
            if (result?.status === "error") return yield* Effect.fail(new Error(result.error ?? "Task failed"))
            if (result?.status === "cancelled") return yield* Effect.fail(new Error("Task cancelled"))
            return {
              title: params.description,
              metadata,
              output: renderOutput({ sessionID: nextSession.id, state: "completed", text: result?.output ?? "" }),
            }
          }),
        (_, exit) =>
          Effect.gen(function* () {
            if (Exit.hasInterrupts(exit))
              yield* Effect.all([cancel, background.cancel(nextSession.id)], { discard: true })
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                ctx.abort.removeEventListener("abort", onAbort)
              }),
            ),
          ),
      )
    })

    return {
      description: [DESCRIPTION, SPAWN_STARTED].join("\n\n"),
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)

const TasksTool = Tool.define(
  "tasks",
  Effect.gen(function* () {
    const background = yield* BackgroundJob.Service
    const sessions = yield* Session.Service

    const run = Effect.fn("TasksTool.execute")(function* (_params: Record<string, never>, ctx: Tool.Context) {
      const jobs = (yield* background.list())
        .filter((job) => job.metadata?.parentSessionId === ctx.sessionID)
        .toSorted((a, b) => a.started_at - b.started_at)
      const byId = new Map(jobs.map((job) => [job.id, job]))
      const children = (yield* sessions.children(ctx.sessionID))
        .toSorted((a, b) => (b.time.updated ?? 0) - (a.time.updated ?? 0))
        .slice(0, 20)

      const lines: string[] = []
      for (const job of jobs) {
        const collectedHint = collected.has(job.id) ? " (collected)" : ""
        lines.push(`task_id=${job.id}\t${job.status}\t${job.title ?? ""}${collectedHint}`)
      }
      for (const child of children) {
        if (byId.has(child.id)) continue
        lines.push(`task_id=${child.id}\tidle\t${child.title} (@${child.agent ?? "subagent"})`)
      }
      if (lines.length === 0) {
        return { title: "tasks", metadata: {}, output: "No subagents for this session." }
      }
      return { title: "tasks", metadata: {}, output: lines.join("\n") }
    })

    return {
      description:
        "List all subagents spawned by this session (task_id, status, description). Use to find task_ids to check, collect, or cancel. Each line is task_id=<id>\\t<status>\\t<description>.",
      parameters: TasksParameters,
      jsonSchema: ToolJsonSchema.fromSchema(TasksParameters),
      execute: (params: Schema.Schema.Type<typeof TasksParameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)

const TaskStatusTool = Tool.define(
  "task_status",
  Effect.gen(function* () {
    const background = yield* BackgroundJob.Service
    const sessions = yield* Session.Service
    const database = yield* Database.Service

    const run = Effect.fn("TaskStatusTool.execute")(function* (
      params: Schema.Schema.Type<typeof TaskStatusParameters>,
      ctx: Tool.Context,
    ) {
      const info = yield* taskInfo(sessions, background, database, ctx.sessionID, params.task_id)
      if (!info) return yield* Effect.fail(new Error(`No task ${params.task_id} belongs to this session`))
      return {
        title: `task_status ${params.task_id}`,
        metadata: { jobId: info.session.id },
        output: renderOutput({
          sessionID: info.session.id,
          state: info.state === "error" ? "error" : info.state === "completed" ? "completed" : "running",
          summary: info.job?.title ?? info.session.title,
          text: info.tail || info.job?.output || info.job?.error || "(no output yet)",
        }),
      }
    })

    return {
      description:
        "Check the status and recent output of a running or finished subagent (non-blocking). Returns state, and the most recent text output. Use `task_wait` for the final result.",
      parameters: TaskStatusParameters,
      jsonSchema: ToolJsonSchema.fromSchema(TaskStatusParameters),
      execute: (params: Schema.Schema.Type<typeof TaskStatusParameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)

const TaskWaitTool = Tool.define(
  "task_wait",
  Effect.gen(function* () {
    const background = yield* BackgroundJob.Service
    const sessions = yield* Session.Service
    const database = yield* Database.Service

    const run = Effect.fn("TaskWaitTool.execute")(function* (
      params: Schema.Schema.Type<typeof TaskWaitParameters>,
      ctx: Tool.Context,
    ) {
      const info = yield* taskInfo(sessions, background, database, ctx.sessionID, params.task_id)
      if (!info) return yield* Effect.fail(new Error(`No task ${params.task_id} belongs to this session`))
      const timeoutMs = (params.timeout ?? 300) * 1000
      const result = yield* background.wait({ id: params.task_id, timeout: timeoutMs })
      if (result.timedOut) {
        return {
          title: `task_wait ${params.task_id}`,
          metadata: { jobId: info.session.id },
          output: renderOutput({
            sessionID: info.session.id,
            state: "running",
            summary: `Still running after ${params.timeout ?? 300}s`,
            text: info.tail || "(no output yet)",
          }),
        }
      }
      if (result.info?.status === "error") return yield* Effect.fail(new Error(result.info.error ?? "Task failed"))
      if (result.info?.status === "cancelled") return yield* Effect.fail(new Error("Task cancelled"))
      const output = result.info?.output ?? info.tail
      collected.add(params.task_id)
      return {
        title: `task_wait ${params.task_id}`,
        metadata: { jobId: info.session.id },
        output: renderOutput({
          sessionID: info.session.id,
          state: "completed",
          summary: `Task completed: ${result.info?.title ?? info.session.title}`,
          text: output,
        }),
      }
    })

    return {
      description:
        "Wait for a subagent to finish and return its final result (blocks until done or timeout). Marks the task as collected so the result is not auto-injected again later.",
      parameters: TaskWaitParameters,
      jsonSchema: ToolJsonSchema.fromSchema(TaskWaitParameters),
      execute: (params: Schema.Schema.Type<typeof TaskWaitParameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)

const TaskCancelTool = Tool.define(
  "task_cancel",
  Effect.gen(function* () {
    const background = yield* BackgroundJob.Service
    const sessions = yield* Session.Service
    const database = yield* Database.Service

    const run = Effect.fn("TaskCancelTool.execute")(function* (
      params: Schema.Schema.Type<typeof TaskCancelParameters>,
      ctx: Tool.Context,
    ) {
      const session = yield* sessionStatus(sessions, ctx.sessionID, params.task_id)
      if (!session) return yield* Effect.fail(new Error(`No task ${params.task_id} belongs to this session`))
      const info = yield* background.cancel(params.task_id)
      const tail = yield* tailText(sessions, database, session.id)
      if (!info) return yield* Effect.fail(new Error(`Task ${params.task_id} is not running`))
      collected.add(params.task_id)
      return {
        title: `task_cancel ${params.task_id}`,
        metadata: { jobId: session.id },
        output: [
          `<task id="${session.id}" state="cancelled">`,
          `<task_result>`,
          tail || (info.output ?? "(no output)"),
          `</task_result>`,
          "</task>",
        ].join("\n"),
      }
    })

    return {
      description: "Abort a running subagent (like Ctrl+C). Returns its buffered output so far.",
      parameters: TaskCancelParameters,
      jsonSchema: ToolJsonSchema.fromSchema(TaskCancelParameters),
      execute: (params: Schema.Schema.Type<typeof TaskCancelParameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)

export { TasksTool, TaskStatusTool, TaskWaitTool, TaskCancelTool }