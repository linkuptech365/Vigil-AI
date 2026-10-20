"use client"

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
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
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
import { useRules } from "./rules-provider"

const TYPE_META: Record<InspectionRuleType, { label: string; className: string }> = {
  GEOMETRIC: { label: "确定性几何规则", className: "border-signal/40 text-signal" },
  THRESHOLD: { label: "阈值规则", className: "border-warning/40 text-warning" },
  PROMPT_SEMANTIC: { label: "VLM 语义 Prompt", className: "border-primary/40 text-primary" },
}

function RuleCard({ rule }: { rule: InspectionRule }) {
  const { updateRule } = useRules()
  const ids = {
    switch: `${rule.id}-enabled`,
    severity: `${rule.id}-severity`,
    cooldown: `${rule.id}-cooldown`,
    schedule: `${rule.id}-schedule`,
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
        <Switch
          id={ids.switch}
          checked={rule.enabled}
          onCheckedChange={(checked) => updateRule(rule.id, { enabled: checked })}
          aria-label={`${rule.enabled ? "停用" : "启用"} ${rule.id}`}
        />
      </div>

      {rule.type === "PROMPT_SEMANTIC" ? (
        <div className="flex gap-2 rounded-md border border-border bg-card p-3">
          <Quote className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-xs leading-relaxed">{rule.prompt}</p>
            {rule.sensitivity !== undefined && (
              <p className="font-mono text-[11px] text-muted-foreground">
                sensitivity {rule.sensitivity.toFixed(2)}
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="flex gap-2 rounded-md border border-border bg-card p-3">
          <Ruler className="mt-0.5 size-3.5 shrink-0 text-signal" aria-hidden="true" />
          <p className="text-xs leading-relaxed text-muted-foreground">{rule.logic}</p>
        </div>
      )}

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
            {ALL_CHANNELS.map((channel) => (
              <ToggleGroupItem key={channel} value={channel} className="font-mono text-xs">
                {channel}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
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
  const { rules, setCustomDialogOpen } = useRules()
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
          <Button type="button" size="sm" onClick={() => setCustomDialogOpen(true)}>
            <Plus data-icon="inline-start" />
            新建自然语言规则
          </Button>
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
