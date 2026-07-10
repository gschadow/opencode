import { SecureInput } from "@opencode-ai/schema/secure-input"
import { Location } from "@opencode-ai/schema/location"
import { Session } from "@opencode-ai/schema/session"
import { Context, Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { SecureInputNotFoundError, SessionNotFoundError } from "../errors"
import { LocationQuery, locationQueryOpenApi } from "./location"

export const makeSecureInputGroup = <
  LocationId extends HttpApiMiddleware.AnyId,
  LocationService,
  SessionLocationId extends HttpApiMiddleware.AnyId,
  SessionLocationService,
>(
  locationMiddleware: Context.Key<LocationId, LocationService>,
  sessionLocationMiddleware: Context.Key<SessionLocationId, SessionLocationService>,
) =>
  HttpApiGroup.make("server.secure-input")
    .add(
      HttpApiEndpoint.get("secure.input.request.list", "/api/secure-input/request", {
        query: LocationQuery,
        success: Location.response(Schema.Array(SecureInput.Request)),
      })
        .annotateMerge(locationQueryOpenApi)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "v2.secure.input.request.list",
            summary: "List pending secure input requests",
            description: "Retrieve pending secure input requests for a location.",
          }),
        ),
    )
    .annotateMerge(OpenApi.annotations({ title: "secure-input", description: "Secure input routes." }))
    .middleware(locationMiddleware)
    .add(
      HttpApiEndpoint.get("session.secure.input.list", "/api/session/:sessionID/secure-input", {
        params: { sessionID: Session.ID },
        success: Schema.Struct({ data: Schema.Array(SecureInput.Request) }),
        error: SessionNotFoundError,
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "v2.session.secure.input.list",
            summary: "List session secure input requests",
            description: "Retrieve pending secure input requests owned by a session.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.post("session.secure.input.reply", "/api/session/:sessionID/secure-input/:requestID/reply", {
        params: { sessionID: Session.ID, requestID: SecureInput.ID },
        payload: SecureInput.Reply,
        success: HttpApiSchema.NoContent,
        error: [SessionNotFoundError, SecureInputNotFoundError],
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "v2.session.secure.input.reply",
            summary: "Reply to pending secure input request",
            description: "Provide a value for a pending secure input request.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.post("session.secure.input.reject", "/api/session/:sessionID/secure-input/:requestID/reject", {
        params: { sessionID: Session.ID, requestID: SecureInput.ID },
        success: HttpApiSchema.NoContent,
        error: [SessionNotFoundError, SecureInputNotFoundError],
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "v2.session.secure.input.reject",
            summary: "Reject pending secure input request",
            description: "Reject a pending secure input request owned by a session.",
          }),
        ),
    )
    .annotateMerge(
      OpenApi.annotations({ title: "session secure input", description: "Session secure input routes." }),
    )
