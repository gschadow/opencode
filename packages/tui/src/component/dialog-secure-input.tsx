import { useKeyboard, usePaste } from "@opentui/solid"
import { createSignal, onCleanup, onMount } from "solid-js"
import type { SecureInputRequest } from "@opencode/client"
import { useTheme } from "../context/theme"
import { useDialog, DialogHeader, DialogLayout } from "../ui/dialog"

export function DialogSecureInput(props: {
  request: SecureInputRequest
  onConfirm: (value: string) => void
  onCancel: () => void
}) {
  const theme = useTheme().surface("dialog")
  const dialog = useDialog()
  // Never put the value in an editor/renderable, history, clipboard or shared store.
  const [value, setValue] = createSignal("")
  const [settled, setSettled] = createSignal(false)
  const finish = (submit: boolean) => {
    if (settled()) return
    setSettled(true)
    const secret = value()
    setValue("")
    if (submit) props.onConfirm(secret)
    else props.onCancel()
  }
  onMount(() => { dialog.setSize("medium"); dialog.setCentered(true) })
  onCleanup(() => setValue(""))
  usePaste((event) => {
    event.preventDefault()
    if (!settled()) setValue((value) => value + new TextDecoder().decode(event.bytes).replace(/[\x00-\x1f\x7f]/g, ""))
  })
  useKeyboard((event) => {
    event.preventDefault()
    event.stopPropagation()
    if (event.eventType === "release" || settled()) return
    if (event.name === "return") return finish(true)
    if (event.name === "escape" || (event.ctrl && event.name === "c")) return finish(false)
    if (event.name === "backspace" || event.name === "delete") {
      setValue((value) => Array.from(value).slice(0, -1).join(""))
      return
    }
    if (event.ctrl || event.meta || /[\x00-\x1f\x7f]/.test(event.sequence)) return
    setValue((value) => value + event.sequence)
  })
  return <DialogLayout
    header={<DialogHeader title={`Secure input for ${props.request.sessionName}`} onClose={() => finish(false)} />}
    footer={{ actions: { primary: [{ key: "enter", title: "Submit", onTrigger: () => finish(true) }],
      secondary: [{ key: "esc", title: "Cancel", onTrigger: () => finish(false) }] } }}
  >
    <text fg={theme.text.muted}>{props.request.prompt}</text>
    <text fg={theme.text.muted}>{props.request.command ?? ""}</text>
    <box backgroundColor={theme.background.base} minHeight={1}>
      <text fg={theme.text.base}>{"*".repeat(Array.from(value()).length) || " "}</text>
    </box>
  </DialogLayout>
}
