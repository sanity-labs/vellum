import { decide, type NoulQuestion } from '../jev/jev'
import { scalarTypes } from '../schema/coerce'
import type { SchemaNode, SchemaRegistry } from '../schema/registry'

export type Member = {
  name: string
  title: string
  description: string
  schema: SchemaNode
}
export type Destination = {
  name: string
  title: string
  description: string
  type: string
  schema: SchemaNode
} & (
  | { kind: 'scalar' }
  | { kind: 'richText'; arity: 'one' | 'many' }
  | { kind: 'collection'; members: Member[] }
)
export type Catalog = { of: (schema: SchemaNode) => Destination[] }
type Arity = Record<string, 'one' | 'many'>
type Reached = {
  schema: SchemaNode
  title: string
  destinations: Destination[]
}

const singlePassageProbability = 0.7
const excludedMemberTypes = new Set(['reference', 'crossDatasetReference', 'image', 'file'])
const arities = new WeakMap<object, Arity>()
const identity = (schema: SchemaNode) => schema.fields ?? schema

export async function prepareDestinations(
  registry: SchemaRegistry,
  root: SchemaNode,
  title: string,
  depth: number,
  signal: AbortSignal,
): Promise<Catalog> {
  const reached = reach(registry, root, title, depth)
  const pending = reached.filter(
    ({ schema, destinations }) =>
      !arities.has(identity(schema)) && destinations.some((d) => d.kind === 'richText'),
  )
  if (pending.length) {
    const decided = await classifyArities(pending, signal)
    for (const [index, { schema }] of pending.entries())
      arities.set(identity(schema), decided[index])
  }
  return {
    of: (schema) => withArity(describeFields(registry, schema), arities.get(schema)),
  }
}

function reach(registry: SchemaRegistry, root: SchemaNode, title: string, depth: number) {
  const reached: Reached[] = []
  const seen = new Set<object>()
  const visit = (schema: SchemaNode, name: string, level: number) => {
    if (seen.has(identity(schema))) return
    seen.add(identity(schema))
    const destinations = describeFields(registry, schema)
    reached.push({ schema, title: name, destinations })
    if (level >= depth) return
    for (const destination of destinations)
      if (destination.kind === 'collection')
        for (const member of destination.members) visit(member.schema, member.title, level + 1)
  }
  visit(root, title, 0)
  return reached
}

function describeFields(registry: SchemaRegistry, schema: SchemaNode): Destination[] {
  return registry.fields(schema).flatMap((field): Destination[] => {
    if (field.typeDef.deprecated) return []
    const base = {
      name: field.name,
      title: field.typeDef.title ?? field.name,
      description: field.typeDef.description ?? '',
      schema: field.typeDef,
    }
    if (registry.richTextTarget(field.typeDef, field.name))
      return [{ ...base, kind: 'richText', type: 'rich text', arity: 'many' }]
    if (scalarTypes.has(field.typeDef.extends))
      return [{ ...base, kind: 'scalar', type: field.typeDef.extends }]
    if (field.typeDef.extends !== 'array') return []
    const members = listMembers(registry, field.typeDef)
    return members.length ? [{ ...base, kind: 'collection', type: 'array', members }] : []
  })
}

function withArity(destinations: Destination[], arity: Arity = {}) {
  return destinations.map((d) =>
    d.kind === 'richText' ? { ...d, arity: arity[d.name] ?? d.arity } : d,
  )
}

function listMembers(registry: SchemaRegistry, schema: SchemaNode): Member[] {
  return registry.members(schema).flatMap((member) => {
    if (member.typeDef.extends !== 'object' || excludedMemberTypes.has(member.declaredType))
      return []
    if (!registry.fields(member.typeDef).length) return []
    return [
      {
        name: member.name,
        title: member.typeDef.title ?? member.name,
        description: member.typeDef.description ?? '',
        schema: member.typeDef,
      },
    ]
  })
}

async function classifyArities(pending: Reached[], signal: AbortSignal): Promise<Arity[]> {
  const richText = pending.map(({ destinations }) =>
    destinations.filter((d) => d.kind === 'richText'),
  )
  const { answers } = await decide(
    {
      state: {
        objectTypes: pending.map(({ title }, index) => ({
          type: title,
          richTextFields: richText[index].map(({ name, title, description }) => ({
            name,
            title,
            description,
          })),
        })),
      },
      questions: Object.fromEntries(
        pending.flatMap(({ title }, index) =>
          richText[index].map((d) => [
            `${index}:${d.name}`,
            {
              type: 'noul',
              instructions: `In a ${title}, does the field ${d.name} (${d.title}) hold one short passage rather than the main body? ${d.description}`,
              criteria: {
                true: 'A title, summary, lede, excerpt, teaser, or caption: a single short passage.',
                false: 'The main content, holding many blocks.',
              },
            } satisfies NoulQuestion,
          ]),
        ),
      ),
    },
    signal,
  )
  return pending.map((_, index) =>
    Object.fromEntries(
      richText[index].map((d): [string, 'one' | 'many'] => {
        const answer = answers[`${index}:${d.name}`]
        const single = answer?.type === 'noul' && answer.noul >= singlePassageProbability
        return [d.name, single ? 'one' : 'many']
      }),
    ),
  )
}

export function describeDestination(destination: Destination) {
  return `${destination.title} (${destination.type}). ${destination.description}`.trim()
}

export function describeMember(member: Member, registry: SchemaRegistry) {
  const fields = registry
    .fields(member.schema)
    .filter((field) => !field.typeDef.deprecated)
    .map((field) => field.name)
  return `${member.title}. ${member.description} Fields: ${fields.join(', ')}.`.replace('  ', ' ')
}
