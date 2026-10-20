"use client"

import * as React from "react"
import { Coins, Filter, Layers, Send, type LucideIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { DAILY_SAVING_USD } from "@/lib/ops/perception-data"
import type { SeriesPoint } from "@/lib/ops/perception-types"
import { usePerception } from "./perception-provider"

interface MetricCardProps {
  label: string
  value: string
  unit: string
  hint: string
  icon: LucideIcon
  badge?: string
}

function MetricCard({ label, value, unit, hint, icon: Icon, badge }: MetricCardProps) {
  return (
    <Card className="gap-0 py-0">
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="flex items-baseline gap-1.5">
            <span className="font-mono text-2xl font-semibold tabular-nums">{value}</span>
            <span className="text-xs text-muted-foreground">{unit}</span>
          </p>
          {badge && (
            <Badge variant="outline" className="w-fit border-success/40 bg-success/10 text-success">
              {badge}
            </Badge>
          )}
          <p className="font-mono text-[11px] text-muted-foreground">{hint}</p>
        </div>
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
          <Icon className="size-4" aria-hidden="true" />
        </div>
      </CardContent>
    </Card>
  )
}

const CHART_W = 300
const CHART_H = 100

function toPoints(values: number[], max: number) {
  return values.map((v, i) => [(i / (values.length - 1)) * CHART_W, CHART_H - (v / max) * (CHART_H - 6) - 3] as const)
}

function FrameTrendChart({ series }: { series: SeriesPoint[] }) {
  const max = Math.max(...series.map((p) => p.ingested)) * 1.1
  const ingested = toPoints(series.map((p) => p.ingested), max)
  const escalated = toPoints(series.map((p) => p.escalated), max)
  const line = (pts: (readonly [number, number])[]) => pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")
  const area = `0,${CHART_H} ${line(ingested)} ${CHART_W},${CHART_H}`
  const tail = ingested[ingested.length - 1]
  const tailEscalated = escalated[escalated.length - 1]

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <svg
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="过去 30 分钟全量抽帧数与送检大模型帧数趋势"
          className="h-28 w-full overflow-visible"
        >
          <defs>
            <linearGradient id="ingested-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map((r) => (
            <line
              key={r}
              x1="0"
              x2={CHART_W}
              y1={CHART_H * r}
              y2={CHART_H * r}
              stroke="var(--border)"
              strokeDasharray="3 4"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <polygon points={area} fill="url(#ingested-fill)" />
          <polyline
            points={line(ingested)}
            fill="none"
            stroke="var(--primary)"
            strokeWidth="2"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          <polyline
            points={line(escalated)}
            fill="none"
            stroke="var(--warning)"
            strokeWidth="2"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <span
          aria-hidden="true"
          className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary ring-4 ring-primary/25"
          style={{ left: `${(tail[0] / CHART_W) * 100}%`, top: `${(tail[1] / CHART_H) * 100}%` }}
        />
        <span
          aria-hidden="true"
          className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-warning ring-4 ring-warning/25"
          style={{
            left: `${(tailEscalated[0] / CHART_W) * 100}%`,
            top: `${(tailEscalated[1] / CHART_H) * 100}%`,
          }}
        />
      </div>
      <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
        <span>-30 min</span>
        <span>-15 min</span>
        <span>现在</span>
      </div>
    </div>
  )
}

export function FilterMetrics() {
  const { metrics, series } = usePerception()
  const escalatedRatio = metrics.escalatedFrames / metrics.ingested
  const filteredRate = (1 - escalatedRatio) * 100
  const saving = Math.round((filteredRate / 88.4) * DAILY_SAVING_USD)
  const perMinute = series[series.length - 1]

  return (
    <section aria-label="一级初筛效率概览" className="grid grid-cols-1 gap-3 xl:grid-cols-12">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:col-span-7">
        <MetricCard
          label="全量进流帧数 (Ingested Frames)"
          value={metrics.ingested.toLocaleString("en-US")}
          unit="帧"
          hint="4 路通道 · 动态抽帧后实时累计"
          icon={Layers}
        />
        <MetricCard
          label="边缘轻量初筛拦截率 (Filtered Rate)"
          value={filteredRate.toFixed(1)}
          unit="%"
          badge="静止/空场景自动滤除"
          hint="YOLO + ByteTrack 边缘初筛"
          icon={Filter}
        />
        <MetricCard
          label="触发送检 VLM 事件数 (Escalated to VLM)"
          value={(escalatedRatio * 100).toFixed(1)}
          unit="%"
          hint={`${Math.round(metrics.escalatedFrames).toLocaleString("en-US")} 帧 / ${metrics.clips} 个候选切片`}
          icon={Send}
        />
        <MetricCard
          label="预估节省推理算力/成本 (Cost & Token Saved)"
          value={filteredRate.toFixed(1)}
          unit="% Token 节省"
          hint={`~$${saving}/日节省`}
          icon={Coins}
        />
      </div>
      <Card className="gap-3 py-4 xl:col-span-5">
        <CardHeader className="gap-1 px-4">
          <CardTitle className="text-sm">抽帧 vs 送检大模型帧数 · 近 30 分钟</CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-primary" aria-hidden="true" />
              全量抽帧数 {perMinute.ingested.toLocaleString("en-US")}/min
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-warning" aria-hidden="true" />
              真正调用大模型帧数 {Math.round(perMinute.escalated).toLocaleString("en-US")}/min
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent className="px-4">
          <FrameTrendChart series={series} />
        </CardContent>
      </Card>
    </section>
  )
}
