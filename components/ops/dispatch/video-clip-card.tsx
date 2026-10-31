"use client"

import Image from "next/image"
import { ChevronLeft, ChevronRight, Film, Pause, Play } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Slider } from "@/components/ui/slider"
import {
  CLIP_FPS,
  CLIP_SECONDS,
  CLIP_T0,
  KEYFRAMES,
  WORKSHOP_IMAGE,
  formatClipTime,
  formatOffset,
} from "@/lib/ops/dispatch-data"
import { cn } from "@/lib/utils"
import { useDispatch } from "./dispatch-provider"

export function VideoClipCard() {
  const { dossier, playhead, playing, togglePlaying, seek, stepFrames } = useDispatch()

  const offset = playhead - CLIP_T0
  const activeFrame = KEYFRAMES.find((kf) => Math.abs(kf.offsetSec - offset) <= 1.2)
  const t0Percent = (CLIP_T0 / CLIP_SECONDS) * 100

  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Film className="size-4 text-signal" aria-hidden="true" />
          原始高清视频切片 (HD Video Clip Asset)
        </CardTitle>
        <CardDescription>事件前后各 15 秒原始码流，逐帧可回放。</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="relative aspect-video overflow-hidden rounded-md border border-border bg-background">
          <Image
            src={WORKSHOP_IMAGE}
            alt="1号重型机加工车间监控画面回放"
            fill
            sizes="(min-width: 1280px) 40vw, 90vw"
            className="object-cover"
          />
          <div className="cctv-scanlines pointer-events-none absolute inset-0" aria-hidden="true" />
          {activeFrame ? (
            <div
              className={cn(
                "pointer-events-none absolute rounded-sm border-2",
                activeFrame.breach ? "border-destructive" : "border-signal"
              )}
              style={{
                left: `${activeFrame.box[0]}%`,
                top: `${activeFrame.box[1]}%`,
                width: `${activeFrame.box[2]}%`,
                height: `${activeFrame.box[3]}%`,
              }}
            >
              <span
                className={cn(
                  "absolute -top-5 left-0 whitespace-nowrap rounded-sm px-1 font-mono text-[10px]",
                  activeFrame.breach
                    ? "bg-destructive text-primary-foreground"
                    : "bg-signal text-background"
                )}
              >
                {activeFrame.breach ? "BREACH" : "TRACK"} {activeFrame.confidence.toFixed(2)}
              </span>
            </div>
          ) : null}
          <div className="absolute left-2 top-2 flex items-center gap-1.5 rounded-sm bg-background/80 px-1.5 py-0.5 font-mono text-[10px] text-foreground">
            <span className="size-1.5 rounded-full bg-destructive" aria-hidden="true" />
            {dossier.channelId} · {dossier.channelName}
          </div>
          <div className="absolute bottom-2 right-2 rounded-sm bg-background/80 px-1.5 py-0.5 font-mono text-[10px] text-foreground">
            {formatOffset(Math.round(offset))} · {formatClipTime(playhead)}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="relative">
            <Slider
              value={[playhead]}
              min={0}
              max={CLIP_SECONDS}
              step={1 / CLIP_FPS}
              onValueChange={([value]) => seek(value)}
              aria-label="视频切片播放进度"
            />
            <span
              className="pointer-events-none absolute -bottom-3.5 -translate-x-1/2 font-mono text-[10px] text-destructive"
              style={{ left: `${t0Percent}%` }}
              aria-hidden="true"
            >
              T0
            </span>
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => stepFrames(-1)}
                aria-label="后退一帧"
              >
                <ChevronLeft />
              </Button>
              <Button
                type="button"
                size="icon"
                onClick={togglePlaying}
                aria-label={playing ? "暂停" : "播放"}
              >
                {playing ? <Pause /> : <Play />}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => stepFrames(1)}
                aria-label="前进一帧"
              >
                <ChevronRight />
              </Button>
            </div>
            <span className="font-mono text-xs text-muted-foreground">
              {formatClipTime(playhead)} / {formatClipTime(CLIP_SECONDS)}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline">{dossier.clipDuration}</Badge>
          <Badge variant="outline">1080P / 25FPS</Badge>
          <Badge variant="outline">{dossier.clipSize}</Badge>
        </div>
      </CardContent>
    </Card>
  )
}
