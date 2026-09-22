import type { ContentNode } from '../../shared/contracts'
import type { Json } from '../../shared/json'
import type { RichTextTarget, SchemaNode, SchemaRegistry } from '../schema/registry'

export type SourceNode =
  | { kind: 'image'; src: string; alt: string; title?: string }
  | { kind: 'code'; code: string; language?: string }
  | { kind: 'callout'; tone: string; content: ContentNode[] }
export type Candidate = {
  id: string
  description: string
  deprecated: boolean
  needsAsset: boolean
  direct: boolean
  requiresClassification: boolean
  build: () => Record<string, Json> | undefined
}

export function candidatesFor(
  source: SourceNode,
  target: RichTextTarget,
  registry: SchemaRegistry,
  inline: boolean,
) {
  const candidates: Candidate[] = []
  const members = inline
    ? registry.members(registry.field(target.block, 'children') ?? { extends: 'array' })
    : registry.members(target.schema)
  function visit(
    input: SchemaNode,
    path: string[],
    description: string,
    wrap: (value: Record<string, Json>) => Record<string, Json>,
    depth = 0,
    deprecated = false,
  ) {
    if (depth > 3) return
    const schema = registry.resolveType(input)
    const fields = registry.fields(schema)
    deprecated ||= Boolean(schema.deprecated) || /\bdeprecated\b/i.test(schema.title ?? '')
    const named = (name: string) => {
      const matches = fields.filter((field) =>
        [field.name, field.typeDef.title?.toLowerCase()].includes(name),
      )
      return matches.length === 1 ? matches[0] : undefined
    }
    const add = (build: Candidate['build'], binding = '', requiresClassification = false) =>
      candidates.push({
        id: `c${candidates.length}`,
        description: `${path.join('.')} (${description})${binding ? `. ${binding}` : ''}`,
        deprecated,
        needsAsset: schema.extends === 'image',
        direct: path.length === 1,
        requiresClassification,
        build: () => {
          const value = build()
          return value && wrap(value)
        },
      })
    if (source.kind === 'image') {
      if (schema.extends === 'image') {
        // A schema descriptor has no destination dataset or verified asset lookup.
        add(() => undefined)
        return
      }
      const urls = fields.filter(
        (f) =>
          f.typeDef.extends === 'url' ||
          (f.typeDef.extends === 'string' &&
            ['src', 'url', 'imageUrl'].some((name) => named(name)?.name === f.name)),
      )
      for (const url of urls) {
        const alt = named('alt')
        const title = named('title')
        add(
          () => ({
            [url.name]: source.src,
            ...(alt && ['string', 'text'].includes(alt.typeDef.extends)
              ? { [alt.name]: source.alt }
              : {}),
            ...(title && title.typeDef.extends === 'string' && source.title
              ? { [title.name]: source.title }
              : {}),
          }),
          `Image URL → ${url.name}. ${url.typeDef.description ?? ''}`,
          !/image|figure|photo|picture|screenshot/i.test(
            `${path.at(-1)} ${schema.title ?? ''} ${schema.description ?? ''}`,
          ),
        )
      }
    }
    if (source.kind === 'code' && schema.extends === 'object') {
      const code = named('code')
      if (code && ['string', 'text'].includes(code.typeDef.extends)) {
        const language = named('language')
        add(() => ({
          [code.name]: source.code,
          ...(language?.typeDef.extends === 'string' && source.language
            ? { [language.name]: source.language }
            : {}),
        }))
        return
      }
      for (const payload of fields.filter((field) => field.typeDef.extends === 'text')) {
        const languages = fields.filter(
          (field) =>
            field.typeDef.extends === 'string' &&
            (!registry.choices(field.typeDef).length ||
              registry.choices(field.typeDef).includes(source.language ?? '')),
        )
        for (const language of source.language && languages.length ? languages : [undefined])
          add(
            () => ({
              [payload.name]: source.code,
              ...(language && source.language ? { [language.name]: source.language } : {}),
            }),
            `Code → ${payload.name} (${payload.typeDef.title ?? ''}). ${payload.typeDef.description ?? ''}${language ? ` Language → ${language.name} (${language.typeDef.title ?? ''}). ${language.typeDef.description ?? ''}` : ''}`,
            true,
          )
      }
    }
    if (source.kind === 'callout') {
      const bodies = fields.filter((f) => registry.richTextTarget(f.typeDef, f.name))
      const tones = fields.filter(
        (f) => f.typeDef.extends === 'string' && registry.choices(f.typeDef).length,
      )
      const aliases: Record<string, string> = {
        note: 'info',
        caution: 'warning',
        important: 'warning',
      }
      for (const body of bodies)
        for (const tone of tones) {
          const allowed = registry.choices(tone.typeDef)
          const exact =
            allowed.find((value) => value === source.tone) ??
            allowed.find((value) => value === aliases[source.tone])
          for (const value of exact ? [exact] : allowed)
            add(
              () => ({ [body.name]: source.content, [tone.name]: value }),
              `Callout text → ${body.name} (${body.typeDef.title ?? ''}); tone → ${tone.name} = ${value}. ${tone.typeDef.description ?? ''}`,
              !exact,
            )
        }
    }
    if (schema.extends !== 'object') return
    for (const field of fields) {
      if (
        field.typeDef.extends === 'array' &&
        !registry.richTextTarget(field.typeDef, field.name)
      ) {
        for (const member of registry.members(field.typeDef)) {
          if (member.typeDef.extends !== 'object') continue
          visit(
            member.typeDef,
            [...path, field.name, member.name],
            `${description}. ${field.typeDef.description ?? ''}. ${member.typeDef.description ?? ''}`,
            (value) =>
              wrap({ [field.name]: [{ ...value, _type: member.name, _key: crypto.randomUUID() }] }),
            depth + 1,
            deprecated,
          )
        }
        continue
      }
      if (!['object', 'image', 'code'].includes(field.typeDef.extends)) continue
      visit(
        field.typeDef,
        [...path, field.name],
        `${description}. Field: ${field.typeDef.title ?? field.name}. ${field.typeDef.description ?? ''}. Only this field is filled; optional sibling fields may be omitted.`,
        (value) =>
          wrap({
            [field.name]: {
              ...value,
              ...(Object.hasOwn(registry.descriptor.types, field.declaredType)
                ? { _type: field.declaredType }
                : {}),
            },
          }),
        depth + 1,
        deprecated,
      )
    }
  }
  for (const member of members) {
    if (['block', 'span', 'reference'].includes(member.typeDef.extends)) continue
    const schema = member.typeDef
    visit(
      schema,
      [member.name],
      [schema.title, schema.description, schema.deprecated?.reason].filter(Boolean).join('. '),
      (value) => ({ ...value, _type: member.name }),
    )
  }
  if (source.kind === 'code' && candidates.some((candidate) => !candidate.requiresClassification))
    return candidates.filter((candidate) => !candidate.requiresClassification)
  return candidates
}
