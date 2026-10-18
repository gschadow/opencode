import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { launch } from "./launch"
import { Effect, Option } from "effect"

// `opencode attach <url>` connects the TUI to an already-running server, exactly
// like the root command with `--server <url>`: it pings the endpoint, warns on a
// version mismatch, and never spawns or replaces a background service.
export default Runtime.handler(Commands.commands.attach, (input) =>
  Effect.gen(function* () {
    const url = Option.getOrUndefined(input.url)
    if (url === undefined)
      return yield* Effect.fail(
        new Error("opencode attach requires a server URL, for example: opencode attach http://127.0.0.1:4096"),
      )
    yield* launch({
      directory: input.directory,
      server: Option.some(url),
      standalone: false,
      session: input.session,
      prompt: input.prompt,
      continue: input.continue,
      auto: input.auto,
    })
  }),
)
