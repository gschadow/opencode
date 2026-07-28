export * as ConfigBudget from "./budget"

import { Schema } from "effect"
import { PositiveInt } from "../schema"

export class Info extends Schema.Class<Info>("ConfigV2.Budget")({
  maxCost: Schema.Finite.pipe(Schema.optional).annotate({
    description: "Maximum session cost in dollars before auto-stop",
  }),
  loopDetectionThreshold: PositiveInt.pipe(Schema.optional).annotate({
    description: "Number of identical tool-call repetitions before loop detection triggers (default: 3)",
  }),
}) {}
