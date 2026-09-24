import { memo } from 'react'
import { z } from 'zod'
import { contentNode, type FieldEvidence } from '../shared/contracts'
import type { Json } from '../shared/json'
import { Preview } from './Preview'

function label(name: string) {
  return name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ')
}
type Confidence = Record<string, number>
type Evidence = Record<string, FieldEvidence>
type Inspect = {
  evidence: Evidence
  selected?: string
  onSelect: (path: string | undefined) => void
  onShowSource: (evidence: FieldEvidence) => void
}
const sureAbove = 0.85
const noValue = '__none__'

export const DocumentPreview = memo(function DocumentPreview({
  value,
  confidence = {},
  inspect,
  path = '',
  depth = 0,
}: {
  value: Json
  confidence?: Confidence
  inspect?: Inspect
  path?: string
  depth?: number
}) {
  if (value === null) return <span className="text-muted-foreground">Not supplied</span>
  if (typeof value !== 'object') return <p className="document-value">{String(value)}</p>
  if (depth > 30) return <p>Inspect the JSON for deeper content.</p>
  if (Array.isArray(value)) {
    const portableText = z.array(contentNode).safeParse(value)
    if (
      portableText.success &&
      value.some(
        (item) =>
          item && typeof item === 'object' && !Array.isArray(item) && item._type === 'block',
      )
    )
      return <Preview blocks={portableText.data} />
    if (!value.length) return <span className="text-muted-foreground">Empty</span>
    return (
      <ol className="document-items">
        {value.map((item, index) => (
          <li
            key={
              item &&
              typeof item === 'object' &&
              !Array.isArray(item) &&
              typeof item._key === 'string'
                ? item._key
                : index
            }
          >
            <DocumentPreview
              value={item}
              confidence={confidence}
              inspect={inspect}
              path={`${path}[${index}]`}
              depth={depth + 1}
            />
          </li>
        ))}
      </ol>
    )
  }
  if (value._type === 'slug' && typeof value.current === 'string')
    return <p className="document-value">/{value.current.replace(/^\//, '')}</p>
  const present = Object.entries(value).filter(([name]) => !['_type', '_key'].includes(name))
  // Fields Vellum looked for and left empty, so a reviewer can see why.
  const empty = Object.entries(inspect?.evidence ?? {}).flatMap(([key, evidence]) => {
    const name = path ? key.slice(path.length + 1) : key
    const own = path ? key.startsWith(`${path}.`) : true
    return own && evidence.status === 'empty' && /^\w+$/.test(name) && !(name in value)
      ? [name]
      : []
  })
  return (
    <div className="document-object">
      {typeof value._type === 'string' && depth > 0 && (
        <p className="document-type">{label(value._type)}</p>
      )}
      <dl>
        {[...present, ...empty.map((name): [string, undefined] => [name, undefined])].map(
          ([name, child]) => {
            const childPath = path ? `${path}.${name}` : name
            const score = confidence[childPath]
            const evidence = inspect?.evidence[childPath]
            const selected = inspect?.selected === childPath
            return (
              <div className="document-field" key={name} data-selected={selected || undefined}>
                <dt>
                  {evidence && inspect ? (
                    <button
                      type="button"
                      className="field-inspect"
                      aria-expanded={selected}
                      onClick={() => inspect.onSelect(selected ? undefined : childPath)}
                      title="See where this value came from"
                    >
                      {label(name)}
                    </button>
                  ) : (
                    label(name)
                  )}
                  {score !== undefined && (
                    <span
                      className="document-confidence"
                      data-sure={score >= sureAbove}
                      title="How confident the classifier was about this value"
                    >
                      {Math.round(score * 100)}%
                    </span>
                  )}
                </dt>
                <dd>
                  {child === undefined ? (
                    <span className="text-muted-foreground">Left empty</span>
                  ) : (
                    <DocumentPreview
                      value={child}
                      confidence={confidence}
                      inspect={inspect}
                      path={childPath}
                      depth={depth + 1}
                    />
                  )}
                  {selected && evidence && inspect && (
                    <EvidenceCard
                      name={name}
                      evidence={evidence}
                      onShowSource={() => inspect.onShowSource(evidence)}
                    />
                  )}
                </dd>
              </div>
            )
          },
        )}
      </dl>
    </div>
  )
})

function EvidenceCard({
  name,
  evidence,
  onShowSource,
}: {
  name: string
  evidence: FieldEvidence
  onShowSource: () => void
}) {
  const picked = evidence.source?.span ?? (evidence.reason === 'none-chosen' ? noValue : undefined)
  return (
    <section className="evidence" aria-label={`Where ${label(name)} came from`}>
      <p className="evidence-summary">{summary(name, evidence)}</p>
      {evidence.source && (
        <blockquote className="evidence-source">
          <span className="evidence-block">{evidence.source.block}</span>
          {evidence.source.text}
          <button type="button" className="link-button" onClick={onShowSource}>
            Show in source
          </button>
        </blockquote>
      )}
      {evidence.options.length > 0 && (
        <figure className="evidence-question">
          <figcaption>
            Jev was asked: which part of the source supplies <code>{name}</code>?
          </figcaption>
          <ul>
            {evidence.options.map((option) => (
              <li key={option.id} data-picked={option.id === picked || undefined}>
                {option.probability >= 0.02 && (
                  <span
                    className="evidence-bar"
                    style={{ width: `${option.probability * 100}%` }}
                  />
                )}
                <span className="evidence-option">
                  {option.id === noValue ? (
                    <em>Nothing here supplies this field</em>
                  ) : (
                    <>
                      <span className="evidence-block">{option.id}</span> {option.text}
                    </>
                  )}
                </span>
                <span className="evidence-probability">
                  {Math.round(option.probability * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </figure>
      )}
      {evidence.signals && (
        <p className="evidence-signals">
          Asked three ways and kept when two agree: field → part {percent(evidence.signals.pointed)}
          , part → field {percent(evidence.signals.assigned)}
          {evidence.signals.confirmed !== undefined &&
            `, pairing check ${percent(evidence.signals.confirmed)}`}
          .
        </p>
      )}
    </section>
  )
}

function summary(name: string, evidence: FieldEvidence) {
  switch (evidence.reason) {
    case 'copied':
      return 'Copied word for word from the source. Jev picked the part; code copied it.'
    case 'no-candidates':
      return `Nothing in the source can be copied into ${label(name)}, so Jev was never asked. Nothing was written in its place.`
    case 'none-chosen':
      return 'Jev was shown every part that could fit and answered that none of them supplies this field. It stays empty rather than being written.'
    case 'below-threshold':
      return 'Jev leaned toward a part, but not enough of the three signals cleared the confidence threshold. It stays empty for review.'
  }
}

function percent(probability: number) {
  return `${Math.round(probability * 100)}%`
}
