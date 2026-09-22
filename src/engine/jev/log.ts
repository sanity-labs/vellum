import type { DocumentRunResult } from '../../shared/contracts'
import type { Answer, Decision } from './jev'

export type Answers = {
  answers: Record<string, Answer>
  usage: { input_tokens: number; output_tokens: number }
  requests: number
}
type Trace = DocumentRunResult['trace']

export function createLog() {
  const trace: Trace = []
  const decisions: Record<string, Answer> = {}
  return {
    trace,
    decisions,
    async step<T extends Answers>(name: string, path: string, work: () => Promise<T>) {
      const started = performance.now()
      const result = await work()
      for (const [id, answer] of Object.entries(result.answers)) decisions[`${path}${id}`] = answer
      trace.push({
        step: name,
        engine: 'Classifier',
        detail: `${Object.keys(result.answers).length} decisions in ${result.requests} requests`,
        elapsedMs: performance.now() - started,
        inputTokens: result.usage.input_tokens,
        outputTokens: result.usage.output_tokens,
      })
      return result
    },
  }
}
export type Log = ReturnType<typeof createLog>

export function merge(results: (Decision | Answers)[]): Answers {
  const merged: Answers = { answers: {}, usage: { input_tokens: 0, output_tokens: 0 }, requests: 0 }
  for (const result of results) {
    Object.assign(merged.answers, result.answers)
    merged.usage.input_tokens += result.usage.input_tokens
    merged.usage.output_tokens += result.usage.output_tokens
    merged.requests += 'requests' in result ? result.requests : 1
  }
  return merged
}

export function windows<T>(items: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, (i + 1) * size),
  )
}
