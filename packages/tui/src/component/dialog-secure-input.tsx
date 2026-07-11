import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { createSignal, onCleanup, onMount } from "solid-js"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"

export type SecureInputRequest = {
  id: string
  sessionID: string
  sessionName: string
  prompt: string
  command?: string
}

export function DialogSecureInput(props: {
  request: SecureInputRequest
  onConfirm: (value: string) => void
  onCancel: () => void
}) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const [value, setValue] = createSignal("")

  onMount(() => dialog.setSize("medium"))
  onCleanup(() => setValue(""))

  useKeyboard((event) => {
    if (event.eventType === "release") return
    if (event.name === "return") {
      event.preventDefault()
      event.stopPropagation()
      props.onConfirm(value())
      return
    }
    if (event.name === "escape") {
      event.preventDefault()
      event.stopPropagation()
      props.onCancel()
      return
    }
    if (event.name === "backspace" || event.name === "delete") {
      event.preventDefault()
      event.stopPropagation()
      setValue((current) => Array.from(current).slice(0, -1).join(""))
      return
    }
    if (event.ctrl || event.meta || event.sequence.length === 0 || /[\u0000-\u001f\u007f]/u.test(event.sequence)) return
    event.preventDefault()
    event.stopPropagation()
    setValue((current) => current + event.sequence)
  })

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Secure input for {props.request.sessionName}
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>
      <text fg={theme.textMuted}>{props.request.prompt}</text>
      {props.request.command && (
        <text fg={theme.textMuted}>{props.request.command}</text>
      )}
      <box backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1} minHeight={1}>
        <text fg={theme.text}>{"•".repeat(Array.from(value()).length) || " "}</text>
      </box>
      <box flexDirection="row" gap={2}>
        <text fg={theme.text}>
          enter <span style={{ fg: theme.textMuted }}>submit</span>
        </text>
        <text fg={theme.text}>
          backspace <span style={{ fg: theme.textMuted }}>delete</span>
        </text>
      </box>
    </box>
  )
}
