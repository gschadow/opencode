export * as SecureInput from "./secure-input.js"

import { Context, Deferred, Effect, Layer, Schema, Scope } from "effect"
import { SecureInput } from "@opencode/schema/secure-input"
import type { Session } from "@opencode/schema/session"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Bus } from "./bus.js"

export const ID = SecureInput.ID
export type ID = SecureInput.ID
export type Request = SecureInput.Request
export const Event = SecureInput.Event

export class RejectedError extends Schema.TaggedError<RejectedError>()("SecureInput.RejectedError", {}) {
  override get message() { return "Secure input cancelled or expired" }
}
export class NotFoundError extends Schema.TaggedError<NotFoundError>()("SecureInput.NotFoundError", {}) {}
export class InvalidCapabilityError extends Schema.TaggedError<InvalidCapabilityError>()("SecureInput.InvalidCapabilityError", {}) {}

export interface Input {
  readonly token: string
  readonly sessionName?: string
  readonly prompt: string
  readonly command?: string
}
export interface Interface {
  readonly grant: (owner: object, sessionID: Session.ID) => Effect.Effect<string, never, Scope.Scope>
  readonly request: (owner: object, input: Input) => Effect.Effect<string, InvalidCapabilityError | RejectedError>
  readonly list: (sessionID?: Session.ID) => Effect.Effect<ReadonlyArray<Request>>
  readonly reply: (sessionID: Session.ID, requestID: ID, value: string) => Effect.Effect<void, NotFoundError>
  readonly reject: (sessionID: Session.ID, requestID: ID) => Effect.Effect<void, NotFoundError>
}
export class Service extends Context.Service<Service, Interface>()("@opencode/SecureInput") {}

export const layer = Layer.effect(Service, Effect.gen(function* () {
  const bus = yield* Bus.Service
  const capabilities = new Map<string, { owner: object; sessionID: Session.ID }>()
  const pending = new Map<ID, { token: string; request: Request; deferred: Deferred.Deferred<string, RejectedError> }>()

  const reject = Effect.fnUntraced(function* (sessionID: Session.ID, requestID: ID) {
    const entry = pending.get(requestID)
    if (!entry || entry.request.sessionID !== sessionID) return yield* new NotFoundError()
    pending.delete(requestID)
    yield* Deferred.fail(entry.deferred, new RejectedError())
    yield* bus.publish(Event.Rejected, { sessionID, requestID })
  }, Effect.uninterruptible)

  const revoke = (token: string) => Effect.gen(function* () {
    capabilities.delete(token)
    yield* Effect.forEach(Array.from(pending.values()).filter((entry) => entry.token === token),
      (entry) => reject(entry.request.sessionID, entry.request.id).pipe(Effect.ignore), { discard: true })
  }).pipe(Effect.uninterruptible)

  const grant = Effect.fnUntraced(function* (owner: object, sessionID: Session.ID) {
    const token = yield* Effect.acquireRelease(Effect.sync(() => {
      const token = crypto.randomUUID()
      capabilities.set(token, { owner, sessionID })
      return token
    }), revoke)
    yield* Effect.sleep("10 minutes").pipe(Effect.andThen(revoke(token)), Effect.forkScoped)
    return token
  })

  const request = Effect.fnUntraced(function* (owner: object, input: Input) { return yield* Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const capability = capabilities.get(input.token)
      if (!capability || capability.owner !== owner) return yield* new InvalidCapabilityError()
      const request: Request = {
        id: ID.create(), sessionID: capability.sessionID,
        sessionName: input.sessionName ?? capability.sessionID, prompt: input.prompt,
        ...(input.command === undefined ? {} : { command: input.command }),
      }
      const deferred = yield* Deferred.make<string, RejectedError>()
      pending.set(request.id, { token: input.token, request, deferred })
      return yield* bus.publish(Event.Asked, request).pipe(
        Effect.andThen(restore(Deferred.await(deferred))),
        Effect.ensuring(reject(request.sessionID, request.id).pipe(Effect.ignore)),
      )
    }),
  ) })

  // Do not trace arguments here: value must never enter telemetry, events or storage.
  const reply = Effect.fnUntraced(function* (sessionID: Session.ID, requestID: ID, value: string) {
    const entry = pending.get(requestID)
    if (!entry || entry.request.sessionID !== sessionID) return yield* new NotFoundError()
    pending.delete(requestID)
    yield* Deferred.succeed(entry.deferred, value)
    yield* bus.publish(Event.Replied, { sessionID, requestID })
  }, Effect.uninterruptible)

  yield* Effect.addFinalizer(() => Effect.forEach(Array.from(capabilities.keys()), revoke, { discard: true }))
  return Service.of({ grant, request, reply, reject,
    list: (sessionID) => Effect.sync(() => Array.from(pending.values(), (entry) => entry.request)
      .filter((request) => sessionID === undefined || request.sessionID === sessionID)),
  })
}))

export const node = makeLocationNode({ service: Service, layer, deps: [Bus.node] })
