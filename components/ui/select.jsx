"use client"

import * as React from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { Check, ChevronDown, ChevronUp } from "lucide-react"

import { cn } from "@/lib/utils"

const Select = SelectPrimitive.Root

const SelectGroup = SelectPrimitive.Group

const SelectValue = SelectPrimitive.Value

const SelectTrigger = React.forwardRef(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      "group flex h-9 w-full items-center justify-between gap-2 whitespace-nowrap rounded-lg border border-input bg-white px-3 py-2 text-left text-sm text-foreground shadow-[0_1px_2px_rgba(16,17,26,0.04)] outline-none transition-[border-color,box-shadow] duration-150 hover:border-primary/40 focus:outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/15 data-[state=open]:border-primary data-[state=open]:ring-[3px] data-[state=open]:ring-primary/15 data-[placeholder]:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1 [&>span]:min-w-0",
      className
    )}
    {...props}>
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:text-primary group-data-[state=open]:rotate-180 group-data-[state=open]:text-primary" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
))
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName

const SelectScrollUpButton = React.forwardRef(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn("flex cursor-default items-center justify-center py-1 text-muted-foreground", className)}
    {...props}>
    <ChevronUp className="h-4 w-4" />
  </SelectPrimitive.ScrollUpButton>
))
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName

const SelectScrollDownButton = React.forwardRef(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn("flex cursor-default items-center justify-center py-1 text-muted-foreground", className)}
    {...props}>
    <ChevronDown className="h-4 w-4" />
  </SelectPrimitive.ScrollDownButton>
))
SelectScrollDownButton.displayName =
  SelectPrimitive.ScrollDownButton.displayName

const SelectContent = React.forwardRef(({ className, children, position = "popper", ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      className={cn(
        "relative z-50 max-h-[min(var(--radix-select-content-available-height),20rem)] min-w-[8rem] overflow-y-auto overflow-x-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-[0_12px_32px_-8px_rgba(16,17,26,0.18),0_2px_6px_rgba(16,17,26,0.06)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-select-content-transform-origin]",
        position === "popper" &&
          "data-[side=bottom]:translate-y-1.5 data-[side=left]:-translate-x-1.5 data-[side=right]:translate-x-1.5 data-[side=top]:-translate-y-1.5",
        className
      )}
      position={position}
      {...props}>
      <SelectScrollUpButton />
      <SelectPrimitive.Viewport
        className={cn("p-1", position === "popper" &&
          "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]")}>
        {children}
      </SelectPrimitive.Viewport>
      <SelectScrollDownButton />
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
))
SelectContent.displayName = SelectPrimitive.Content.displayName

const SelectLabel = React.forwardRef(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn("px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground", className)}
    {...props} />
))
SelectLabel.displayName = SelectPrimitive.Label.displayName

const SelectItem = React.forwardRef(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-pointer select-none items-center rounded-md py-[7px] pl-2.5 pr-8 text-[13px] text-popover-foreground outline-none transition-colors data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[state=checked]:font-medium data-[state=checked]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    {...props}>
    <span className="absolute right-2.5 flex h-3.5 w-3.5 items-center justify-center text-primary">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
))
SelectItem.displayName = SelectPrimitive.Item.displayName

const SelectSeparator = React.forwardRef(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-border", className)}
    {...props} />
))
SelectSeparator.displayName = SelectPrimitive.Separator.displayName

// Radix reserves "" for "no selection", so an empty-string option (e.g. "All
// statuses") is carried through this sentinel and mapped back on change.
const EMPTY_VALUE = "__empty__"
const toItemValue = (v) => (v === "" || v == null ? EMPTY_VALUE : String(v))

// Drop-in replacement for a native <select>: options are [value, label] pairs
// or { value, label, disabled } objects; onValueChange receives the raw string.
function AppSelect({ value, onValueChange, options, placeholder, className, contentClassName, disabled, ...props }) {
  return (
    <Select value={toItemValue(value)} onValueChange={(v) => onValueChange(v === EMPTY_VALUE ? "" : v)} disabled={disabled}>
      <SelectTrigger className={className} {...props}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className={contentClassName}>
        {options.map((o, i) => {
          const [v, label, optDisabled] = Array.isArray(o) ? o : [o.value, o.label, o.disabled]
          return <SelectItem key={`${i}:${v}`} value={toItemValue(v)} disabled={optDisabled}>{label}</SelectItem>
        })}
      </SelectContent>
    </Select>
  )
}

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
  AppSelect,
}
