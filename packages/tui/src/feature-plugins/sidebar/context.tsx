import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, Show } from "solid-js"

const id = "internal:sidebar-context"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const msg = createMemo(() => props.api.state.session.messages(props.session_id))
  const session = createMemo(() => props.api.state.session.get(props.session_id))
  const cost = createMemo(() => session()?.cost ?? 0)
  const costLimit = createMemo(() => {
    const sessionBudget = (session()?.metadata as Record<string, unknown> | undefined)?.budget as
      | { maxCost?: number }
      | undefined
    if (sessionBudget?.maxCost !== undefined) return sessionBudget.maxCost
    const configBudget = (props.api.state.config as Record<string, unknown>)?.budget as
      | { maxCost?: number }
      | undefined
    return configBudget?.maxCost
  })

  const state = createMemo(() => {
    const last = msg().findLast((item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0)
    if (!last) {
      return {
        tokens: 0,
        percent: null,
      }
    }

    const tokens =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const model = props.api.state.provider.find((item) => item.id === last.providerID)?.models[last.modelID]
    return {
      tokens,
      percent: model?.limit.context ? Math.round((tokens / model.limit.context) * 100) : null,
    }
  })

  const tokenBreakdown = createMemo(() => {
    const s = session()
    if (!s?.tokens) return null
    const t = s.tokens
    const total = t.input + t.output + t.reasoning + t.cache.read + t.cache.write
    if (total <= 0) return null
    const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
    return {
      input: fmt(t.input),
      output: fmt(t.output),
      cacheHit: fmt(t.cache.read),
      cacheWrite: fmt(t.cache.write),
      reasoning: fmt(t.reasoning),
      hasReasoning: t.reasoning > 0,
    }
  })

  return (
    <box>
      <text fg={theme().text}>
        <b>Context</b>
      </text>
      <text fg={theme().textMuted}>{state().tokens.toLocaleString()} tokens</text>
      <text fg={theme().textMuted}>{state().percent ?? 0}% used</text>
      <text fg={theme().textMuted}>{money.format(cost())} spent</text>
      <Show when={costLimit()}>
        {(limit) => (
          <>
            <text fg={theme().textMuted}>{money.format(limit())} limit</text>
            <text fg={cost() > limit() ? theme().error : theme().textMuted}>
              {money.format(Math.max(0, limit() - cost()))} remaining
            </text>
          </>
        )}
      </Show>
      <Show when={tokenBreakdown()}>
        {(tb) => (
          <>
            <text fg={theme().text}>
              <b>Tokens</b>
            </text>
            <text fg={theme().textMuted}>in: {tb().input}  out: {tb().output}</text>
            <text fg={theme().textMuted}>cache hit: {tb().cacheHit}  write: {tb().cacheWrite}</text>
            <Show when={tb().hasReasoning}>
              <text fg={theme().textMuted}>reasoning: {tb().reasoning}</text>
            </Show>
          </>
        )}
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
