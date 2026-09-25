import type { DocumentProgress, FieldEvidence } from '../../shared/contracts'
import type { JsonObject } from '../../shared/json'
import { type Answer, decideInBatches, type Question } from '../jev/jev'
import { type Answers, createLog, type Log, merge, windows } from '../jev/log'
import type { SchemaNode, SchemaRegistry } from '../schema/registry'
import {
  type Binding,
  candidates,
  confirmBindings,
  describePart,
  explain,
  isSingle,
  noValue,
  pointAtSpans,
  propose,
  shapeOfBlock,
} from './binding'
import { type Block, changedBlocks, splitBlocks, stitchLines, tagBlocks } from './blocks'
import {
  type Catalog,
  type Destination,
  describeDestination,
  describeMember,
  type Member,
  prepareDestinations,
} from './destinations'

const skipConfidence = 0.85
const memberProbability = 0.2
const runnerUpRatio = 0.6
const beamWidth = 2
const assignWindow = 48
const maxDepth = 4
const skipRole = '__skip__'
const unconsumedPrefix = 'Unconsumed block '
const continues = 'continues'
const nested = 'nested'
const sibling = 'sibling'

type Stream = Extract<Destination, { kind: 'richText' | 'collection' }>
type Collection = Extract<Destination, { kind: 'collection' }>
type Scope = {
  registry: SchemaRegistry
  catalog: Catalog
  threshold: number
  log: Log
  signal: AbortSignal
  onProgress?: (event: DocumentProgress) => void
  path: string
}
export type MappingInput = {
  source: string
  registry: SchemaRegistry
  typeName: string
  threshold: number
}
type Confidence = Record<string, number>
type Evidence = Record<string, FieldEvidence>
type Mapped = { fields: JsonObject; confidence: Confidence; evidence: Evidence; notes: string[] }
type Bound = {
  bindings: Binding[]
  evidence: Evidence
  assignments: Record<string, Answer>
  notes: string[]
}
type Routed = { run: Block[]; stream?: Stream; members: Member[] }

export async function mapBlocks(
  { source, registry, typeName, threshold }: MappingInput,
  signal: AbortSignal,
  onProgress?: (event: DocumentProgress) => void,
) {
  const document = registry.getDocument(typeName)
  onProgress?.({ type: 'progress', message: 'Reading the source…' })
  const [blocks, scope] = await Promise.all([
    stitchLines(splitBlocks(source), signal),
    createScope(registry, document, threshold, signal, onProgress),
  ])
  const mapped = await mapObject(blocks, document.schema, document.title, scope, 0)
  return {
    document: { _type: typeName, ...mapped.fields } as JsonObject,
    confidence: mapped.confidence,
    evidence: mapped.evidence,
    notes: summarizeUnconsumed(mapped.notes),
    trace: scope.log.trace,
    decisions: scope.log.decisions,
    blocks,
  }
}

export async function mapAddedBlocks(
  previous: string,
  { source, registry, typeName, threshold }: MappingInput,
  signal: AbortSignal,
) {
  const document = registry.getDocument(typeName)
  const [before, after, scope] = await Promise.all([
    stitchLines(splitBlocks(previous), signal),
    stitchLines(splitBlocks(source), signal),
    createScope(registry, document, threshold, signal),
  ])
  const destinations = scope.catalog.of(document.schema)
  const added = changedBlocks(after, before)
  const { bindings, assignments } = await bindSingles(
    after,
    added,
    destinations,
    document.title,
    scope,
    0,
  )
  const claimed = new Set(bindings.map(({ block }) => block))
  const streams = destinations.filter(isStream)
  const unresolved = added.filter(
    (block) => !claimed.has(block) && !streamFor(assignments[`assign:${block.id}`], streams),
  )
  return { before, after, bindings, unresolved, trace: scope.log.trace }
}

async function createScope(
  registry: SchemaRegistry,
  document: { schema: SchemaNode; title: string },
  threshold: number,
  signal: AbortSignal,
  onProgress?: (event: DocumentProgress) => void,
): Promise<Scope> {
  const catalog = await prepareDestinations(
    registry,
    document.schema,
    document.title,
    maxDepth,
    signal,
  )
  return { registry, catalog, threshold, log: createLog(), signal, onProgress, path: '' }
}

async function mapObject(
  blocks: Block[],
  schema: SchemaNode,
  title: string,
  scope: Scope,
  depth: number,
): Promise<Mapped> {
  const { log, path, signal } = scope
  const destinations = scope.catalog.of(schema)
  const streams = destinations.filter(isStream)
  const [{ bindings, assignments, evidence, notes }, segmented] = await Promise.all([
    bindSingles(blocks, blocks, destinations, title, scope, depth),
    log.step(`Segment (${title})`, path, () =>
      segment(blocks, streams.filter(isCollection), signal),
    ),
  ])
  const fields: JsonObject = Object.fromEntries(
    bindings.map(({ destination, value }) => [destination.name, value]),
  )
  const confidence: Confidence = Object.fromEntries(
    bindings.map(({ destination, score }) => [destination.name, score]),
  )
  const claimed = new Set(bindings.map(({ block }) => block))
  const runs = segmented.sections
    .map((run) =>
      run.filter((block) => !claimed.has(block) && !skipped(assignments[`assign:${block.id}`])),
    )
    .filter((run) => run.length)
  const routed = await log.step(`Route runs (${title})`, path, () =>
    routeRuns(runs, blocks, assignments, streams, title, scope.registry, signal),
  )
  for (const [stream, group] of groupRuns(routed.routes, notes)) {
    if (stream.kind === 'richText')
      fields[stream.name] = group
        .flatMap(({ run }) => run)
        .map((block) => block.text)
        .join('\n\n')
    else if (depth < maxDepth) {
      const collection = await mapCollection(group, stream, scope, depth + 1)
      if (collection.items.length) fields[stream.name] = collection.items
      Object.assign(confidence, collection.confidence)
      Object.assign(evidence, collection.evidence)
      notes.push(...collection.notes)
    } else notes.push(`Nesting too deep for ${stream.name}`)
  }
  return { fields, confidence, evidence, notes }
}

async function bindSingles(
  blocks: Block[],
  targets: Block[],
  destinations: Destination[],
  title: string,
  scope: Scope,
  depth: number,
): Promise<Bound> {
  const { registry, log, signal, path } = scope
  const own = ownBlocks(blocks).filter((block) => targets.includes(block))
  const singles = destinations.filter(isSingle)
  const spans = candidates(own, singles, registry)
  const [assignments, pointers] = await Promise.all([
    log.step(`Assign blocks (${title})`, path, () =>
      assignBlocks(blocks, targets, destinations, title, depth, signal),
    ),
    log.step(`Point at values (${title})`, path, () =>
      pointAtSpans(blocks, own, spans, depth, signal),
    ),
  ])
  const proposals = propose(spans, assignments.answers, pointers.answers)
  const confirmed = await log.step(`Confirm values (${title})`, path, () =>
    confirmBindings(proposals, blocks, title, depth, scope.threshold, registry, signal),
  )
  return {
    bindings: confirmed.bindings,
    evidence: explain(singles, spans, pointers.answers, confirmed.bindings),
    assignments: assignments.answers,
    notes: [...pointers.notes, ...confirmed.notes],
  }
}

async function mapCollection(
  group: Routed[],
  stream: Collection,
  scope: Scope,
  depth: number,
): Promise<{ items: JsonObject[]; confidence: Confidence; evidence: Evidence; notes: string[] }> {
  const { path } = scope
  scope.onProgress?.({ type: 'progress', message: `Mapping ${stream.title}…` })
  const notes: string[] = []
  const mapped = await Promise.all(
    group.map(async ({ run, members }, index) => {
      if (!members.length) {
        notes.push(`Unresolved ${stream.name} item: ${run.map((b) => b.id).join(', ')}`)
        return undefined
      }
      const attempts = await Promise.all(
        members.map(async (member, rank) => {
          const itemScope = {
            ...scope,
            path: `${path}${stream.name}[${index}]${rank ? `~${rank}` : ''}.`,
          }
          const item = await mapObject(run, member.schema, member.title, itemScope, depth)
          return { member, item, consumed: run.length - unconsumedCount(item.notes) }
        }),
      )
      return attempts.reduce((a, b) => (b.consumed > a.consumed ? b : a))
    }),
  )
  const confidence: Confidence = {}
  const evidence: Evidence = {}
  const items = mapped
    .filter((best) => best !== undefined)
    .map((best, index) => {
      notes.push(...best.item.notes)
      for (const [field, score] of Object.entries(best.item.confidence))
        confidence[`${stream.name}[${index}].${field}`] = score
      for (const [field, why] of Object.entries(best.item.evidence))
        evidence[`${stream.name}[${index}].${field}`] = why
      return { _type: best.member.name, ...best.item.fields }
    })
  return { items, confidence, evidence, notes }
}

function unconsumedCount(notes: string[]) {
  return notes.filter((note) => note.startsWith(unconsumedPrefix)).length
}

function summarizeUnconsumed(notes: string[]) {
  const ids = notes
    .filter((note) => note.startsWith(unconsumedPrefix))
    .map((note) => note.slice(unconsumedPrefix.length))
  const rest = notes.filter((note) => !note.startsWith(unconsumedPrefix))
  return ids.length ? [...rest, `Unconsumed blocks: ${ids.join(', ')}`] : rest
}

async function assignBlocks(
  blocks: Block[],
  targets: Block[],
  destinations: Destination[],
  title: string,
  depth: number,
  signal: AbortSignal,
): Promise<Answers> {
  const wanted = new Set(targets)
  const criteriaFor = (block: Block) =>
    Object.fromEntries([
      ...destinations
        .filter((d) => d.kind !== 'collection' || !opensObject(block, blocks))
        .map((d) => [d.name, describeDestination(d)]),
      [skipRole, 'Notes to the editor or writer about how to handle the document. Not content.'],
      ...(depth
        ? [
            [
              noValue,
              'Not part of this item: it belongs to a neighbouring item or to nothing here.',
            ],
          ]
        : []),
    ])
  const results = await Promise.all(
    windows(blocks, assignWindow)
      .filter((window) => window.some((block) => wanted.has(block)))
      .map((window) =>
        decideInBatches(
          {
            state: tagBlocks(window),
            questions: Object.fromEntries(
              window
                .filter((block) => wanted.has(block))
                .flatMap((block) =>
                  block.spans.map((span) => [
                    `assign:${span.id}`,
                    {
                      type: 'choice',
                      instructions: {
                        part: describePart(span, block, blocks, depth),
                        question: `Within this ${title}, which field holds \`part\`?`,
                      },
                      criteria: criteriaFor(block),
                    } satisfies Question,
                  ]),
                ),
            ),
          },
          signal,
        ),
      ),
  )
  return merge(results)
}

function opensObject(block: Block, blocks: Block[]) {
  return block === blocks[0] && block.kind === 'heading'
}

async function segment(blocks: Block[], collections: Collection[], signal: AbortSignal) {
  if (blocks.length < 2 || !collections.length)
    return { ...merge([]), sections: blocks.map((block) => [block]) }
  const itemKinds = [
    ...new Set(collections.flatMap((c) => c.members.map((member) => member.title))),
  ].join(', ')
  const result = await decideInBatches(
    {
      state: tagBlocks(blocks),
      questions: Object.fromEntries(
        blocks.slice(1).map((block, index) => {
          const previous = blocks[index]
          return [
            `boundary:${block.id}`,
            {
              type: 'choice',
              instructions: {
                block: {
                  id: block.id,
                  shape: shapeOfBlock(block),
                  previousBlock: previous.id,
                  previousShape: shapeOfBlock(previous),
                  sameShapeAsPrevious: shapeOfBlock(block) === shapeOfBlock(previous),
                },
                collection: {
                  name: collections.map((c) => c.name).join(' or '),
                  title: collections.map((c) => c.title).join(' or '),
                  itemKinds,
                },
                question:
                  'How does `block` relate to the entry of `collection` that contains `block.previousBlock`? Each entry is one complete item of the kinds listed in `collection.itemKinds`, and an entry may list smaller things of its own inside it.',
              },
              criteria: {
                [continues]:
                  'It continues the current entry: its description, details, links, or answer.',
                [nested]:
                  'It begins a smaller thing listed inside the current entry, such as one feature, card, step, or question under the section that contains `block.previousBlock`.',
                [sibling]:
                  'It begins the next entry of `collection`, at the same level as the current one, for example a heading that opens a new topic.',
              },
            } satisfies Question,
          ]
        }),
      ),
    },
    signal,
  )
  const sections: Block[][] = []
  let current: Block[] | undefined
  for (const block of blocks) {
    if (opensObject(block, blocks)) {
      sections.push([block])
      continue
    }
    const answer = result.answers[`boundary:${block.id}`]
    const opensRun =
      block.kind === 'heading'
        ? !nestedUnder(block, current ?? [])
        : answer?.type === 'choice' && answer.choice === sibling
    if (current && !opensRun) current.push(block)
    else {
      current = [block]
      sections.push(current)
    }
  }
  return { ...result, sections }
}

async function routeRuns(
  runs: Block[][],
  blocks: Block[],
  assignments: Record<string, Answer>,
  streams: Stream[],
  title: string,
  registry: SchemaRegistry,
  signal: AbortSignal,
) {
  const eligible = (run: Block[]) =>
    opensObject(run[0], blocks) ? streams.filter((stream) => stream.kind === 'richText') : streams
  const options = (run: Block[]) =>
    Object.fromEntries([
      ...eligible(run).flatMap((stream) =>
        stream.kind === 'richText'
          ? [[stream.name, describeDestination(stream)]]
          : stream.members.map((member) => [
              `${stream.name}.${member.name}`,
              `One ${member.title} in ${stream.title}. ${describeMember(member, registry)}`,
            ]),
      ),
      [noValue, 'No field of this object holds them.'],
    ])
  const decided = (run: Block[]) => {
    if (run.length > 1) return undefined
    const stream = streamFor(assignments[`assign:${run[0].id}`], eligible(run))
    return stream && (stream.kind === 'richText' || stream.members.length === 1)
      ? { run, stream, members: stream.kind === 'collection' ? stream.members : [] }
      : undefined
  }
  const undecided = runs.filter((run) => !decided(run))
  const question = (run: Block[]): Question => ({
    type: 'choice',
    instructions: {
      run: {
        blocks: run.map((block) => block.id),
        shape: shapeOf(run),
        position: `${runs.indexOf(run) + 1} of ${runs.length}`,
        runsWithSameShape: runs.filter((other) => shapeOf(other) === shapeOf(run)).length,
      },
      question: `The blocks in \`run\` stay together as one item or passage inside this ${title}. Which field holds them, and as which kind of item? Choose by structure and position, not by the subject discussed. A run of several similarly shaped runs is usually one entry each in a list field.`,
    },
    criteria: options(run),
  })
  const results = await Promise.all(
    windows(blocks, assignWindow).flatMap((window) => {
      const inside = undecided.filter((run) => window.includes(run[0]))
      return inside.length
        ? [
            decideInBatches(
              {
                state: tagBlocks(window),
                questions: Object.fromEntries(
                  inside.map((run) => [`run:${run[0].id}`, question(run)]),
                ),
              },
              signal,
            ),
          ]
        : []
    }),
  )
  const result = merge(results)
  const routes = runs.map(
    (run): Routed =>
      decided(run) ?? resolveRoute(run, result.answers[`run:${run[0].id}`], eligible(run)),
  )
  return { ...result, routes }
}

function resolveRoute(run: Block[], answer: Answer | undefined, streams: Stream[]): Routed {
  if (answer?.type !== 'choice' || answer.choice === noValue) return { run, members: [] }
  const [streamName] = answer.choice.split('.')
  const stream = streams.find((candidate) => candidate.name === streamName)
  if (!stream || stream.kind === 'richText') return { run, stream, members: [] }
  const ranked = Object.entries(answer.probabilities)
    .filter(
      ([option, probability]) =>
        option.startsWith(`${stream.name}.`) && probability >= memberProbability,
    )
    .sort((a, b) => b[1] - a[1])
  const top = ranked[0]?.[1] ?? 0
  const members = ranked
    .filter(([, probability]) => probability >= top * runnerUpRatio)
    .slice(0, beamWidth)
    .flatMap(([option]) =>
      stream.members.filter((member) => `${stream.name}.${member.name}` === option),
    )
  return { run, stream, members }
}

function groupRuns(routes: Routed[], notes: string[]) {
  const grouped = new Map<Stream, Routed[]>()
  for (const route of routes) {
    if (!route.stream) {
      notes.push(...route.run.map((block) => `${unconsumedPrefix}${block.id}`))
      continue
    }
    grouped.set(route.stream, [...(grouped.get(route.stream) ?? []), route])
  }
  return [...grouped]
}

function skipped(assignment: Answer | undefined) {
  return (
    assignment?.type === 'choice' &&
    assignment.choice === skipRole &&
    assignment.confidence >= skipConfidence
  )
}

function streamFor(assignment: Answer | undefined, streams: Stream[]) {
  if (assignment?.type !== 'choice') return streams.length === 1 ? streams[0] : undefined
  return streams.find((stream) => stream.name === assignment.choice)
}

function isCollection(stream: Stream): stream is Collection {
  return stream.kind === 'collection'
}

function ownBlocks(blocks: Block[]) {
  const opener = blocks[0]
  if (opener?.kind !== 'heading') return blocks
  const nested = blocks.findIndex(
    (block, index) =>
      index > 0 && block.kind === 'heading' && (block.level ?? 0) > (opener.level ?? 0),
  )
  return nested < 0 ? blocks : blocks.slice(0, nested)
}

function nestedUnder(heading: Block, section: Block[]) {
  const opener = section[0]
  return opener?.kind === 'heading' && (heading.level ?? 0) > (opener.level ?? 0)
}

function shapeOf(section: Block[]) {
  const counts = new Map<string, number>()
  for (const block of section) {
    const shape = shapeOfBlock(block)
    counts.set(shape, (counts.get(shape) ?? 0) + 1)
  }
  return [...counts].map(([shape, count]) => `${count} × ${shape}`).join(', ')
}

function isStream(destination: Destination): destination is Stream {
  return (
    destination.kind === 'collection' ||
    (destination.kind === 'richText' && destination.arity === 'many')
  )
}
