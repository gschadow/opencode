import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import type { GlobalEvent } from "@opencode-ai/sdk/v2"
import { Flag } from "@opencode-ai/core/flag/flag"
import { createSimpleContext } from "./helper"
import { batch, createSignal, onCleanup, onMount } from "solid-js"

export type EventSource = {
  subscribe: (handler: (event: GlobalEvent) => void) => Promise<() => void>
}

export const { use: useSDK, provider: SDKProvider } = createSimpleContext({
  name: "SDK",
  init: (props: {
    url: string
    directory?: string
    fetch?: typeof fetch
    headers?: RequestInit["headers"]
    events?: EventSource
  }) => {
    const abort = new AbortController()
    let sse: AbortController | undefined
    const [connected, setConnected] = createSignal(false)
    // The server emits a `server.heartbeat` event every 10s on the global SSE
    // stream (global.ts eventResponse). Any event refreshing lastEventAt —
    // including that heartbeat when idle — proves the backend is alive. Absence
    // of events beyond this window means the connection is stale (server died,
    // network partition, hung socket) even if the TCP socket has not closed, so
    // we force a reconnect instead of trusting an open-but-silent stream.
    const HEARTBEAT_TIMEOUT_MS = 30_000
    let lastEventAt = Date.now()
    let stalenessTimer: Timer | undefined

    function createSDK() {
      return createOpencodeClient({
        baseUrl: props.url,
        signal: abort.signal,
        directory: props.directory,
        fetch: props.fetch,
        headers: props.headers,
      })
    }

    let sdk = createSDK()

    const handlers = new Set<(event: GlobalEvent) => void>()
    const emitter = {
      emit(_type: "event", event: GlobalEvent) {
        for (const handler of handlers) handler(event)
      },
      on(_type: "event", handler: (event: GlobalEvent) => void) {
        handlers.add(handler)
        return () => {
          handlers.delete(handler)
        }
      },
    }

    let queue: GlobalEvent[] = []
    let timer: Timer | undefined
    let last = 0
    const retryDelay = 1000
    const maxRetryDelay = 30000

    const flush = () => {
      if (queue.length === 0) return
      const events = queue
      queue = []
      timer = undefined
      last = Date.now()
      // Batch all event emissions so all store updates result in a single render
      batch(() => {
        for (const event of events) {
          emitter.emit("event", event)
        }
      })
    }

    const handleEvent = (event: GlobalEvent) => {
      lastEventAt = Date.now()
      setConnected(true)
      queue.push(event)
      const elapsed = Date.now() - last

      if (timer) return
      // If we just flushed recently (within 16ms), batch this with future events
      // Otherwise, process immediately to avoid latency
      if (elapsed < 16) {
        timer = setTimeout(flush, 16)
        return
      }
      flush()
    }

    function startSSE() {
      sse?.abort()
      stalenessTimer = setInterval(() => {
        if (abort.signal.aborted) return
        if (Date.now() - lastEventAt > HEARTBEAT_TIMEOUT_MS) {
          // No events (not even server.heartbeat) for too long: the backend is
          // unresponsive even if the socket looks open. Mark disconnected and
          // force the current stream to fail so the loop reconnects below.
          setConnected(false)
          sse?.abort()
        }
      }, 5000)
      ;(async () => {
        let attempt = 0
        while (true) {
          if (abort.signal.aborted) break
          const ctrl = new AbortController()
          sse = ctrl
          try {
            const events = await sdk.global.event({
              signal: ctrl.signal,
              sseMaxRetryAttempts: 0,
            })

            if (Flag.OPENCODE_EXPERIMENTAL_WORKSPACES) {
              // Start syncing workspaces, it's important to do this after
              // we've started listening to events
              await sdk.sync.start().catch(() => {})
            }

            setConnected(true)
            for await (const event of events.stream) {
              if (ctrl.signal.aborted) break
              handleEvent(event)
            }
          } catch {
            // Connection failed (server restarting, network blip) — will retry
          }
          setConnected(false)

          if (timer) clearTimeout(timer)
          if (queue.length > 0) flush()
          attempt += 1
          if (abort.signal.aborted) break

          // Exponential backoff
          const backoff = Math.min(retryDelay * 2 ** (attempt - 1), maxRetryDelay)
          await new Promise((resolve) => setTimeout(resolve, backoff))
        }
      })().catch(() => {})
    }

    onMount(async () => {
      if (props.events) {
        const unsub = await props.events.subscribe(handleEvent)
        onCleanup(unsub)
        setConnected(true)

        if (Flag.OPENCODE_EXPERIMENTAL_WORKSPACES) {
          // Start syncing workspaces, it's important to do this after
          // we've started listening to events
          await sdk.sync.start().catch(() => {})
        }
      } else {
        startSSE()
      }
    })

    onCleanup(() => {
      abort.abort()
      sse?.abort()
      if (stalenessTimer) clearInterval(stalenessTimer)
      if (timer) clearTimeout(timer)
      handlers.clear()
    })

    return {
      get client() {
        return sdk
      },
      directory: props.directory,
      event: emitter,
      fetch: props.fetch ?? fetch,
      connected,
      url: props.url,
      request(path: string, init?: RequestInit) {
        const headers = new Headers(props.headers)
        new Headers(init?.headers).forEach((value, key) => headers.set(key, value))
        return (props.fetch ?? fetch)(new URL(path, props.url), { ...init, headers, signal: abort.signal })
      },
    }
  },
})
