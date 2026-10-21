"use client"

import * as React from "react"
import { Plus, Quote, Ruler } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
import {
  ALL_CHANNELS,
  COOLDOWN_OPTIONS,
  SCHEDULE_LABEL,
  SEVERITY_LABEL,
} from "@/lib/ops/rules-data"
import type {
  InspectionRule,
  InspectionRuleType,
  RuleSchedule,
  RuleSeverity,
} from "@/lib/ops/rules-types"
import { cn } from "@/lib/utils"
import { CustomRuleDialog } from "./custom-rule-dialog"
import { DeleteRuleButton, LoadGmpPresetButton, ResetRulesButton } from "./rule-danger-actions"
import { useRules } from "./rules-provider"

const TYPE_META: Record<InspectionRuleType, { label: string; className: string }> = {
  GEOMETRIC: { label: "确定性几何规则", className: "border-signal/40 text-signal" },
  THRESHOLD: { label: "阈值规则", className: "border-warning/40 text-warning" },
  PROMPT_SEMANTIC: { label: "VLM 语义 Prompt", className: "border-primary/40 text-primary" },
}

const MIN_DESCRIPTION = 4
const MAX_DESCRIPTION = 400

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
    <Field>
      <FieldLabel htmlFor={textareaId} className="flex items-center gap-1.5">
        <Icon className="size-3.5 text-primary" aria-hidden="true" />
        语义判定依据 (VLM Description)
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
      {!valid ? (
        <p className="text-[11px] text-destructive">
          描述需为 {MIN_DESCRIPTION}~{MAX_DESCRIPTION} 个字符，未满足前不会保存。
        </p>
      ) : (
        <p className="text-[11px] text-muted-foreground">失焦后自动保存，下一次研判即按新描述注入大模型。</p>
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
    <Field>
      <div className="flex items-center justify-between">
        <FieldLabel htmlFor={sliderId}>灵敏度 / 置信度阈值</FieldLabel>
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

function RuleCard({ rule }: { rule: InspectionRule }) {
  const { updateRule, deleteRule } = useRules()
  const ids = {
    switch: `${rule.id}-enabled`,
    severity: `${rule.id}-severity`,
    cooldown: `${rule.id}-cooldown`,
    schedule: `${rule.id}-schedule`,
    description: `${rule.id}-description`,
    sensitivity: `${rule.id}-sensitivity`,
  }
  const type = TYPE_META[rule.type]

  return (
    <li
      className={cn(
        "flex flex-col gap-4 rounded-lg border border-border bg-background p-4 transition-opacity",
        !rule.enabled && "opacity-60"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="font-mono">
              {rule.id}
            </Badge>
            <Badge variant="outline" className={type.className}>
              {type.label}
            </Badge>
            {rule.custom && (
              <Badge variant="outline" className="border-success/40 text-success">
                自定义
              </Badge>
            )}
          </div>
          <label htmlFor={ids.switch} className="text-sm font-semibold leading-snug">
            {rule.name}
          </label>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <DeleteRuleButton rule={rule} onDelete={deleteRule} />
          <Switch
            id={ids.switch}
            checked={rule.enabled}
            onCheckedChange={(checked) => updateRule(rule.id, { enabled: checked })}
            aria-label={`${rule.enabled ? "停用" : "启用"} ${rule.id}`}
          />
        </div>
      </div>

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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field className="sm:col-span-3">
          <FieldLabel>绑定通道 (Bound Channels)</FieldLabel>
          <ToggleGroup
            type="multiple"
            variant="outline"
            size="sm"
            spacing={1}
            disabled={!rule.enabled}
            value={rule.boundChannels}
            onValueChange={(value) => updateRule(rule.id, { boundChannels: value })}
            aria-label={`${rule.id} 绑定通道`}
            className="flex-wrap"
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
          <p className="text-[11px] text-muted-foreground">
            ALL 覆盖实时通道与本地视频；LOCAL 仅用于本地导入/检索目录视频。
          </p>
          {rule.boundChannels.length === 0 && (
            <p className="text-[11px] text-warning">未绑定任何通道，该规则不会产生触发。</p>
          )}
        </Field>

        <Field>
          <FieldLabel htmlFor={ids.severity}>告警等级</FieldLabel>
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
                {(Object.keys(SEVERITY_LABEL) as RuleSeverity[]).map((severity) => (
                  <SelectItem key={severity} value={severity}>
                    {SEVERITY_LABEL[severity]}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel htmlFor={ids.cooldown}>冷却窗口</FieldLabel>
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

        <Field>
          <FieldLabel htmlFor={ids.schedule}>生效时段</FieldLabel>
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
                {(Object.keys(SCHEDULE_LABEL) as RuleSchedule[]).map((schedule) => (
                  <SelectItem key={schedule} value={schedule}>
                    {SCHEDULE_LABEL[schedule]}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      </div>
    </li>
  )
}

export function RuleStudioView() {
  const { rules, setCustomDialogOpen, resetRules, loadGmpPreset } = useRules()
  const enabled = rules.filter((rule) => rule.enabled).length

  return (
    <Card className="gap-4 py-4">
      <CardHeader className="px-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle className="text-sm">混合规则工作室 (Hybrid Rule Studio)</CardTitle>
            <CardDescription>
              几何/阈值规则由一级引擎确定性判定，语义规则由大模型按 Prompt 研判。共 {rules.length} 条，{enabled} 条已启用。
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <LoadGmpPresetButton onLoad={loadGmpPreset} />
            <ResetRulesButton onReset={resetRules} />
            <Button type="button" size="sm" onClick={() => setCustomDialogOpen(true)}>
              <Plus data-icon="inline-start" />
              新建自然语言规则
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4">
        <ul className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {rules.map((rule) => (
            <RuleCard key={rule.id} rule={rule} />
          ))}
        </ul>
      </CardContent>
      <CustomRuleDialog />
    </Card>
  )
}
