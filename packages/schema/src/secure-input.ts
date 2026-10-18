export * as SecureInput from "./secure-input.js"

import { Schema } from "effect"
import { ephemeral, inventory } from "./event.js"
import { ascending } from "./identifier.js"
import { optional, statics } from "./schema.js"
import { SessionID } from "./session-id.js"

const IDSchema = Schema.String.check(Schema.isStartingWith("sec_")).pipe(
  Schema.brand("SecureInput.ID"),
  Schema.annotate({ identifier: "SecureInput.ID" }),
)
export const ID = IDSchema.pipe(statics((schema) => ({ create: () => schema.make("sec_" + ascending()) })))
export type ID = typeof ID.Type

// Only display metadata belongs on the public stream. Neither values nor capabilities do.
export const Request = Schema.Struct({
  id: ID,
  sessionID: SessionID,
  sessionName: Schema.String,
  prompt: Schema.String,
  command: Schema.String.pipe(optional),
}).annotate({ identifier: "SecureInput.Request" })
export interface Request extends Schema.Schema.Type<typeof Request> {}

export const Reply = Schema.Struct({ value: Schema.String }).annotate({ identifier: "SecureInput.Reply" })
export interface Reply extends Schema.Schema.Type<typeof Reply> {}

const Asked = ephemeral({ type: "secure.input.asked", schema: Request.fields })
const Replied = ephemeral({ type: "secure.input.replied", schema: { sessionID: SessionID, requestID: ID } })
const Rejected = ephemeral({ type: "secure.input.rejected", schema: { sessionID: SessionID, requestID: ID } })
export const Event = { Asked, Replied, Rejected, Definitions: inventory(Asked, Replied, Rejected) }
