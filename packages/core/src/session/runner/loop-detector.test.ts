import { describe, expect, it } from "bun:test"
import * as LoopDetector from "./loop-detector"

describe("LoopDetector", () => {
  it("detects single-step repetition", () => {
    let state = LoopDetector.create()
    state = LoopDetector.record(state, "read:file.ts")
    state = LoopDetector.record(state, "read:file.ts")
    state = LoopDetector.record(state, "read:file.ts")
    const result = LoopDetector.detectLoop(state, 3)
    expect(result).toBeDefined()
    expect(result!.cycleLength).toBe(1)
    expect(result!.repeats).toBe(3)
    expect(result!.pattern).toEqual(["read:file.ts"])
  })

  it("detects multi-step cycles", () => {
    let state = LoopDetector.create()
    // bash→edit→read cycle repeated 3 times
    state = LoopDetector.record(state, "bash:node --check")
    state = LoopDetector.record(state, "edit:file.ts")
    state = LoopDetector.record(state, "read:file.ts")
    state = LoopDetector.record(state, "bash:node --check")
    state = LoopDetector.record(state, "edit:file.ts")
    state = LoopDetector.record(state, "read:file.ts")
    state = LoopDetector.record(state, "bash:node --check")
    state = LoopDetector.record(state, "edit:file.ts")
    state = LoopDetector.record(state, "read:file.ts")
    const result = LoopDetector.detectLoop(state, 3)
    expect(result).toBeDefined()
    expect(result!.cycleLength).toBe(3)
    expect(result!.repeats).toBe(3)
    expect(result!.pattern).toEqual(["bash:node --check", "edit:file.ts", "read:file.ts"])
  })

  it("does not trigger on different operations", () => {
    let state = LoopDetector.create()
    state = LoopDetector.record(state, "read:fileA.ts")
    state = LoopDetector.record(state, "read:fileB.ts")
    state = LoopDetector.record(state, "read:fileC.ts")
    const result = LoopDetector.detectLoop(state, 3)
    expect(result).toBeUndefined()
  })

  it("does not trigger below threshold", () => {
    let state = LoopDetector.create()
    state = LoopDetector.record(state, "read:file.ts")
    state = LoopDetector.record(state, "read:file.ts")
    const result = LoopDetector.detectLoop(state, 3)
    expect(result).toBeUndefined()
  })

  it("detects 2-step cycles", () => {
    let state = LoopDetector.create()
    // read→edit cycle repeated 3 times
    state = LoopDetector.record(state, "read:file.ts")
    state = LoopDetector.record(state, "edit:file.ts")
    state = LoopDetector.record(state, "read:file.ts")
    state = LoopDetector.record(state, "edit:file.ts")
    state = LoopDetector.record(state, "read:file.ts")
    state = LoopDetector.record(state, "edit:file.ts")
    const result = LoopDetector.detectLoop(state, 3)
    expect(result).toBeDefined()
    expect(result!.cycleLength).toBe(2)
    expect(result!.repeats).toBe(3)
  })

  it("handles text-level loops", () => {
    let state = LoopDetector.create()
    const text = "The user wants me to create a new anchored summary..."
    state = LoopDetector.record(state, `text:${text.slice(0, 50)}`)
    state = LoopDetector.record(state, `text:${text.slice(0, 50)}`)
    state = LoopDetector.record(state, `text:${text.slice(0, 50)}`)
    const result = LoopDetector.detectLoop(state, 3)
    expect(result).toBeDefined()
    expect(result!.cycleLength).toBe(1)
  })
})
