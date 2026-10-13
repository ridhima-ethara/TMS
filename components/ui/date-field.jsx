"use client"

// Themed date picker that replaces the browser's native <input type="date">.
// Value in and out is a "YYYY-MM-DD" string, same as the native input, so call
// sites keep their existing state and API formats.
import * as React from "react"
import { CalendarDays } from "lucide-react"

import { cn } from "@/lib/utils"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

const KEY = /^(\d{4})-(\d{2})-(\d{2})$/

function parseKey(value) {
  const match = KEY.exec(value || "")
  if (!match) return undefined
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

function toKey(date) {
  const pad = (n) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const label = (date) =>
  date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })

export function DateField({
  value,
  onChange,
  min,
  max,
  placeholder = "Select date",
  clearable = false,
  disabled = false,
  align = "start",
  className,
  id,
  "aria-label": ariaLabel,
}) {
  const [open, setOpen] = React.useState(false)
  const selected = parseKey(value)
  const minDate = parseKey(min)
  const maxDate = parseKey(max)
  const blocked = [
    ...(minDate ? [{ before: minDate }] : []),
    ...(maxDate ? [{ after: maxDate }] : []),
  ]
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayAllowed = (!minDate || today >= minDate) && (!maxDate || today <= maxDate)
  const pick = (date) => {
    if (!date) return
    onChange?.(toKey(date))
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          disabled={disabled}
          aria-label={ariaLabel}
          className={cn(
            "inline-flex h-9 min-w-[140px] items-center justify-between gap-2 rounded-md border border-[#e0dfdb] bg-white px-3 text-left text-sm text-foreground shadow-none outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
            className
          )}
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected ? label(selected) : placeholder}
          </span>
          <CalendarDays className="h-4 w-4 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-auto overflow-hidden rounded-xl border-[#e8e7e3] bg-white p-0 shadow-[0_12px_32px_rgba(0,0,0,.12)]">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={pick}
          defaultMonth={selected || maxDate || undefined}
          startMonth={minDate}
          endMonth={maxDate}
          disabled={blocked}
          weekStartsOn={1}
          className="bg-white"
          autoFocus
        />
        <div className="flex items-center justify-between border-t border-[#efeeea] px-3 py-2 text-xs">
          {clearable ? (
            <button
              type="button"
              onClick={() => { onChange?.(""); setOpen(false) }}
              className="font-medium text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          ) : <span />}
          <button
            type="button"
            disabled={!todayAllowed}
            onClick={() => pick(today)}
            className="font-medium text-primary hover:underline disabled:opacity-40"
          >
            Today
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default DateField
