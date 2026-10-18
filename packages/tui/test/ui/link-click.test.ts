import { expect, test } from "bun:test"
import { TextRenderable, StyledText, MouseButton } from "@opentui/core"
import { createTestRenderer, setRendererCapabilities } from "@opentui/core/testing"
import { linkAt } from "../../src/ui/link"

test("left-click on a link cell opens the URL; drag-select does not", async () => {
  const { renderer, mockMouse, renderOnce } = await createTestRenderer({ width: 60, height: 8, useMouse: true })
  setRendererCapabilities(renderer, { hyperlinks: false })
  const opened: string[] = []
  let linkClickDown: { x: number; y: number } | null = null

  renderer.root.onMouseDown = (event) => {
    if (event.button === MouseButton.LEFT) linkClickDown = { x: event.x, y: event.y }
  }
  renderer.root.onMouseUp = (event) => {
    if (event.defaultPrevented || event.button !== MouseButton.LEFT) return
    const down = linkClickDown
    linkClickDown = null
    if (down === null || Math.abs(event.x - down.x) > 1 || Math.abs(event.y - down.y) > 1) return
    const href = linkAt(renderer.currentRenderBuffer, event.x, event.y)
    if (!href) return
    opened.push(href)
  }

  const href = "https://example.com/click"
  renderer.root.add(
    new TextRenderable(renderer, {
      content: new StyledText([{ __isChunk: true, text: "example", link: { url: href } }]),
      width: "100%",
      height: 1,
      left: 0,
      top: 1,
    }),
  )

  try {
    await renderOnce()
    const buffer = renderer.currentRenderBuffer
    let targetX = -1
    let targetY = -1
    for (let y = 0; y < buffer.height; y++) {
      for (let x = 0; x < buffer.width; x++) {
        if (linkAt(buffer, x, y)) {
          targetX = x
          targetY = y
          break
        }
      }
      if (targetX >= 0) break
    }
    expect(targetX).toBeGreaterThanOrEqual(0)

    await mockMouse.click(targetX, targetY, MouseButton.LEFT, { delayMs: 20 })
    expect(opened).toContain(href)

    opened.length = 0
    await mockMouse.drag(targetX, targetY, targetX + 5, targetY, MouseButton.LEFT)
    expect(opened).toEqual([])
  } finally {
    renderer.destroy()
  }
})
