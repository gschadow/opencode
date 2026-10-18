import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { launch } from "./launch"
import { Env } from "../../env"
import { Option } from "effect"
import fs from "node:fs"

// `opencode attach [url]` connects the TUI to an already-running server, exactly
// like the root command with `--server <url>`: it pings the endpoint, warns on a
// version mismatch, and never spawns or replaces a background service. With no
// URL it attaches to the local managed service (from service-local.json, else
// 127.0.0.1:4096) using the password stored in server.env.
export default Runtime.handler(Commands.commands.attach, (input) =>
  launch({
    directory: input.directory,
    server: Option.some(Option.getOrUndefined(input.url) ?? localServer()),
    standalone: false,
    session: input.session,
    prompt: input.prompt,
    continue: input.continue,
    auto: input.auto,
  }),
)

function localServer() {
  try {
    const config = JSON.parse(fs.readFileSync(Env.configDir("service-local.json"), "utf8")) as {
      hostname?: string
      port?: number
    }
    return `http://${config.hostname ?? "127.0.0.1"}:${config.port ?? 4096}`
  } catch {
    return "http://127.0.0.1:4096"
  }
}
