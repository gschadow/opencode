import { expect } from "bun:test"
import { Deferred, Effect, Fiber } from "effect"
import { ConfigMCP } from "@opencode/schema/config/mcp"
import { Session } from "@opencode/schema/session"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { SecureInput } from "@opencode/core/secure-input"
import { McpClient } from "@opencode/core/mcp/client"
import { hostEnvironmentLayer } from "./fixture/environment"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Bus.node, SecureInput.node])))
it.live("v2 SDK sends local invocation capability, returns secret only to transport, and rejects replay", () => Effect.gen(function* () {
  const service = yield* SecureInput.Service
  const bus = yield* Bus.Service
  const asked = yield* Deferred.make<SecureInput.Request>()
  const events: unknown[] = []
  yield* bus.listen((event) => Effect.gen(function* () {
    events.push(event)
    if (event.type === SecureInput.Event.Asked.type) yield* Deferred.succeed(asked, event.data as SecureInput.Request)
  })).pipe(Effect.flatMap((unsubscribe) => Effect.addFinalizer(() => unsubscribe)))
  const client = yield* McpClient.connect("fixture", new ConfigMCP.Local({ type: "local",
    command: [process.execPath, `${import.meta.dir}/fixture/mcp-secure-input.ts`],
  }), import.meta.dir, undefined, undefined, undefined, service).pipe(Effect.provide(hostEnvironmentLayer))
  const sessionID = Session.ID.make("ses_transport")
  const call = yield* client.callTool({ name: "ask", sessionID }).pipe(Effect.forkScoped)
  const request = yield* Deferred.await(asked)
  expect(request.sessionID).toBe(sessionID)
  yield* service.reply(sessionID, request.id, "test-only-secret")
  const result = yield* Fiber.join(call)
  expect(result.content).toEqual([{ type: "text", text: "verified" }])
  expect(JSON.stringify(result)).not.toContain("test-only-secret")
  expect(JSON.stringify(events)).not.toContain("test-only-secret")
  expect((yield* client.callTool({ name: "replay", sessionID })).content).toEqual([{ type: "text", text: "unavailable" }])
  expect((yield* client.callTool({ name: "ask" })).content).toEqual([{ type: "text", text: "no capability" }])
  expect(yield* service.list()).toEqual([])
}))
