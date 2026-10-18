import { createMemo, createSignal } from "solid-js"
import { useClient } from "../context/client"
import { useData } from "../context/data"
import { useLocation } from "../context/location"
import { useRoute } from "../context/route"
import { useTheme } from "../context/theme"
import { DialogErrorDetails } from "./dialog-error-details"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { errorMessage } from "../util/error"

type ToolInfo = { name: string; description: string; inputSchema: unknown }

function resultText(output: unknown): string {
  if (output === undefined || output === null) return "(no output)"
  if (typeof output === "string") return output
  try {
    return JSON.stringify(output, null, 2)
  } catch {
    return String(output)
  }
}

/**
 * User-initiated tool invocation: pick a registered tool, supply JSON arguments, and run it
 * without going through the model. Backed by the `opencode.tool` RPC (see core `tool/invoke.ts`),
 * which this checkout exposes over the RPC route because the HttpApi surface is at its type
 * complexity ceiling.
 */
export function DialogTool() {
  const dialog = useDialog()
  const client = useClient()
  const data = useData()
  const location = useLocation()
  const theme = useTheme().surface("dialog")
  const toast = useToast()
  const current = () => location.ref ?? data.location.default()
  const [tools, setTools] = createSignal<ReadonlyArray<ToolInfo>>([])
  const [ready, setReady] = createSignal(false)

  void client.api.rpc
    .call({ rpcID: "opencode.tool", method: "list", input: {}, location: { directory: current().directory } })
    .then((response) => {
      const output = response.output
      setTools(Array.isArray(output) ? (output as ToolInfo[]) : [])
    })
    .catch((error) =>
      toast.show({ message: `Failed to list tools: ${errorMessage(error)}`, variant: "error", duration: 5000 }),
    )
    .finally(() => setReady(true))

  const options = createMemo(() =>
    tools().map((tool) => ({
      value: tool.name,
      title: tool.name,
      footer: tool.description,
      footerColor: theme.text.muted,
    })),
  )

  return (
    <DialogSelect
      title="Tools"
      searchInTitle
      titlePlaceholder="Search tools"
      options={options()}
      emptyView={ready() ? <text fg={theme.text.muted}>No tools available</text> : undefined}
      onSelect={(option) => {
        const tool = tools().find((entry) => entry.name === option.value)
        if (tool) dialog.replace(() => <DialogToolArgs tool={tool} />)
      }}
    />
  )
}

function DialogToolArgs(props: { tool: ToolInfo }) {
  const dialog = useDialog()
  const client = useClient()
  const data = useData()
  const location = useLocation()
  const route = useRoute()
  const toast = useToast()
  const [busy, setBusy] = createSignal(false)
  const current = () => location.ref ?? data.location.default()

  const run = (value: string) => {
    const sessionID = route.data.type === "session" ? route.data.sessionID : undefined
    if (!sessionID) {
      toast.show({ message: "Open a session to invoke a tool", variant: "error", duration: 5000 })
      return
    }
    let parsed: unknown
    try {
      parsed = value.trim() ? JSON.parse(value) : {}
    } catch (error) {
      toast.show({ message: `Invalid JSON: ${errorMessage(error)}`, variant: "error", duration: 5000 })
      return
    }
    setBusy(true)
    void client.api.rpc
      .call({
        rpcID: "opencode.tool",
        method: "invoke",
        input: { sessionID, name: props.tool.name, input: parsed as never },
        location: { directory: current().directory },
      })
      .then((response) => {
        dialog.replace(() => <DialogToolResult title={`${props.tool.name} result`} text={resultText(response.output)} />)
      })
      .catch((error) => {
        toast.show({ message: `${props.tool.name}: ${errorMessage(error)}`, variant: "error", duration: 8000 })
        setBusy(false)
      })
  }

  return (
    <DialogPrompt
      title={`Invoke ${props.tool.name}`}
      subtitle={props.tool.description}
      placeholder="{}"
      value="{}"
      busy={busy()}
      busyText="Running…"
      onConfirm={run}
      onCancel={() => dialog.replace(() => <DialogTool />)}
    />
  )
}

function DialogToolResult(props: { title: string; text: string }) {
  const dialog = useDialog()
  return (
    <DialogErrorDetails title={props.title} error={props.text} onBack={() => dialog.replace(() => <DialogTool />)} />
  )
}
