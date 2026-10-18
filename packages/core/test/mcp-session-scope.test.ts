import { describe, expect, test } from "bun:test"
import { scopeMuxSessionArgs } from "@opencode/core/mcp/index"

describe("mux session scoping", () => {
  test("gives the same logical name different scoped names per opencode session", () => {
    const a = scopeMuxSessionArgs("mux", { name: "ad00" }, "ses_aaaaaaa1")
    const b = scopeMuxSessionArgs("mux", { name: "ad00" }, "ses_bbbbbbb2")
    expect(String(a?.name)).toMatch(/^ad00_/)
    expect(String(b?.name)).toMatch(/^ad00_/)
    expect(String(a?.name)).not.toBe(String(b?.name))
  })

  test("is stable for the same session and idempotent when re-scoped", () => {
    const once = scopeMuxSessionArgs("mux", { name: "ad00" }, "ses_aaaaaaa1")!
    const twice = scopeMuxSessionArgs("mux", once, "ses_aaaaaaa1")!
    expect(String(twice.name)).toBe(String(once.name))
  })

  test("preserves other arguments", () => {
    const out = scopeMuxSessionArgs("mux", { name: "psql", command: "psql -h db00" }, "ses_aaaaaaa1")!
    expect(out.command).toBe("psql -h db00")
  })

  test("leaves non-mux servers, missing sessions, and non-session tools untouched", () => {
    const args = { name: "search", query: "x" }
    expect(scopeMuxSessionArgs("tessera", args, "ses_aaaaaaa1")).toBe(args)
    expect(scopeMuxSessionArgs("mux", args, undefined)).toBe(args)
    expect(scopeMuxSessionArgs("mux", { command: "ls" }, "ses_aaaaaaa1")).toEqual({ command: "ls" })
  })
})
