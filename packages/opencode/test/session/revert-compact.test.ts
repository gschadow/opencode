import { describe, expect } from "bun:test"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import fs from "fs/promises"
import path from "path"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Effect } from "effect"
import { Session } from "@/session/session"

import { SessionRevert } from "../../src/session/revert"
import { MessageV2 } from "../../src/session/message-v2"
import { Snapshot } from "../../src/snapshot"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([Session.node, SessionRevert.node, Snapshot.node, SessionProjector.node, CrossSpawnSpawner.node]),
  ),
)

const user = Effect.fn("test.user")(function* (sessionID: SessionID, agent = "default") {
  const session = yield* Session.Service
  return yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user" as const,
    sessionID,
    agent,
    model: { providerID: ProviderV2.ID.make("openai"), modelID: ModelV2.ID.make("gpt-4") },
    time: { created: Date.now() },
  })
})

const userAt = Effect.fn("test.userAt")(function* (sessionID: SessionID, id: string, created: number) {
  const session = yield* Session.Service
  return yield* session.updateMessage({
    id: MessageID.make(id),
    role: "user" as const,
    sessionID,
    agent: "default",
    model: { providerID: ProviderV2.ID.make("openai"), modelID: ModelV2.ID.make("gpt-4") },
    time: { created },
  })
})

const assistantAt = Effect.fn("test.assistantAt")(function* (
  sessionID: SessionID,
  id: string,
  created: number,
  parentID: MessageID,
) {
  const session = yield* Session.Service
  return yield* session.updateMessage({
    id: MessageID.make(id),
    role: "assistant" as const,
    sessionID,
    mode: "default",
    agent: "default",
    path: { cwd: "", root: "" },
    cost: 0,
    tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ModelV2.ID.make("gpt-4"),
    providerID: ProviderV2.ID.make("openai"),
    parentID,
    time: { created },
    finish: "end_turn",
  })
})

const assistant = Effect.fn("test.assistant")(function* (sessionID: SessionID, parentID: MessageID, dir: string) {
  const session = yield* Session.Service
  return yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "assistant" as const,
    sessionID,
    mode: "default",
    agent: "default",
    path: { cwd: dir, root: dir },
    cost: 0,
    tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ModelV2.ID.make("gpt-4"),
    providerID: ProviderV2.ID.make("openai"),
    parentID,
    time: { created: Date.now() },
    finish: "end_turn",
  })
})

const text = Effect.fn("test.text")(function* (sessionID: SessionID, messageID: MessageID, content: string) {
  const session = yield* Session.Service
  return yield* session.updatePart({
    id: PartID.ascending(),
    messageID,
    sessionID,
    type: "text" as const,
    text: content,
  })
})

const tool = Effect.fn("test.tool")(function* (sessionID: SessionID, messageID: MessageID) {
  const session = yield* Session.Service
  return yield* session.updatePart({
    id: PartID.ascending(),
    messageID,
    sessionID,
    type: "tool" as const,
    tool: "bash",
    callID: "call-1",
    state: {
      status: "completed" as const,
      input: {},
      output: "done",
      title: "",
      metadata: {},
      time: { start: 0, end: 1 },
    },
  })
})

const read = (file: string) => Effect.promise(() => fs.readFile(file, "utf-8"))
const write = (file: string, text: string) => Effect.promise(() => fs.writeFile(file, text))

const tokens = {
  input: 0,
  output: 0,
  reasoning: 0,
  cache: { read: 0, write: 0 },
}

describe("revert + compact workflow", () => {
  it.live(
    "should properly handle compact command after revert",
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const session = yield* Session.Service
          const revert = yield* SessionRevert.Service

          const info = yield* session.create({})
          const sessionID = info.id

          const userMsg1 = yield* session.updateMessage({
            id: MessageID.ascending(),
            role: "user",
            sessionID,
            agent: "default",
            model: {
              providerID: ProviderV2.ID.make("openai"),
              modelID: ModelV2.ID.make("gpt-4"),
            },
            time: {
              created: Date.now(),
            },
          })

          yield* session.updatePart({
            id: PartID.ascending(),
            messageID: userMsg1.id,
            sessionID,
            type: "text",
            text: "Hello, please help me",
          })

          const assistantMsg1: SessionV1.Assistant = {
            id: MessageID.ascending(),
            role: "assistant",
            sessionID,
            mode: "default",
            agent: "default",
            path: {
              cwd: dir,
              root: dir,
            },
            cost: 0,
            tokens: {
              output: 0,
              input: 0,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
            modelID: ModelV2.ID.make("gpt-4"),
            providerID: ProviderV2.ID.make("openai"),
            parentID: userMsg1.id,
            time: {
              created: Date.now(),
            },
            finish: "end_turn",
          }
          yield* session.updateMessage(assistantMsg1)

          yield* session.updatePart({
            id: PartID.ascending(),
            messageID: assistantMsg1.id,
            sessionID,
            type: "text",
            text: "Sure, I'll help you!",
          })

          const userMsg2 = yield* session.updateMessage({
            id: MessageID.ascending(),
            role: "user",
            sessionID,
            agent: "default",
            model: {
              providerID: ProviderV2.ID.make("openai"),
              modelID: ModelV2.ID.make("gpt-4"),
            },
            time: {
              created: Date.now(),
            },
          })

          yield* session.updatePart({
            id: PartID.ascending(),
            messageID: userMsg2.id,
            sessionID,
            type: "text",
            text: "What's the capital of France?",
          })

          const assistantMsg2: SessionV1.Assistant = {
            id: MessageID.ascending(),
            role: "assistant",
            sessionID,
            mode: "default",
            agent: "default",
            path: {
              cwd: dir,
              root: dir,
            },
            cost: 0,
            tokens: {
              output: 0,
              input: 0,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
            modelID: ModelV2.ID.make("gpt-4"),
            providerID: ProviderV2.ID.make("openai"),
            parentID: userMsg2.id,
            time: {
              created: Date.now(),
            },
            finish: "end_turn",
          }
          yield* session.updateMessage(assistantMsg2)

          yield* session.updatePart({
            id: PartID.ascending(),
            messageID: assistantMsg2.id,
            sessionID,
            type: "text",
            text: "The capital of France is Paris.",
          })

          let messages = yield* session.messages({ sessionID })
          expect(messages.length).toBe(4)
          const messageIds = messages.map((m) => m.info.id)
          expect(messageIds).toContain(userMsg1.id)
          expect(messageIds).toContain(userMsg2.id)
          expect(messageIds).toContain(assistantMsg1.id)
          expect(messageIds).toContain(assistantMsg2.id)

          yield* revert.revert({
            sessionID,
            messageID: userMsg2.id,
          })

          let sessionInfo = yield* session.get(sessionID)
          expect(sessionInfo.revert).toBeDefined()
          expect(sessionInfo.revert?.messageID).toBeDefined()

          messages = yield* session.messages({ sessionID })
          expect(messages.length).toBe(4)

          yield* revert.cleanup(sessionInfo)

          // Non-destructive cleanup: all messages survive a staged revert, so no
          // conversation history is ever lost after a restart.
          messages = yield* session.messages({ sessionID })
          const remainingIds = messages.map((m) => m.info.id)
          expect(messages.length).toBe(4)
          expect(remainingIds).toContain(userMsg2.id)
          expect(remainingIds).toContain(assistantMsg2.id)

          // The revert marker is preserved (only unrevert/redo clears it).
          sessionInfo = yield* session.get(sessionID)
          expect(sessionInfo.revert).toBeDefined()

          yield* session.remove(sessionID)
        }),
      { git: true },
    ),
  )

  it.live(
    "should properly clean up revert state before creating compaction message",
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const session = yield* Session.Service
          const revert = yield* SessionRevert.Service

          const info = yield* session.create({})
          const sessionID = info.id

          const userMsg = yield* session.updateMessage({
            id: MessageID.ascending(),
            role: "user",
            sessionID,
            agent: "default",
            model: {
              providerID: ProviderV2.ID.make("openai"),
              modelID: ModelV2.ID.make("gpt-4"),
            },
            time: {
              created: Date.now(),
            },
          })

          yield* session.updatePart({
            id: PartID.ascending(),
            messageID: userMsg.id,
            sessionID,
            type: "text",
            text: "Hello",
          })

          const assistantMsg: SessionV1.Assistant = {
            id: MessageID.ascending(),
            role: "assistant",
            sessionID,
            mode: "default",
            agent: "default",
            path: {
              cwd: dir,
              root: dir,
            },
            cost: 0,
            tokens: {
              output: 0,
              input: 0,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
            modelID: ModelV2.ID.make("gpt-4"),
            providerID: ProviderV2.ID.make("openai"),
            parentID: userMsg.id,
            time: {
              created: Date.now(),
            },
            finish: "end_turn",
          }
          yield* session.updateMessage(assistantMsg)

          yield* session.updatePart({
            id: PartID.ascending(),
            messageID: assistantMsg.id,
            sessionID,
            type: "text",
            text: "Hi there!",
          })

          yield* revert.revert({
            sessionID,
            messageID: userMsg.id,
          })

          let sessionInfo = yield* session.get(sessionID)
          expect(sessionInfo.revert).toBeDefined()

          // A staged revert must never delete messages, even when cleanup runs on
          // the next prompt after a client restart. This is the regression that
          // wiped a whole conversation's history.
          yield* revert.cleanup(sessionInfo)

          const messages = yield* session.messages({ sessionID })
          expect(messages.length).toBe(2)

          yield* session.remove(sessionID)
        }),
      { git: true },
    ),
  )

  it.live(
    "cleanup with partID leaves parts and the revert marker intact",
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const session = yield* Session.Service
          const revert = yield* SessionRevert.Service

          const info = yield* session.create({})
          const sid = info.id

          const u1 = yield* user(sid)
          const p1 = yield* text(sid, u1.id, "first part")
          const p2 = yield* tool(sid, u1.id)
          yield* text(sid, u1.id, "third part")

          yield* session.setRevert({
            sessionID: sid,
            revert: { messageID: u1.id, partID: p2.id, time: Date.now() },
            summary: { additions: 0, deletions: 0, files: 0 },
          })

          const state = yield* session.get(sid)
          yield* revert.cleanup(state)

          const msgs = yield* session.messages({ sessionID: sid })
          expect(msgs.length).toBe(1)
          expect(msgs[0].parts.length).toBe(3)

          const after = yield* session.get(sid)
          expect(after.revert).toBeDefined()
        }),
      { git: true },
    ),
  )

  it.live(
    "cleanup leaves messages after the revert point intact",
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const session = yield* Session.Service
          const revert = yield* SessionRevert.Service

          const info = yield* session.create({})
          const sid = info.id

          const u1 = yield* user(sid)
          yield* text(sid, u1.id, "hello")
          const a1 = yield* assistant(sid, u1.id, dir)
          yield* text(sid, a1.id, "hi back")

          const u2 = yield* user(sid)
          yield* text(sid, u2.id, "second question")
          const a2 = yield* assistant(sid, u2.id, dir)
          yield* text(sid, a2.id, "second answer")

          yield* session.setRevert({
            sessionID: sid,
            revert: { messageID: u2.id, time: Date.now() },
            summary: { additions: 0, deletions: 0, files: 0 },
          })

          const state = yield* session.get(sid)
          yield* revert.cleanup(state)

          const msgs = yield* session.messages({ sessionID: sid })
          const ids = msgs.map((m) => m.info.id)
          expect(ids).toContain(u1.id)
          expect(ids).toContain(a1.id)
          expect(ids).toContain(u2.id)
          expect(ids).toContain(a2.id)
        }),
      { git: true },
    ),
  )

  it.live(
    "filterRevert trims the model view at the revert boundary without deleting",
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const session = yield* Session.Service

          const info = yield* session.create({})
          const sid = info.id

          const u1 = yield* userAt(sid, "msg_m1", 1)
          yield* text(sid, u1.id, "first")
          const a1 = yield* assistantAt(sid, "msg_m2", 2, u1.id)
          yield* text(sid, a1.id, "answer 1")

          const u2 = yield* userAt(sid, "msg_m3", 3)
          yield* text(sid, u2.id, "second")
          const a2 = yield* assistantAt(sid, "msg_m4", 4, u2.id)
          yield* text(sid, a2.id, "answer 2")

          const stagedAt = 100

          yield* session.setRevert({
            sessionID: sid,
            revert: { messageID: u2.id, time: stagedAt },
            summary: { additions: 0, deletions: 0, files: 0 },
          })

          // Everything at/before the boundary plus the continuation is kept in the
          // model view; the undone message pair (u2/a2) is dropped only from the view.
          const msgs = yield* session.messages({ sessionID: sid })
          const view = MessageV2.filterRevert(msgs, (yield* session.get(sid)).revert ?? undefined)
          const ids = view.map((m) => m.info.id)
          expect(ids).toContain(u1.id)
          expect(ids).toContain(a1.id)
          expect([...ids].includes(u2.id)).toBe(false)
          expect([...ids].includes(a2.id)).toBe(false)

          // Durable rows are untouched, so Redo/unrevert can restore them.
          const stored = yield* session.messages({ sessionID: sid })
          expect(stored.length).toBe(4)
        }),
      { git: true },
    ),
  )

  it.live(
    "cleanup is a no-op when session has no revert state",
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const session = yield* Session.Service
          const revert = yield* SessionRevert.Service

          const info = yield* session.create({})
          const sid = info.id

          const u1 = yield* user(sid)
          yield* text(sid, u1.id, "hello")

          const state = yield* session.get(sid)
          expect(state.revert).toBeUndefined()
          yield* revert.cleanup(state)

          const msgs = yield* session.messages({ sessionID: sid })
          expect(msgs.length).toBe(1)
        }),
      { git: true },
    ),
  )

  it.live(
    "restore messages in sequential order",
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const session = yield* Session.Service
          const revert = yield* SessionRevert.Service
          const snapshot = yield* Snapshot.Service

          yield* write(path.join(dir, "a.txt"), "a0")
          yield* write(path.join(dir, "b.txt"), "b0")
          yield* write(path.join(dir, "c.txt"), "c0")

          const info = yield* session.create({})
          const sid = info.id

          const turn = Effect.fn("test.turn")(function* (file: string, next: string) {
            const u = yield* user(sid)
            yield* text(sid, u.id, `${file}:${next}`)
            const a = yield* assistant(sid, u.id, dir)
            const before = yield* snapshot.track()
            if (!before) throw new Error("expected snapshot")
            yield* write(path.join(dir, file), next)
            const after = yield* snapshot.track()
            if (!after) throw new Error("expected snapshot")
            const patch = yield* snapshot.patch(before)
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: a.id,
              sessionID: sid,
              type: "step-start",
              snapshot: before,
            })
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: a.id,
              sessionID: sid,
              type: "step-finish",
              reason: "stop",
              snapshot: after,
              cost: 0,
              tokens,
            })
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: a.id,
              sessionID: sid,
              type: "patch",
              hash: patch.hash,
              files: patch.files,
            })
            return u.id
          })

          const first = yield* turn("a.txt", "a1")
          const second = yield* turn("b.txt", "b2")
          const third = yield* turn("c.txt", "c3")

          yield* revert.revert({
            sessionID: sid,
            messageID: first,
          })
          expect((yield* session.get(sid)).revert?.messageID).toBe(first)
          expect(yield* read(path.join(dir, "a.txt"))).toBe("a0")
          expect(yield* read(path.join(dir, "b.txt"))).toBe("b0")
          expect(yield* read(path.join(dir, "c.txt"))).toBe("c0")

          yield* revert.revert({
            sessionID: sid,
            messageID: second,
          })
          expect((yield* session.get(sid)).revert?.messageID).toBe(second)
          expect(yield* read(path.join(dir, "a.txt"))).toBe("a1")
          expect(yield* read(path.join(dir, "b.txt"))).toBe("b0")
          expect(yield* read(path.join(dir, "c.txt"))).toBe("c0")

          yield* revert.revert({
            sessionID: sid,
            messageID: third,
          })
          expect((yield* session.get(sid)).revert?.messageID).toBe(third)
          expect(yield* read(path.join(dir, "a.txt"))).toBe("a1")
          expect(yield* read(path.join(dir, "b.txt"))).toBe("b2")
          expect(yield* read(path.join(dir, "c.txt"))).toBe("c0")

          yield* revert.unrevert({
            sessionID: sid,
          })
          expect((yield* session.get(sid)).revert).toBeUndefined()
          expect(yield* read(path.join(dir, "a.txt"))).toBe("a1")
          expect(yield* read(path.join(dir, "b.txt"))).toBe("b2")
          expect(yield* read(path.join(dir, "c.txt"))).toBe("c3")
        }),
      { git: true },
    ),
  )

  it.live(
    "restore same file in sequential order",
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const session = yield* Session.Service
          const revert = yield* SessionRevert.Service
          const snapshot = yield* Snapshot.Service

          yield* write(path.join(dir, "a.txt"), "a0")

          const info = yield* session.create({})
          const sid = info.id

          const turn = Effect.fn("test.turnSame")(function* (next: string) {
            const u = yield* user(sid)
            yield* text(sid, u.id, `a.txt:${next}`)
            const a = yield* assistant(sid, u.id, dir)
            const before = yield* snapshot.track()
            if (!before) throw new Error("expected snapshot")
            yield* write(path.join(dir, "a.txt"), next)
            const after = yield* snapshot.track()
            if (!after) throw new Error("expected snapshot")
            const patch = yield* snapshot.patch(before)
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: a.id,
              sessionID: sid,
              type: "step-start",
              snapshot: before,
            })
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: a.id,
              sessionID: sid,
              type: "step-finish",
              reason: "stop",
              snapshot: after,
              cost: 0,
              tokens,
            })
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: a.id,
              sessionID: sid,
              type: "patch",
              hash: patch.hash,
              files: patch.files,
            })
            return u.id
          })

          const first = yield* turn("a1")
          const second = yield* turn("a2")
          const third = yield* turn("a3")
          expect(yield* read(path.join(dir, "a.txt"))).toBe("a3")

          yield* revert.revert({
            sessionID: sid,
            messageID: first,
          })
          expect((yield* session.get(sid)).revert?.messageID).toBe(first)
          expect(yield* read(path.join(dir, "a.txt"))).toBe("a0")

          yield* revert.revert({
            sessionID: sid,
            messageID: second,
          })
          expect((yield* session.get(sid)).revert?.messageID).toBe(second)
          expect(yield* read(path.join(dir, "a.txt"))).toBe("a1")

          yield* revert.revert({
            sessionID: sid,
            messageID: third,
          })
          expect((yield* session.get(sid)).revert?.messageID).toBe(third)
          expect(yield* read(path.join(dir, "a.txt"))).toBe("a2")

          yield* revert.unrevert({
            sessionID: sid,
          })
          expect((yield* session.get(sid)).revert).toBeUndefined()
          expect(yield* read(path.join(dir, "a.txt"))).toBe("a3")
        }),
      { git: true },
    ),
  )
})
