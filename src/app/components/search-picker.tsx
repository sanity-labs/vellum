import { ChevronDown } from 'lucide-react'
import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

type Option = { value: string; label: string; description?: string; group?: string }

export function SearchPicker({
  id,
  label,
  value,
  options,
  onChange,
  disabled,
  placeholder = 'Choose…',
}: {
  id: string
  label: string
  value: string
  options: Option[]
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const listId = useId()
  const selected = options.find((option) => option.value === value)
  const groups = [...new Set(options.map((option) => option.group ?? ''))]
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          id={id}
          variant="outline"
          role="combobox"
          aria-label={`${label}: ${selected?.label ?? placeholder}`}
          aria-expanded={open}
          aria-controls={listId}
          disabled={disabled}
          className="w-full min-w-0 justify-between gap-2 font-normal"
        >
          <span className="min-w-0 truncate">{selected?.label ?? placeholder}</span>
          <ChevronDown data-icon="inline-end" className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <Command
          filter={(value, search, keywords = []) => {
            const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
            return [value, ...keywords].some((text) => normalize(text).includes(normalize(search)))
              ? 1
              : 0
          }}
        >
          <CommandInput
            name={`${id}-search`}
            aria-label={`Search ${label.toLowerCase()}`}
            placeholder={`Search ${label.toLowerCase()}…`}
          />
          <CommandList id={listId} className="search-options">
            <CommandEmpty>No matches found.</CommandEmpty>
            {groups.map((group) => (
              <CommandGroup key={group} heading={group || undefined}>
                {options
                  .filter((option) => (option.group ?? '') === group)
                  .map((option) => (
                    <CommandItem
                      key={option.value}
                      value={option.value}
                      keywords={[option.label, option.description ?? '', group]}
                      data-checked={value === option.value}
                      onSelect={() => {
                        onChange(option.value)
                        setOpen(false)
                      }}
                    >
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate">{option.label}</span>
                        {option.description && (
                          <span className="truncate text-xs text-muted-foreground">
                            {option.description}
                          </span>
                        )}
                      </span>
                    </CommandItem>
                  ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
