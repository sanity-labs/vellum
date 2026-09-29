import type { SchemaFormat } from '../schema/code'
import type { DocumentRunResult } from '../shared/contracts'
import type { Json, JsonObject } from '../shared/json'

type DocumentType = NonNullable<DocumentRunResult['documentType']>

export type AgentPromptInput = {
  document: JsonObject
  documentType: Pick<DocumentType, 'name' | 'title' | 'fields'>
  /** The schema source the document was mapped with. Left out for a pasted descriptor. */
  schema?: { format: SchemaFormat; code: string }
  /** Validation errors, so the agent reports them instead of filling the gaps. */
  errors: string[]
}

/** What each export of the starters' `./define` module stands for in Studio code. */
export const defineHelpers: Record<string, string> = {
  defineType: '`defineType` comes from `sanity`',
  required: '`required` is `(rule) => rule.required()`',
  richText: "`richText` is `{ type: 'array', of: [{ type: 'block' }] }`",
  button:
    '`button` is an object type named `button` with a required `label` string and a required `url`',
}

/** The prompt sanity.new gives people to paste into a coding agent. */
export const sanityNewPrompt =
  'Run npx sanity@latest new --instructions and set up my Sanity project.'

/**
 * A prompt for a coding agent: create a Sanity project with sanity.new, add the schema the
 * document was mapped with, publish the document, and render it.
 */
export function agentPrompt({ document, documentType, schema, errors }: AgentPromptInput) {
  const name = documentType.name
  const id = documentId(document, documentType)
  const empty = documentType.fields.filter((field) => isEmpty(document[field.name]))
  const sections = [
    sanityNewPrompt,
    [
      `Build it around one document type, ${documentType.title} (\`${name}\`), using the schema and document below instead of designing your own. Vellum (https://vellum.sanity.dev) mapped the document from my Markdown, so every value is copied from my text. Keep the values as they are.`,
      '',
      `1. Add the schema to the Studio as a document type named \`${name}\`, so it matches the document's \`_type\`.`,
      `2. Publish the document with the project token, keeping its \`_id\` (\`${id}\`). Use \`createOrReplace\`, so running this again updates it instead of making a copy.`,
      '3. Add a page to the frontend that looks the document up by `_id` with GROQ and renders the fields that have values, including Portable Text.',
      "4. Give me the claim link as soon as you have it, and again at the top of your last message. The project and this document are deleted if I don't claim it within 72 hours.",
    ].join('\n'),
    `## Schema\n\n${schemaSection(documentType, schema)}`,
    `## Document\n\n\`\`\`json\n${JSON.stringify({ _id: id, ...document }, null, 2)}\n\`\`\``,
  ]
  if (empty.length)
    sections.push(
      `## Empty fields\n\nMy Markdown didn't supply these, so they're empty: ${empty.map((field) => `\`${field.name}\``).join(', ')}. Don't fill them in, and don't make the page depend on them. List them in your last message so I can add them to the Markdown.`,
    )
  if (errors.length)
    sections.push(
      `## Validation\n\nSanity validation flagged these. Don't fill the fields in. Tell me what's missing so I can add it to the Markdown.\n\n${errors.map((error) => `- ${error}`).join('\n')}`,
    )
  return `${sections.join('\n\n')}\n`
}

function schemaSection(
  documentType: AgentPromptInput['documentType'],
  schema?: AgentPromptInput['schema'],
) {
  if (!schema) {
    const fields = documentType.fields.map(
      (field) =>
        `- \`${field.name}\` (${field.type})${field.description ? `: ${field.description}` : ''}`,
    )
    return `Write the type from these fields. The document shows the shape of anything nested.\n\n${fields.join('\n')}`
  }
  if (schema.format === 'sanity') {
    const helpers = definedHelpers(schema.code).map(
      (helper) => defineHelpers[helper] ?? `\`${helper}\``,
    )
    const note = helpers.length
      ? `Written for the Vellum playground, which provides its own helpers from \`./define\`. Replace them in Studio code: ${helpers.join(', ')}.`
      : 'A Sanity schema type.'
    return `${note}\n\n\`\`\`js\n${schema.code.trim()}\n\`\`\``
  }
  const markdown =
    "Strings with `format: \"markdown\"` are Portable Text, `{ type: 'array', of: [{ type: 'block' }] }`."
  return schema.format === 'zod'
    ? `A Zod schema. Write it as a Sanity schema type. ${markdown}\n\n\`\`\`js\n${schema.code.trim()}\n\`\`\``
    : `A JSON Schema. Write it as a Sanity schema type. ${markdown}\n\n\`\`\`json\n${schema.code.trim()}\n\`\`\``
}

/**
 * A readable, stable `_id`: the type name and the slug, or the first plain string field in
 * schema order, like `post-the-logo-soup-problem`. No dots, since only an authenticated request
 * can read a document whose id has one: https://www.sanity.io/docs/content-lake/ids
 */
function documentId(document: JsonObject, documentType: AgentPromptInput['documentType']) {
  const slug = document.slug
  const current =
    slug && typeof slug === 'object' && !Array.isArray(slug) && typeof slug.current === 'string'
      ? slug.current
      : undefined
  const label =
    current ??
    documentType.fields
      .filter((field) => field.type === 'string')
      .map((field) => document[field.name])
      .find((value): value is string => typeof value === 'string' && value.trim() !== '')
  const words = (label ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 80)
    .replace(/^-+|-+$/g, '')
  const type = documentType.name.replace(/[^a-zA-Z0-9_-]+/g, '-')
  return words ? `${type}-${words}` : type
}

/** Vellum leaves out what the source doesn't supply; this also catches blank values. */
function isEmpty(value: Json | undefined): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === 'string') return !value.trim()
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object')
    return Object.entries(value).every(([key, item]) => key.startsWith('_') || isEmpty(item))
  return false
}

/** The names a starter imports from `./define`. */
function definedHelpers(code: string) {
  const imports = /import\s*\{([^}]*)\}\s*from\s*['"]\.\/define['"]/.exec(code)
  return (imports?.[1] ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
}
