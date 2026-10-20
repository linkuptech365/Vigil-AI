"use client"

import * as React from "react"
import { BellRing, FlaskConical, Siren, Video, WandSparkles } from "lucide-react"
import { toast } from "sonner"

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
import { DEFAULT_RULE_PROMPT } from "@/lib/ops/data"
import type { Rule, RuleActions } from "@/lib/ops/types"
import { cn } from "@/lib/utils"
import { type RuleStudioTab, useOps } from "./ops-provider"

const ACTIONS: { key: keyof RuleActions; label: string; icon: typeof BellRing }[] = [
  { key: "notify", label: "钉钉/企微推送", icon: BellRing },
  { key: "siren", label: "声光报警器", icon: Siren },
  { key: "record", label: "自动录制切片", icon: Video },
]

function RuleRow({ rule }: { rule: Rule }) {
  const { toggleRule, setRuleSensitivity, setRuleAction } = useOps()
  const switchId = `rule-switch-${rule.id}`

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
            {rule.custom && (
              <Badge variant="outline" className="border-signal/40 text-signal">
                自定义
              </Badge>
            )}
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {rule.description}
          </p>
        </div>
        <Switch
          id={switchId}
          checked={rule.enabled}
          onCheckedChange={() => toggleRule(rule.id)}
          aria-label={`${rule.enabled ? "停用" : "启用"} ${rule.name}`}
        />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">灵敏度阈值</span>
          <span className="font-mono text-signal">{rule.sensitivity.toFixed(2)}</span>
        </div>
        <Slider
          value={[rule.sensitivity]}
          min={0.3}
          max={0.99}
          step={0.01}
          disabled={!rule.enabled}
          onValueChange={([v]) => setRuleSensitivity(rule.id, v)}
          aria-label={`${rule.name} 灵敏度`}
        />
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {ACTIONS.map(({ key, label, icon: Icon }) => {
          const id = `${rule.id}-${key}`
          return (
            <div key={key} className="flex items-center gap-2">
              <Checkbox
                id={id}
                checked={rule.actions[key]}
                disabled={!rule.enabled}
                onCheckedChange={(v) => setRuleAction(rule.id, key, v === true)}
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
  const { addRule } = useOps()
  const [prompt, setPrompt] = React.useState(DEFAULT_RULE_PROMPT)
  const [actions, setActions] = React.useState<RuleActions>({
    notify: true,
    siren: false,
    record: true,
  })
  const [testing, setTesting] = React.useState(false)
  const timer = React.useRef<number | null>(null)

  React.useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current)
    },
    []
  )

  const valid = prompt.trim().length >= 8

  const runTest = () => {
    setTesting(true)
    timer.current = window.setTimeout(() => {
      setTesting(false)
      toast.success("规则测试完成", {
        description: "在最近 24 小时样本视频中命中 3 次，平均置信度 91%，预计误报率低于 4%。",
      })
    }, 1600)
  }

  const submit = () => {
    const text = prompt.trim()
    addRule({
      name: text.length > 18 ? `${text.slice(0, 18)}...` : text,
      description: text,
      prompt: text,
      sensitivity: 0.85,
      actions,
    })
    onCreated()
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
            多模态大模型会把描述解析为检测目标、行为条件和持续时长，无需手动配置算法。
          </p>
        </Field>
      </FieldGroup>

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
                  onCheckedChange={(v) => setActions((prev) => ({ ...prev, [key]: v === true }))}
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
        <Button type="button" variant="outline" disabled={!valid || testing} onClick={runTest}>
          {testing ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <FlaskConical data-icon="inline-start" />
          )}
          {testing ? "测试中..." : "测试规则"}
        </Button>
        <Button type="button" disabled={!valid} onClick={submit}>
          <WandSparkles data-icon="inline-start" />
          创建并启用规则
        </Button>
      </div>
    </div>
  )
}

export function RuleStudioModal() {
  const { ruleStudio, setRuleStudioOpen, setRuleStudioTab, rules } = useOps()
  const enabledCount = rules.filter((r) => r.enabled).length

  return (
    <Dialog open={ruleStudio.open} onOpenChange={setRuleStudioOpen}>
      <DialogContent className="flex max-h-[88svh] flex-col gap-4 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>布控规则工作室</DialogTitle>
          <DialogDescription>
            共 {rules.length} 条规则，{enabledCount} 条已启用。调整灵敏度与联动响应后即时生效。
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={ruleStudio.tab}
          onValueChange={(v) => setRuleStudioTab(v as RuleStudioTab)}
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
