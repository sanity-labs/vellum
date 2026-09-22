import { memo } from 'react'
import { z } from 'zod'
import { contentNode } from '../shared/contracts'
import type { Json } from '../shared/json'
import { Preview } from './Preview'

function label(name: string) {
  return name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ')
}
type Confidence = Record<string, number>
const sureAbove = 0.85

export const DocumentPreview = memo(function DocumentPreview({
  value,
  confidence = {},
  path = '',
  depth = 0,
}: {
  value: Json
  confidence?: Confidence
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
  return (
    <div className="document-object">
      {typeof value._type === 'string' && depth > 0 && (
        <p className="document-type">{label(value._type)}</p>
      )}
      <dl>
        {Object.entries(value)
          .filter(([name]) => !['_type', '_key'].includes(name))
          .map(([name, child]) => {
            const childPath = path ? `${path}.${name}` : name
            const score = confidence[childPath]
            return (
              <div className="document-field" key={name}>
                <dt>
                  {label(name)}
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
                  <DocumentPreview
                    value={child}
                    confidence={confidence}
                    path={childPath}
                    depth={depth + 1}
                  />
                </dd>
              </div>
            )
          })}
      </dl>
    </div>
  )
})
