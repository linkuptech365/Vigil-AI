"use client"

import * as React from "react"
import { toast } from "sonner"
import { Check, ChevronDown, Copy, EyeOff, ShieldAlert, Sparkles } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { severityLabel } from "@/lib/ops/vlm-data"
import type { VlmSeverity } from "@/lib/ops/vlm-types"
import { cn } from "@/lib/utils"
import { highlightJson } from "./json-view"
import { useVlm } from "./vlm-provider"

const SEVERITY_STYLE: Record<VlmSeverity, string> = {
  CRITICAL: "border-destructive/50 bg-destructive/15 text-destructive",
  WARNING: "border-warning/50 bg-warning/15 text-warning",
  SAFE: "border-success/50 bg-success/15 text-success",
}

function CvLimitationPanel() {
  const { scenario, activeClip } = useVlm()
  if (!scenario || !activeClip) return null

  return (
    <section
      aria-labelledby="cv-limit-title"
      className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 id="cv-limit-title" className="flex items-center gap-2 text-sm font-medium">
          <EyeOff className="size-4 text-muted-foreground" aria-hidden="true" />
          传统 CV 识别局限
        </h3>
        <Badge variant="outline" className="border-warning/40 text-warning">
          语义模糊 (Ambiguous)
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">Tier-1 看到了什么 (What Tier-1 Saw)</p>
      <p className="rounded-md bg-muted px-3 py-2 font-mono text-xs leading-relaxed">{scenario.cvSaw}</p>
      <p className="text-xs leading-relaxed text-muted-foreground">{scenario.cvNote}</p>
    </section>
  )
}

function ChainSteps({ steps }: { steps: string[] }) {
  return (
    <ol className="flex flex-col gap-2.5">
      {steps.map((step, index) => (
        <li key={index} className="flex gap-3 text-sm leading-relaxed">
          <span
            className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-signal/15 font-mono text-[11px] text-signal"
            aria-hidden="true"
          >
            {index + 1}
          </span>
          <span className="text-foreground/90">{step}</span>
        </li>
      ))}
    </ol>
  )
}

function Verdict() {
  const { result, scenario } = useVlm()
  if (!result || !scenario) return null

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5 rounded-md border border-border bg-background p-3 sm:col-span-2">
        <span className="text-xs text-muted-foreground">行为意图研判</span>
        <p className="text-sm leading-relaxed">{result.summary}</p>
      </div>
      <div className="flex flex-col gap-1.5 rounded-md border border-border bg-background p-3">
        <span className="text-xs text-muted-foreground">危险等级评定</span>
        <Badge variant="outline" className={cn("w-fit font-mono", SEVERITY_STYLE[result.severity])}>
          {severityLabel(result.severity)}
        </Badge>
      </div>
      <div className="flex flex-col gap-1.5 rounded-md border border-border bg-background p-3">
        <span className="text-xs text-muted-foreground">置信度评分</span>
        <div className="flex items-center gap-3">
          <span className="font-mono text-lg font-semibold tabular-nums text-signal">
            {result.confidence.toFixed(1)}%
          </span>
          <Progress value={result.confidence} aria-label="模型置信度" className="h-1.5" />
        </div>
      </div>
      <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 sm:col-span-2">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">安全生产合规扣分项</span>
          <span className="text-sm font-medium">{scenario.clause}</span>
        </div>
      </div>
    </div>
  )
}

function DeductionPanel() {
  const { phase, result, scenario } = useVlm()

  return (
    <section
      aria-labelledby="vlm-deduction-title"
      className="flex flex-col gap-4 rounded-lg border border-signal/30 bg-signal/5 p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 id="vlm-deduction-title" className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="size-4 text-signal" aria-hidden="true" />
          多模态大模型因果推导 (Cognitive Deduction Chain)
        </h3>
        {result && (
          <Badge variant="outline" className="border-signal/40 font-mono text-signal">
            {result.eventId}
          </Badge>
        )}
      </div>

      {result && scenario ? (
        <>
          <ChainSteps steps={result.reasoningChain} />
          <Verdict />
        </>
      ) : phase === "idle" ? (
        <p className="text-sm leading-relaxed text-muted-foreground">
          尚未研判。运行上方的 VLM 推理后，这里会给出模型对「行为意图、危险等级、置信度与合规条款」的因果推导。
        </p>
      ) : (
        <div className="flex flex-col gap-3" role="status" aria-label="等待模型输出结论">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="size-5 shrink-0 rounded-full" />
              <Skeleton className="h-4 flex-1" style={{ maxWidth: `${96 - i * 8}%` }} />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function JsonSpec() {
  const { result } = useVlm()
  const [open, setOpen] = React.useState(true)
  const [copied, setCopied] = React.useState(false)
  const text = React.useMemo(() => (result ? JSON.stringify(result.rawJson, null, 2) : ""), [result])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      toast.success("结构化 JSON 已复制到剪贴板")
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      toast.error("复制失败，请手动选择文本复制")
    }
  }

  return (
    <section aria-labelledby="json-spec-title" className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          aria-controls="json-spec-body"
          className="flex items-center gap-2 rounded text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronDown
            className={cn("size-4 text-muted-foreground transition-transform", !open && "-rotate-90")}
            aria-hidden="true"
          />
          <span id="json-spec-title">结构化 API 输出 (Structured JSON Spec)</span>
        </button>
        <Button variant="outline" size="sm" onClick={copy} disabled={!result}>
          {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
          {copied ? "已复制" : "复制 JSON"}
        </Button>
      </div>
      {open && (
        <div id="json-spec-body" className="border-t border-border">
          {result ? (
            <pre className="scrollbar-thin max-h-80 overflow-auto p-3 font-mono text-xs leading-relaxed">
              <code>{highlightJson(text)}</code>
            </pre>
          ) : (
            <p className="p-3 text-xs text-muted-foreground">研判完成后，将在此展示推送至告警中心的完整 JSON 结构。</p>
          )}
        </div>
      )}
    </section>
  )
}

export function CausalReasoningView() {
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="gap-1 border-b px-4 py-3">
        <CardTitle className="text-sm">可解释 AI 与因果推理 (Explainable AI & Causal Reasoning)</CardTitle>
        <CardDescription className="text-xs">
          对比传统检测「看见了什么」与多模态大模型「理解了什么」，并输出可直接入库、推送的结构化结论。
        </CardDescription>
      </CardHeader>
      <div className="flex flex-col gap-4 p-4">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
          <CvLimitationPanel />
          <DeductionPanel />
        </div>
        <JsonSpec />
      </div>
    </Card>
  )
}
