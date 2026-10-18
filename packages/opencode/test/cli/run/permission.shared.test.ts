import { describe, expect, test } from "bun:test"
import type { PermissionRequest } from "@opencode-ai/sdk/v2"
import {
  createPermissionBodyState,
  permissionAlwaysLines,
  permissionAlwaysShorten,
  permissionAlwaysWiden,
  permissionCancel,
  permissionEscape,
  permissionInfo,
  permissionReject,
  permissionRun,
  shortenPattern,
} from "@/cli/cmd/run/permission.shared"

function req(input: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    id: "perm-1",
    sessionID: "session-1",
    permission: "read",
    patterns: [],
    metadata: {},
    always: [],
    ...input,
  }
}

describe("run permission shared", () => {
  test("replies immediately for allow once", () => {
    const out = permissionRun(createPermissionBodyState("perm-1"), "perm-1", "once")

    expect(out.reply).toEqual({
      requestID: "perm-1",
      reply: "once",
    })
  })

  test("requires confirmation for allow always", () => {
    const next = permissionRun(createPermissionBodyState("perm-1"), "perm-1", "always")
    expect(next.state.stage).toBe("always")
    expect(next.state.selected).toBe("confirm")
    expect(next.reply).toBeUndefined()

    expect(permissionRun(next.state, "perm-1", "confirm").reply).toEqual({
      requestID: "perm-1",
      reply: "always",
    })

    expect(permissionRun(next.state, "perm-1", "cancel").state).toMatchObject({
      stage: "permission",
      selected: "always",
    })
  })

  test("builds trimmed reject replies and stage transitions", () => {
    const next = permissionRun(createPermissionBodyState("perm-1"), "perm-1", "reject")
    expect(next.state.stage).toBe("reject")

    const out = permissionReject({ ...next.state, message: "  use rg  " }, "perm-1")
    expect(out).toEqual({
      requestID: "perm-1",
      reply: "reject",
      message: "use rg",
    })

    expect(permissionCancel(next.state)).toMatchObject({
      stage: "permission",
      selected: "reject",
    })

    expect(permissionEscape(createPermissionBodyState("perm-1"))).toMatchObject({
      stage: "reject",
      selected: "reject",
    })

    expect(permissionEscape({ ...next.state, stage: "always", selected: "confirm" })).toMatchObject({
      stage: "permission",
      selected: "always",
    })
  })

  test("maps supported permission types into display info", () => {
    expect(
      permissionInfo(
        req({
          permission: "bash",
          metadata: {
            input: {
              command: "git status --short",
            },
          },
        }),
      ),
    ).toMatchObject({
      title: "Shell command",
      lines: ["$ git status --short"],
    })

    expect(
      permissionInfo(
        req({
          permission: "task",
          metadata: {
            description: "investigate stream",
            subagent_type: "general",
          },
        }),
      ),
    ).toMatchObject({
      title: "General Task",
      lines: ["◉ investigate stream"],
    })

    expect(
      permissionInfo(
        req({
          permission: "external_directory",
          patterns: ["/tmp/work/**/*.ts", "/tmp/work/**/*.tsx"],
        }),
      ),
    ).toMatchObject({
      title: "Access external directory /tmp/work",
      lines: ["- /tmp/work/**/*.ts", "- /tmp/work/**/*.tsx"],
    })

    expect(permissionInfo(req({ permission: "doom_loop" }))).toMatchObject({
      title: "Continue after repeated failures",
    })

    expect(permissionInfo(req({ permission: "custom_tool" }))).toMatchObject({
      title: "Call tool custom_tool",
      lines: ["Tool: custom_tool"],
    })
  })

  test("formats always-allow copy for wildcard and explicit patterns", () => {
    expect(permissionAlwaysLines(req({ permission: "bash", always: ["*"] }))).toEqual([
      "This will allow bash until OpenCode is restarted.",
    ])

    expect(permissionAlwaysLines(req({ always: ["src/**/*.ts", "src/**/*.tsx"] }))).toEqual([
      "This will allow the following patterns until OpenCode is restarted.",
      "- src/**/*.ts",
      "- src/**/*.tsx",
    ])
  })

  test("shortenPattern trims one path segment from the right", () => {
    expect(shortenPattern("/tmp/foo/*")).toBe("/tmp/*")
    expect(shortenPattern("/tmp/foo/bar/**")).toBe("/tmp/foo/*")
    expect(shortenPattern("/tmp/*")).toBe("/tmp/*")
    expect(shortenPattern("src/foo/*")).toBe("src/*")
    expect(shortenPattern("*.ts")).toBe("*.ts")
  })

  test("always stage narrows and widens saved patterns with history", () => {
    const entered = permissionRun(createPermissionBodyState("perm-1"), "perm-1", "always", ["/tmp/foo/*"])
    expect(entered.state.stage).toBe("always")
    expect(entered.state.always).toEqual(["/tmp/foo/*"])
    expect(entered.state.history).toEqual([])

    const narrowed = permissionAlwaysShorten(entered.state)
    expect(narrowed.always).toEqual(["/tmp/*"])
    expect(narrowed.history).toEqual([["/tmp/foo/*"]])

    const widened = permissionAlwaysWiden(narrowed)
    expect(widened.always).toEqual(["/tmp/foo/*"])
    expect(widened.history).toEqual([])

    expect(permissionAlwaysShorten(narrowed).always).toEqual(["/tmp/*"])
    const base = createPermissionBodyState("perm-1")
    expect(permissionAlwaysWiden(base)).toBe(base)
  })

  test("confirm carries edited always patterns in the reply", () => {
    const entered = permissionRun(createPermissionBodyState("perm-1"), "perm-1", "always", ["/tmp/foo/*"])
    const narrowed = permissionAlwaysShorten(entered.state)
    expect(permissionRun(narrowed, "perm-1", "confirm").reply).toEqual({
      requestID: "perm-1",
      reply: "always",
      patterns: ["/tmp/*"],
    })

    expect(permissionRun(entered.state, "perm-1", "confirm").reply).toEqual({
      requestID: "perm-1",
      reply: "always",
      patterns: ["/tmp/foo/*"],
    })
  })

  test("permanent always flags the reply for persistence", () => {
    const entered = permissionRun(createPermissionBodyState("perm-1"), "perm-1", "always", ["/tmp/foo/*"])
    const narrowed = permissionAlwaysShorten(entered.state)
    expect(permissionRun(narrowed, "perm-1", "permanent").reply).toEqual({
      requestID: "perm-1",
      reply: "always",
      patterns: ["/tmp/*"],
      persist: true,
    })
  })
})
