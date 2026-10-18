import { Plugin } from "@opencode/plugin/tui"
import { createMemo, Show } from "solid-js"
import { contextUsage } from "../../util/session"
import { useConfig } from "../../config"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

export function SidebarContext(props: { context: Plugin.Context; sessionID: string }) {
  const theme = props.context.theme
  const config = useConfig()
  const msg = createMemo(() => props.context.data.session.message.list(props.sessionID))
  const session = createMemo(() => props.context.data.session.get(props.sessionID))
  const cost = createMemo(() => props.context.data.session.cost(props.sessionID))
  // Session budget (set from the client) wins over the configured default.
  const costLimit = createMemo(() => {
    const budget = (session()?.metadata as { budget?: { maxCost?: number } } | undefined)?.budget
    if (budget?.maxCost !== undefined) return budget.maxCost
    return (config.data as { budget?: { maxCost?: number } } | undefined)?.budget?.maxCost
  })

  const state = createMemo(() =>
    contextUsage(msg(), props.context.data.location.model.list(session()?.location), session()?.revert?.messageID),
  )

  return (
    <Show when={state() || cost() > 0}>
      <box>
        <text fg={theme.text.base}>
          <b>Context</b>
        </text>
        <Show when={state()}>
          {(value) => (
            <>
              <text fg={theme.text.muted}>{value().tokens.toLocaleString()} tokens</text>
              <Show when={value().percent !== undefined}>
                <text fg={theme.text.muted}>{value().percent}% used</text>
              </Show>
            </>
          )}
        </Show>
        <Show when={cost() > 0}>
          <text fg={theme.text.muted}>{money.format(cost())} spent</text>
        </Show>
        <Show when={costLimit()}>
          {(limit) => (
            <>
              <text fg={theme.text.muted}>{money.format(limit())} limit</text>
              <text fg={cost() > limit() ? theme.text.feedback.error.base : theme.text.muted}>
                {money.format(Math.max(0, limit() - cost()))} remaining
              </text>
            </>
          )}
        </Show>
      </box>
    </Show>
  )
}

export default Plugin.define({
  id: "opencode.sidebar.context",
  setup(context) {
    context.ui.slot({
      append: "sidebar.content",
      render: (props) => <SidebarContext context={context} sessionID={props.sessionID} />,
    })
  },
})
