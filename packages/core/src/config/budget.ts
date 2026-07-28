export * as ConfigBudget from "./budget"

import { Schema } from "effect"
import { PositiveInt } from "../schema"

export class Info extends Schema.Class<Info>("ConfigV2.Budget")({
  maxCost: Schema.Finite.pipe(Schema.optional).annotate({
    description: "Maximum session cost in dollars before auto-stop",
  }),
  maxConsecutiveSteps: PositiveInt.pipe(Schema.optional).annotate({
    description: "Maximum consecutive tool-loop steps without user input before stop",
  }),
}) {}
