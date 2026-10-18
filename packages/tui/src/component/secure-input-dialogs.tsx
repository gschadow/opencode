import { createEffect, createSignal, onCleanup } from "solid-js"
import type { SecureInputRequest } from "@opencode/client"
import { useClient } from "../context/client"
import { useLocation } from "../context/location"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { DialogSecureInput } from "./dialog-secure-input"

export function SecureInputDialogs() {
  const client = useClient()
  const location = useLocation()
  const dialog = useDialog()
  const toast = useToast()
  const [requests, setRequests] = createSignal<SecureInputRequest[]>([])
  let revision = 0
  let generation = 0
  let active: string | undefined
  let closing = false
  const remove = (id: string) => setRequests((requests) => requests.filter((request) => request.id !== id))
  const failed = () => toast.show({ variant: "error", message: "Secure input could not be submitted" })
  const close = () => {
    if (dialog.key !== active) return
    closing = true
    dialog.clear()
    closing = false
  }
  const refresh = () => {
    const attempt = ++generation
    const version = revision
    void client.api.secureInput.request.list({ location: location.ref }).then((result) => {
      if (attempt !== generation) return
      // An event racing hydration must not resurrect a completed request.
      if (version !== revision) return refresh()
      setRequests(result.data)
    }).catch(() => {})
  }
  onCleanup(client.event.on("server.connected", refresh))
  onCleanup(client.event.on("secure.input.asked", (event) => {
    revision++
    if (event.location?.directory !== location.current?.directory) return
    setRequests((requests) => [...requests.filter((request) => request.id !== event.data.id), event.data])
  }))
  for (const type of ["secure.input.replied", "secure.input.rejected"] as const) {
    onCleanup(client.event.on(type, (event) => { revision++; remove(event.data.requestID) }))
  }
  createEffect(() => {
    location.ref
    setRequests([])
    refresh()
  })
  createEffect(() => {
    const next = requests()[0]
    if (active && active !== next?.id) { close(); active = undefined }
    if (!next || active === next.id) return
    active = next.id
    const cancel = () => {
      if (closing) return
      void client.api.secureInput.reject({ sessionID: next.sessionID, requestID: next.id }).catch(failed)
      remove(next.id)
    }
    dialog.replace(() => <DialogSecureInput request={next} onCancel={cancel} onConfirm={(value) => {
      void client.api.secureInput.reply({ sessionID: next.sessionID, requestID: next.id, value }).catch(failed)
      remove(next.id)
    }} />, cancel, { key: next.id })
  })
  onCleanup(() => { generation++; close() })
  return null
}
