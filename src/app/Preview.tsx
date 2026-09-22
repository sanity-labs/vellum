import { PortableText, type PortableTextComponents } from '@portabletext/react'
import { z } from 'zod'
import { type ContentNode, contentNode } from '../shared/contracts'

const callout = z.object({
  type: z.string(),
  title: z.string().optional(),
  content: z.array(contentNode),
})
const codeBlock = z.object({
  blocks: z.array(
    z.object({
      _key: z.string(),
      filename: z.string().optional(),
      code: z.object({ code: z.string(), language: z.string().optional() }),
    }),
  ),
})
const link = z.object({ url: z.string().optional(), href: z.string().optional() })
const code = z.object({
  code: z.string(),
  language: z.string().optional(),
  filename: z.string().optional(),
})
const example = z.object({
  example: code.optional(),
  output: code.optional(),
  inputLabel: z.string().optional(),
  outputLabel: z.string().optional(),
})

function CodePreview({ value, label }: { value: z.infer<typeof code>; label?: string }) {
  return (
    <div className="code-block">
      <p className="code-label">{label ?? value.filename ?? value.language ?? 'Code'}</p>
      <pre>
        <code>{value.code}</code>
      </pre>
    </div>
  )
}

const components: Partial<PortableTextComponents> = {
  types: {
    code: ({ value }) => {
      const parsed = code.safeParse(value)
      return parsed.success ? (
        <CodePreview value={parsed.data} />
      ) : (
        <p>Invalid code block. Inspect the JSON output.</p>
      )
    },
    usageExample: ({ value }) => {
      const parsed = example.safeParse(value)
      if (!parsed.success) return <p>Invalid code example. Inspect the JSON output.</p>
      return (
        <>
          {parsed.data.example && (
            <CodePreview value={parsed.data.example} label={parsed.data.inputLabel} />
          )}
          {parsed.data.output && (
            <CodePreview value={parsed.data.output} label={parsed.data.outputLabel ?? 'Output'} />
          )}
        </>
      )
    },
    callout: ({ value }) => {
      const parsed = callout
        .extend({ body: z.array(contentNode), content: z.array(contentNode).optional() })
        .safeParse(value)
      if (!parsed.success) return <p>Invalid callout. Inspect the JSON output.</p>
      return (
        <aside className="callout" data-tone={parsed.data.type}>
          <p className="callout-title">{parsed.data.title ?? parsed.data.type}</p>
          <PortableText value={parsed.data.body} components={components} />
        </aside>
      )
    },
    docsCallout: ({ value }) => {
      const result = callout.safeParse(value)
      if (!result.success) return <p>Invalid callout. Inspect the JSON output.</p>
      return (
        <aside className="callout" data-tone={result.data.type}>
          <p className="callout-title">{result.data.title ?? result.data.type}</p>
          <PortableText value={result.data.content} components={components} />
        </aside>
      )
    },
    codeBlock: ({ value }) => {
      const result = codeBlock.safeParse(value)
      if (!result.success) return <p>Invalid code block. Inspect the JSON output.</p>
      return result.data.blocks.map((block) => (
        <div className="code-block" key={block._key}>
          <p className="code-label">{block.filename ?? block.code.language ?? 'Code'}</p>
          <pre>
            <code>{block.code.code}</code>
          </pre>
        </div>
      ))
    },
  },
  marks: {
    link: ({ children, value }) => {
      const parsed = link.safeParse(value)
      const href = parsed.success ? (parsed.data.url ?? parsed.data.href) : undefined
      const safe = href && /^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(href)
      return safe ? (
        <a href={href} target="_blank" rel="noreferrer">
          {children}
        </a>
      ) : (
        <span>{children}</span>
      )
    },
  },
  unknownType: ({ value }) => {
    const snippet = code.safeParse(value)
    if (snippet.success) return <CodePreview value={snippet.data} />
    const image = z
      .object({ src: z.string().url(), alt: z.string().optional(), title: z.string().optional() })
      .safeParse(value)
    if (image.success && /^https?:\/\//i.test(image.data.src))
      return (
        <figure>
          <img
            src={image.data.src}
            alt={image.data.alt ?? ''}
            loading="lazy"
            className="max-w-full rounded-md"
          />
          {image.data.title && <figcaption>{image.data.title}</figcaption>}
        </figure>
      )
    return <div className="callout">Custom object: {String(value._type)}. Inspect its JSON.</div>
  },
}

export function Preview({ blocks }: { blocks: ContentNode[] }) {
  return (
    <article className="prose-content">
      <PortableText value={blocks} components={components} />
    </article>
  )
}
