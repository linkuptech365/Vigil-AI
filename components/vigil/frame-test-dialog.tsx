"use client"

import * as React from "react"
import { Film, ImageOff, RefreshCw } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { ExtractedKeyframe } from "@/lib/ops/video-types"
import type { SamplingFps } from "@/lib/ops/video-types"
import { useVigil } from "./vigil-provider"

export function KeyframeGrid({
  keyframes,
  triggerSec,
}: {
  keyframes: ExtractedKeyframe[]
  triggerSec?: number
}) {
  return (
    <ol
      aria-label="关键帧序列"
      className="grid grid-cols-2 gap-3 sm:grid-cols-4"
    >
      {keyframes.map((frame) => {
        const isTrigger =
          triggerSec !== undefined && Math.abs(frame.timestampSec - triggerSec) < 0.5
        return (
          <li
            key={frame.index}
            className="flex flex-col gap-1.5 overflow-hidden rounded-lg border border-border bg-card"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={frame.thumbnailUrl}
              alt={`关键帧 ${frame.index + 1}，时间码 ${frame.timecode}`}
              className="aspect-video w-full bg-secondary object-cover"
              loading="lazy"
            />
            <div className="flex items-center justify-between px-2 pb-2 font-mono text-xs">
              <span className={isTrigger ? "font-semibold text-destructive" : "text-muted-foreground"}>
                {frame.timecode}
              </span>
              <span className="text-muted-foreground">
                {Math.round(frame.motionScore * 100)}%
              </span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export function FrameTestDialog() {
  const { frameTest, queue, runFrameTest, closeFrameTest } = useVigil()
  const video = queue.find((v) => v.id === frameTest?.videoId)
  const [triggerInput, setTriggerInput] = React.useState("")

  React.useEffect(() => {
    if (frameTest?.status === "ok" && frameTest.triggerTimestampSec !== undefined) {
      setTriggerInput(String(frameTest.triggerTimestampSec))
    }
  }, [frameTest?.status, frameTest?.triggerTimestampSec])

  const rerun = (fps: SamplingFps, rawTrigger: string) => {
    if (!video) return
    const parsed = rawTrigger.trim() === "" ? null : Number(rawTrigger)
    const trigger = parsed !== null && Number.isFinite(parsed) && parsed >= 0 ? parsed : null
    void runFrameTest(video, fps, trigger)
  }

  return (
    <Dialog open={Boolean(frameTest && video)} onOpenChange={(next) => !next && closeFrameTest()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
        {frameTest && video && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Film className="size-4 text-primary" aria-hidden="true" />
                关键帧抽取测试
              </DialogTitle>
              <DialogDescription className="font-mono text-xs break-all">
                {video.path}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
              <Field className="sm:w-auto">
                <FieldLabel>采样频率</FieldLabel>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  value={String(frameTest.fps)}
                  onValueChange={(value) => {
                    if (value) rerun(Number(value) as SamplingFps, triggerInput)
                  }}
                  disabled={frameTest.status === "loading"}
                >
                  {([1, 2, 5] as const).map((fps) => (
                    <ToggleGroupItem key={fps} value={String(fps)} aria-label={`${fps} FPS`}>
                      {fps} FPS
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </Field>
              <Field className="sm:w-48">
                <FieldLabel htmlFor="trigger-sec">触发时间点（秒，可选）</FieldLabel>
                <Input
                  id="trigger-sec"
                  inputMode="decimal"
                  placeholder="默认取视频中点"
                  value={triggerInput}
                  onChange={(event) => setTriggerInput(event.target.value)}
                  className="font-mono"
                />
              </Field>
              <Button
                variant="outline"
                disabled={frameTest.status === "loading"}
                onClick={() => rerun(frameTest.fps, triggerInput)}
              >
                <RefreshCw data-icon="inline-start" />
                重新抽帧
              </Button>
            </div>

            {frameTest.status === "loading" && (
              <div
                className="grid grid-cols-2 gap-3 sm:grid-cols-4"
                role="status"
                aria-label="正在抽取关键帧"
              >
                {Array.from({ length: 8 }, (_, i) => (
                  <Skeleton key={i} className="aspect-video w-full" />
                ))}
              </div>
            )}

            {frameTest.status === "error" && (
              <Alert variant="destructive">
                <ImageOff />
                <AlertTitle>抽帧失败</AlertTitle>
                <AlertDescription>{frameTest.error}</AlertDescription>
              </Alert>
            )}

            {frameTest.status === "ok" && frameTest.keyframes && frameTest.windowRange && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="font-mono">
                    窗口 [{frameTest.windowRange.startSec}s, {frameTest.windowRange.endSec}s]
                  </Badge>
                  <Badge variant="outline" className="font-mono">
                    触发点 {frameTest.triggerTimestampSec}s
                  </Badge>
                  <Badge variant="secondary">共 {frameTest.keyframes.length} 帧</Badge>
                </div>
                <KeyframeGrid
                  keyframes={frameTest.keyframes}
                  triggerSec={frameTest.triggerTimestampSec}
                />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  缩略图由服务端合成（未调用 ffmpeg），时间轴与时长来自真实文件元数据。
                </p>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
