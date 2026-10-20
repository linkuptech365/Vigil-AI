"use client"

import * as React from "react"
import { BellRing, Send, Siren, Webhook, WandSparkles, type LucideIcon } from "lucide-react"

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
import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import { Textarea } from "@/components/ui/textarea"
import { ACTION_LABEL, DEFAULT_CUSTOM_PROMPT } from "@/lib/ops/rules-data"
import type { RuleActionKey } from "@/lib/ops/rules-types"
import { useRules } from "./rules-provider"

const ACTION_ICON: Record<RuleActionKey, LucideIcon> = {
  webhook: Webhook,
  dispatch: Send,
  siren: Siren,
}

const ACTION_KEYS = Object.keys(ACTION_LABEL) as RuleActionKey[]

function CustomRuleForm({ onDone }: { onDone: () => void }) {
  const { addCustomRule } = useRules()
  const [name, setName] = React.useState("人员摔倒滞留求助预警")
  const [prompt, setPrompt] = React.useState(DEFAULT_CUSTOM_PROMPT)
  const [sensitivity, setSensitivity] = React.useState(0.82)
  const [actions, setActions] = React.useState<Record<RuleActionKey, boolean>>({
    webhook: true,
    dispatch: true,
    siren: false,
  })

  const [submitting, setSubmitting] = React.useState(false)

  const valid = name.trim().length >= 2 && prompt.trim().length >= 8

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!valid || submitting) return
    setSubmitting(true)
    const created = await addCustomRule({ name: name.trim(), prompt: prompt.trim(), sensitivity, actions })
    setSubmitting(false)
    if (created) onDone()
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="custom-rule-name">规则名称</FieldLabel>
          <Input
            id="custom-rule-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={30}
            placeholder="例如：人员摔倒滞留求助预警"
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="custom-rule-prompt">自然语言描述</FieldLabel>
          <Textarea
            id="custom-rule-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={4}
            className="resize-none text-sm leading-relaxed"
            placeholder="描述需要识别的画面、持续时长与触发条件"
          />
          <p className="text-xs text-muted-foreground">
            大模型会把描述解析为检测目标、行为条件和持续时长，无需手动配置算法。
          </p>
        </Field>

        <Field>
          <div className="flex items-center justify-between">
            <FieldLabel htmlFor="custom-rule-sensitivity">灵敏度阈值</FieldLabel>
            <span className="font-mono text-xs text-signal">{sensitivity.toFixed(2)}</span>
          </div>
          <Slider
            id="custom-rule-sensitivity"
            value={[sensitivity]}
            min={0.6}
            max={0.95}
            step={0.01}
            onValueChange={([value]) => setSensitivity(value)}
            aria-label="灵敏度阈值"
          />
          <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
            <span>0.60 宽松 / 召回优先</span>
            <span>0.95 严格 / 精度优先</span>
          </div>
        </Field>
      </FieldGroup>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 flex items-center gap-1.5 text-sm font-medium">
          <BellRing className="size-4 text-muted-foreground" aria-hidden="true" />
          联动动作 (Action Triggers)
        </legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {ACTION_KEYS.map((key) => {
            const Icon = ACTION_ICON[key]
            const id = `custom-action-${key}`
            return (
              <div key={key} className="flex items-center gap-2">
                <Checkbox
                  id={id}
                  checked={actions[key]}
                  onCheckedChange={(checked) =>
                    setActions((prev) => ({ ...prev, [key]: checked === true }))
                  }
                />
                <label htmlFor={id} className="flex items-center gap-1.5 text-sm">
                  <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                  {ACTION_LABEL[key]}
                </label>
              </div>
            )
          })}
        </div>
      </fieldset>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onDone}>
          取消
        </Button>
        <Button type="submit" disabled={!valid || submitting}>
          <WandSparkles data-icon="inline-start" />
          {submitting ? "正在写入规则库..." : "创建并启用规则"}
        </Button>
      </div>
    </form>
  )
}

export function CustomRuleDialog() {
  const { customDialogOpen, setCustomDialogOpen } = useRules()

  return (
    <Dialog open={customDialogOpen} onOpenChange={setCustomDialogOpen}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>自定义自然语言规则</DialogTitle>
          <DialogDescription>
            用一句话描述想要布控的行为，系统会交给多模态大模型持续研判。
          </DialogDescription>
        </DialogHeader>
        <CustomRuleForm onDone={() => setCustomDialogOpen(false)} />
      </DialogContent>
    </Dialog>
  )
}
