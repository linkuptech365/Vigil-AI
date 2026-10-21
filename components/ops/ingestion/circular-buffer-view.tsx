"use client"

import * as React from "react"
import { Film, Lock, RefreshCw, Send, Zap } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Progress } from "@/components/ui/progress"
import { Spinner } from "@/components/ui/spinner"
import { KEYFRAME_OFFSETS, segmentKind } from "@/lib/ops/ingestion-data"
import {
  BUFFER_SECONDS,
  EXTRACTION_STEPS,
  type BufferedClip,
  type SegmentKind,
} from "@/lib/ops/ingestion-types"
import { secondsToTime, timeToSeconds } from "@/lib/ops/utils"
import { cn } from "@/lib/utils"
import { ChannelSelector } from "./channel-selector"
import { useIngestion } from "./ingestion-provider"
import { LocalChunkInspector } from "./local-chunk-inspector"

const SEGMENT_STYLE: Record<SegmentKind, string> = {
  low: "bg-muted-foreground/40",
  high: "bg-primary",
  trigger: "bg-warning",
}

const LEGEND: Array<{ kind: SegmentKind; label: string }> = [
  { kind: "low", label: "低帧率缓存" },
  { kind: "high", label: "高帧率缓存" },
  { kind: "trigger", label: "候选触发点" },
]

function offsetLabel(offset: number) {
  if (offset === 0) return "T"
  return offset > 0 ? `T+${offset}s` : `T${offset}s`
}

function Filmstrip({ clip }: { clip: BufferedClip }) {
  const triggerSeconds = timeToSeconds(clip.startTime) + BUFFER_SECONDS / 2

  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8" aria-label="证据切片关键帧">
      {KEYFRAME_OFFSETS.map((offset, index) => {
        const image = clip.keyframeThumbnails[index]
        const isTrigger = offset === 0
        return (
          <li key={offset} className="flex flex-col gap-1">
            <div
              role="img"
              aria-label={`关键帧 ${offsetLabel(offset)}`}
              className={cn(
                "relative aspect-video overflow-hidden rounded-md border bg-secondary",
                isTrigger ? "border-warning ring-1 ring-warning" : "border-border",
              )}
              style={
                image
                  ? {
                      backgroundImage: `url(${image})`,
                      backgroundSize: "260%",
                      backgroundPosition: `${8 + index * 12}% ${25 + (index % 3) * 22}%`,
                    }
                  : undefined
              }
            >
              <span className="absolute left-1 top-1 rounded bg-background/80 px-1 font-mono text-[10px] tabular-nums">
                #{index + 1}
              </span>
            </div>
            <div className="flex items-center justify-between font-mono text-[10px] tabular-nums">
              <span className={isTrigger ? "font-semibold text-warning" : "text-muted-foreground"}>
                {offsetLabel(offset)}
              </span>
              <span className="text-muted-foreground">{secondsToTime(triggerSeconds + offset)}</span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export function CircularBufferView() {
  const { selectedStream, selectedLocalVideo, histories, buffers, clips, extraction, triggerExtraction } =
    useIngestion()
  const [activeClipId, setActiveClipId] = React.useState<string | null>(null)
  const [dispatched, setDispatched] = React.useState<string[]>([])

  if (selectedLocalVideo) return <LocalChunkInspector video={selectedLocalVideo} />
  if (!selectedStream) return null

  const history = histories[selectedStream.id] ?? []
  const buffer = buffers.find((b) => b.channelId === selectedStream.id)
  const channelClips = clips.filter((c) => c.channelId === selectedStream.id)
  const activeClip = channelClips.find((c) => c.clipId === activeClipId) ?? channelClips[0]
  const extracting = extraction?.channelId === selectedStream.id
  const offline = selectedStream.status === "offline"
  const centre = Math.floor(BUFFER_SECONDS / 2)

  const dispatchClip = (clip: BufferedClip) => {
    setDispatched((prev) => [...prev, clip.clipId])
    toast.success(`${clip.clipId} 已送入 Tier-2 VLM 推理队列`, {
      description: `${clip.frameCount} 帧 / 8 关键帧，等待视觉语言模型研判`,
    })
  }

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="flex flex-col gap-3 border-b border-border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <RefreshCw className="size-4 text-primary" aria-hidden="true" />
              环形切片缓存检视器
            </CardTitle>
            <CardDescription>内存中保留最近 30 秒 HD 滚动帧，触发时回溯 T-15s ~ T+15s</CardDescription>
          </div>
          {buffer?.isLocked ? (
            <Badge variant="outline" className="border-warning/40 bg-warning/10 font-mono text-warning">
              <Lock data-icon="inline-start" />
              已冻结
            </Badge>
          ) : (
            <Badge variant="outline" className="border-success/40 bg-success/10 font-mono text-success">
              滚动写入中
            </Badge>
          )}
        </div>
        <ChannelSelector />
      </CardHeader>

      <CardContent className="flex flex-col gap-5 p-4">
        <dl className="grid grid-cols-3 gap-3 font-mono">
          {[
            ["容量", `${buffer?.capacitySeconds ?? 30}s`],
            ["缓存帧数", `${buffer?.currentFramesCount ?? 0}`],
            ["内存占用", `${buffer?.memoryUsageMB ?? 0} MB`],
          ].map(([label, value]) => (
            <div key={label} className="flex flex-col gap-0.5 rounded-lg border border-border bg-background/60 p-2.5">
              <dt className="text-[11px] text-muted-foreground">{label}</dt>
              <dd className="text-sm font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="flex flex-col gap-2">
          <div
            className="relative flex h-12 items-stretch gap-[2px] pt-5"
            role="img"
            aria-label={`${selectedStream.id} 最近 30 秒环形缓存时间轴`}
          >
            {history.map((sample, index) => {
              const kind = segmentKind(sample)
              const isHead = index === history.length - 1
              return (
                <div key={index} className="relative flex-1">
                  {kind === "trigger" && (
                    <span className="absolute -top-5 left-1/2 -translate-x-1/2 font-mono text-[10px] font-semibold text-warning">
                      T
                    </span>
                  )}
                  <div
                    className={cn(
                      "h-full w-full rounded-[2px] transition-colors duration-300",
                      SEGMENT_STYLE[kind],
                      index === centre && kind !== "trigger" && "opacity-100",
                    )}
                  />
                  {isHead && (
                    <>
                      <span className="absolute -inset-y-0.5 -right-0.5 w-0.5 animate-pulse rounded-full bg-foreground" />
                      <span className="absolute -top-5 right-0 font-mono text-[10px] font-semibold text-foreground">
                        LIVE
                      </span>
                    </>
                  )}
                </div>
              )
            })}
          </div>
          <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
            <span>T-30s</span>
            <span>T-15s</span>
            <span>NOW</span>
          </div>
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {LEGEND.map((item) => (
              <li key={item.kind} className="flex items-center gap-1.5">
                <span className={cn("size-2.5 rounded-[2px]", SEGMENT_STYLE[item.kind])} aria-hidden="true" />
                {item.label}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-3">
          <Button
            type="button"
            disabled={offline || Boolean(extraction)}
            onClick={() => triggerExtraction(selectedStream.id)}
            className="h-auto min-h-9 whitespace-normal bg-warning text-black hover:bg-warning/90"
          >
            {extracting ? <Spinner data-icon="inline-start" /> : <Zap data-icon="inline-start" />}
            模拟触发预警并抓取证据切片 (Trigger Mock Incident Extraction)
          </Button>
          {offline && (
            <p className="text-xs text-destructive">通道离线，无法抽取缓存切片。</p>
          )}
          {extracting && extraction && (
            <div className="flex flex-col gap-1.5" aria-live="polite">
              <Progress value={((extraction.step + 1) / EXTRACTION_STEPS.length) * 100} className="h-1.5" />
              <p className="font-mono text-xs text-muted-foreground">
                [{extraction.step + 1}/{EXTRACTION_STEPS.length}] {EXTRACTION_STEPS[extraction.step]}
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">证据切片 (30s Evidence Clip)</h3>
            {channelClips.length > 1 && (
              <div className="flex flex-wrap gap-1">
                {channelClips.map((clip) => (
                  <Button
                    key={clip.clipId}
                    type="button"
                    size="xs"
                    variant={clip.clipId === activeClip?.clipId ? "secondary" : "ghost"}
                    className="font-mono"
                    onClick={() => setActiveClipId(clip.clipId)}
                  >
                    {clip.endTime}
                  </Button>
                ))}
              </div>
            )}
          </div>

          {activeClip ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-xs">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
                  <span className="text-foreground">{activeClip.clipId}</span>
                  <span className="tabular-nums">
                    {activeClip.startTime} - {activeClip.endTime}
                  </span>
                  <span className="tabular-nums">{activeClip.frameCount} 帧</span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={dispatched.includes(activeClip.clipId)}
                  onClick={() => dispatchClip(activeClip)}
                >
                  <Send data-icon="inline-start" />
                  {dispatched.includes(activeClip.clipId) ? "已入队 Tier-2 VLM" : "送入 Tier-2 VLM 推理"}
                </Button>
              </div>
              <Filmstrip clip={activeClip} />
            </div>
          ) : (
            <Empty className="border border-dashed border-border p-6">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Film />
                </EmptyMedia>
                <EmptyTitle>暂无证据切片</EmptyTitle>
                <EmptyDescription>点击上方按钮模拟规则违规，系统将打包 T-15s ~ T+15s 的 30 秒证据。</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
