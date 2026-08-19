import type { Argv } from "yargs"
import { Effect, Option } from "effect"
import { cmd } from "./cmd"
import { effectCmd, fail } from "../effect-cmd"
import { Session } from "@/session/session"
import { SessionID } from "../../session/schema"
import { UI } from "../ui"
import { Locale } from "@/util/locale"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"
import { NotFoundError } from "@/storage/storage"
import { EOL } from "os"
import path from "path"
import { which } from "@opencode-ai/core/util/which"
import { Global } from "@opencode-ai/core/global"

function pagerCmd(): string[] {
  const lessOptions = ["-R", "-S"]
  if (process.platform !== "win32") {
    return ["less", ...lessOptions]
  }

  // user could have less installed via other options
  const lessOnPath = which("less")
  if (lessOnPath) {
    if (Filesystem.stat(lessOnPath)?.size) return [lessOnPath, ...lessOptions]
  }

  if (Flag.OPENCODE_GIT_BASH_PATH) {
    const less = path.join(Flag.OPENCODE_GIT_BASH_PATH, "..", "..", "usr", "bin", "less.exe")
    if (Filesystem.stat(less)?.size) return [less, ...lessOptions]
  }

  const git = which("git")
  if (git) {
    const less = path.join(git, "..", "..", "usr", "bin", "less.exe")
    if (Filesystem.stat(less)?.size) return [less, ...lessOptions]
  }

  // Fall back to Windows built-in more (via cmd.exe)
  return ["cmd", "/c", "more"]
}

export const SessionCommand = cmd({
  command: "session",
  describe: "manage sessions",
  builder: (yargs: Argv) =>
    yargs
      .command(SessionListCommand)
      .command(SessionDeleteCommand)
      .command(SessionPsCommand)
      .demandCommand(),
  async handler() {},
})

export const SessionDeleteCommand = effectCmd({
  command: "delete <sessionID>",
  describe: "delete a session",
  builder: (yargs) =>
    yargs.positional("sessionID", {
      describe: "session ID to delete",
      type: "string",
      demandOption: true,
    }),
  handler: Effect.fn("Cli.session.delete")(function* (args) {
    const svc = yield* Session.Service
    const sessionID = SessionID.make(args.sessionID)
    yield* svc
      .remove(sessionID)
      .pipe(Effect.catchIf(NotFoundError.isInstance, () => fail(`Session not found: ${args.sessionID}`)))
    UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Session ${args.sessionID} deleted` + UI.Style.TEXT_NORMAL)
  }),
})

export const SessionListCommand = effectCmd({
  command: "list",
  describe: "list sessions",
  builder: (yargs) =>
    yargs
      .option("max-count", {
        alias: "n",
        describe: "limit to N most recent sessions",
        type: "number",
      })
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["table", "json"],
        default: "table",
      })
      .option("all", {
        alias: "a",
        describe: "list sessions across all projects",
        type: "boolean",
        default: false,
      }),
  handler: Effect.fn("Cli.session.list")(function* (args) {
    const sessions = yield* Session.Service.use((svc) =>
      args.all
        ? svc.listGlobal({ roots: true, limit: args.maxCount })
        : svc.list({ roots: true, limit: args.maxCount }),
    )

    if (sessions.length === 0) return

    const output =
      args.format === "json"
        ? formatSessionJSON(sessions)
        : args.all
          ? formatSessionTableAll(sessions as Session.GlobalInfo[])
          : formatSessionTable(sessions)

    const shouldPaginate = process.stdout.isTTY && !args.maxCount && args.format === "table"

    if (shouldPaginate) {
      yield* Effect.promise(async () => {
        const proc = Process.spawn(pagerCmd(), {
          stdin: "pipe",
          stdout: "inherit",
          stderr: "inherit",
        })

        if (!proc.stdin) {
          console.log(output)
          return
        }

        proc.stdin.write(output)
        proc.stdin.end()
        await proc.exited
      })
    } else {
      console.log(output)
    }
  }),
})

function formatSessionTable(sessions: Session.Info[]): string {
  const lines: string[] = []

  const maxIdWidth = Math.max(20, ...sessions.map((s) => s.id.length))
  const maxTitleWidth = Math.max(25, ...sessions.map((s) => s.title.length))

  const header = `Session ID${" ".repeat(maxIdWidth - 10)}  Title${" ".repeat(maxTitleWidth - 5)}  Updated`
  lines.push(header)
  lines.push("─".repeat(header.length))
  for (const session of sessions) {
    const truncatedTitle = Locale.truncate(session.title, maxTitleWidth)
    const timeStr = Locale.todayTimeOrDateTime(session.time.updated)
    const line = `${session.id.padEnd(maxIdWidth)}  ${truncatedTitle.padEnd(maxTitleWidth)}  ${timeStr}`
    lines.push(line)
  }

  return lines.join(EOL)
}

function formatSessionTableAll(sessions: Session.GlobalInfo[]): string {
  const lines: string[] = []

  const maxIdWidth = Math.max(20, ...sessions.map((s) => s.id.length))
  const maxTitleWidth = Math.max(25, ...sessions.map((s) => s.title.length))
  const maxProjectWidth = Math.max(12, ...sessions.map((s) => s.project?.name ?? s.project?.worktree ?? "?").map((n) => n.length))

  const header = `Session ID${" ".repeat(maxIdWidth - 10)}  Title${" ".repeat(maxTitleWidth - 5)}  Project${" ".repeat(maxProjectWidth - 7)}  Updated`
  lines.push(header)
  lines.push("─".repeat(header.length))
  for (const session of sessions) {
    const truncatedTitle = Locale.truncate(session.title, maxTitleWidth)
    const projectName = session.project?.name ?? session.project?.worktree ?? "?"
    const timeStr = Locale.todayTimeOrDateTime(session.time.updated)
    const line = `${session.id.padEnd(maxIdWidth)}  ${truncatedTitle.padEnd(maxTitleWidth)}  ${projectName.padEnd(maxProjectWidth)}  ${timeStr}`
    lines.push(line)
  }

  return lines.join(EOL)
}

function formatSessionJSON(sessions: Session.Info[]): string {
  const jsonData = sessions.map((session) => ({
    id: session.id,
    title: session.title,
    updated: session.time.updated,
    created: session.time.created,
    projectId: session.projectID,
    directory: session.directory,
  }))
  return JSON.stringify(jsonData, null, 2)
}

export const SessionPsCommand = effectCmd({
  command: "ps",
  describe: "show running opencode processes with CPU usage",
  instance: false,
  builder: (yargs) => yargs,
  handler: Effect.fn("Cli.session.ps")(function* () {
    const procList = yield* Effect.sync(() => {
      try {
        return require("fs").readdirSync("/proc") as string[]
      } catch {
        return undefined as string[] | undefined
      }
    })
    if (!procList) {
      UI.println("Process listing (/proc) not available on this platform")
      return
    }

    const uptimeRaw = yield* Effect.sync(() => {
      try {
        return require("fs").readFileSync("/proc/uptime", "utf8") as string
      } catch {
        return undefined as string | undefined
      }
    })
    if (!uptimeRaw) {
      UI.println("/proc/uptime not available")
      return
    }
    const uptime = parseFloat(uptimeRaw.split(" ")[0])
    const clkTck = 100

    const daemonPath = path.join(Global.Path.state, "server.json")
    let daemonPid: number | undefined
    try {
      const daemonRaw = require("fs").readFileSync(daemonPath, "utf8") as string
      daemonPid = JSON.parse(daemonRaw).pid
    } catch {}

    const pids = procList.filter((name) => /^\d+$/.test(name)).map(Number)

    type ProcInfo = {
      pid: number
      cpuPct: number
      rssKB: number
      state: string
      comm: string
      isDaemon: boolean
    }

    const processes: ProcInfo[] = []
    for (const pid of pids) {
      try {
        const cmdline = (require("fs").readFileSync(`/proc/${pid}/cmdline`, "utf8") as string)
          .replace(/\0/g, " ")
          .trim()
        if (!cmdline.toLowerCase().includes("opencode")) continue

        const stat = require("fs").readFileSync(`/proc/${pid}/stat`, "utf8") as string
        const openParen = stat.indexOf("(")
        const closeParen = stat.lastIndexOf(")")
        const comm = stat.slice(openParen + 1, closeParen)
        const rest = stat.slice(closeParen + 2).split(/\s+/)

        const state = rest[0]
        const utime = Number(rest[11])
        const stime = Number(rest[12])
        const starttime = Number(rest[19])
        const rss = Number(rest[21])

        const totalCpuTicks = utime + stime
        const elapsedSeconds = uptime - starttime / clkTck
        const cpuPct = elapsedSeconds > 0 ? ((totalCpuTicks / clkTck) / elapsedSeconds) * 100 : 0
        const rssKB = rss * 4

        processes.push({ pid, cpuPct, rssKB, state, comm, isDaemon: pid === daemonPid })
      } catch {
        // process may have exited between listing and reading
      }
    }

    if (processes.length === 0) {
      UI.println("No opencode processes found")
      return
    }

    const header = "PID      CPU%     RSS      S  COMMAND"
    const lines: string[] = [header, "─".repeat(header.length)]
    for (const p of processes.sort((a, b) => b.cpuPct - a.cpuPct)) {
      const label = p.isDaemon ? `${p.comm} [daemon]` : p.comm
      const pid = String(p.pid).padEnd(7)
      const cpu = p.cpuPct.toFixed(1).padStart(6)
      const rss =
        p.rssKB >= 1_048_576
          ? `${(p.rssKB / 1_048_576).toFixed(1)}GB`.padStart(7)
          : p.rssKB >= 1024
            ? `${(p.rssKB / 1024).toFixed(0)}MB`.padStart(7)
            : `${p.rssKB}KB`.padStart(7)
      const state = p.state.padEnd(3)
      lines.push(`${pid} ${cpu}% ${rss} ${state} ${label}`)
    }
    console.log(lines.join(EOL))
  }),
})
