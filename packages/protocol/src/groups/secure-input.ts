import { SecureInput } from "@opencode/schema/secure-input"
import { Location } from "@opencode/schema/location"
import { Session } from "@opencode/schema/session"
import { Context, Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSchema, OpenApi } from "effect/http-api"
import { SecureInputNotFoundError, SessionNotFoundError } from "../errors.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

export const makeSecureInputGroup = <
  LocationId extends HttpApiMiddleware.AnyId, LocationService,
  SessionLocationId extends HttpApiMiddleware.AnyId, SessionLocationService,
>(location: Context.Key<LocationId, LocationService>, session: Context.Key<SessionLocationId, SessionLocationService>) =>
  HttpApiGroup.make("server.secure-input")
    .add(HttpApiEndpoint.get("secureInput.request.list", "/api/secure-input", {
      query: LocationQuery, success: Location.response(Schema.Array(SecureInput.Request)),
    }).annotateMerge(locationQueryOpenApi).annotateMerge(OpenApi.annotations({
      identifier: "secure-input.request.list", summary: "List pending secure input requests",
    })))
    .middleware(location)
    .add(HttpApiEndpoint.get("secureInput.list", "/api/session/:sessionID/secure-input", {
      params: { sessionID: Session.ID }, success: Schema.Struct({ data: Schema.Array(SecureInput.Request) }),
      error: SessionNotFoundError,
    }).middleware(session).annotateMerge(OpenApi.annotations({ identifier: "secure-input.list" })))
    .add(HttpApiEndpoint.post("secureInput.reply", "/api/session/:sessionID/secure-input/:requestID/reply", {
      params: { sessionID: Session.ID, requestID: SecureInput.ID }, payload: SecureInput.Reply,
      success: HttpApiSchema.NoContent, error: [SessionNotFoundError, SecureInputNotFoundError],
    }).middleware(session).annotateMerge(OpenApi.annotations({ identifier: "secure-input.reply" })))
    .add(HttpApiEndpoint.post("secureInput.reject", "/api/session/:sessionID/secure-input/:requestID/reject", {
      params: { sessionID: Session.ID, requestID: SecureInput.ID },
      success: HttpApiSchema.NoContent, error: [SessionNotFoundError, SecureInputNotFoundError],
    }).middleware(session).annotateMerge(OpenApi.annotations({ identifier: "secure-input.reject" })))
    .annotateMerge(OpenApi.annotations({ title: "secure-input", description: "Ephemeral secret input; replies are never published." }))
