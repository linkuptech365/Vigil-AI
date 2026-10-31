"use client"

import * as React from "react"
import { Film, Play, Radar } from "lucide-react"

import { useVigil } from "@/components/vigil/vigil-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { formatDuration } from "@/lib/ops/local-source"
import { getVideoSrc } from "@/lib/vigil/video-source"
import type { VideoItem } from "@/lib/vigil/types"
import { PerceptionSourceSelect } from "./perception-source-select"

export function LocalScreeningCanvas({ video }: { video: VideoItem }) {
  const { analyzeOne } = useVigil()
  const src = getVideoSrc(video)
  const prescreen = video.prescreen
  const duration = prescreen?.durationSec ?? video.durationSec
  const analyzing = video.status === "analyzing"
  const [videoFailed, setVideoFailed] = React.useState(false)

  React.useEffect(() => {
    setVideoFailed(false)
  }, [video.id])

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="gap-1 border-b px-4 py-3">
        <CardTitle className="text-sm">本地录像初筛回放 (Local Replay Screening)</CardTitle>
        <CardDescription className="text-xs">
          浏览器逐秒像素差分完成 Level-1 运动初筛，只有动作区间才会切片送往二级大模型。
        </CardDescription>
      </CardHeader>

      <div className="border-b p-3">
        <PerceptionSourceSelect />
      </div>

      <div className="relative isolate aspect-[1408/768] w-full overflow-hidden bg-black">
        {src && !videoFailed ? (
          <video
            key={video.id}
            src={src}
            controls
            muted
            playsInline
            preload="metadata"
            className="absolute inset-0 size-full object-contain"
            aria-label={`${video.name} 本地视频回放`}
            onError={() => setVideoFailed(true)}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-white/70">
            <Film className="size-8" aria-hidden="true" />
            <span>{src ? "视频无法播放，请检查文件编码或路径" : "该视频没有可播放的来源"}</span>
          </div>
        )}
        <div className="pointer-events-none absolute left-0 top-0 flex flex-col gap-1 p-2.5">
          <span className="w-fit rounded bg-black/70 px-1.5 py-0.5 font-mono text-xs font-semibold text-signal">
            LOCAL
          </span>
          <span className="max-w-64 truncate rounded bg-black/70 px-1.5 py-0.5 text-xs font-medium text-white">
            {video.name}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Radar className="size-3.5" aria-hidden="true" />
            动作时段时间轴
          </span>
          <span className="font-mono">全长 {formatDuration(duration)}</span>
        </div>

        {prescreen ? (
          <>
            <div
              role="img"
              aria-label={`识别出 ${prescreen.motionSegments.length} 个动作时段`}
              className="relative h-8 overflow-hidden rounded-lg border border-border bg-background/60"
            >
              {prescreen.motionSegments.map((seg) => (
                <span
                  key={`${seg.startSeconds}-${seg.endSeconds}`}
                  className="absolute inset-y-0 bg-primary/40"
                  style={{
                    left: `${(seg.startSeconds / Math.max(duration, 1)) * 100}%`,
                    width: `${Math.max(((seg.endSeconds - seg.startSeconds) / Math.max(duration, 1)) * 100, 0.8)}%`,
                  }}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {prescreen.motionSegments.length === 0 ? (
                <Badge variant="outline" className="font-mono">
                  全程静止，未发现动作时段
                </Badge>
              ) : (
                prescreen.motionSegments.map((seg) => (
                  <Badge
                    key={`${seg.startSeconds}-${seg.endSeconds}`}
                    variant="outline"
                    className="border-primary/40 bg-primary/10 font-mono text-primary"
                  >
                    {seg.start}-{seg.end}
                  </Badge>
                ))
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border bg-background/60 p-3">
            <p className="text-sm text-muted-foreground">
              {analyzing ? "正在执行一级运动初筛…" : "该视频尚未执行一级初筛，开始分析后将在此展示真实结果。"}
            </p>
            <Button size="sm" disabled={analyzing} onClick={() => void analyzeOne(video)}>
              {analyzing ? <Spinner data-icon="inline-start" /> : <Play data-icon="inline-start" />}
              {analyzing ? "初筛中" : "开始分析"}
            </Button>
          </div>
        )}
      </div>
    </Card>
  )
}
