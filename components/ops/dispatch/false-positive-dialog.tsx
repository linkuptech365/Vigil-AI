"use client"

import * as React from "react"
import { DatabaseZap } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { FALSE_POSITIVE_REASONS } from "@/lib/ops/dispatch-data"
import type { FalsePositiveReason } from "@/lib/ops/dispatch-types"
import { useDispatch } from "./dispatch-provider"

const REASON_KEYS = Object.keys(FALSE_POSITIVE_REASONS) as FalsePositiveReason[]

function FeedbackForm({ onDone }: { onDone: () => void }) {
  const { submitFalsePositive } = useDispatch()
  const [reason, setReason] = React.useState<FalsePositiveReason>("LIGHT_CHANGE")
  const [explanation, setExplanation] = React.useState("")

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    submitFalsePositive(reason, explanation)
    onDone()
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="fp-reason">误报原因</FieldLabel>
          <Select value={reason} onValueChange={(value) => setReason(value as FalsePositiveReason)}>
            <SelectTrigger id="fp-reason" className="w-full">
              <SelectValue placeholder="选择误报原因" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {REASON_KEYS.map((key) => (
                  <SelectItem key={key} value={key}>
                    {FALSE_POSITIVE_REASONS[key]}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="fp-explanation">补充说明</FieldLabel>
          <Textarea
            id="fp-explanation"
            value={explanation}
            onChange={(event) => setExplanation(event.target.value)}
            rows={4}
            maxLength={300}
            className="resize-none text-sm leading-relaxed"
            placeholder="例如：画面中两人为正常交接物料，手臂动作为递送零件，并非肢体冲突。"
          />
          <p className="text-xs text-muted-foreground">
            说明会随截图和模型输出一起写入微调数据集，帮助模型区分相似场景。
          </p>
        </Field>
      </FieldGroup>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onDone}>
          取消
        </Button>
        <Button type="submit">
          <DatabaseZap data-icon="inline-start" />
          提交并入库微调集
        </Button>
      </div>
    </form>
  )
}

interface FalsePositiveDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function FalsePositiveDialog({ open, onOpenChange }: FalsePositiveDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>标记为大模型误报</DialogTitle>
          <DialogDescription>
            选择误报原因，样本将进入主动学习闭环，用于下一轮模型微调与阈值校准。
          </DialogDescription>
        </DialogHeader>
        {open ? <FeedbackForm onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  )
}
