import { expect } from "bun:test"
import { Context, Effect, Layer } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { createEmbeddedRoutes } from "../src/routes"

it.live("lists registered tools over the opencode.tool RPC", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const context = yield* Layer.build(
      createEmbeddedRoutes({
        database: { path: ":memory:" },
        models: { fetch: false },
        config: { directory: directory.path, project: false, content: "{}" },
        fs: { filewatcher: false },
      }).pipe(Layer.provide(HttpServer.layerServices)),
    )
    const handler = Context.get(context, HttpRouter.HttpRouter)
      .asHttpEffect()
      .pipe(HttpEffect.toWebHandlerWith(context))
    const url = new URL(`/api/rpc/opencode.tool/list`, "http://opencode.local")
    url.searchParams.set("location[directory]", directory.path)
    const response = yield* Effect.promise(() =>
      handler(
        new Request(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ input: {} }),
        }),
      ),
    )
    expect(response.status).toBe(200)
    const body: { output: ReadonlyArray<{ name: string; description: string; inputSchema: unknown }> } =
      yield* Effect.promise(() => response.json())
    expect(Array.isArray(body.output)).toBe(true)
    expect(body.output.some((tool) => tool.name === "read")).toBe(true)
  }),
)
