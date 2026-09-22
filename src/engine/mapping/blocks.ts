import MarkdownIt, { type Token } from 'markdown-it'
import { decideInBatches, type NoulQuestion } from '../jev/jev'

type BlockKind =
  | 'heading'
  | 'paragraph'
  | 'list item'
  | 'quote'
  | 'table'
  | 'code'
  | 'image'
  | 'rule'
  | 'html'
export type Span = { id: string; text: string; note?: string }
export type Block = Span & {
  kind: BlockKind
  level?: number
  content: string
  spans: Span[]
}
type Piece = {
  kind: BlockKind
  text: string
  content: string
  level?: number
  inline?: Token
}
type Line = { text: string; parent: number }

const parser = new MarkdownIt('commonmark', { linkify: true }).enable(['table', 'linkify'])
const trailingSeparators = /[\s\p{P}\p{S}]+$/u
const listMarker = /^\s*(?:[-+*]|\d+[.)])\s+/
const labelPattern = /^([^:.!\n]{1,80}):[ \t]+(\S.*)$/
const terminalPunctuation = /[.!?:;…]["')\]]*$/
const joinAfterDangling = 0.2
const joinAfterTerminal = 0.5
const kinds: Record<string, BlockKind> = {
  heading_open: 'heading',
  paragraph_open: 'paragraph',
  list_item_open: 'list item',
  blockquote_open: 'quote',
  table_open: 'table',
  fence: 'code',
  code_block: 'code',
  hr: 'rule',
  html_block: 'html',
}

export function splitBlocks(source: string): Block[] {
  return pieces(source).map(describe)
}

export function changedBlocks(blocks: Block[], other: Block[]) {
  const known = new Set(other.map((block) => block.text))
  return blocks.filter((block) => !known.has(block.text))
}

export async function stitchLines(blocks: Block[], signal: AbortSignal): Promise<Block[]> {
  const lines: Line[] = blocks.flatMap((block, parent) =>
    block.kind === 'paragraph' || block.kind === 'list item'
      ? block.text.split('\n').map((text) => ({ text: text.trim(), parent }))
      : [{ text: block.text, parent }],
  )
  const ids = lines.map((_, index) => `L${String(index).padStart(3, '0')}`)
  const pairs = lines.flatMap((line, index) =>
    index > 0 && lines[index - 1].parent === line.parent ? [index] : [],
  )
  if (!pairs.length) return blocks
  const { answers } = await decideInBatches(
    {
      state: tagBlocks(lines.map((line, index) => ({ id: ids[index], text: line.text }))),
      questions: Object.fromEntries(
        pairs.map((index) => [
          `join:${ids[index]}`,
          continuationQuestion(ids[index - 1], ids[index]),
        ]),
      ),
    },
    signal,
  )
  const texts: string[] = []
  for (const [index, line] of lines.entries()) {
    const previous = lines[index - 1]
    const threshold =
      previous && terminalPunctuation.test(previous.text) ? joinAfterTerminal : joinAfterDangling
    const answer = answers[`join:${ids[index]}`]
    const joins = answer?.type === 'noul' && answer.noul >= threshold
    if (joins && texts.length) texts[texts.length - 1] += `\n${line.text}`
    else texts.push(line.text)
  }
  return texts.flatMap(pieces).map(describe)
}

function continuationQuestion(previousId: string, lineId: string): NoulQuestion {
  return {
    type: 'noul',
    instructions: `Does line ${lineId} pick up mid-sentence, continuing a sentence left unfinished at the end of line ${previousId}?`,
    criteria: {
      true: 'The line starts in the middle of a sentence that began on the previous line.',
      false: 'The line begins a new sentence, item, heading, label, or thought of its own.',
    },
  }
}

function pieces(source: string): Piece[] {
  const lines = source.split('\n')
  const tokens = parser.parse(source, {})
  const result: Piece[] = []
  for (const [index, token] of tokens.entries()) {
    const kind = kinds[token.type]
    if (!kind || !token.map || token.level > Number(kind === 'list item')) continue
    const text = lines.slice(token.map[0], token.map[1]).join('\n').trim()
    if (!text) continue
    const inline = inlineOf(tokens, index)
    const content = contentOf(kind, text, inline)
    result.push({ kind, text, level: headingLevel(token), inline, content })
  }
  return result
}

function inlineOf(tokens: Token[], index: number) {
  for (let next = index + 1; next < tokens.length; next++) {
    if (tokens[next].level <= tokens[index].level) return undefined
    if (tokens[next].type === 'inline') return tokens[next]
  }
  return undefined
}

function headingLevel(token: Token) {
  return token.type === 'heading_open' ? Number(token.tag.slice(1)) : undefined
}

function contentOf(kind: BlockKind, text: string, inline?: Token) {
  if (kind === 'heading') return inline?.content.trim() ?? text
  if (kind === 'list item') return text.replace(listMarker, '')
  return text
}

function describe(piece: Piece, index: number): Block {
  const id = blockId(index)
  const whole: Span = { id, text: piece.text }
  const children = piece.inline?.children ?? []
  const base = { ...whole, level: piece.level, content: piece.content }
  if (piece.kind === 'paragraph' && children.length === 1 && children[0].type === 'image')
    return { ...base, kind: 'image', spans: [] }
  if (piece.kind === 'code' || piece.kind === 'rule' || piece.kind === 'html')
    return { ...base, kind: piece.kind, spans: [] }
  const parts =
    piece.kind === 'paragraph' || piece.kind === 'list item'
      ? partsOf(whole, piece.content, children)
      : []
  return { ...base, kind: piece.kind, spans: [whole, ...parts] }
}

function blockId(index: number) {
  return `B${String(index).padStart(3, '0')}`
}

function partsOf(block: Span, content: string, children: Token[]): Span[] {
  const labeled = labelPattern.exec(content)
  const value = labeled
    ? [part(block, 'value', labeled[2], `text after the label "${labeled[1]}"`)]
    : []
  const link = content.includes('\n') ? undefined : singleLink(children, labeled?.[1])
  if (!link) return value
  return [
    ...value,
    part(block, 'text', link.text, 'the text beside the link'),
    part(block, 'href', link.href, 'link target'),
  ]
}

function singleLink(children: Token[], label?: string) {
  const opens = children.filter((token) => token.type === 'link_open')
  if (opens.length !== 1) return undefined
  const href = opens[0].attrGet('href')
  if (typeof href !== 'string' || !href) return undefined
  const first = children.indexOf(opens[0])
  const last = children.findIndex((token, index) => index > first && token.type === 'link_close')
  const outside = textOf([...children.slice(0, first), ...children.slice(last + 1)])
  const beside = (label ? outside.replace(`${label}:`, '') : outside)
    .replace(trailingSeparators, '')
    .trim()
  const text = beside || textOf(children.slice(first + 1, last))
  return text ? { href, text } : undefined
}

function textOf(tokens: Token[]) {
  return tokens
    .filter((token) => token.type === 'text' || token.type === 'code_inline')
    .map((token) => token.content)
    .join('')
}

function part(block: Span, name: string, text: string, note: string): Span {
  return { id: `${block.id}.${name}`, text, note }
}

export function spanText(span: Span, block: Block) {
  return span.id === block.id ? block.content : span.text
}

export function tagBlocks(blocks: { id: string; text: string; spans?: Span[] }[]): string {
  return blocks
    .flatMap((block) => [
      `${block.id}| ${block.text.replaceAll('\n', '\n    | ')}`,
      ...(block.spans ?? [])
        .filter((span) => span.id !== block.id)
        .map((span) => `  ${span.id}| ${span.text}`),
    ])
    .join('\n')
}
