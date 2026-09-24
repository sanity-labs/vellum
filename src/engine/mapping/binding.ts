import type { FieldEvidence } from '../../shared/contracts'
import type { Json } from '../../shared/json'
import { type Answer, decideInBatches, type Question } from '../jev/jev'
import { merge } from '../jev/log'
import { coerceFieldValue } from '../schema/coerce'
import type { SchemaRegistry } from '../schema/registry'
import { type Block, type Span, spanText, tagBlocks } from './blocks'
import type { Destination } from './destinations'

export type Single = Extract<Destination, { kind: 'scalar' | 'richText' }>
type Candidate = { destination: Single; block: Block; span: Span }
type Proposal = Candidate & { assigned: number; pointed: number }
export type Binding = Proposal & { value: Json; score: number; confirmed?: number }

const agreeingSignals = 2
const proposalProbability = 0.1
const maxProposals = 3
const maxScalarLength = 300
const maxChoiceOptions = 255
const contextRadius = 8
export const noValue = '__none__'

export function isSingle(destination: Destination): destination is Single {
  return (
    destination.kind === 'scalar' ||
    (destination.kind === 'richText' && destination.arity === 'one')
  )
}

export function candidates(own: Block[], singles: Single[], registry: SchemaRegistry): Candidate[] {
  return singles.flatMap((destination) =>
    own.flatMap((block) => {
      const passage = destination.type === 'text' || destination.type === 'rich text'
      if (!passage && block.content.length > maxScalarLength) return []
      return block.spans
        .filter(
          (span) =>
            coerceFieldValue(spanText(span, block), destination.schema, registry) !== undefined,
        )
        .map((span) => ({ destination, block, span }))
    }),
  )
}

export async function pointAtSpans(
  blocks: Block[],
  own: Block[],
  candidates: Candidate[],
  depth: number,
  signal: AbortSignal,
) {
  const notes: string[] = []
  const questions: Record<string, Question> = {}
  for (const destination of new Set(candidates.map((c) => c.destination))) {
    const options = candidates.filter((c) => c.destination === destination)
    if (options.length > maxChoiceOptions) {
      notes.push(`Too many candidate spans for ${destination.name}; skipped.`)
      continue
    }
    questions[`point:${destination.name}`] = {
      type: 'choice',
      instructions: `Which part of the source supplies the ${destination.title} (${destination.name})? ${destination.description}`,
      criteria: {
        ...Object.fromEntries(
          options.map(({ span, block }) => [span.id, summarizePart(span, block, blocks, depth)]),
        ),
        [noValue]: 'Nothing here supplies this field; it would have to be written or inferred.',
      },
    }
  }
  const result = Object.keys(questions).length
    ? await decideInBatches({ state: tagBlocks(around(blocks, own)), questions }, signal)
    : merge([])
  return { ...result, notes }
}

export function propose(
  candidates: Candidate[],
  assignments: Record<string, Answer>,
  pointers: Record<string, Answer>,
): Proposal[] {
  const scored = candidates.map((candidate) => {
    const assignment = assignments[`assign:${candidate.span.id}`]
    const pointer = pointers[`point:${candidate.destination.name}`]
    return {
      ...candidate,
      assigned: probabilityOf(assignment, candidate.destination.name),
      pointed: probabilityOf(pointer, candidate.span.id),
    }
  })
  return [...new Set(scored.map((p) => p.destination))].flatMap((destination) =>
    scored
      .filter((p) => p.destination === destination)
      .filter((p) => Math.max(p.assigned, p.pointed) >= proposalProbability)
      .sort((a, b) => b.assigned * b.pointed - a.assigned * a.pointed)
      .slice(0, maxProposals),
  )
}

export async function confirmBindings(
  proposals: Proposal[],
  blocks: Block[],
  objectTitle: string,
  depth: number,
  threshold: number,
  registry: SchemaRegistry,
  signal: AbortSignal,
) {
  const notes: string[] = []
  const undecided = proposals.filter(
    (proposal) => strongSignals([proposal.assigned, proposal.pointed], threshold) === 1,
  )
  const results = await Promise.all(
    groupByNeighbourhood(undecided, blocks).map((group) =>
      decideInBatches(
        {
          state: tagBlocks(
            around(
              blocks,
              group.map((proposal) => proposal.block),
            ),
          ),
          questions: Object.fromEntries(
            group.map((proposal) => [
              confirmId(proposal),
              confirmQuestion(proposal, blocks, objectTitle, depth),
            ]),
          ),
        },
        signal,
      ),
    ),
  )
  const merged = merge(results)
  const bindings = proposals.flatMap((proposal): Binding[] => {
    const answer = merged.answers[confirmId(proposal)]
    const signals = [proposal.assigned, proposal.pointed]
    if (answer?.type === 'noul') signals.push(answer.noul)
    const score = signals.reduce((sum, p) => sum + p, 0) / signals.length
    const strong = strongSignals(signals, threshold)
    if (strong < agreeingSignals) {
      if (strong)
        notes.push(
          `${proposal.destination.name}: left empty; ${proposal.span.id} scored ${percent(score)}, below ${percent(threshold)}.`,
        )
      return []
    }
    const value = coerceFieldValue(
      spanText(proposal.span, proposal.block),
      proposal.destination.schema,
      registry,
    )
    const confirmed = answer?.type === 'noul' ? answer.noul : undefined
    return value === undefined ? [] : [{ ...proposal, value, score, confirmed }]
  })
  return { ...merged, bindings: exclusive(bindings), notes }
}

const maxEvidenceOptions = 4
const maxEvidenceText = 160

/**
 * Explains every single-value field: the source it was copied from, or why nothing was. This is
 * what lets a reviewer check that no value was written by the model.
 */
export function explain(
  singles: Single[],
  spans: Candidate[],
  pointers: Record<string, Answer>,
  bindings: Binding[],
): Record<string, FieldEvidence> {
  return Object.fromEntries(
    singles.map((destination): [string, FieldEvidence] => {
      const offered = spans.filter((candidate) => candidate.destination === destination)
      const pointer = pointers[`point:${destination.name}`]
      const options =
        pointer?.type === 'choice'
          ? Object.entries(pointer.probabilities)
              .sort((a, b) => b[1] - a[1])
              .slice(0, maxEvidenceOptions)
              .map(([id, probability]) => {
                const candidate = offered.find((c) => c.span.id === id)
                const text = candidate ? spanText(candidate.span, candidate.block) : ''
                return { id, text: clip(text), probability }
              })
          : []
      const binding = bindings.find((b) => b.destination === destination)
      if (binding)
        return [
          destination.name,
          {
            status: 'filled',
            reason: 'copied',
            source: {
              block: binding.block.id,
              span: binding.span.id,
              blockText: binding.block.text,
              text: clip(spanText(binding.span, binding.block)),
            },
            signals: {
              assigned: binding.assigned,
              pointed: binding.pointed,
              ...(binding.confirmed === undefined ? {} : { confirmed: binding.confirmed }),
            },
            options,
          },
        ]
      const noneChosen = pointer?.type === 'choice' && pointer.choice === noValue
      const reason = !offered.length
        ? 'no-candidates'
        : noneChosen
          ? 'none-chosen'
          : 'below-threshold'
      return [destination.name, { status: 'empty', reason, options }]
    }),
  )
}

function clip(text: string) {
  return text.length > maxEvidenceText ? `${text.slice(0, maxEvidenceText - 1)}…` : text
}

function strongSignals(signals: number[], threshold: number) {
  return signals.filter((probability) => probability >= threshold).length
}

function groupByNeighbourhood(proposals: Proposal[], blocks: Block[]) {
  const sorted = [...proposals].sort((a, b) => blocks.indexOf(a.block) - blocks.indexOf(b.block))
  const groups: Proposal[][] = []
  for (const proposal of sorted) {
    const group = groups.at(-1)
    const first = group ? blocks.indexOf(group[0].block) : -1
    if (group && blocks.indexOf(proposal.block) - first <= contextRadius) group.push(proposal)
    else groups.push([proposal])
  }
  return groups
}

function percent(probability: number) {
  return `${Math.round(probability * 100)}%`
}

function confirmId(proposal: Candidate) {
  return `confirm:${proposal.destination.name}:${proposal.span.id}`
}

function exclusive(bindings: Binding[]) {
  const usedSpans = new Set<string>()
  const usedDestinations = new Set<string>()
  return bindings
    .filter((binding) => !shadowedByPart(binding, bindings))
    .sort((a, b) => b.score - a.score)
    .filter(({ destination, span }) => {
      if (usedSpans.has(span.id) || usedDestinations.has(destination.name)) return false
      usedSpans.add(span.id)
      usedDestinations.add(destination.name)
      return true
    })
}

function shadowedByPart(binding: Binding, bindings: Binding[]) {
  return (
    binding.span.id === binding.block.id &&
    bindings.some(
      (other) =>
        other.block === binding.block &&
        other.destination === binding.destination &&
        other.span.id !== other.block.id,
    )
  )
}

function confirmQuestion(
  { destination, block, span }: Candidate,
  blocks: Block[],
  objectTitle: string,
  depth: number,
): Question {
  const whole = depth === 0
  return {
    type: 'noul',
    instructions: {
      part: describePart(span, block, blocks, depth),
      object: {
        type: objectTitle,
        scope: whole
          ? 'the whole document; nested items have their own fields'
          : 'one item nested in a larger document',
      },
      field: {
        name: destination.name,
        title: destination.title,
        description: destination.description,
      },
      question: whole
        ? 'Should `part` be stored as the `field` of the whole `object`? A document normally takes its title from the top-level heading, even when later sections have their own headings. Formatting and length rules in `field.description` are checked separately.'
        : 'Should `part` be stored as the `field` of this `object`? An item normally takes its title from the heading that opens it, link fields from a link line, and labeled values from the text after the label. Formatting and length rules in `field.description` are checked separately.',
    },
    criteria: {
      true: 'Yes, that is where this text belongs.',
      false:
        'No. It belongs to another field or another item, is body content, or the source does not supply this field.',
    },
  }
}

export function describePart(span: Span, block: Block, blocks: Block[], depth: number) {
  const index = blocks.indexOf(block)
  const opens = index === 0 && block.kind === 'heading'
  return {
    id: span.id,
    of: span.id === block.id ? 'the whole block' : (span.note ?? 'a part of the block'),
    block: shapeOfBlock(block),
    position: opens
      ? `the heading that opens this ${depth ? 'item' : 'document'}`
      : `block ${index + 1} of ${blocks.length}`,
  }
}

function summarizePart(span: Span, block: Block, blocks: Block[], depth: number) {
  const part = describePart(span, block, blocks, depth)
  const what = part.of === 'the whole block' ? part.block : `${part.of} in ${part.block}`
  return `${what}, ${part.position}`
}

export function shapeOfBlock(block: Block) {
  const label = block.spans.find((span) => span.id.endsWith('.value'))?.note
  if (label) return `a labeled line: ${label}`
  if (block.spans.some((span) => span.id.endsWith('.href'))) return 'a link on its own line'
  return block.level ? `a level ${block.level} heading` : `a ${block.kind}`
}

function probabilityOf(answer: Answer | undefined, option: string) {
  return answer?.type === 'choice' ? (answer.probabilities[option] ?? 0) : 0
}

function around(blocks: Block[], focus: Block | Block[]) {
  const targets = Array.isArray(focus) ? focus : [focus]
  const indexes = targets.map((block) => blocks.indexOf(block)).filter((index) => index >= 0)
  if (!indexes.length) return blocks
  const first = Math.max(0, Math.min(...indexes) - contextRadius)
  const last = Math.min(blocks.length, Math.max(...indexes) + contextRadius + 1)
  return blocks.slice(first, last)
}
