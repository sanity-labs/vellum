import { Schema } from '@sanity/schema'
import {
  builtinTypes,
  DescriptorConverter,
  groupProblems,
  validateSchema,
} from '@sanity/schema/_internal'
import { z } from 'zod'

/** A Studio type definition, the plain object `defineType` returns. */
export type TypeDefinition = Parameters<typeof groupProblems>[0][number]
export type SchemaDescriptor = { types: Record<string, unknown>; hoisted: Record<string, unknown> }

const namedType = z.object({
  type: z.literal('sanity.schema.namedType'),
  name: z.string(),
  // Built-in roots have `extends: null`.
  typeDef: z.looseObject({ extends: z.string() }),
})
const hoistedType = z.object({
  type: z.literal('sanity.schema.hoisted'),
  key: z.string(),
  value: z.unknown(),
})
// Built-in types (slug, geopoint, image assets) come with every compiled schema already.
const builtinNames = new Set(builtinTypes.map((type: { name: string }) => type.name))

/**
 * Compiles Studio-style type definitions (what `defineType` returns) into the schema
 * descriptor JSON that Vellum's server reads.
 */
export async function descriptorFromTypes(types: TypeDefinition[]): Promise<SchemaDescriptor> {
  const errors = groupProblems(validateSchema(types).getTypes()).flatMap((group) =>
    group.problems
      .filter((problem) => problem.severity === 'error')
      .map(
        (problem) =>
          `${group.path.map((segment) => segment.name ?? segment.kind).join('.')}: ${problem.message}`,
      ),
  )
  if (errors.length) throw new Error(`The schema has errors:\n${errors.join('\n')}`)
  const schema = Schema.compile({ name: 'vellum', types: [...builtinTypes, ...types] })
  const { objectValues } = await new DescriptorConverter().get(schema)
  const values = Object.values(objectValues) as unknown[]
  const named = values.flatMap((value) => {
    const parsed = namedType.safeParse(value)
    return parsed.success && !builtinNames.has(parsed.data.name) ? [parsed.data] : []
  })
  const hoisted = values.flatMap((value) => {
    const parsed = hoistedType.safeParse(value)
    return parsed.success ? [parsed.data] : []
  })
  return {
    types: Object.fromEntries(named.map((value) => [value.name, value.typeDef])),
    hoisted: Object.fromEntries(hoisted.map((value) => [value.key, value.value])),
  }
}
