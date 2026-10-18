export * as ToolInvoke from "./invoke.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { define } from "@opencode/schema/rpc"
import { Session } from "@opencode/schema/session"
import { Tool } from "@opencode/schema/tool"
import { Effect, Schema } from "effect"
import { Agent } from "../agent.js"
import { Session as SessionService } from "../session.js"
import { SessionMessage } from "../session/message.js"
import { Tool as ToolService } from "../tool.js"

/**
 * User-initiated tool invocation, without going through the model.
 *
 * Exposed over the existing plugin RPC surface (`POST /api/rpc/opencode.tool/:method`) rather
 * than as dedicated HttpApi endpoints: this checkout is already at the Effect/tsgo type-complexity
 * ceiling, and any additional HttpApi endpoint pushes `tsgo` into phantom middleware requirements
 * and a segfault. RPC adds no Api surface.
 *
 * `list` returns the model-facing summaries (name, description, JSON input schema);
 * `invoke` runs one registered tool by effective name in the given session's context.
 */
export const Definition = define({
  id: "opencode.tool",
  methods: {
    list: {
      input: Schema.Struct({}),
      output: Schema.Array(Tool.Description),
    },
    invoke: {
      input: Schema.Struct({ sessionID: Session.ID, name: Schema.String, input: Schema.Unknown }),
      output: Tool.InvocationResult,
      errors: { "tool.failed": Schema.Struct({}) },
    },
  },
  events: {},
})

export const Plugin = {
  id: "opencode.tool.invoke",
  effect: Effect.fn("ToolInvoke.Plugin")(function* (ctx: Context) {
    const tools = yield* ToolService.Service
    const sessions = yield* SessionService.Service
    yield* ctx.rpc.register(Definition, {
      list: () => tools.describe(),
      invoke: (input, call) =>
        Effect.gen(function* () {
          const fail = (message: string) => Effect.fail(call.error("tool.failed", message, {}))
          const session = yield* sessions.get(input.sessionID).pipe(Effect.catch(() => fail(`Session not found: ${input.sessionID}`)))
          return yield* tools
            .invoke(input.name, input.input, {
              sessionID: session.id,
              agent: session.agent ?? Agent.defaultID,
              messageID: SessionMessage.ID.create(),
              id: ToolService.CallID.make("call_" + crypto.randomUUID().replaceAll("-", "").slice(0, 24)),
              progress: () => Effect.void,
            })
            .pipe(Effect.catchTag("Tool.Error", (error) => fail(error.message)))
        }),
    }).pipe(Effect.orDie)
  }),
}
