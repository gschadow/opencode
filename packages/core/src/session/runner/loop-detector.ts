export * as LoopDetector from "./loop-detector.js"

import { createHash } from "node:crypto"
import type { SessionMessage } from "../message.js"

const DEFAULT_EXEMPT_TOOLS = "(?:^|_)(?:mux_(?:read|wait)|task_(?:status|wait)|browse_wait|poll|wait)$"

/** One bounded history per drain, not a session-wide step ceiling. */
export function create() {
  const exact: string[] = []
  const targets: string[] = []
  return {
    reset() {
      exact.length = 0
      targets.length = 0
    },
    check(messages: readonly SessionMessage.Info[], threshold = 3, exemptPattern = DEFAULT_EXEMPT_TOOLS) {
      const message = messages.findLast((message) => message.type === "assistant" || message.type === "user")
      if (message?.type !== "assistant") return
      const exempt = compile(exemptPattern)
      const calls = message.content.flatMap((part) =>
        part.type === "tool" && part.state.status !== "streaming" && !exempt.test(part.name)
          ? [{ name: part.name, input: part.state.input }]
          : [],
      )
      // Text-only and exempt-only steps break a tool cycle rather than joining unrelated work.
      if (calls.length === 0) {
        exact.length = 0
        targets.length = 0
        return
      }
      const signatures = calls.map((call) => signature(call))
      const counts = new Map<string, number>()
      for (const sig of signatures) {
        const count = (counts.get(sig) ?? 0) + 1
        counts.set(sig, count)
        if (count >= Math.max(10, threshold)) return { cycleLength: 1, repeats: count }
      }
      exact.push(signature(signatures.sort()))
      targets.push(
        signature(
          calls
            .map((call) => {
              // Only relax edit payloads. Different commands, queries, URLs and read offsets are different work.
              if (!/(?:^|_)(?:edit|write)$/.test(call.name) || typeof call.input.filePath !== "string")
                return signature(call)
              return signature({
                name: call.name,
                input: Object.fromEntries(
                  Object.entries(call.input).filter(([key]) => !["oldString", "newString", "content"].includes(key)),
                ),
              })
            })
            .sort(),
        ),
      )
      // Enough for four target-cycle steps at the higher threshold; never grows with elapsed steps.
      const window = Math.max(20, threshold * 5 * 4)
      if (exact.length > window) exact.splice(0, exact.length - window)
      if (targets.length > window) targets.splice(0, targets.length - window)
      return detect(exact, threshold) ?? detect(targets, threshold * 5)
    },
  }
}

// Config cannot carry a regex-validity check through client codegen, so an invalid pattern is handled here.
function compile(pattern: string) {
  try {
    return new RegExp(pattern)
  } catch {
    return new RegExp(DEFAULT_EXEMPT_TOOLS)
  }
}

function detect(sequence: readonly string[], threshold: number) {
  for (let size = 1; size <= Math.floor(sequence.length / threshold); size++) {
    const start = sequence.length - size * threshold
    if (sequence.slice(start).every((sig, index) => sig === sequence[start + (index % size)]))
      return { cycleLength: size, repeats: threshold }
  }
}

function signature(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex")
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, value]) => [key, canonical(value)]),
    )
  return value
}
