import { Config, Effect, Redacted } from "effect"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

// Every environment variable the CLI reads, in one place. Consumers yield
// these instead of touching process.env so the full surface stays visible,
// typed, and redacted where secret.

// The opencode server password: sent by clients connecting to an explicit
// --server, and adopted by a manually run or standalone server. The legacy
// name is still honored. A local server writes its password to
// ~/.config/opencode/server.env (see `opencode serve --service`), so a client
// on the same machine reads it automatically instead of requiring the user to
// export anything for intra-localhost connections.
export const password: Effect.Effect<Redacted.Redacted | undefined> = Effect.gen(function* () {
  const configured = yield* Config.Redacted("OPENCODE_PASSWORD").pipe(
    Config.orElse(() => Config.Redacted("OPENCODE_SERVER_PASSWORD")),
    Config.withDefault(undefined),
  )
  if (configured !== undefined) return configured
  const stored = storedPassword()
  return stored === undefined ? undefined : Redacted.make(stored)
}).pipe(Effect.orDie)

function storedPassword() {
  const file = configDir("server.env")
  try {
    for (const line of fs.readFileSync(file, "utf8").split("\n"))
      for (const name of ["OPENCODE_PASSWORD", "OPENCODE_SERVER_PASSWORD"])
        if (line.startsWith(`${name}=`)) return line.slice(name.length + 1).trim()
  } catch {}
  return undefined
}

export function configDir(file: string) {
  return process.env.OPENCODE_CONFIG_DIR
    ? path.join(process.env.OPENCODE_CONFIG_DIR, file)
    : path.join(os.homedir(), ".config", "opencode", file)
}

export function session() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && entry[0] !== "OPENCODE_PASSWORD" && entry[0] !== "OPENCODE_SERVER_PASSWORD",
    ),
  )
}

export * as Env from "./env"
