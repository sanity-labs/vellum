import { ArrowUpRight, BookOpen } from 'lucide-react'
import { useId } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

/**
 * A toggletip rather than a tooltip: it holds a link, so it opens on click or Enter, takes focus,
 * and closes on Escape.
 */
export function VellumDefinition() {
  const headword = useId()
  return (
    <Popover>
      <PopoverTrigger className="vellum-trigger" aria-label="What does vellum mean?">
        <BookOpen aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="start" className="vellum-definition" aria-labelledby={headword}>
        <p id={headword} className="vellum-headword">
          <span aria-hidden="true">vel·lum</span>
          <span className="sr-only">vellum</span> <span className="vellum-pos">noun</span>
        </p>
        <ol>
          <li>Fine parchment made from calfskin, prepared for writing on.</li>
          <li>Translucent paper that drafters lay over a drawing to trace it.</li>
        </ol>
        <p>This one traces the structure in your Markdown.</p>
        <a
          href="https://www.merriam-webster.com/dictionary/vellum"
          target="_blank"
          rel="noreferrer"
        >
          Merriam-Webster
          <span className="sr-only"> (opens in a new tab)</span>
          <ArrowUpRight aria-hidden="true" />
        </a>
      </PopoverContent>
    </Popover>
  )
}
