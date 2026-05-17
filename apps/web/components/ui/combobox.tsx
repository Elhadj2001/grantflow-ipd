'use client';

import * as React from 'react';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export interface ComboboxOption {
  value: string;
  label: string;
  sublabel?: React.ReactNode;
  searchText?: string;
  disabled?: boolean;
  rightSlot?: React.ReactNode;
}

export interface ComboboxProps {
  options: ComboboxOption[];
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: React.ReactNode;
  loading?: boolean;
  disabled?: boolean;
  clearable?: boolean;
  className?: string;
  contentClassName?: string;
  triggerLabel?: React.ReactNode;
  /** Controlled search query — used for server-side search. */
  search?: string;
  onSearchChange?: (q: string) => void;
  /** When true, disables cmdk's default filtering (server-side search). */
  serverFilter?: boolean;
  testId?: string;
}

export function Combobox({
  options,
  value,
  onChange,
  placeholder = 'Sélectionner…',
  searchPlaceholder = 'Rechercher…',
  emptyText = 'Aucun résultat.',
  loading = false,
  disabled = false,
  clearable = true,
  className,
  contentClassName,
  triggerLabel,
  search,
  onSearchChange,
  serverFilter = false,
  testId,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const selected = options.find((o) => o.value === value) ?? null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          data-testid={testId}
          className={cn(
            'w-full justify-between font-normal',
            !selected && 'text-slate-muted',
            className,
          )}
        >
          <span className="truncate">
            {triggerLabel ?? selected?.label ?? placeholder}
          </span>
          <div className="ml-2 flex shrink-0 items-center gap-1">
            {clearable && selected && !disabled ? (
              <span
                role="button"
                aria-label="Effacer la sélection"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(null);
                }}
                className="rounded p-0.5 hover:bg-slate-100"
              >
                <X className="h-3.5 w-3.5 text-slate-muted" />
              </span>
            ) : null}
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={cn('w-[var(--radix-popover-trigger-width)] p-0', contentClassName)}
        align="start"
      >
        <Command shouldFilter={!serverFilter}>
          <CommandInput
            placeholder={searchPlaceholder}
            value={search}
            onValueChange={onSearchChange}
          />
          <CommandList>
            {loading ? (
              <div className="space-y-2 p-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : (
              <>
                <CommandEmpty>{emptyText}</CommandEmpty>
                <CommandGroup>
                  {options.map((opt) => (
                    <CommandItem
                      key={opt.value}
                      value={opt.searchText ?? `${opt.label} ${typeof opt.sublabel === 'string' ? opt.sublabel : ''}`}
                      disabled={opt.disabled}
                      onSelect={() => {
                        onChange(opt.value);
                        setOpen(false);
                      }}
                      data-testid={`combobox-item-${opt.value}`}
                    >
                      <Check
                        className={cn(
                          'mr-2 h-4 w-4',
                          value === opt.value ? 'opacity-100 text-ipd-darker' : 'opacity-0',
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate">{opt.label}</div>
                        {opt.sublabel && (
                          <div className="truncate text-xs text-slate-muted">{opt.sublabel}</div>
                        )}
                      </div>
                      {opt.rightSlot && (
                        <div className="ml-2 shrink-0">{opt.rightSlot}</div>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
