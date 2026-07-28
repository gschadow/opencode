import { and, asc, desc, eq, gt, gte, ne, or } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { Database } from "../database/database"
import { MessageDecodeError } from "./error"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { SessionContextEpochTable, SessionMessageTable } from "./sql"

type DatabaseService = Database.Interface["db"]

const decode = Schema.decodeUnknownEffect(SessionMessage.Message)

// entriesForRunner/load re-fetch and re-decode the whole session history on every call, and
// the runner calls entriesForRunner once per agent step (every LLM round-trip within a turn),
// not once per user message. Without a cache, that's O(history size) Schema decode work per
// step, i.e. O(history size * step count) total for one turn - the dominant cost observed
// profiling a long session (CPU time in SchemaAST.js/SchemaParser.js scaled with context size).
// Invalidate by comparing the raw stored JSON rather than a timestamp: two writes to the same
// row can land in the same millisecond, so time_updated can't reliably distinguish them, but
// a content compare can't be wrong - decode is a pure function of row.data/id/type.
const MAX_CACHED_MESSAGES = 50_000
const decodedMessageCache = new Map<string, { readonly rawJSON: string; readonly message: SessionMessage.Message }>()

const cacheDecodedMessage = (id: string, rawJSON: string, message: SessionMessage.Message) => {
  decodedMessageCache.delete(id)
  decodedMessageCache.set(id, { rawJSON, message })
  if (decodedMessageCache.size > MAX_CACHED_MESSAGES) {
    const oldest = decodedMessageCache.keys().next().value
    if (oldest !== undefined) decodedMessageCache.delete(oldest)
  }
}

export const latestCompaction = Effect.fnUntraced(function* (db: DatabaseService, sessionID: SessionSchema.ID) {
  return yield* db
    .select({ seq: SessionMessageTable.seq })
    .from(SessionMessageTable)
    .where(and(eq(SessionMessageTable.session_id, sessionID), eq(SessionMessageTable.type, "compaction")))
    .orderBy(desc(SessionMessageTable.seq))
    .limit(1)
    .get()
    .pipe(Effect.orDie)
})

const messageRows = Effect.fnUntraced(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  compaction: { readonly seq: number } | undefined,
  baselineSeq?: number,
) {
  const rows = yield* db
    .select()
    .from(SessionMessageTable)
    .where(
      and(
        eq(SessionMessageTable.session_id, sessionID),
        compaction
          ? or(
              gte(SessionMessageTable.seq, compaction.seq),
              baselineSeq === undefined
                ? undefined
                : and(eq(SessionMessageTable.type, "system"), gt(SessionMessageTable.seq, baselineSeq)),
            )
          : undefined,
        baselineSeq === undefined
          ? undefined
          : or(ne(SessionMessageTable.type, "system"), gt(SessionMessageTable.seq, baselineSeq)),
      ),
    )
    .orderBy(asc(SessionMessageTable.seq))
    .all()
    .pipe(Effect.orDie)
  return rows
})

const decodeMessageRow = (row: typeof SessionMessageTable.$inferSelect) => {
  const rawJSON = JSON.stringify(row.data)
  const cached = decodedMessageCache.get(row.id)
  if (cached && cached.rawJSON === rawJSON) return Effect.succeed(cached.message)
  return decode({ ...row.data, id: row.id, type: row.type }).pipe(
    Effect.tap((message) => Effect.sync(() => cacheDecodedMessage(row.id, rawJSON, message))),
    Effect.mapError(
      () =>
        new MessageDecodeError({
          sessionID: SessionSchema.ID.make(row.session_id),
          messageID: SessionMessage.ID.make(row.id),
        }),
    ),
  )
}

export const load = Effect.fn("SessionHistory.load")(function* (db: DatabaseService, sessionID: SessionSchema.ID) {
  const [epoch, compaction] = yield* Effect.all(
    [
      db
        .select({ baselineSeq: SessionContextEpochTable.baseline_seq })
        .from(SessionContextEpochTable)
        .where(eq(SessionContextEpochTable.session_id, sessionID))
        .get()
        .pipe(Effect.orDie),
      latestCompaction(db, sessionID),
    ],
    { concurrency: "unbounded" },
  )
  return yield* Effect.forEach(yield* messageRows(db, sessionID, compaction, epoch?.baselineSeq), decodeMessageRow)
})

export const loadForRunner = Effect.fn("SessionHistory.loadForRunner")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  baselineSeq: number,
) {
  return (yield* entriesForRunner(db, sessionID, baselineSeq)).map((entry) => entry.message)
})

export const entriesForRunner = Effect.fn("SessionHistory.entriesForRunner")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  baselineSeq: number,
) {
  const rows = yield* messageRows(db, sessionID, yield* latestCompaction(db, sessionID), baselineSeq)
  return yield* Effect.forEach(rows, (row) =>
    decodeMessageRow(row).pipe(Effect.map((message) => ({ seq: row.seq, message }))),
  )
})

export * as SessionHistory from "./history"
