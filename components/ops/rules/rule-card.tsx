"use client"

import * as React from "react"
import { ChevronDown, Quote, Ruler } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { SCOPE_BINDINGS, bindingLabel, ruleDescription, ruleSensitivity } from "@/lib/ops/rule-binding"
import { COOLDOWN_OPTIONS, SCHEDULE_LABEL, SEVERITY_LABEL } from "@/lib/ops/rules-data"
import { BindableChannelItems } from "./bindable-channel-items"
import type {
  InspectionRule,
  InspectionRuleType,
  RuleSchedule,
  RuleSeverity,
} from "@/lib/ops/rules-types"
import { cn } from "@/lib/utils"
import { DeleteRuleButton } from "./rule-danger-actions"
import { useRules } from "./rules-provider"

const TYPE_META: Record<InspectionRuleType, { label: string; className: string }> = {
  GEOMETRIC: { label: "确定性几何", className: "border-signal/40 bg-signal/10 text-signal" },
  THRESHOLD: { label: "确定性阈值", className: "border-signal/40 bg-signal/10 text-signal" },
  PROMPT_SEMANTIC: { label: "VLM 语义", className: "border-primary/40 bg-primary/10 text-primary" },
}

const SEVERITY_META: Record<RuleSeverity, { label: string; className: string }> = {
  CRITICAL: { label: "严重", className: "border-destructive/40 bg-destructive/10 text-destructive" },
  WARNING: { label: "警告", className: "border-warning/40 bg-warning/10 text-warning" },
  INFO: { label: "提示", className: "border-border bg-muted text-muted-foreground" },
}

const MIN_DESCRIPTION = 4
const MAX_DESCRIPTION = 400
const MAX_VISIBLE_TAGS = 4

function DescriptionEditor({
  rule,
  textareaId,
  onSave,
}: {
  rule: InspectionRule
  textareaId: string
  onSave: (description: string) => void
}) {
  const saved = ruleDescription(rule)
  const [draft, setDraft] = React.useState(saved)
  const text = draft.trim()
  const valid = text.length >= MIN_DESCRIPTION && text.length <= MAX_DESCRIPTION
  const Icon = rule.type === "PROMPT_SEMANTIC" ? Quote : Ruler

  const commit = () => {
    if (valid && text !== saved) onSave(text)
  }

  return (
    <Field className="gap-1.5">
      <FieldLabel htmlFor={textareaId} className="flex items-center gap-1.5 text-xs">
        <Icon className="size-3.5 text-primary" aria-hidden="true" />
        {rule.type === "PROMPT_SEMANTIC" ? "VLM Prompt 判定依据" : "判定逻辑说明"}
      </FieldLabel>
      <Textarea
        id={textareaId}
        value={draft}
        disabled={!rule.enabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        rows={3}
        maxLength={MAX_DESCRIPTION}
        aria-invalid={!valid}
        className="resize-none text-xs leading-relaxed"
      />
      {valid ? (
        <p className="text-[10px] text-muted-foreground/70">失焦自动保存</p>
      ) : (
        <p className="text-[10px] text-destructive">
          需 {MIN_DESCRIPTION}~{MAX_DESCRIPTION} 个字符，未满足前不会保存
        </p>
      )}
    </Field>
  )
}

function SensitivityField({
  rule,
  sliderId,
  onCommit,
}: {
  rule: InspectionRule
  sliderId: string
  onCommit: (sensitivity: number) => void
}) {
  const [value, setValue] = React.useState(ruleSensitivity(rule))

  return (
    <Field className="gap-1.5">
      <div className="flex items-center justify-between">
        <FieldLabel htmlFor={sliderId} className="text-xs">
          灵敏度 / 置信度阈值
        </FieldLabel>
        <span className="font-mono text-xs text-signal">≥ {value.toFixed(2)}</span>
      </div>
      <Slider
        id={sliderId}
        value={[value]}
        min={0.3}
        max={0.99}
        step={0.01}
        disabled={!rule.enabled}
        onValueChange={([next]) => setValue(next)}
        onValueCommit={([next]) => onCommit(next)}
        aria-label={`${rule.id} 灵敏度阈值`}
      />
    </Field>
  )
}

function ChannelTags({ channels }: { channels: string[] }) {
  if (channels.length === 0) {
    return <span className="text-[11px] text-warning">未绑定通道，不会触发</span>
  }
  const visible = channels.slice(0, MAX_VISIBLE_TAGS)
  const rest = channels.length - visible.length
  return (
    <ul className="flex flex-wrap items-center gap-1" aria-label="绑定通道">
      {visible.map((channel) => (
        <li key={channel}>
          <Badge variant="outline" className="h-5 px-1.5 font-mono text-[10px] font-normal text-muted-foreground">
            {bindingLabel(channel)}
          </Badge>
        </li>
      ))}
      {rest > 0 && (
        <li>
          <Badge variant="outline" className="h-5 px-1.5 font-mono text-[10px] font-normal text-muted-foreground">
            +{rest}
          </Badge>
        </li>
      )}
    </ul>
  )
}

export function RuleCard({ rule }: { rule: InspectionRule }) {
  const { updateRule, deleteRule } = useRules()
  const [expanded, setExpanded] = React.useState(false)
  const baseId = React.useId()
  const ids = {
    switch: `${baseId}-enabled`,
    severity: `${baseId}-severity`,
    cooldown: `${baseId}-cooldown`,
    schedule: `${baseId}-schedule`,
    description: `${baseId}-description`,
    sensitivity: `${baseId}-sensitivity`,
    panel: `${baseId}-panel`,
  }
  const type = TYPE_META[rule.type]
  const severity = SEVERITY_META[rule.severity]

  return (
    <li
      className={cn(
        "flex flex-col rounded-lg border bg-background transition-[opacity,border-color]",
        rule.enabled ? "border-border" : "border-border/40 opacity-60",
        expanded && rule.enabled && "border-primary/40"
      )}
    >
      <div className="flex flex-col gap-3 p-3 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto] lg:items-center lg:gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <Switch
            id={ids.switch}
            checked={rule.enabled}
            onCheckedChange={(checked) => updateRule(rule.id, { enabled: checked })}
            aria-label={`${rule.enabled ? "停用" : "启用"} ${rule.id}`}
            className="mt-0.5 shrink-0"
          />
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[11px] text-muted-foreground">{rule.id}</span>
              <Badge variant="outline" className={cn("h-5 px-1.5 text-[10px]", type.className)}>
                {type.label}
              </Badge>
              {rule.custom && (
                <Badge variant="outline" className="h-5 border-success/40 px-1.5 text-[10px] text-success">
                  自定义
                </Badge>
              )}
            </div>
            <label htmlFor={ids.switch} className="text-sm font-semibold leading-snug text-balance">
              {rule.name}
            </label>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{ruleDescription(rule)}</p>
          <ChannelTags channels={rule.boundChannels} />
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 lg:justify-end">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={cn("h-5 px-1.5 text-[10px]", severity.className)}>
              {severity.label}
            </Badge>
            <span className="font-mono text-[11px] text-muted-foreground">
              灵敏度 {ruleSensitivity(rule).toFixed(2)}
            </span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={expanded}
            aria-controls={ids.panel}
            onClick={() => setExpanded((open) => !open)}
            className="text-xs text-muted-foreground"
          >
            {expanded ? "收起" : "展开配置"}
            <ChevronDown
              data-icon="inline-end"
              aria-hidden="true"
              className={cn("transition-transform", expanded && "rotate-180")}
            />
          </Button>
        </div>
      </div>

      {expanded && (
        <div id={ids.panel} className="flex flex-col gap-4 border-t border-border/60 p-3">
          <DescriptionEditor
            key={`${rule.id}:${ruleDescription(rule)}`}
            rule={rule}
            textareaId={ids.description}
            onSave={(description) => updateRule(rule.id, { description })}
          />

          <SensitivityField
            key={`${rule.id}:${ruleSensitivity(rule)}`}
            rule={rule}
            sliderId={ids.sensitivity}
            onCommit={(sensitivity) => updateRule(rule.id, { sensitivity })}
          />

          <Field className="gap-1.5">
            <FieldLabel className="text-xs">绑定通道</FieldLabel>
            <ToggleGroup
              type="multiple"
              variant="outline"
              size="sm"
              spacing={1}
              disabled={!rule.enabled}
              value={rule.boundChannels}
              onValueChange={(value) => updateRule(rule.id, { boundChannels: value })}
              aria-label={`${rule.id} 绑定通道`}
              className="flex-wrap justify-start"
            >
              {SCOPE_BINDINGS.map((scope) => (
                <ToggleGroupItem key={scope} value={scope} className="text-xs">
                  {bindingLabel(scope)} ({scope})
                </ToggleGroupItem>
              ))}
              <BindableChannelItems />
            </ToggleGroup>
            <p className="text-[10px] text-muted-foreground/70">
              ALL 覆盖实时通道与本地视频；LOCAL 仅用于本地导入/检索目录视频
            </p>
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field className="gap-1.5">
              <FieldLabel htmlFor={ids.severity} className="text-xs">
                告警等级
              </FieldLabel>
              <Select
                value={rule.severity}
                disabled={!rule.enabled}
                onValueChange={(value) => updateRule(rule.id, { severity: value as RuleSeverity })}
              >
                <SelectTrigger id={ids.severity} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {(Object.keys(SEVERITY_LABEL) as RuleSeverity[]).map((value) => (
                      <SelectItem key={value} value={value}>
                        {SEVERITY_LABEL[value]}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Field className="gap-1.5">
              <FieldLabel htmlFor={ids.cooldown} className="text-xs">
                冷却窗口
              </FieldLabel>
              <Select
                value={String(rule.cooldownSeconds)}
                disabled={!rule.enabled}
                onValueChange={(value) => updateRule(rule.id, { cooldownSeconds: Number(value) })}
              >
                <SelectTrigger id={ids.cooldown} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {COOLDOWN_OPTIONS.map((seconds) => (
                      <SelectItem key={seconds} value={String(seconds)}>
                        {seconds}s
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Field className="gap-1.5">
              <FieldLabel htmlFor={ids.schedule} className="text-xs">
                生效时段
              </FieldLabel>
              <Select
                value={rule.schedule}
                disabled={!rule.enabled}
                onValueChange={(value) => updateRule(rule.id, { schedule: value as RuleSchedule })}
              >
                <SelectTrigger id={ids.schedule} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {(Object.keys(SCHEDULE_LABEL) as RuleSchedule[]).map((value) => (
                      <SelectItem key={value} value={value}>
                        {SCHEDULE_LABEL[value]}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="flex justify-end">
            <DeleteRuleButton rule={rule} onDelete={deleteRule} />
          </div>
        </div>
      )}
    </li>
  )
}
