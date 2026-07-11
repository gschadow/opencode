import { SecureInputV2 } from "@opencode-ai/core/secure-input"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import { SecureInputNotFoundError } from "@opencode-ai/protocol/errors"
import { response } from "../location"

function missingRequest(id: SecureInputV2.ID) {
  return new SecureInputNotFoundError({ requestID: id, message: `Secure input request not found: ${id}` })
}

export const SecureInputHandler = HttpApiBuilder.group(Api, "server.secure-input", (handlers) =>
  Effect.gen(function* () {
    const withOwnedRequest = Effect.fnUntraced(function* <A, E>(
      sessionID: SecureInputV2.Request["sessionID"],
      requestID: SecureInputV2.ID,
      use: (secureInput: SecureInputV2.Interface) => Effect.Effect<A, E>,
    ) {
      const secureInput = yield* SecureInputV2.Service
      const request = (yield* secureInput.list()).find((request) => request.id === requestID)
      if (!request || request.sessionID !== sessionID) return yield* missingRequest(requestID)
      return yield* use(secureInput)
    })

    return handlers
      .handle(
        "secure.input.request.listAll",
        Effect.fn(function* () {
          return yield* response((yield* SecureInputV2.Service).list())
        }),
      )
      .handle(
        "session.secure.input.list",
        Effect.fn(function* (ctx) {
          const requests = yield* (yield* SecureInputV2.Service).list()
          return { data: requests.filter((request) => request.sessionID === ctx.params.sessionID) }
        }),
      )
      .handle(
        "session.secure.input.reply",
        Effect.fn(function* (ctx) {
          yield* withOwnedRequest(ctx.params.sessionID, ctx.params.requestID, (secureInput) =>
            secureInput
              .reply({ requestID: ctx.params.requestID, value: ctx.payload.value })
              .pipe(Effect.catchTag("SecureInputV2.NotFoundError", () => missingRequest(ctx.params.requestID))),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "session.secure.input.reject",
        Effect.fn(function* (ctx) {
          yield* withOwnedRequest(ctx.params.sessionID, ctx.params.requestID, (secureInput) =>
            secureInput
              .reject(ctx.params.requestID)
              .pipe(Effect.catchTag("SecureInputV2.NotFoundError", () => missingRequest(ctx.params.requestID))),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
  }),
)
