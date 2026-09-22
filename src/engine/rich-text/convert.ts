import {
  type Degradation,
  markdownToPortableText,
  portableTextToMarkdown,
} from '@portabletext/markdown'
import { compileSchema, type FieldDefinition } from '@portabletext/schema'
import { z } from 'zod'
import { contentNode } from '../../shared/contracts'
import {
  defaultSchema,
  type RichTextTarget,
  type SchemaNode,
  type SchemaRegistry,
} from '../schema/registry'
import { candidatesFor, type SourceNode } from './candidates'

function linkFields(schema: SchemaNode, registry: SchemaRegistry) {
  const fields = registry.fields(schema)
  const urls = fields.filter((field) => field.typeDef.extends === 'url')
  return urls.length
    ? urls
    : fields.filter(
        (field) => field.typeDef.extends === 'string' && ['url', 'href'].includes(field.name),
      )
}

export function conversionOptions(
  target: RichTextTarget,
  registry: SchemaRegistry = defaultSchema,
) {
  const { choices, field, fields, members } = registry
  const annotations = members(field(target.block, 'markDefs') ?? { extends: 'array' })
  const links = annotations.flatMap((annotation) =>
    linkFields(annotation.typeDef, registry).map((field) => ({ annotation, field })),
  )
  const link = links.length === 1 ? links[0] : undefined
  const customObject = (source: SourceNode, key: () => string) => {
    const candidates = candidatesFor(source, target, registry, false).filter((c) => !c.deprecated)
    if (candidates.length !== 1 || candidates[0].requiresClassification) return undefined
    const value = candidates[0].build()
    return value && typeof value._type === 'string'
      ? { ...value, _type: value._type, _key: key() }
      : undefined
  }
  const schema = compileSchema({
    styles: target.styles.map((name) => ({ name })),
    lists: choices(field(target.block, 'listItem')).map((name) => ({ name })),
    decorators: ['strong', 'em', 'code', 'underline', 'strike-through'].map((name) => ({ name })),
    annotations: annotations.map((a) => ({
      name: a.name,
      fields: fields(a.typeDef).map(
        (f): FieldDefinition => ({
          name: f.name,
          type:
            f.typeDef.extends === 'boolean'
              ? 'boolean'
              : f.typeDef.extends === 'reference'
                ? 'object'
                : 'string',
        }),
      ),
    })),
    blockObjects: members(target.schema)
      .filter((member) => !['block', 'span'].includes(member.typeDef.extends))
      .map((member) => ({
        name: member.name,
        fields: fields(member.typeDef).map(
          (f): FieldDefinition => ({
            name: f.name,
            type: f.typeDef.extends === 'array' ? 'array' : 'string',
          }),
        ),
      })),
  })
  const options: NonNullable<Parameters<typeof markdownToPortableText>[1]> = {
    schema,
    html: { inline: 'text' },
    marks: {
      link: ({ context, value }) => {
        if (!link) return undefined
        return {
          _type: link.annotation.name,
          _key: context.keyGenerator(),
          [link.field.name]: value.href,
        }
      },
    },
    types: {
      code: ({ context, value }) =>
        customObject(
          { kind: 'code', code: value.code, language: value.language },
          context.keyGenerator,
        ),
      callout: ({ context, value }) =>
        customObject(
          { kind: 'callout', tone: value.tone, content: z.array(contentNode).parse(value.content) },
          context.keyGenerator,
        ),
    },
  }
  return options
}

export function convert(
  markdown: string,
  target: RichTextTarget,
  registry: SchemaRegistry = defaultSchema,
) {
  const degradations: Degradation[] = []
  const blocks = z.array(contentNode).parse(
    markdownToPortableText(markdown, {
      ...conversionOptions(target, registry),
      onDegradation: (report) => degradations.push(...report.degradations),
    }),
  )
  return {
    blocks,
    warnings: degradations.map((d) => `${d.line ? `Line ${d.line}: ` : ''}${d.message}`),
  }
}

export function serializationOptions(
  target: RichTextTarget,
  registry: SchemaRegistry = defaultSchema,
) {
  return {
    schema: conversionOptions(target, registry).schema,
    marks: Object.fromEntries(
      target.annotations.map((name) => [
        name,
        ({ children, value }: { children?: string; value?: Record<string, unknown> }) => {
          const annotation = registry
            .members(registry.field(target.block, 'markDefs') ?? { extends: 'array' })
            .find((member) => member.name === name)
          const candidates = annotation ? linkFields(annotation.typeDef, registry) : []
          const url = candidates.length === 1 ? value?.[candidates[0].name] : undefined
          return typeof url === 'string' ? `[${children ?? ''}](${url})` : (children ?? '')
        },
      ]),
    ),
  }
}

export function serialize(
  blocks: z.infer<typeof contentNode>[],
  target: RichTextTarget,
  registry: SchemaRegistry = defaultSchema,
) {
  return portableTextToMarkdown(blocks, serializationOptions(target, registry))
}
