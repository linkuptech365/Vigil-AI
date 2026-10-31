"use client"

import * as React from "react"
import { Check, Copy } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { GmpDeviationRecord } from "@/lib/ops/audit-types"
import { CapaStatusBadge, ClassificationBadge } from "./audit-badges"
import { EvidenceMedia } from "./evidence-media"

function formatAt(iso: string) {
  return new Date(iso).toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" })
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  )
}

export function DossierDialog({ record, onClose }: { record: GmpDeviationRecord; onClose: () => void }) {
  const [copied, setCopied] = React.useState(false)

  const copyHash = async () => {
    try {
      await navigator.clipboard.writeText(record.sha256)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      toast.error("复制失败，请手动选择哈希值")
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[92svh] w-[calc(100%-1.5rem)] max-w-3xl flex-col gap-0 overflow-hidden bg-card p-0 sm:max-w-3xl">
        <DialogHeader className="gap-2 border-b border-border px-6 py-4 text-left">
          <div className="flex flex-wrap items-center gap-2 pr-8">
            <DialogTitle className="font-mono text-base">存证卷宗 · {record.id}</DialogTitle>
            <ClassificationBadge value={record.classification} />
            <CapaStatusBadge value={record.capaStatus} />
          </div>
          <DialogDescription>
            {record.behavior} | {record.clause}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
          <EvidenceMedia record={record} />

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
            <Meta label="机位与区域">
              {record.channelId} {record.zone}
            </Meta>
            <Meta label="发生时间">
              <span className="font-mono">{record.occurredAt}</span>
            </Meta>
            <Meta label="操作员">{record.operator}</Meta>
            <Meta label="班组长">{record.shiftLead}</Meta>
          </dl>

          <div className="flex flex-col gap-1.5">
            <p className="text-xs text-muted-foreground">SHA-256 存证哈希</p>
            <div className="flex items-start gap-2 rounded-md border border-border bg-background/60 p-2">
              <code className="min-w-0 flex-1 break-all font-mono text-xs leading-relaxed">{record.sha256}</code>
              <Button type="button" size="icon-sm" variant="ghost" aria-label="复制哈希" onClick={() => void copyHash()}>
                {copied ? <Check className="text-success" /> : <Copy />}
              </Button>
            </div>
          </div>

          <div className="rounded-lg border border-signal/30 bg-signal/5 p-3">
            <p className="mb-1 font-mono text-[11px] uppercase tracking-wider text-signal">
              AI VLM Causal Reasoning · 置信度 {(record.confidence * 100).toFixed(0)}%
            </p>
            <p className="text-sm leading-relaxed text-pretty">{record.vlmExcerpt}</p>
          </div>

          <section aria-labelledby="audit-log-heading" className="flex flex-col gap-2">
            <h3 id="audit-log-heading" className="text-sm font-semibold">
              审计日志 (Audit Log)
            </h3>
            <ol className="flex flex-col gap-2 border-l border-border pl-4">
              {[...record.auditLog].reverse().map((entry) => (
                <li key={entry.id} className="relative flex flex-col gap-0.5">
                  <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-signal" aria-hidden="true" />
                  <span className="text-sm">{entry.action}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {formatAt(entry.at)} · {entry.actor}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
