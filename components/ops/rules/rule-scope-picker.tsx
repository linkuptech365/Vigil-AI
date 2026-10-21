"use client"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { SCOPE_BINDINGS, bindingLabel } from "@/lib/ops/rule-binding"
import { ALL_CHANNELS } from "@/lib/ops/rules-data"

interface RuleScopePickerProps {
  value: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
  label?: string
}

export function RuleScopePicker({ value, onChange, disabled, label = "规则适用范围" }: RuleScopePickerProps) {
  return (
    <ToggleGroup
      type="multiple"
      variant="outline"
      size="sm"
      value={value}
      disabled={disabled}
      onValueChange={(next) => onChange(next.length ? next : ["ALL"])}
      className="flex-wrap justify-start"
      aria-label={label}
    >
      {SCOPE_BINDINGS.map((scope) => (
        <ToggleGroupItem key={scope} value={scope} className="text-xs">
          {bindingLabel(scope)} ({scope})
        </ToggleGroupItem>
      ))}
      {ALL_CHANNELS.map((channel) => (
        <ToggleGroupItem key={channel} value={channel} className="font-mono text-xs">
          {channel}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
