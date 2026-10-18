import { expect } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Scope } from "effect"
import { TestClock } from "effect/testing"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { SecureInput } from "@opencode/core/secure-input"
import { Session } from "@opencode/schema/session"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Bus.node, SecureInput.node])))
const first = Session.ID.make("ses_first")
const second = Session.ID.make("ses_second")

it.effect("secure reply is owner checked and only metadata enters events", () => Effect.gen(function* () {
  const service = yield* SecureInput.Service
  const bus = yield* Bus.Service
  const asked = yield* Deferred.make<SecureInput.Request>()
  const events: unknown[] = []
  yield* bus.listen((event) => Effect.gen(function* () {
    events.push(event)
    if (event.type === SecureInput.Event.Asked.type)
      yield* Deferred.succeed(asked, event.data as SecureInput.Request)
  })).pipe(Effect.flatMap((unsubscribe) => Effect.addFinalizer(() => unsubscribe)))
  const owner = {}
  const token = yield* service.grant(owner, first)
  const other = yield* service.grant(owner, second)
  expect(yield* service.request({}, { token, prompt: "Password" }).pipe(Effect.flip))
    .toBeInstanceOf(SecureInput.InvalidCapabilityError)
  expect(yield* service.request(owner, { token: "wrong", prompt: "Password" }).pipe(Effect.flip))
    .toBeInstanceOf(SecureInput.InvalidCapabilityError)
  const fiber = yield* service.request(owner, { token, prompt: "Password" }).pipe(Effect.forkScoped)
  const request = yield* Deferred.await(asked)
  expect(request.sessionID).toBe(first)
  expect(yield* service.list(second)).toEqual([])
  expect(yield* service.reply(second, request.id, "wrong-owner").pipe(Effect.flip)).toBeInstanceOf(SecureInput.NotFoundError)
  expect(yield* service.reject(second, request.id).pipe(Effect.flip)).toBeInstanceOf(SecureInput.NotFoundError)
  yield* service.reply(first, request.id, "test-only-secret")
  expect(yield* Fiber.join(fiber)).toBe("test-only-secret")
  expect(yield* service.list()).toEqual([])
  expect(JSON.stringify(events)).not.toContain("test-only-secret")
  expect(JSON.stringify(events)).not.toContain(token)
  expect(JSON.stringify(events)).not.toContain(other)
  expect(events).toHaveLength(2)
  expect(yield* service.reply(first, request.id, "again").pipe(Effect.flip)).toBeInstanceOf(SecureInput.NotFoundError)
}))

it.effect("reject, request interruption, expiry and invocation finalization remove pending prompts", () => Effect.gen(function* () {
  const service = yield* SecureInput.Service
  const bus = yield* Bus.Service
  const requests: SecureInput.Request[] = []
  yield* bus.listen((event) => Effect.sync(() => {
    if (event.type === SecureInput.Event.Asked.type) requests.push(event.data as SecureInput.Request)
  })).pipe(Effect.flatMap((unsubscribe) => Effect.addFinalizer(() => unsubscribe)))
  const owner = {}
  const invocation = yield* Scope.make()
  const token = yield* service.grant(owner, first).pipe(Scope.provide(invocation))
  const ask = () => service.request(owner, { token, prompt: "Password" }).pipe(Effect.forkChild({ startImmediately: true }))
  const rejected = yield* ask()
  yield* service.reject(first, requests[0]!.id)
  expect(Exit.isFailure(yield* Fiber.await(rejected))).toBe(true)
  const interrupted = yield* ask()
  yield* Fiber.interrupt(interrupted)
  expect(yield* service.list()).toEqual([])
  const expired = yield* ask()
  yield* TestClock.adjust("10 minutes")
  expect(Exit.isFailure(yield* Fiber.await(expired))).toBe(true)
  expect(yield* service.list()).toEqual([])
  expect(yield* service.request(owner, { token, prompt: "late" }).pipe(Effect.flip)).toBeInstanceOf(SecureInput.InvalidCapabilityError)
  yield* Scope.close(invocation, Exit.void)
  const tool = yield* Scope.make()
  const final = yield* service.grant(owner, second).pipe(Scope.provide(tool))
  const pending = yield* service.request(owner, { token: final, prompt: "Password" }).pipe(Effect.forkChild({ startImmediately: true }))
  yield* Scope.close(tool, Exit.void)
  expect(Exit.isFailure(yield* Fiber.await(pending))).toBe(true)
  expect(yield* service.list()).toEqual([])
  expect(yield* service.request(owner, { token: final, prompt: "late" }).pipe(Effect.flip)).toBeInstanceOf(SecureInput.InvalidCapabilityError)
}))
