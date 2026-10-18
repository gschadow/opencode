export * as ConfigBudget from "./budget.js"

import { Schema } from "effect"
import { optional, PositiveInt } from "../schema.js"

export class Info extends Schema.Class<Info>("Config.Budget")({
  maxCost: Schema.Finite.pipe(optional).annotate({
    description: "Maximum cost per session in USD before stopping further model steps; omitted means no ceiling",
  }),
  loopDetectionThreshold: PositiveInt.pipe(optional).annotate({
    description:
      "Number of identical tool-call repetitions before stopping (default: 3); target repeats use 5 times this threshold",
  }),
  loopDetectionExemptTools: Schema.String.pipe(optional).annotate({
    description:
      "Regex pattern for tool names exempt from loop detection; defaults to long-running polling tools (an invalid pattern falls back to the default)",
  }),
}) {}
