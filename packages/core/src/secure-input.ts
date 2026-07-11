export * as SecureInputV2 from "./secure-input"

import { makeLocationNode } from "./effect/app-node"
import { Context, Deferred, Effect, Layer, Schema } from "effect"
import { SecureInput } from "@opencode-ai/schema/secure-input"
import { EventV2 } from "./event"
import { SessionSchema } from "./session/schema"

export const ID = SecureInput.ID
export type ID = typeof ID.Type

export const Request = SecureInput.Request
export type Request = typeof Request.Type

export const Reply = SecureInput.Reply
export type Reply = typeof Reply.Type

export const Event = SecureInput.Event

export class RejectedError extends Schema.TaggedErrorClass<RejectedError>()("SecureInputV2.RejectedError", {}) {
  override get message() {
    return "The user dismissed the secure input dialog"
  }
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("SecureInputV2.NotFoundError", {
  requestID: ID,
}) {}

export interface RequestInput {
  readonly sessionID: SessionSchema.ID
  readonly sessionName: string
  readonly prompt: string
  readonly command?: string
}

export interface ReplyInput {
  readonly requestID: ID
  readonly value: string
}

export interface Interface {
  readonly request: (input: RequestInput) => Effect.Effect<string, RejectedError>
  readonly reply: (input: ReplyInput) => Effect.Effect<void, NotFoundError>
  readonly reject: (requestID: ID) => Effect.Effect<void, NotFoundError>
  readonly list: () => Effect.Effect<ReadonlyArray<Request>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SecureInput") {}

interface Pending {
  readonly request: Request
  readonly deferred: Deferred.Deferred<string, RejectedError>
}

const pending = new Map<ID, Pending>()

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service

    const request = Effect.fn("SecureInputV2.request")((input: RequestInput) =>
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const id = ID.ascending()
          const deferred = yield* Deferred.make<string, RejectedError>()
          const req: Request = { id, ...input }
          pending.set(id, { request: req, deferred })
          return yield* events.publish(Event.Asked, req).pipe(
            Effect.andThen(restore(Deferred.await(deferred))),
            Effect.ensuring(Effect.sync(() => { pending.delete(id) })),
          )
        }),
      ),
    )

    const reply = Effect.fn("SecureInputV2.reply")((input: ReplyInput) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          const existing = pending.get(input.requestID)
          if (!existing) return yield* new NotFoundError({ requestID: input.requestID })
          yield* events.publish(Event.Replied, {
            sessionID: existing.request.sessionID,
            requestID: existing.request.id,
          })
          yield* Deferred.succeed(existing.deferred, input.value)
          pending.delete(input.requestID)
        }),
      ),
    )

    const reject = Effect.fn("SecureInputV2.reject")((requestID: ID) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          const existing = pending.get(requestID)
          if (!existing) return yield* new NotFoundError({ requestID })
          yield* events.publish(Event.Rejected, {
            sessionID: existing.request.sessionID,
            requestID: existing.request.id,
          })
          yield* Deferred.fail(existing.deferred, new RejectedError())
          pending.delete(requestID)
        }),
      ),
    )

    const list = Effect.fn("SecureInputV2.list")(function* () {
      return Array.from(pending.values(), (item) => item.request)
    })

    return Service.of({ request, reply, reject, list })
  }),
)

export const locationLayer = layer
export const node = makeLocationNode({ service: Service, layer, deps: [EventV2.node] })
