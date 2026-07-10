export * as SecureInput from "./secure-input"

import { Schema } from "effect"
import { optional } from "./schema"
import { define, inventory } from "./event"
import { SessionID } from "./session-id"
import { statics } from "./schema"

export const ID = Schema.String.pipe(
  Schema.brand("SecureInput.ID"),
  statics((schema) => {
    let counter = 0
    const create = () => schema.make("sec_" + (++counter).toString(36))
    return { create, ascending: (id?: string) => (id === undefined ? create() : schema.make(id)) }
  }),
)
export type ID = typeof ID.Type

export const Request = Schema.Struct({
  id: ID,
  sessionID: SessionID,
  sessionName: Schema.String,
  prompt: Schema.String,
}).annotate({ identifier: "SecureInput.Request" })
export interface Request extends Schema.Schema.Type<typeof Request> {}

export const Reply = Schema.Struct({
  value: Schema.String,
}).annotate({ identifier: "SecureInput.Reply" })
export interface Reply extends Schema.Schema.Type<typeof Reply> {}

const Asked = define({ type: "secure.input.asked", schema: Request.fields })
const Replied = define({
  type: "secure.input.replied",
  schema: { sessionID: SessionID, requestID: ID },
})
const Rejected = define({
  type: "secure.input.rejected",
  schema: { sessionID: SessionID, requestID: ID },
})
export const Event = { Asked, Replied, Rejected, Definitions: inventory(Asked, Replied, Rejected) }
