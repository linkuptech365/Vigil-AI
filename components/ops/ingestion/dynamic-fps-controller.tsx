"use client"

import { ArrowLeftRight, Gauge } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Slider } from "@/components/ui/slider"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  IDLE_FPS,
  MAX_FPS,
  MOTION_THRESHOLD,
  type SamplingMode,
  type StreamSource,
} from "@/lib/ops/ingestion-types"
import { cn } from "@/lib/utils"
import { ChannelSelector } from "./channel-selector"
import { useIngestion } from "./ingestion-provider"

const MOTION_SCALE_MAX = 40

function modeOf(stream: StreamSource): "idle" | "active" | "fixed" | "offline" {
  if (stream.status === "offline") return "offline"
  if (stream.samplingMode === "fixed") return "fixed"
  return stream.currentFps > IDLE_FPS ? "active" : "idle"
}

function StateNode({
  title,
  detail,
  active,
  tone,
}: {
  title: string
  detail: string
  active: boolean
  tone: "idle" | "active"
}) {
  return (
    <div
      className={cn(
        "flex flex-1 flex-col gap-0.5 rounded-lg border p-3 transition-colors",
        active && tone === "idle" && "border-muted-foreground/60 bg-muted",
        active && tone === "active" && "border-primary/60 bg-primary/10",
        !active && "border-border opacity-60",
      )}
      aria-current={active ? "true" : undefined}
    >
      <span className={cn("font-mono text-xs font-semibold", active && tone === "active" && "text-primary")}>
        {title}
      </span>
      <span className="text-[11px] text-muted-foreground">{detail}</span>
    </div>
  )
}

export function DynamicFpsController() {
  const { selectedStream, histories, setSamplingMode, setFixedFps } = useIngestion()

  if (!selectedStream) return null
  const history = histories[selectedStream.id] ?? []
  const mode = modeOf(selectedStream)
  const motionPct = Math.min(100, (selectedStream.motionLevel / MOTION_SCALE_MAX) * 100)
  const thresholdPct = (MOTION_THRESHOLD / MOTION_SCALE_MAX) * 100
  const aboveThreshold = selectedStream.motionLevel >= MOTION_THRESHOLD

  const modeBadge = {
    idle: { label: "Idle / Low-Motion", className: "border-border bg-muted text-muted-foreground" },
    active: { label: "Active / High-Motion", className: "border-primary/40 bg-primary/10 text-primary" },
    fixed: { label: "Fixed FPS", className: "border-warning/40 bg-warning/10 text-warning" },
    offline: { label: "Offline", className: "border-destructive/40 bg-destructive/10 text-destructive" },
  }[mode]

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="flex flex-col gap-3 border-b border-border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <Gauge className="size-4 text-primary" aria-hidden="true" />
              动态自适应抽帧控制器
            </CardTitle>
            <CardDescription>运动增量 &lt; 5% 降至 1 FPS，检测到运动升至 5~10 FPS</CardDescription>
          </div>
          <Badge variant="outline" className={cn("font-mono", modeBadge.className)}>
            {modeBadge.label}
          </Badge>
        </div>
        <ChannelSelector />
      </CardHeader>

      <CardContent className="flex flex-col gap-5 p-4">
        <div className="flex items-end justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">
              {selectedStream.id} 实时抽帧率
            </span>
            <span className="font-mono text-4xl font-semibold tabular-nums leading-none">
              {selectedStream.currentFps}
              <span className="ml-1.5 text-sm font-normal text-muted-foreground">FPS</span>
            </span>
          </div>
          <div className="flex flex-col items-end gap-0.5">
            <span className="text-xs text-muted-foreground">运动增量 Δ</span>
            <span
              className={cn(
                "font-mono text-lg font-semibold tabular-nums",
                aboveThreshold ? "text-primary" : "text-muted-foreground",
              )}
            >
              {selectedStream.motionLevel.toFixed(1)}%
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <div
            className="relative h-2 rounded-full bg-secondary"
            role="meter"
            aria-label="场景运动增量"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={selectedStream.motionLevel}
          >
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-500",
                aboveThreshold ? "bg-primary" : "bg-muted-foreground/60",
              )}
              style={{ width: `${motionPct}%` }}
            />
            <div
              className="absolute -top-1 h-4 w-px bg-warning"
              style={{ left: `${thresholdPct}%` }}
              aria-hidden="true"
            />
          </div>
          <div className="relative h-3 font-mono text-[10px] text-muted-foreground">
            <span className="absolute left-0">0%</span>
            <span className="absolute -translate-x-1/2 text-warning" style={{ left: `${thresholdPct}%` }}>
              阈值 {MOTION_THRESHOLD}%
            </span>
            <span className="absolute right-0">{MOTION_SCALE_MAX}%+</span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>近 30 秒抽帧率 (FPS)</span>
            <span className="font-mono">
              {IDLE_FPS} ~ {MAX_FPS}
            </span>
          </div>
          <div
            className="flex h-24 items-end gap-[3px] rounded-lg border border-border bg-background/60 p-2"
            role="img"
            aria-label={`${selectedStream.id} 近 30 秒抽帧率曲线，当前 ${selectedStream.currentFps} FPS`}
          >
            {history.map((sample, index) => (
              <div
                key={index}
                className={cn(
                  "min-w-0 flex-1 rounded-t-[2px] transition-[height] duration-500",
                  sample.fps === 0 && "bg-destructive/50",
                  sample.fps > 0 && sample.fps < 4 && "bg-muted-foreground/50",
                  sample.fps >= 4 && "bg-primary",
                  index === history.length - 1 && "animate-pulse",
                )}
                style={{ height: `${Math.max(6, (sample.fps / MAX_FPS) * 100)}%` }}
              />
            ))}
          </div>
        </div>

        <div className="flex items-stretch gap-2">
          <StateNode
            title="IDLE  1 FPS"
            detail="Δ < 5%，节省带宽与边缘算力"
            active={mode === "idle"}
            tone="idle"
          />
          <div className="flex items-center text-muted-foreground" aria-hidden="true">
            <ArrowLeftRight className="size-4" />
          </div>
          <StateNode
            title="ACTIVE  5~10 FPS"
            detail="Δ ≥ 5%，捕获动作细节"
            active={mode === "active"}
            tone="active"
          />
        </div>

        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <ToggleGroup
            type="single"
            value={selectedStream.samplingMode}
            onValueChange={(value) => value && setSamplingMode(selectedStream.id, value as SamplingMode)}
            aria-label="抽帧模式"
            className="grid w-full grid-cols-1 gap-1.5 sm:grid-cols-2"
          >
            <ToggleGroupItem
              value="auto"
              className="h-9 w-full border border-border text-xs data-[state=on]:border-primary/60 data-[state=on]:bg-primary/15 data-[state=on]:text-primary"
            >
              自适应动态抽帧 (Auto Dynamic)
            </ToggleGroupItem>
            <ToggleGroupItem
              value="fixed"
              className="h-9 w-full border border-border text-xs data-[state=on]:border-warning/60 data-[state=on]:bg-warning/15 data-[state=on]:text-warning"
            >
              锁定固定采样率 (Fixed FPS)
            </ToggleGroupItem>
          </ToggleGroup>

          {selectedStream.samplingMode === "fixed" && (
            <div className="flex items-center gap-4">
              <Slider
                value={[selectedStream.fixedFps]}
                min={1}
                max={MAX_FPS}
                step={1}
                onValueChange={([value]) => setFixedFps(selectedStream.id, value)}
                aria-label="固定采样率"
              />
              <span className="w-16 shrink-0 text-right font-mono text-sm tabular-nums">
                {selectedStream.fixedFps} FPS
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
