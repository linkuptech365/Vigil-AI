"use client"

import * as React from "react"
import { Activity, Gauge, Stethoscope, Timer, Waves } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Spinner } from "@/components/ui/spinner"
import type {
  LivePhase,
  QosSeries,
  StreamHealthReport,
  StreamQosMetrics,
} from "@/lib/ops/ingestion-types"
import { jitterStatus } from "@/lib/ops/live-stream"
import { cn } from "@/lib/utils"

const TONE_TEXT = {
  good: "text-success",
  warn: "text-warning",
  bad: "text-destructive",
} as const

const TONE_DOT = {
  good: "bg-success",
  warn: "bg-warning",
  bad: "bg-destructive",
} as const

function Sparkline({ values, label }: { values: number[]; label: string }) {
  const width = 120
  const height = 28
  if (values.length < 2) {
    return <div className="h-7 rounded bg-secondary/60" role="img" aria-label={`${label}：等待采样`} />
  }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width
      const y = height - 2 - ((value - min) / range) * (height - 4)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(" ")
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="h-7 w-full"
      role="img"
      aria-label={`${label}趋势`}
    >
      <polyline points={points} fill="none" stroke="var(--signal)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function MetricCard({
  icon: Icon,
  title,
  value,
  caption,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  value: string
  caption: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5 text-signal" aria-hidden="true" />
        {title}
      </div>
      <div className="font-mono text-lg font-semibold tabular-nums text-foreground">{value}</div>
      {children}
      <div className="text-[11px] leading-snug text-muted-foreground">{caption}</div>
    </div>
  )
}

const PROBE_STAGES = ["探测下行链路与握手时延", "校验解码器与封装格式", "统计丢帧与抖动分布"]

interface StreamQosPanelProps {
  metrics: StreamQosMetrics
  series: QosSeries
  phase: LivePhase
  probing: boolean
  progress: number
  report: StreamHealthReport | null
  onDiagnose: () => void
}

export function StreamQosPanel({
  metrics,
  series,
  phase,
  probing,
  progress,
  report,
  onDiagnose,
}: StreamQosPanelProps) {
  const jitter = jitterStatus(metrics.jitterMs)
  const hasData = series.fps.length > 0
  const stage = PROBE_STAGES[Math.min(PROBE_STAGES.length - 1, Math.floor(progress * PROBE_STAGES.length))]
  const ready = phase === "live" || phase === "fallback"

  return (
    <section aria-label="实时 QoS 监控" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">实时 QoS 监控</h3>
        <Button type="button" size="sm" variant="secondary" disabled={probing || !ready} onClick={onDiagnose}>
          {probing ? <Spinner /> : <Stethoscope />}
          {probing ? "诊断中" : "一键诊断流质量"}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        <MetricCard
          icon={Activity}
          title="码率 Bitrate"
          value={hasData ? `${metrics.bitrateMbps.toFixed(2)} Mbps` : "-- Mbps"}
          caption={metrics.bitrateSource === "measured" ? "分片/RTP 实测" : "按通道标称码率估算"}
        >
          <Sparkline values={series.bitrate} label="码率" />
        </MetricCard>

        <MetricCard
          icon={Gauge}
          title="帧率 FPS"
          value={hasData ? `${metrics.fps.toFixed(1)} FPS` : "-- FPS"}
          caption={
            <span className="font-mono">
              Target: {metrics.targetFps.toFixed(1)} | Dropped: {metrics.droppedFrames}
            </span>
          }
        >
          <Sparkline values={series.fps} label="帧率" />
        </MetricCard>

        <MetricCard
          icon={Waves}
          title="抖动 Jitter"
          value={hasData ? `${metrics.jitterMs.toFixed(1)} ms` : "-- ms"}
          caption={
            hasData ? (
              <span className="flex items-center gap-1.5">
                <span className={cn("size-2 rounded-full", TONE_DOT[jitter.tone])} aria-hidden="true" />
                <span className={TONE_TEXT[jitter.tone]}>{jitter.label}</span>
              </span>
            ) : (
              "等待采样"
            )
          }
        >
          <Sparkline values={series.jitter} label="抖动" />
        </MetricCard>

        <MetricCard
          icon={Timer}
          title="GOP 间隔"
          value={hasData ? `${metrics.gopSeconds.toFixed(1)}s (${metrics.gopFrames} 帧)` : "--"}
          caption="按分片时长与帧率估算"
        />
      </div>

      {probing && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-signal/40 bg-signal/5 p-3" role="status">
          <div className="flex items-center justify-between text-xs">
            <span className="text-foreground">{stage}…</span>
            <span className="font-mono text-muted-foreground tabular-nums">{Math.round(progress * 100)}%</span>
          </div>
          <Progress value={progress * 100} aria-label="诊断进度" />
        </div>
      )}

      {report && !probing && <HealthReport report={report} />}
    </section>
  )
}

const VERDICT_STYLE = {
  excellent: { label: "优秀", className: "border-success/50 bg-success/15 text-success" },
  good: { label: "良好", className: "border-warning/50 bg-warning/15 text-warning" },
  poor: { label: "较差", className: "border-destructive/50 bg-destructive/15 text-destructive" },
} as const

function HealthReport({ report }: { report: StreamHealthReport }) {
  const verdict = VERDICT_STYLE[report.verdict]
  const rows: Array<[string, string]> = [
    ["编码格式", report.codec],
    ["分辨率", report.resolution],
    [
      "丢包率",
      `${report.packetLossPct.toFixed(2)}% (${report.packetLossLabel})${report.lossBasis === "decoder" ? " · 按解码丢帧折算" : ""}`,
    ],
    ["延迟等级", report.latencyLabel],
  ]
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4" role="region" aria-label="流健康诊断报告">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-xs text-muted-foreground">健康评分</span>
          <span className="font-mono text-3xl font-semibold tabular-nums text-foreground">
            {report.score.toFixed(1)}
          </span>
          <span className="text-xs text-muted-foreground">/ 100</span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={verdict.className}>
            {verdict.label}
          </Badge>
          <span className="font-mono text-[11px] text-muted-foreground">生成于 {report.generatedAt}</span>
        </div>
      </div>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {rows.map(([term, detail]) => (
          <div key={term} className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-1.5">
            <dt className="shrink-0 text-muted-foreground">{term}</dt>
            <dd className="text-right font-medium text-foreground">{detail}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
