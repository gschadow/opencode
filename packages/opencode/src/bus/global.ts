import { EventEmitter } from "events"
import { Identifier } from "@/id/id"

export type GlobalEvent = {
  directory?: string
  project?: string
  workspace?: string
  payload: any
}

class GlobalBusEmitter extends EventEmitter<{
  event: [GlobalEvent]
}> {
  override emit(eventName: string | symbol, ...args: any[]): boolean {
    if (eventName === "event") {
      const event = args[0] as GlobalEvent
      if (event?.payload && typeof event.payload === "object" && !("id" in event.payload)) {
        event.payload.id = event.payload.syncEvent?.id ?? Identifier.create("evt", "ascending")
      }
    }
    return super.emit(eventName, ...args)
  }
}

export const GlobalBus = new GlobalBusEmitter()

// This deployment routinely has a dozen+ concurrent SSE subscribers (attach
// TUIs, Telegram bot, voice daemon, subagents), each registering one GlobalBus
// "event" listener. The default max (10) fires spurious MaxListenersExceeded
// warnings. Memory is bounded per connection by the sliding queues in the SSE
// handlers (global.ts / event.ts), so a high listener cap is safe here.
GlobalBus.setMaxListeners(100)
