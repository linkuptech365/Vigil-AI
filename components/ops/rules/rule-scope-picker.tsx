"use client"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { SOURCE_ALL, SOURCE_LOCAL, bindingLabel, normalizeBinding } from "@/lib/ops/rule-binding"
import { BindableChannelItems } from "./bindable-channel-items"

interface RuleScopePickerProps {
  value: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
  label?: string
}

/**
 * 规则绑定通道的唯一选择器。「全部视频源」与具体通道互斥：
 * 勾选 ALL 会清空其余并禁用单通道项，取消 ALL 后才能挑选具体通道。
 */
export function RuleScopePicker({ value, onChange, disabled, label = "规则适用范围" }: RuleScopePickerProps) {
  const allSelected = value.includes(SOURCE_ALL)

  return (
    <div className="flex flex-col gap-1.5">
      <ToggleGroup
        type="multiple"
        variant="outline"
        size="sm"
        spacing={1}
        value={value}
        disabled={disabled}
        onValueChange={(next) => onChange(normalizeBinding(value, next))}
        className="flex-wrap justify-start"
        aria-label={label}
      >
        <ToggleGroupItem value={SOURCE_ALL} className="text-xs">
          {bindingLabel(SOURCE_ALL)}
        </ToggleGroupItem>
        <ToggleGroupItem value={SOURCE_LOCAL} disabled={allSelected} className="text-xs">
          {bindingLabel(SOURCE_LOCAL)}
        </ToggleGroupItem>
        <BindableChannelItems selected={value} disabled={allSelected} />
      </ToggleGroup>
      <p className="text-[11px] text-muted-foreground">
        {allSelected
          ? "已选「全部视频源」，对所有通道生效；取消勾选后才能指定具体通道。"
          : value.length === 0
            ? "尚未选择任何通道，该规则不会触发。"
            : "仅对已勾选的通道生效。"}
      </p>
    </div>
  )
}
