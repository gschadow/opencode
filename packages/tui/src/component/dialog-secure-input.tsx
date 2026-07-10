import { TextareaRenderable } from "@opentui/core"
import { useTheme } from "../context/theme"
import { Show, createSignal, onMount } from "solid-js"
import { useBindings } from "../keymap"
import { useTuiConfig } from "../config"

export type SecureInputRequest = {
  id: string
  sessionID: string
  sessionName: string
  prompt: string
}

function apiPost(url: string, body?: Record<string, unknown>) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => {})
}

export function SecureInputPrompt(props: { request: SecureInputRequest }) {
  const { theme } = useTheme()
  const tuiConfig = useTuiConfig()
  const [textareaTarget, setTextareaTarget] = createSignal<TextareaRenderable>()
  let textarea: TextareaRenderable

  function submit() {
    const value = textarea?.plainText ?? ""
    void apiPost(`/api/session/${props.request.sessionID}/secure-input/${props.request.id}/reply`, { value })
  }

  function reject() {
    void apiPost(`/api/session/${props.request.sessionID}/secure-input/${props.request.id}/reject`)
  }

  useBindings(() => ({
    target: textareaTarget,
    enabled: textareaTarget() !== undefined,
    priority: 1,
    commands: [
      {
        name: "dialog.prompt.submit",
        title: "Submit secure input",
        category: "Dialog",
        run: submit,
      },
    ],
    bindings: tuiConfig.keybinds.gather("dialog.prompt", ["dialog.prompt.submit"]),
  }))

  onMount(() => {
    if (!textarea || textarea.isDestroyed) return
    textarea.focus()
    textarea.gotoLineEnd()
  })

  return (
    <box
      backgroundColor={theme.backgroundPanel}
      border={["left"]}
      borderColor={theme.warning}
    >
      <box gap={1} paddingLeft={2} paddingRight={3} paddingTop={1} paddingBottom={1}>
        <box>
          <text fg={theme.warning}>
            Secure input for <span style={{ fg: theme.secondary }}>{props.request.sessionName}</span>
          </text>
        </box>
        <box>
          <text fg={theme.textMuted}>{props.request.prompt}</text>
        </box>
        <textarea
          height={1}
          ref={(val: TextareaRenderable) => {
            textarea = val
            setTextareaTarget(val)
          }}
          placeholder="Type your response and press submit"
          placeholderColor={theme.textMuted}
          textColor={theme.text}
          focusedTextColor={theme.text}
          cursorColor={theme.text}
        />
      </box>
      <box
        flexDirection="row"
        flexShrink={0}
        gap={1}
        paddingLeft={2}
        paddingRight={3}
        paddingBottom={1}
        justifyContent="space-between"
      >
        <box flexDirection="row" gap={2}>
          <text fg={theme.text}>
            enter <span style={{ fg: theme.textMuted }}>submit</span>
          </text>
          <text fg={theme.text}>
            esc <span style={{ fg: theme.textMuted }}>dismiss</span>
          </text>
        </box>
      </box>
    </box>
  )
}
