"use client"

import { Copy, Download, FileText, Fingerprint, ShieldCheck } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { SUMMARY_CAUSAL_CHAIN, SUMMARY_OVERVIEW } from "@/lib/ops/dispatch-data"
import { useDispatch } from "./dispatch-provider"

export function SummaryCard() {
  const { dossier, downloadReport } = useDispatch()

  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <FileText className="size-4 text-signal" aria-hidden="true" />
          AI 研判合规报告 (AI Incident Summary Document)
        </CardTitle>
        <CardDescription>由二级多模态研判自动生成，可直接作为审计附件。</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <section className="flex flex-col gap-1">
          <h4 className="text-xs font-medium text-muted-foreground">事件概述</h4>
          <p className="text-sm leading-relaxed">{SUMMARY_OVERVIEW}</p>
        </section>
        <section className="flex flex-col gap-1.5">
          <h4 className="text-xs font-medium text-muted-foreground">因果逻辑链</h4>
          <ol className="flex flex-col gap-1.5">
            {SUMMARY_CAUSAL_CHAIN.map((step, index) => (
              <li key={step} className="flex gap-2 text-sm leading-relaxed">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-secondary font-mono text-[10px] text-signal">
                  {index + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        </section>
        <Separator />
        <section className="flex flex-col gap-1.5">
          <h4 className="text-xs font-medium text-muted-foreground">违反的安全条款</h4>
          <ul className="flex flex-col gap-1.5">
            {dossier.violatedClauses.map((clause) => (
              <li key={clause} className="flex items-start gap-2 text-sm leading-relaxed">
                <Badge variant="destructive" className="mt-0.5 shrink-0">
                  违规
                </Badge>
                {clause}
              </li>
            ))}
          </ul>
        </section>
        <Button type="button" variant="outline" onClick={downloadReport} className="self-start">
          <Download data-icon="inline-start" />
          下载电子证据报告 (PDF / JSON)
        </Button>
      </CardContent>
    </Card>
  )
}

export function HashCard() {
  const { dossier, copyHash } = useDispatch()

  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Fingerprint className="size-4 text-signal" aria-hidden="true" />
          数字指纹与防篡改存证 (Cryptographic Audit Hash)
        </CardTitle>
        <CardDescription>
          视频、关键帧与报告合并计算摘要，任何一字节改动都会导致校验码变化。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">SHA-256 Checksum</span>
          <code className="break-all rounded-md border border-border bg-background px-3 py-2 font-mono text-xs leading-relaxed text-signal">
            {dossier.sha256Hash}
          </code>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={copyHash}>
            <Copy data-icon="inline-start" />
            复制存证校验码 (Copy Hash)
          </Button>
          <Badge variant="outline" className="gap-1 text-success">
            <ShieldCheck aria-hidden="true" />
            校验通过 · 未被篡改
          </Badge>
        </div>
      </CardContent>
    </Card>
  )
}
