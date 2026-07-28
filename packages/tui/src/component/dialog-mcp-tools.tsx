import { createResource, createSignal } from "solid-js"
import { useSDK } from "../context/sdk"
import { DialogSelect, type DialogSelectRef, type DialogSelectOption } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"

interface ToolDef {
  name: string
  description?: string
  inputSchema: unknown
}

function propertyDetails(schema: unknown): string[] {
  if (!schema || typeof schema !== "object") return []
  const s = schema as Record<string, unknown>
  const props = s.properties as Record<string, Record<string, unknown>> | undefined
  if (!props) return []
  const required = (s.required as string[]) ?? []
  const lines: string[] = []
  for (const [key, prop] of Object.entries(props)) {
    const type = (prop.type as string) ?? "any"
    const desc = (prop.description as string) ?? ""
    const req = required.includes(key) ? " (required)" : ""
    const descPart = desc ? ` — ${desc}` : ""
    lines.push(`  ${key}: ${type}${req}${descPart}`)
  }
  return lines
}

function buildArgsTemplate(schema: unknown): string {
  if (!schema || typeof schema !== "object") return "{}"
  const s = schema as Record<string, unknown>
  const props = s.properties as Record<string, Record<string, unknown>> | undefined
  if (!props || Object.keys(props).length === 0) return "{}"
  const required = (s.required as string[]) ?? []
  const template: Record<string, string> = {}
  for (const [key, prop] of Object.entries(props)) {
    const type = (prop.type as string) ?? "any"
    if (required.includes(key)) {
      if (type === "string") template[key] = `"<${key}>"`
      else if (type === "number" || type === "integer") template[key] = `0`
      else if (type === "boolean") template[key] = `false`
      else if (type === "array") template[key] = `[]`
      else template[key] = `{}`
    }
  }
  if (Object.keys(template).length === 0) return "{}"
  return JSON.stringify(template)
}

export function DialogMcpTools(props: {
  onSelect: (toolName: string, argsTemplate: string) => void
}) {
  const sdk = useSDK()
  const dialog = useDialog()
  const [, setRef] = createSignal<DialogSelectRef<ToolDef>>()

  const [tools] = createResource(async () => {
    const res = await sdk.request("/mcp/tools")
    if (!res.ok) throw new Error(`Failed to fetch tools: ${res.status}`)
    return (await res.json()) as ToolDef[]
  })

  const options = () =>
    (tools() ?? []).map((tool) => ({
      value: tool,
      title: tool.name,
      description: tool.description ?? "",
      details: propertyDetails(tool.inputSchema),
      category: undefined,
    }))

  return (
    <DialogSelect
      ref={setRef}
      title="MCP Tools — select to fill input"
      options={options()}
      onSelect={(option: DialogSelectOption<ToolDef>) => {
        const tool = option.value
        const argsTemplate = buildArgsTemplate(tool.inputSchema)
        dialog.clear()
        props.onSelect(tool.name, argsTemplate)
      }}
    />
  )
}
