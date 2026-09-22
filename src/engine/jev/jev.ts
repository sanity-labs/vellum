import { z } from 'zod'
import type { Json, JsonObject } from '../../shared/json'

type Instructions = string | JsonObject | Json[]

type ChoiceQuestion = {
  type: 'choice'
  instructions: Instructions
  criteria: Record<string, string | null>
}
export type NoulQuestion = {
  type: 'noul'
  instructions: Instructions
  criteria?: { true: string; false: string }
}
export type Question = ChoiceQuestion | NoulQuestion

const probability = z.number().min(0).max(1)
const choiceAnswer = z.object({
  type: z.literal('choice').default('choice'),
  choice: z.string(),
  confidence: probability,
  probabilities: z.record(z.string(), probability),
})
const noulAnswer = z.object({ type: z.literal('noul'), noul: probability })
const responseSchema = z.object({
  model: z.string().optional(),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
  answers: z.record(z.string(), z.union([noulAnswer, choiceAnswer])),
})
export type Answer = z.infer<typeof choiceAnswer> | z.infer<typeof noulAnswer>
export type Decision = z.infer<typeof responseSchema>

const retryStatuses = new Set([429, 529])
const maxAttempts = 4
const initialBackoffMs = 500
const requestTimeoutMs = 30000
const maxInFlight = 16

export async function decide(
  input: { state: Json; questions: Record<string, Question> },
  signal: AbortSignal,
): Promise<Decision> {
  const key = process.env.TYPESAFE_API_KEY
  if (!key)
    throw new Error('Classification is unavailable. Configure the classifier key on the server.')
  const body = JSON.stringify({ model: 'jev-latest', ...input })
  for (let attempt = 1; ; attempt++) {
    signal.throwIfAborted()
    const response = await inFlight(() =>
      fetch('https://api.typesafe.ai/v1/systemone', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body,
        signal: AbortSignal.any([signal, AbortSignal.timeout(requestTimeoutMs)]),
      }),
    )
    if (response.ok) return complete(responseSchema.parse(await response.json()), input.questions)
    if (!retryStatuses.has(response.status) || attempt === maxAttempts)
      throw new Error(await failureMessage(response))
    await backoff(response.headers.get('retry-after'), attempt, signal)
  }
}

let active = 0
const waiting: (() => void)[] = []

async function inFlight<T>(work: () => Promise<T>) {
  if (active >= maxInFlight) await new Promise<void>((resolve) => waiting.push(resolve))
  active++
  try {
    return await work()
  } finally {
    active--
    waiting.shift()?.()
  }
}

const failureDetail = z.object({ detail: z.object({ message: z.string() }) })

async function failureMessage(response: Response) {
  const detail = failureDetail.safeParse(await response.json().catch(() => undefined)).data
  return `Classification failed (HTTP ${response.status}). ${detail?.detail.message ?? 'Check the server configuration or try again.'}`
}

function complete(decision: Decision, questions: Record<string, Question>) {
  for (const [id, question] of Object.entries(questions)) {
    const answer = decision.answers[id]
    if (!answer) throw new Error(`The classifier returned no answer for ${id}.`)
    if (answer.type !== question.type)
      throw new Error(
        `The classifier returned a ${answer.type} answer for the ${question.type} question ${id}.`,
      )
    if (
      answer.type === 'choice' &&
      question.type === 'choice' &&
      !Object.hasOwn(question.criteria, answer.choice)
    )
      throw new Error(`The classifier chose an unknown option for ${id}.`)
  }
  return decision
}

function backoff(retryAfter: string | null, attempt: number, signal: AbortSignal) {
  const requested = Number(retryAfter) * 1000
  const ms =
    Number.isFinite(requested) && requested > 0 ? requested : initialBackoffMs * 2 ** (attempt - 1)
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason)
      },
      { once: true },
    )
  })
}

const questionsPerRequest = 24
const concurrentRequests = 8

export async function decideInBatches(
  input: { state: Json; questions: Record<string, Question> },
  signal: AbortSignal,
) {
  const entries = Object.entries(input.questions)
  const batches = Array.from({ length: Math.ceil(entries.length / questionsPerRequest) }, (_, i) =>
    Object.fromEntries(entries.slice(i * questionsPerRequest, (i + 1) * questionsPerRequest)),
  )
  const answers: Record<string, Answer> = {}
  const usage = { input_tokens: 0, output_tokens: 0 }
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrentRequests, batches.length) }, async () => {
      while (next < batches.length) {
        const result = await decide({ state: input.state, questions: batches[next++] }, signal)
        Object.assign(answers, result.answers)
        usage.input_tokens += result.usage.input_tokens
        usage.output_tokens += result.usage.output_tokens
      }
    }),
  )
  return { answers, usage, requests: batches.length }
}
