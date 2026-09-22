import { z } from 'zod'
import type { Json } from '../../shared/json'
import rawDescriptor from './admin-schema.json'

type Rule = {
  type: string
  value?: Json
  values?: Json[]
}
export type SchemaNode = {
  extends: string
  title?: string
  description?: string
  deprecated?: { reason: string }
  fields?: Member[]
  of?: Member[]
  options?: { list?: Json[] }
  validation?: { level?: string; rules: Rule[] }[]
}
type Member = { name: string; typeDef: SchemaNode } | { __type: 'hoisted'; key: string }
const node: z.ZodType<SchemaNode> = z.lazy(() =>
  z
    .object({
      extends: z.string(),
      title: z.string().optional(),
      description: z.string().catch('').optional(),
      deprecated: z.object({ reason: z.string() }).optional(),
      fields: z.array(member).optional(),
      of: z.array(member).optional(),
      options: z
        .object({ list: z.array(z.json()).optional() })
        .passthrough()
        .catch({})
        .optional(),
      validation: z
        .array(
          z
            .object({
              level: z.string().default('error'),
              rules: z.array(
                z
                  .object({
                    type: z.string(),
                    value: z.json().optional(),
                    values: z.array(z.json()).optional(),
                  })
                  .passthrough(),
              ),
            })
            .passthrough(),
        )
        .optional(),
    })
    .passthrough(),
)
const member: z.ZodType<Member> = z.lazy(() =>
  z.union([
    z.object({ name: z.string(), typeDef: node }),
    z.object({ __type: z.literal('hoisted'), key: z.string() }),
  ]),
)
const descriptorSchema = z.object({
  types: z.record(z.string(), node),
  hoisted: z.record(z.string(), member).default({}),
})

export const schemaSource =
  'https://github.com/sanity-io/schema-descriptor-utils/blob/main/fixtures/admin-schema.json'
export function createSchema(raw: unknown) {
  const parsed = descriptorSchema.safeParse(raw)
  if (!parsed.success)
    throw new Error(
      'Paste schema-descriptor JSON with a types object and optional hoisted definitions. Studio JavaScript and extracted type arrays are not supported yet.',
    )
  const descriptor = parsed.data
  const typeCount = Object.keys(descriptor.types).length

  function resolveType(schema: SchemaNode, visited = new Set<string>()): SchemaNode {
    const parent = Object.hasOwn(descriptor.types, schema.extends)
      ? descriptor.types[schema.extends]
      : undefined
    if (visited.has(schema.extends)) throw new Error(`Cyclic schema type: ${schema.extends}`)
    if (!parent) return schema
    const resolved = resolveType(parent, new Set([...visited, schema.extends]))
    return { ...resolved, ...schema, extends: resolved.extends }
  }

  function resolveMember(
    value: Member,
    visited = new Set<string>(),
  ): { name: string; typeDef: SchemaNode; declaredType: string } {
    if ('name' in value)
      return {
        name: value.name,
        typeDef: resolveType(value.typeDef),
        declaredType: value.typeDef.extends,
      }
    if (visited.has(value.key)) throw new Error(`Cyclic schema definition: ${value.key}`)
    const found = descriptor.hoisted[value.key]
    if (!found) throw new Error(`Missing schema definition: ${value.key}`)
    return resolveMember(found, new Set([...visited, value.key]))
  }

  function fields(schema: SchemaNode) {
    const resolved = resolveType(schema)
    const fields = (resolved.fields ?? []).map((f) => resolveMember(f))
    // Descriptors can omit the built-in string field stored at slug.current.
    if (resolved.extends === 'slug' && !fields.some((field) => field.name === 'current'))
      fields.push(resolveMember({ name: 'current', typeDef: { extends: 'string' } }))
    return fields
  }
  function members(schema: SchemaNode) {
    return (resolveType(schema).of ?? []).map((m) => resolveMember(m))
  }
  function field(schema: SchemaNode, name: string) {
    return fields(schema).find((f) => f.name === name)?.typeDef
  }
  function choices(schema: SchemaNode | undefined): string[] {
    return (schema?.options?.list ?? []).flatMap((item) => {
      if (typeof item === 'string') return [item]
      if (
        item &&
        typeof item === 'object' &&
        !Array.isArray(item) &&
        typeof item.value === 'string'
      )
        return [item.value]
      return []
    })
  }

  function richTextTarget(schema: SchemaNode, id: string, title = id) {
    const block = members(schema).find((m) => m.typeDef.extends === 'block')
    if (!block) return undefined
    return {
      id,
      title,
      styles: choices(field(block.typeDef, 'style')),
      members: members(schema).map((m) => m.name),
      annotations: members(field(block.typeDef, 'markDefs') ?? { extends: 'array' }).map(
        (m) => m.name,
      ),
      schema,
      block: block.typeDef,
    }
  }
  const documents = Object.entries(descriptor.types)
    .filter(([, schema]) => resolveType(schema).extends === 'document')
    .map(([name, schema]) => ({
      name,
      title: schema.title ?? name,
      description: schema.description ?? '',
      fields: fields(schema).map((f) => ({
        name: f.name,
        title: f.typeDef.title ?? f.name,
        type: f.typeDef.extends,
        description: f.typeDef.description ?? '',
      })),
    }))
    .sort((a, b) => a.title.localeCompare(b.title))
  function getDocument(name: string) {
    const summary = documents.find((d) => d.name === name)
    if (!summary) throw new Error('Select a document type from the supplied schema.')
    return { ...summary, schema: descriptor.types[name] }
  }
  function listTargets() {
    return documents
      .flatMap((document) =>
        fields(getDocument(document.name).schema).flatMap((f) => {
          const target = richTextTarget(
            f.typeDef,
            `${document.name}.${f.name}`,
            `${document.title} / ${f.typeDef.title ?? f.name}`,
          )
          return target ? [{ ...target, documentType: document.name, field: f.name }] : []
        }),
      )
      .sort((a, b) => a.title.localeCompare(b.title))
  }
  const targets = listTargets()
  function getTarget(id: string) {
    const target = targets.find((item) => item.id === id)
    if (!target) throw new Error('Select a rich-text field from the supplied schema.')
    return target
  }
  function summarize(target: ReturnType<typeof getTarget>) {
    const { schema: _schema, block: _block, ...summary } = target
    return summary
  }

  return {
    descriptor: {
      ...descriptor,
      hoisted: Object.fromEntries(
        Object.entries(descriptor.hoisted).map(([key, value]) => [key, resolveMember(value)]),
      ),
      registries: [],
    },
    typeCount,
    resolveType,
    resolveMember,
    fields,
    members,
    field,
    choices,
    targets,
    getTarget,
    summarize,
    documents,
    getDocument,
    richTextTarget,
  }
}
export const defaultSchema = createSchema(rawDescriptor)
export type SchemaRegistry = ReturnType<typeof createSchema>
export type RichTextTarget = NonNullable<ReturnType<SchemaRegistry['richTextTarget']>>
export function loadSchema(source?: string) {
  if (!source) return defaultSchema
  let raw: unknown
  try {
    raw = JSON.parse(source)
  } catch {
    throw new Error('The schema is not valid JSON. Check its commas and brackets.')
  }
  return createSchema(raw)
}
