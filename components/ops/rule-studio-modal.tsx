"use client"

import * as React from "react"
import { BellRing, ClipboardList, Siren, WandSparkles } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Slider } from "@/components/ui/slider"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { DEFAULT_CUSTOM_PROMPT } from "@/lib/ops/rules-data"
import type { InspectionRule, RuleActionKey } from "@/lib/ops/rules-types"
import { cn } from "@/lib/utils"
import { type RuleStudioTab, useOps } from "./ops-provider"
import { DeleteRuleButton, LoadGmpPresetButton, ResetRulesButton } from "./rules/rule-danger-actions"
import { RuleScopePicker } from "./rules/rule-scope-picker"
import { useServerRules } from "./rules/use-server-rules"

const ACTIONS: { key: RuleActionKey; label: string; icon: typeof BellRing }[] = [
  { key: "webhook", label: "钉钉/企微推送", icon: BellRing },
  { key: "dispatch", label: "自动生成工单", icon: ClipboardList },
  { key: "siren", label: "声光报警器", icon: Siren },
]

const DEFAULT_ACTIONS: Record<RuleActionKey, boolean> = {
  webhook: true,
  dispatch: true,
  siren: false,
}

const TYPE_LABEL: Record<InspectionRule["type"], string> = {
  GEOMETRIC: "几何规则",
  THRESHOLD: "阈值规则",
  PROMPT_SEMANTIC: "语义规则",
}

function RuleRow({ rule }: { rule: InspectionRule }) {
  const { updateRule, deleteRule } = useServerRules()
  const switchId = `rule-switch-${rule.id}`
  const serverSensitivity = rule.sensitivity
  const [draft, setDraft] = React.useState(serverSensitivity)

  React.useEffect(() => {
    setDraft(serverSensitivity)
  }, [serverSensitivity])

  const actions = rule.actions ?? { webhook: false, dispatch: false, siren: false }

  return (
    <li
      className={cn(
        "flex flex-col gap-4 rounded-lg border border-border bg-card p-4 transition-opacity",
        !rule.enabled && "opacity-60"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={switchId} className="text-sm font-semibold">
              {rule.name}
            </label>
            <Badge variant="outline" className="font-mono">
              {rule.id}
            </Badge>
            <Badge variant="outline">{TYPE_LABEL[rule.type]}</Badge>
            <Badge variant={rule.severity === "CRITICAL" ? "destructive" : "secondary"}>
              {rule.severity}
            </Badge>
            {rule.custom && (
              <Badge variant="outline" className="border-signal/40 text-signal">
                自定义
              </Badge>
            )}
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">{rule.prompt ?? rule.logic}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <DeleteRuleButton rule={rule} onDelete={deleteRule} />
          <Switch
            id={switchId}
            checked={rule.enabled}
            onCheckedChange={(enabled) => void updateRule(rule.id, { enabled })}
            aria-label={`${rule.enabled ? "停用" : "启用"} ${rule.name}`}
          />
        </div>
      </div>

      {draft !== undefined && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">灵敏度阈值</span>
            <span className="font-mono text-signal">{draft.toFixed(2)}</span>
          </div>
          <Slider
            value={[draft]}
            min={0.3}
            max={0.99}
            step={0.01}
            disabled={!rule.enabled}
            onValueChange={([value]) => setDraft(value)}
            onValueCommit={([value]) => void updateRule(rule.id, { sensitivity: value })}
            aria-label={`${rule.name} 灵敏度`}
          />
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">适用范围</span>
        <RuleScopePicker
          value={rule.boundChannels}
          disabled={!rule.enabled}
          onChange={(boundChannels) => void updateRule(rule.id, { boundChannels })}
          label={`${rule.name} 适用范围`}
        />
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {ACTIONS.map(({ key, label, icon: Icon }) => {
          const id = `${rule.id}-${key}`
          return (
            <div key={key} className="flex items-center gap-2">
              <Checkbox
                id={id}
                checked={actions[key]}
                disabled={!rule.enabled}
                onCheckedChange={(value) =>
                  void updateRule(rule.id, { actions: { ...actions, [key]: value === true } })
                }
              />
              <label htmlFor={id} className="flex items-center gap-1.5 text-xs">
                <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
                {label}
              </label>
            </div>
          )
        })}
      </div>
    </li>
  )
}

function CustomRuleForm({ onCreated }: { onCreated: () => void }) {
  const { addCustomRule } = useServerRules()
  const [prompt, setPrompt] = React.useState(DEFAULT_CUSTOM_PROMPT)
  const [actions, setActions] = React.useState(DEFAULT_ACTIONS)
  const [bound, setBound] = React.useState<string[]>(["ALL"])
  const [submitting, setSubmitting] = React.useState(false)

  const valid = prompt.trim().length >= 8

  const submit = async () => {
    const text = prompt.trim()
    setSubmitting(true)
    const created = await addCustomRule({
      name: text.length > 18 ? `${text.slice(0, 18)}...` : text,
      prompt: text,
      sensitivity: 0.85,
      actions,
      boundChannels: bound,
    })
    setSubmitting(false)
    if (created) onCreated()
  }

  return (
    <div className="flex flex-col gap-5">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="rule-prompt">用自然语言描述布控规则</FieldLabel>
          <Textarea
            id="rule-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={5}
            className="resize-none text-sm leading-relaxed"
            placeholder="例如：当监控画面中出现..."
          />
          <p className="text-xs text-muted-foreground">
            规则会写入服务端规则库，并由语义匹配引擎在每次评估时与研判结果比对。
          </p>
        </Field>
      </FieldGroup>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">适用范围 (Bound Scope)</legend>
        <RuleScopePicker value={bound} onChange={setBound} />
        <p className="text-xs text-muted-foreground">
          ALL 对所有视频源生效；LOCAL 仅用于本地视频；也可只勾选指定机位。
        </p>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">联动响应</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {ACTIONS.map(({ key, label, icon: Icon }) => {
            const id = `custom-${key}`
            return (
              <div key={key} className="flex items-center gap-2">
                <Checkbox
                  id={id}
                  checked={actions[key]}
                  onCheckedChange={(value) => setActions((prev) => ({ ...prev, [key]: value === true }))}
                />
                <label htmlFor={id} className="flex items-center gap-1.5 text-sm">
                  <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                  {label}
                </label>
              </div>
            )
          })}
        </div>
      </fieldset>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" disabled={!valid || submitting} onClick={() => void submit()}>
          {submitting ? <Spinner data-icon="inline-start" /> : <WandSparkles data-icon="inline-start" />}
          创建并启用规则
        </Button>
      </div>
    </div>
  )
}

export function RuleStudioModal() {
  const { ruleStudio, setRuleStudioOpen, setRuleStudioTab } = useOps()
  const { rules, rulesError, resetRules, loadGmpPreset } = useServerRules()
  const enabledCount = rules.filter((rule) => rule.enabled).length

  return (
    <Dialog open={ruleStudio.open} onOpenChange={setRuleStudioOpen}>
      <DialogContent className="flex max-h-[88svh] flex-col gap-4 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>布控规则工作室</DialogTitle>
          <DialogDescription>
            {rulesError
              ? "规则引擎服务暂时不可用，当前显示的是本地预置规则。"
              : `服务端规则库共 ${rules.length} 条规则，${enabledCount} 条已启用。所有修改即时同步到规则引擎。`}
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={ruleStudio.tab}
          onValueChange={(value) => setRuleStudioTab(value as RuleStudioTab)}
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          <TabsList>
            <TabsTrigger value="list">规则库管理</TabsTrigger>
            <TabsTrigger value="custom">自定义布控</TabsTrigger>
          </TabsList>

          <TabsContent
            value="list"
            className="scrollbar-thin -mr-2 min-h-0 flex-1 overflow-y-auto pr-2"
          >
            <div className="mb-3 flex flex-wrap justify-end gap-2">
              <LoadGmpPresetButton onLoad={loadGmpPreset} />
              <ResetRulesButton onReset={resetRules} />
            </div>
            <ul className="flex flex-col gap-3">
              {rules.map((rule) => (
                <RuleRow key={rule.id} rule={rule} />
              ))}
            </ul>
          </TabsContent>

          <TabsContent value="custom" className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
            <CustomRuleForm onCreated={() => setRuleStudioTab("list")} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
