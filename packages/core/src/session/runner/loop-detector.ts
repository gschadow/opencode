export * as LoopDetector from "./loop-detector"

const DEFAULT_WINDOW = 20
const DEFAULT_REPEATS = 3

export interface State {
  readonly signatures: string[]
}

export function create(): State {
  return { signatures: [] }
}

export function record(state: State, signature: string, window = DEFAULT_WINDOW): State {
  if (signature === "") return state
  const signatures = [...state.signatures, signature].slice(-window)
  return { signatures }
}

export interface LoopResult {
  readonly cycleLength: number
  readonly repeats: number
  readonly pattern: string[]
}

export function detectLoop(state: State, minRepeats = DEFAULT_REPEATS): LoopResult | undefined {
  const seq = state.signatures
  const len = seq.length
  if (len < minRepeats) return undefined

  for (let k = 1; k <= Math.floor(len / minRepeats); k++) {
    const candidate = seq.slice(-k)
    let repeats = 1
    for (let i = len - k - 1; i >= 0; i -= k) {
      const chunk = seq.slice(i, i + k)
      if (chunk.length < k) break
      let match = true
      for (let j = 0; j < k; j++) {
        if (chunk[j] !== candidate[j]) { match = false; break }
      }
      if (!match) break
      repeats++
    }
    if (repeats >= minRepeats) {
      return { cycleLength: k, repeats, pattern: candidate }
    }
  }
  return undefined
}

export function reset(state: State): State {
  return create()
}
