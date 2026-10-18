import { Server } from "@modelcontextprotocol/server"
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio"
import { z } from "zod"

const server = new Server({ name: "secure-input-fixture", version: "1" }, { capabilities: { tools: {} } })
let previous: string | undefined
server.setRequestHandler("tools/list", () => ({ tools: [{ name: "ask", inputSchema: { type: "object" } }] }))
server.setRequestHandler("tools/call", async (request, ctx) => {
  const token = request.params._meta?.["opencode.dev/secure-input-token"]
  if (typeof token !== "string") return { content: [{ type: "text", text: "no capability" }] }
  const params = { token: request.params.name === "replay" ? previous : token, prompt: "Test password" }
  previous = token
  try {
    const result = await ctx.mcpReq.send({ method: "opencode/secure-input", params }, z.object({ value: z.string() }))
    return { content: [{ type: "text", text: result.value === "test-only-secret" ? "verified" : "incorrect" }] }
  } catch {
    return { content: [{ type: "text", text: "unavailable" }] }
  }
})
await server.connect(new StdioServerTransport())
