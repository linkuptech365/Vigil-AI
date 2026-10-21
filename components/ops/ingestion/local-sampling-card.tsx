"use client"

import { Gauge, Play } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { CHUNK_WINDOW_SECONDS, planVideoChunks } from "@/lib/client/frame-capture"
import { formatDuration } from "@/lib/ops/local-source"
import type { VideoItem } from "@/lib/vigil/types"
import { cn } from "@/lib/utils"
import { useVigil } from "@/components/vigil/vigil-provider"
import { ChannelSelector } from "./channel-selector"

export function LocalSamplingCard({ video }: { video: VideoItem }) {
  const { analyzeOne } = useVigil()
  const duration = video.prescreen?.durationSec ?? video.durationSec
  const plan = planVideoChunks(duration)
  const analyzing = video.status === "analyzing"
  const prescreen = video.prescreen

  const rows: Array<[string, string]> = [
    ["抽帧模式", "自适应动态抽帧"],
    ["初筛采样", prescreen ? `每 ${prescreen.scanStepSeconds}s 一帧（${(1 / prescreen.scanStepSeconds).toFixed(1)} FPS）` : "1 FPS 像素差分"],
    ["切片窗口", `${CHUNK_WINDOW_SECONDS}s / 片`],
    ["切片数量", `${plan.length} 片`],
    ["视频时长", formatDuration(duration)],
    ["分辨率", video.resolution ?? "未知"],
  ]

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="flex flex-col gap-3 border-b border-border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <Gauge className="size-4 text-primary" aria-hidden="true" />
              动态自适应抽帧控制器
            </CardTitle>
            <CardDescription>本地录像回放模式：先逐秒运动初筛，再按动作区间加密抽帧</CardDescription>
          </div>
          <Badge variant="outline" className="border-primary/40 bg-primary/10 font-mono text-primary">
            Local Replay
          </Badge>
        </div>
        <ChannelSelector />
      </CardHeader>

      <CardContent className="flex flex-col gap-5 p-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">视频源</span>
          <span className="truncate font-mono text-sm font-semibold">{video.name}</span>
        </div>

        <dl className="grid grid-cols-2 gap-3 font-mono">
          {rows.map(([label, value]) => (
            <div key={label} className="flex flex-col gap-0.5 rounded-lg border border-border bg-background/60 p-2.5">
              <dt className="text-[11px] text-muted-foreground">{label}</dt>
              <dd className="truncate text-sm font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>切片与动作区间时间轴</span>
            <span className="font-mono">{plan.length} 个切片</span>
          </div>
          <div
            className="relative h-10 overflow-hidden rounded-lg border border-border bg-background/60"
            role="img"
            aria-label={`${video.name} 切片划分与动作区间`}
          >
            {prescreen?.motionSegments.map((segment) => (
              <div
                key={segment.start + segment.end}
                className="absolute inset-y-0 bg-primary/70"
                style={{
                  left: `${(segment.startSeconds / Math.max(duration, 1)) * 100}%`,
                  width: `${Math.max(0.6, ((segment.endSeconds - segment.startSeconds) / Math.max(duration, 1)) * 100)}%`,
                }}
              />
            ))}
            {plan.slice(1).map((chunk) => (
              <div
                key={chunk.index}
                className="absolute inset-y-0 w-px bg-warning"
                style={{ left: `${(chunk.startTime / Math.max(duration, 1)) * 100}%` }}
              />
            ))}
          </div>
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <li className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-[2px] bg-primary/70" aria-hidden="true" />
              动作区间
            </li>
            <li className="flex items-center gap-1.5">
              <span className="h-2.5 w-px bg-warning" aria-hidden="true" />
              切片边界
            </li>
          </ul>
        </div>

        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <Button
            type="button"
            disabled={analyzing}
            onClick={() => void analyzeOne(video)}
            className={cn("h-auto min-h-9 whitespace-normal")}
          >
            {analyzing ? <Spinner data-icon="inline-start" /> : <Play data-icon="inline-start" />}
            {analyzing ? "分析进行中" : video.chunks?.length ? "重新分析该视频" : "开始分析该视频"}
          </Button>
          {!prescreen && !analyzing && (
            <p className="text-xs text-muted-foreground">尚未初筛。开始分析后，这里会展示真实的动作时段与切片划分。</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
