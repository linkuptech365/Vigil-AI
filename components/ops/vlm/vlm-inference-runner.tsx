"use client"

import * as React from "react"
import { BrainCircuit, Play, RotateCcw } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { localSliceLabel } from "@/lib/ops/local-slice"
import { cn } from "@/lib/utils"
import { useVlm } from "./vlm-provider"

function formatUsd(value: number) {
  return `$${value.toFixed(4)}`
}

function MetricsBadge() {
  const { phase, promptTokens, completionTokens, metrics, model } = useVlm()
  const rtt = metrics ? `${(metrics.rttMs / 1000).toFixed(2)}s` : "--"
  const cost = metrics ? metrics.costUsd : ((promptTokens + completionTokens) / 1000) * model.costPer1kTokens
  const showCost = phase !== "idle"

  const items = [
    ["Prompt Tokens", promptTokens.toLocaleString("en-US")],
    ["Output", phase === "idle" ? "--" : completionTokens.toLocaleString("en-US")],
    ["RTT", rtt],
    ["Cost", showCost ? formatUsd(cost) : "--"],
  ]

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-background px-3 py-1.5 font-mono text-xs"
      aria-live="polite"
    >
      {items.map(([label, value], index) => (
        <React.Fragment key={label}>
          {index > 0 && <span className="text-border" aria-hidden="true">|</span>}
          <span className="flex items-baseline gap-1.5">
            <span className="text-muted-foreground">{label}:</span>
            <span className="tabular-nums text-signal">{value}</span>
          </span>
        </React.Fragment>
      ))}
    </div>
  )
}

function StreamLine({ line }: { line: string }) {
  if (line.startsWith("### ")) {
    return <div className="mt-2 font-semibold text-signal first:mt-0">{line}</div>
  }
  if (line.startsWith("```")) {
    return <div className="text-muted-foreground">{line}</div>
  }
  if (line.startsWith("- ")) {
    return <div className="pl-3 text-foreground/90">{line}</div>
  }
  return <div className="text-foreground/90">{line || "\u00a0"}</div>
}

function StreamOutput() {
  const { phase, streamText, thinkingMessage, metrics } = useVlm()
  const scrollRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const el = scrollRef.current
    if (el && phase === "streaming") el.scrollTop = el.scrollHeight
  }, [streamText, phase])

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-xs">
        <span className="font-mono text-muted-foreground">model_output.stream</span>
        <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
          {phase === "thinking" && (
            <>
              <Spinner className="size-3 shrink-0" />
              <span className="truncate">{thinkingMessage || "Thinking"}</span>
            </>
          )}
          {phase === "streaming" && (
            <>
              <span className="size-1.5 animate-pulse rounded-full bg-signal" aria-hidden="true" />
              Streaming
            </>
          )}
          {phase === "done" && (
            <>
              <span className="text-success">Completed</span>
              {metrics && (
                <Badge
                  variant="outline"
                  className={cn(
                    "font-mono",
                    metrics.source === "remote" ? "border-signal/50 text-signal" : "border-warning/50 text-warning"
                  )}
                >
                  {metrics.source === "remote" ? "远端模型" : "离线模拟"}
                </Badge>
              )}
            </>
          )}
          {phase === "idle" && "Idle"}
        </span>
      </div>
      {phase === "done" && metrics?.source === "fallback" && metrics.fallbackReason && (
        <p className="border-b border-warning/30 bg-warning/10 px-3 py-1.5 text-xs text-warning" role="status">
          未使用远端模型：{metrics.fallbackReason}。以下为内置启发式引擎的离线模拟结果，不代表真实模型判断。
        </p>
      )}
      <div
        ref={scrollRef}
        className="scrollbar-thin h-56 overflow-y-auto p-3 font-mono text-xs leading-relaxed"
        aria-live="off"
      >
        {phase === "idle" && (
          <p className="text-muted-foreground">
            选择送检切片与模型后，点击「执行大模型深度研判」，时序关键帧将与初筛元数据一并送入 VLM。
          </p>
        )}
        {phase === "thinking" && (
          <div className="flex flex-col gap-2" role="status" aria-label="模型推理中">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-4/6" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        )}
        {(phase === "streaming" || phase === "done") && (
          <div>
            {streamText.split("\n").map((line, index) => (
              <StreamLine key={index} line={line} />
            ))}
            {phase === "streaming" && (
              <span
                className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 bg-signal"
                style={{ animation: "terminal-caret 1s steps(1) infinite" }}
                aria-hidden="true"
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function AlertFrameStrip() {
  const { activeCandidate, phase, evidenceFrames } = useVlm()
  const [selected, setSelected] = React.useState(0)

  if (!activeCandidate) return null
  if (activeCandidate.frameCount === 0) {
    return (
      <div
        className="flex min-h-24 items-center justify-center rounded-md border border-dashed border-border px-3 py-4 text-xs text-muted-foreground"
        role="status"
      >
        该告警未留存证据帧，二级研判将仅基于一级初筛的规则与结论文本（元数据推理）。
      </div>
    )
  }

  const evidence = evidenceFrames ?? []
  const showEvidence = evidence.length > 0
  const frameUrl = (index: number) =>
    `/api/v1/stream-alerts/${encodeURIComponent(activeCandidate.alertId)}/frames/${index + 1}`

  return (
    <div className="flex flex-col gap-2">
      <ol
        className="grid grid-cols-4 gap-2 md:grid-cols-8"
        aria-label={`送入模型的 ${activeCandidate.frameCount} 帧一级初筛留存证据帧`}
      >
        {Array.from({ length: activeCandidate.frameCount }, (_, index) => {
          const isEvidence = showEvidence && evidence.includes(index)
          const isSelected = selected === index
          return (
            <li key={index}>
              <button
                type="button"
                onClick={() => setSelected(index)}
                aria-pressed={isSelected}
                aria-label={`第 ${index + 1} 帧${isEvidence ? "，模型引用的关键证据帧" : ""}`}
                className={cn(
                  "relative block w-full overflow-hidden rounded-md border bg-black text-left outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring",
                  isEvidence ? "border-signal ring-2 ring-signal/60" : "border-border",
                  isSelected && !isEvidence && "border-primary",
                  phase === "thinking" && "animate-pulse",
                  showEvidence && !isEvidence && "opacity-55"
                )}
                style={phase === "thinking" ? { animationDelay: `${index * 120}ms` } : undefined}
              >
                <div className="relative aspect-video overflow-hidden">
                  <img src={frameUrl(index)} alt="" loading="lazy" className="size-full object-cover" />
                  <span className="absolute top-1 left-1 rounded bg-black/70 px-1 font-mono text-[10px] text-white">
                    #{index + 1}
                  </span>
                  {isEvidence && (
                    <span className="absolute top-1 right-1 rounded bg-signal px-1 text-[10px] font-medium text-black">
                      证据
                    </span>
                  )}
                </div>
              </button>
            </li>
          )
        })}
      </ol>
      <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <span className="font-mono text-foreground">
          #{selected + 1} / {activeCandidate.frameCount}
        </span>
        <span>
          {activeCandidate.caseId ?? activeCandidate.alertId} · {activeCandidate.channelName} · {activeCandidate.ruleName}
        </span>
        {showEvidence && evidence.includes(selected) && (
          <Badge variant="outline" className="border-signal/50 text-signal">
            模型引用的关键证据
          </Badge>
        )}
      </p>
    </div>
  )
}

function LocalFrameStrip() {
  const { activeLocal, localFrames, localFramesLoading, localFramesError, phase, evidenceFrames } = useVlm()
  const [selected, setSelected] = React.useState(0)

  if (!activeLocal) return null

  const usable = localFrames.filter((f) => !!f.base64)
  const evidence = evidenceFrames ?? []
  const showEvidence = evidence.length > 0

  if (usable.length === 0) {
    return (
      <div
        className="flex min-h-24 items-center justify-center gap-2 rounded-md border border-dashed border-border px-3 py-4 text-xs text-muted-foreground"
        role="status"
      >
        {localFramesLoading ? (
          <>
            <Spinner className="size-3.5" />
            正在从原视频重新抽取该切片的关键帧…
          </>
        ) : (
          (localFramesError ?? "该切片暂无关键帧图像，请在检测队列中重新分析该视频。")
        )}
      </div>
    )
  }

  const current = usable[Math.min(selected, usable.length - 1)]

  return (
    <div className="flex flex-col gap-2">
      <ol
        className="grid grid-cols-4 gap-2 md:grid-cols-8"
        aria-label={`送入模型的 ${usable.length} 帧真实关键帧`}
      >
        {usable.map((frame, index) => {
          const isEvidence = showEvidence && evidence.includes(index)
          const isSelected = selected === index
          return (
            <li key={`${frame.timestamp}-${index}`}>
              <button
                type="button"
                onClick={() => setSelected(index)}
                aria-pressed={isSelected}
                aria-label={`第 ${index + 1} 帧，${frame.timestamp}${isEvidence ? "，模型引用的关键证据帧" : ""}`}
                className={cn(
                  "relative block w-full overflow-hidden rounded-md border bg-black text-left outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring",
                  isEvidence ? "border-signal ring-2 ring-signal/60" : "border-border",
                  isSelected && !isEvidence && "border-primary",
                  phase === "thinking" && "animate-pulse",
                  showEvidence && !isEvidence && "opacity-55"
                )}
                style={phase === "thinking" ? { animationDelay: `${index * 120}ms` } : undefined}
              >
                <div className="relative aspect-video overflow-hidden">
                  <img src={frame.base64} alt="" className="size-full object-cover" />
                  <span className="absolute top-1 left-1 rounded bg-black/70 px-1 font-mono text-[10px] text-white">
                    #{index + 1}
                  </span>
                  {isEvidence && (
                    <span className="absolute top-1 right-1 rounded bg-signal px-1 text-[10px] font-medium text-black">
                      证据
                    </span>
                  )}
                  <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1 font-mono text-[10px] text-white tabular-nums">
                    {frame.timestamp}
                  </span>
                </div>
              </button>
            </li>
          )
        })}
      </ol>
      <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <span className="font-mono text-foreground">
          #{Math.min(selected, usable.length - 1) + 1} · {current.timestamp}
        </span>
        <span>
          {activeLocal.video.name} · 切片 {activeLocal.chunk.index}/{activeLocal.chunk.total} ·{" "}
          {activeLocal.chunk.startStr}-{activeLocal.chunk.endStr}
        </span>
        {showEvidence && evidence.includes(Math.min(selected, usable.length - 1)) && (
          <Badge variant="outline" className="border-signal/50 text-signal">
            模型引用的关键证据
          </Badge>
        )}
      </p>
    </div>
  )
}

export function VlmInferenceRunner() {
  const {
    models,
    model,
    setModelId,
    candidates,
    candidatesLoading,
    candidatesError,
    activeCandidate,
    setClipId,
    selectionId,
    localSlices,
    activeLocal,
    localFramesLoading,
    phase,
    run,
  } = useVlm()
  const busy = phase === "thinking" || phase === "streaming"
  const hasSelection = !!activeCandidate || !!activeLocal

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="gap-1 border-b px-4 py-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <BrainCircuit className="size-4 text-signal" aria-hidden="true" />
          多模态推理跑道 (VLM Inference Runway)
        </CardTitle>
        <CardDescription className="text-xs">
          从一级初筛真实命中的告警（含留存证据帧）或本地视频切片中选取一项，连同命中规则与初筛结论送入多模态大模型；研判结论会写回案卷并入库检索索引。
        </CardDescription>
      </CardHeader>
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <Select value={model.id} onValueChange={setModelId} disabled={busy}>
            <SelectTrigger size="sm" className="w-full xl:w-72" aria-label="切换 VLM 模型">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {models.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select value={selectionId ?? ""} onValueChange={setClipId} disabled={busy}>
            <SelectTrigger size="sm" className="w-full min-w-0 xl:flex-1" aria-label="选择待研判的候选切片">
              <SelectValue
                placeholder={
                  candidatesLoading
                    ? "正在加载一级初筛命中告警…"
                    : (candidatesError ?? "暂无候选：一级初筛尚未产生已落库的命中告警")
                }
              />
            </SelectTrigger>
            <SelectContent>
              {candidates.length > 0 && (
                <SelectGroup>
                  <SelectLabel>一级初筛命中告警（实时通道）</SelectLabel>
                  {candidates.map((item) => (
                    <SelectItem key={item.alertId} value={item.alertId}>
                      {`${item.caseId ?? item.alertId}: ${item.channelName} · ${item.ruleName}${item.vlm ? "（已研判）" : ""}`}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              {localSlices.length > 0 && (
                <SelectGroup>
                  <SelectLabel>本地视频切片（来自检测队列）</SelectLabel>
                  {localSlices.map((slice) => (
                    <SelectItem key={slice.id} value={slice.id}>
                      {localSliceLabel(slice)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <MetricsBadge />
          <p className="font-mono text-xs text-muted-foreground">
            {model.provider} · Context {model.contextWindow}
          </p>
        </div>

        {activeLocal ? (
          <LocalFrameStrip key={activeLocal.id} />
        ) : (
          <AlertFrameStrip key={activeCandidate?.alertId ?? "none"} />
        )}

        <div className="flex items-center gap-3">
          <Button onClick={run} disabled={busy || !hasSelection || localFramesLoading}>
            {busy ? (
              <Spinner data-icon="inline-start" />
            ) : phase === "done" ? (
              <RotateCcw data-icon="inline-start" />
            ) : (
              <Play data-icon="inline-start" />
            )}
            {phase === "done" ? "重新研判 (Re-run)" : "执行大模型深度研判 (Run VLM Reasoning)"}
          </Button>
          {phase === "thinking" && <span className="text-xs text-muted-foreground">模型正在理解时序关键帧画面…</span>}
        </div>

        <StreamOutput />
      </div>
    </Card>
  )
}
