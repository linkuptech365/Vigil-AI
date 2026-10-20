"use client"

import * as React from "react"
import { BadgeCheck, CornerUpLeft, Save, Send } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import { RCA_OPTIONS, type CapaFormState, type CapaStatus, type GmpDeviationRecord, type RcaCategory } from "@/lib/ops/audit-types"
import { applyCapaUpdate } from "@/lib/ops/storage/audit-storage"
import { CapaStatusBadge, ClassificationBadge } from "./audit-badges"
import { EvidenceMedia } from "./evidence-media"

type FieldKey = "rcaNotes" | "containment" | "capaPlan" | "plannedDate" | "qaOfficer" | "returnReason"
type Errors = Partial<Record<FieldKey, string>>

interface CapaModalProps {
  record: GmpDeviationRecord
  initial: CapaFormState
  onClose: () => void
}

function formatSignedAt(iso: string) {
  return new Date(iso).toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" })
}

function Section({ index, title, children }: { index: number; title: string; children: React.ReactNode }) {
  const headingId = `capa-section-${index}`
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h3 id={headingId} className="flex items-center gap-2 text-sm font-semibold">
        <span className="flex size-5 items-center justify-center rounded-full border border-signal/40 bg-signal/10 font-mono text-[11px] text-signal">
          {index}
        </span>
        {title}
      </h3>
      {children}
    </section>
  )
}

export function CapaModal({ record, initial, onClose }: CapaModalProps) {
  const [form, setForm] = React.useState<CapaFormState>(initial)
  const [reason, setReason] = React.useState(initial.returnReason ?? "")
  const [errors, setErrors] = React.useState<Errors>({})
  const readOnly = record.capaStatus === "APPROVED"

  const update = <K extends keyof CapaFormState>(key: K, value: CapaFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setErrors((prev) => (key in prev ? { ...prev, [key]: undefined } : prev))
  }

  const validate = (required: FieldKey[]) => {
    const next: Errors = {}
    const values: Record<FieldKey, string> = {
      rcaNotes: form.rcaNotes.trim(),
      containment: form.containment.trim(),
      capaPlan: form.capaPlan.trim(),
      plannedDate: form.plannedDate,
      qaOfficer: form.qaOfficer.trim(),
      returnReason: reason.trim(),
    }
    for (const key of required) {
      if (!values[key]) next[key] = key === "returnReason" ? "驳回时必须填写驳回原因" : "此项为必填"
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const persist = (status: CapaStatus, actor: string, action: string, patch: Partial<CapaFormState> = {}) => {
    applyCapaUpdate({ deviationId: record.id, form: { ...form, ...patch }, status, actor, action })
  }

  const handleSave = () => {
    const hasContent = Boolean(form.rcaNotes || form.containment || form.capaPlan || form.plannedDate)
    const status: CapaStatus = record.capaStatus === "DRAFT" && hasContent ? "IN_PROGRESS" : record.capaStatus
    persist(status, record.shiftLead, "保存 CAPA 草稿")
    toast.success("CAPA 草稿已保存", { description: record.id })
    onClose()
  }

  const handleSubmitReview = () => {
    if (!validate(["rcaNotes", "containment", "capaPlan", "plannedDate"])) return
    persist("QA_REVIEW", record.shiftLead, "提交 QA 质保复核")
    toast.success("已提交 QA 质保复核", { description: `${record.id} 等待 QA 负责人审批` })
    onClose()
  }

  const handleReject = () => {
    if (!validate(["qaOfficer", "returnReason"])) return
    const trimmed = reason.trim()
    persist("IN_PROGRESS", form.qaOfficer.trim(), `驳回重新调查：${trimmed}`, {
      signedAt: null,
      returnReason: trimmed,
    })
    toast.warning("已驳回，退回重新调查", { description: `${record.id} · ${trimmed}` })
    onClose()
  }

  const handleApprove = () => {
    if (!validate(["rcaNotes", "containment", "capaPlan", "plannedDate", "qaOfficer"])) return
    const signedAt = new Date().toISOString()
    persist("APPROVED", form.qaOfficer.trim(), "批准 CAPA 并结案（电子签名）", { signedAt, returnReason: null })
    toast.success("CAPA 已批准，偏差结案", {
      description: `${record.id} · ${form.qaOfficer.trim()} 已于 ${formatSignedAt(signedAt)} 完成电子签名`,
      icon: <BadgeCheck className="size-5 text-success" />,
      duration: 6000,
    })
    onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[92svh] w-[calc(100%-1.5rem)] max-w-4xl flex-col gap-0 overflow-hidden bg-card p-0 sm:max-w-4xl">
        <DialogHeader className="gap-2 border-b border-border px-6 py-4 text-left">
          <div className="flex flex-wrap items-center gap-2 pr-8">
            <DialogTitle className="font-mono text-base">{record.id}</DialogTitle>
            <ClassificationBadge value={record.classification} />
            <CapaStatusBadge value={record.capaStatus} />
          </div>
          <DialogDescription>
            CAPA 纠正与预防措施单 · {record.channelId} {record.zone} · {record.clause}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-5">
          <Section index={1} title="偏差现场调查与事实确认 (Investigation)">
            <EvidenceMedia record={record} />
            <div className="rounded-lg border border-signal/30 bg-signal/5 p-3">
              <p className="mb-1 font-mono text-[11px] uppercase tracking-wider text-signal">
                AI VLM Causal Reasoning · 置信度 {(record.confidence * 100).toFixed(0)}%
              </p>
              <p className="text-sm leading-relaxed text-pretty">{record.vlmExcerpt}</p>
            </div>
          </Section>

          <Section index={2} title="根本原因分析 (Root Cause Analysis - RCA)">
            <FieldGroup>
              <Field>
                <FieldLabel id="rca-category-label">根因分类</FieldLabel>
                <RadioGroup
                  aria-labelledby="rca-category-label"
                  value={form.rcaCategory}
                  onValueChange={(value) => update("rcaCategory", value as RcaCategory)}
                  disabled={readOnly}
                  className="grid gap-2 sm:grid-cols-2"
                >
                  {RCA_OPTIONS.map((option) => {
                    const id = `rca-${option.value}`
                    return (
                      <label
                        key={option.value}
                        htmlFor={id}
                        className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background/40 px-3 py-2 text-sm has-[[data-state=checked]]:border-signal/60 has-[[data-state=checked]]:bg-signal/10"
                      >
                        <RadioGroupItem id={id} value={option.value} />
                        {option.label}
                      </label>
                    )
                  })}
                </RadioGroup>
              </Field>
              <Field data-invalid={Boolean(errors.rcaNotes)}>
                <FieldLabel htmlFor="rca-notes">RCA 分析说明</FieldLabel>
                <Textarea
                  id="rca-notes"
                  rows={3}
                  value={form.rcaNotes}
                  readOnly={readOnly}
                  aria-invalid={Boolean(errors.rcaNotes)}
                  placeholder="例如：操作员未执行 SOP-BIO-018 更衣流程，且更衣室出口缺少复核点。"
                  onChange={(event) => update("rcaNotes", event.target.value)}
                />
                {errors.rcaNotes && <FieldError>{errors.rcaNotes}</FieldError>}
              </Field>
            </FieldGroup>
          </Section>

          <Section index={3} title="纠正措施 (Immediate Containment)">
            <Field data-invalid={Boolean(errors.containment)}>
              <FieldLabel htmlFor="containment" className="sr-only">
                纠正措施
              </FieldLabel>
              <Textarea
                id="containment"
                rows={3}
                value={form.containment}
                readOnly={readOnly}
                aria-invalid={Boolean(errors.containment)}
                placeholder="例如：立即召回该操作人员，对走廊地面重新实施过氧化氢消毒，抽检该批次物料洁净度。"
                onChange={(event) => update("containment", event.target.value)}
              />
              {errors.containment && <FieldError>{errors.containment}</FieldError>}
            </Field>
          </Section>

          <Section index={4} title="预防性纠正措施 (CAPA Plan)">
            <FieldGroup>
              <Field data-invalid={Boolean(errors.capaPlan)}>
                <FieldLabel htmlFor="capa-plan" className="sr-only">
                  预防性纠正措施
                </FieldLabel>
                <Textarea
                  id="capa-plan"
                  rows={3}
                  value={form.capaPlan}
                  readOnly={readOnly}
                  aria-invalid={Boolean(errors.capaPlan)}
                  placeholder="例如：修订 SOP-BIO-018，加装更衣室门禁防静电手脚综合测试仪联动锁。"
                  onChange={(event) => update("capaPlan", event.target.value)}
                />
                {errors.capaPlan && <FieldError>{errors.capaPlan}</FieldError>}
              </Field>
              <Field data-invalid={Boolean(errors.plannedDate)} className="sm:max-w-xs">
                <FieldLabel htmlFor="planned-date">计划完成日期</FieldLabel>
                <Input
                  id="planned-date"
                  type="date"
                  value={form.plannedDate}
                  readOnly={readOnly}
                  aria-invalid={Boolean(errors.plannedDate)}
                  onChange={(event) => update("plannedDate", event.target.value)}
                />
                {errors.plannedDate && <FieldError>{errors.plannedDate}</FieldError>}
              </Field>
            </FieldGroup>
          </Section>

          <Section index={5} title="QA 质量保证负责人审批 (Quality Assurance Sign-off)">
            <FieldGroup>
              <Field data-invalid={Boolean(errors.qaOfficer)} className="sm:max-w-sm">
                <FieldLabel htmlFor="qa-officer">QA 负责人姓名</FieldLabel>
                <Input
                  id="qa-officer"
                  value={form.qaOfficer}
                  readOnly={readOnly}
                  aria-invalid={Boolean(errors.qaOfficer)}
                  placeholder="陈质保 (QA Supervisor)"
                  onChange={(event) => update("qaOfficer", event.target.value)}
                />
                {errors.qaOfficer && <FieldError>{errors.qaOfficer}</FieldError>}
              </Field>
              {!readOnly && (
                <Field data-invalid={Boolean(errors.returnReason)}>
                  <FieldLabel htmlFor="return-reason">驳回原因</FieldLabel>
                  <Textarea
                    id="return-reason"
                    rows={2}
                    value={reason}
                    aria-invalid={Boolean(errors.returnReason)}
                    placeholder="仅在驳回时填写，将记录到审计日志。"
                    onChange={(event) => {
                      setReason(event.target.value)
                      setErrors((prev) => ({ ...prev, returnReason: undefined }))
                    }}
                  />
                  <FieldDescription>批准结案不需要填写。</FieldDescription>
                  {errors.returnReason && <FieldError>{errors.returnReason}</FieldError>}
                </Field>
              )}
              {readOnly && form.signedAt && (
                <p className="flex items-center gap-2 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
                  <BadgeCheck className="size-4" aria-hidden="true" />
                  {form.qaOfficer} 已于 {formatSignedAt(form.signedAt)} 完成电子签名
                </p>
              )}
            </FieldGroup>
          </Section>
        </div>

        <DialogFooter className="flex-row flex-wrap items-center justify-end gap-2 border-t border-border bg-background/40 px-6 py-3 sm:justify-end">
          {readOnly ? (
            <Button type="button" variant="outline" onClick={onClose}>
              关闭
            </Button>
          ) : (
            <>
              <Button type="button" variant="ghost" onClick={handleSave}>
                <Save data-icon="inline-start" />
                保存草稿
              </Button>
              <Button type="button" variant="outline" onClick={handleSubmitReview}>
                <Send data-icon="inline-start" />
                提交 QA 复核
              </Button>
              <Button type="button" variant="outline" onClick={handleReject}>
                <CornerUpLeft data-icon="inline-start" />
                驳回重新调查 (Reject &amp; Return)
              </Button>
              <Button type="button" className="bg-success text-black hover:bg-success/90" onClick={handleApprove}>
                <BadgeCheck data-icon="inline-start" />
                批准 CAPA 并结案 (Approve &amp; Close)
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
