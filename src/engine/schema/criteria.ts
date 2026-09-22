import { processSchema } from '@sanity/agent-schema'
import { convertToDefinition } from '@sanity/schema-descriptor-utils'
import type { SchemaRegistry } from './registry'

const contexts = new WeakMap<SchemaRegistry, Record<string, string>>()
const schemas = new WeakMap<SchemaRegistry, ReturnType<typeof prepareSchema>>()

function prepareSchema(registry: SchemaRegistry) {
  const manifest = convertToDefinition(
    {
      ...registry.descriptor,
      types: Object.fromEntries(
        Object.entries(registry.descriptor.types).map(([name, type]) => [
          name,
          registry.resolveType(type),
        ]),
      ),
    },
    { format: 'manifest' },
  )
  return { types: manifest.types, ...processSchema(manifest.types) }
}

function schemaData(registry: SchemaRegistry) {
  let data = schemas.get(registry)
  if (!data) {
    data = prepareSchema(registry)
    schemas.set(registry, data)
  }
  return data
}

export function documentCriteria(registry: SchemaRegistry) {
  const cached = contexts.get(registry)
  if (cached) return cached

  const { documentTypes } = schemaData(registry)
  const documents = registry.documents.flatMap(({ name }) => {
    const document = documentTypes.get(name)
    return document ? [document] : []
  })
  const descriptionCounts = new Map<string, number>()
  for (const document of documents)
    for (const description of new Set(document.fields.map((field) => field.description)))
      if (description)
        descriptionCounts.set(description, (descriptionCounts.get(description) ?? 0) + 1)

  const criteria = Object.fromEntries(
    documents.map((document) => [
      document.name,
      [
        `Title: ${document.title ?? document.name}`,
        document.description ? `Description: ${document.description}` : '',
        `Fields: ${document.fields
          .map((field) => {
            const title =
              field.title && field.title.toLowerCase() !== field.name.toLowerCase()
                ? ` [${field.title}]`
                : ''
            const description =
              field.description && (descriptionCounts.get(field.description) ?? 0) < 4
                ? `: ${field.description}`
                : ''
            return `${field.name}${title}${description}`
          })
          .join('; ')}`,
      ]
        .filter(Boolean)
        .join('\n'),
    ]),
  )
  contexts.set(registry, criteria)
  return criteria
}
