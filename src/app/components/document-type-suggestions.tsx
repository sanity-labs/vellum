import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export function DocumentTypeSuggestions({
  suggested,
  alternatives,
  disabled,
  onChoose,
}: {
  suggested: { name: string; title: string } | null
  alternatives: { name: string; title: string; confidence: number }[]
  disabled: boolean
  onChoose: (name: string) => void
}) {
  const [open, setOpen] = useState(false)
  if (!suggested && !alternatives.length) return null

  return (
    <fieldset
      aria-label="Choose a document type and convert"
      className="inline-flex items-stretch text-foreground"
    >
      {suggested && (
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={alternatives.length ? 'rounded-r-none focus-visible:z-10' : undefined}
          onClick={() => onChoose(suggested.name)}
        >
          Use {suggested.title}
        </Button>
      )}
      {alternatives.length > 0 && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              aria-label="Choose another suggested type"
              className={suggested ? '-ml-px rounded-l-none px-2 focus-visible:z-10' : undefined}
            >
              {!suggested && 'Choose a type'}
              <ChevronDown />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 p-0">
            <Command shouldFilter={false}>
              <CommandList aria-label="Suggested document types">
                <CommandGroup heading="Convert as">
                  {alternatives.map((alternative) => (
                    <CommandItem
                      key={alternative.name}
                      value={alternative.name}
                      onSelect={() => {
                        setOpen(false)
                        onChoose(alternative.name)
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate">{alternative.title}</span>
                      <CommandShortcut className="tracking-normal tabular-nums">
                        {Math.round(alternative.confidence * 100)}%
                      </CommandShortcut>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}
    </fieldset>
  )
}
