import { SecureInput } from "@opencode/core/secure-input"
import { SecureInputNotFoundError } from "@opencode/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/http-api"
import { Api } from "../api"
import { response } from "../location"

const missing = () => new SecureInputNotFoundError({ message: "Secure input request not found" })

export const SecureInputHandler = HttpApiBuilder.group(Api, "server.secure-input", (handlers) => handlers
  .handle("secureInput.request.list", Effect.fnUntraced(function* () {
    const input = yield* SecureInput.Service
    return yield* response(input.list())
  }))
  .handle("secureInput.list", Effect.fnUntraced(function* (ctx) {
    const input = yield* SecureInput.Service
    return { data: yield* input.list(ctx.params.sessionID) }
  }))
  .handle("secureInput.reply", Effect.fnUntraced(function* (ctx) {
    const input = yield* SecureInput.Service
    yield* input.reply(ctx.params.sessionID, ctx.params.requestID, ctx.payload.value)
      .pipe(Effect.catchTag("SecureInput.NotFoundError", missing))
    return HttpApiSchema.NoContent.make()
  }))
  .handle("secureInput.reject", Effect.fnUntraced(function* (ctx) {
    const input = yield* SecureInput.Service
    yield* input.reject(ctx.params.sessionID, ctx.params.requestID)
      .pipe(Effect.catchTag("SecureInput.NotFoundError", missing))
    return HttpApiSchema.NoContent.make()
  })),
)
