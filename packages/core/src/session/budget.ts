export * as SessionBudget from "./budget.js"

import { ConfigBudget } from "@opencode/schema/config/budget"
import { Effect, Option, Schema } from "effect"
import { Config } from "../config.js"
import { StepFailedError } from "./error.js"
import { SessionSchema } from "./schema.js"
import { SessionStore } from "./store.js"

/** Capture services once; reload recorded USD spending before each request. */
export const make = Effect.gen(function* () {
  const config = yield* Config.Service
  const store = yield* SessionStore.Service
  return Effect.fn("SessionBudget.check")(function* (sessionID: SessionSchema.ID) {
    const session = yield* store.get(sessionID)
    if (!session) return
    const budget = Option.getOrUndefined(Schema.decodeUnknownOption(ConfigBudget.Info)(session.metadata?.budget))
    const maxCost = budget?.maxCost ?? Config.latest(yield* config.entries(), "budget")?.maxCost
    if (maxCost !== undefined && session.cost >= maxCost)
      return yield* new StepFailedError({
        error: {
          type: "budget.exceeded",
          message: `Session budget exceeded. Cost $${session.cost} USD has reached the $${maxCost} USD limit. Stopping.`,
        },
      })
  })
})
