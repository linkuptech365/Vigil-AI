"use client"

import Image from "next/image"
import { GalleryHorizontalEnd } from "lucide-react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { CLIP_T0, KEYFRAMES, formatClipTime, formatOffset } from "@/lib/ops/dispatch-data"
import { cn } from "@/lib/utils"
import { useDispatch } from "./dispatch-provider"

export function KeyframeFilmstrip() {
  const { dossier, selectedKeyframeId, selectKeyframe } = useDispatch()

  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <GalleryHorizontalEnd className="size-4 text-signal" aria-hidden="true" />
          AI 时序关键帧证据图谱 (Keyframe Evidence Filmstrip)
        </CardTitle>
        <CardDescription>
          8 帧按时间排序，红框标记规则被突破的精确时刻，点击可让左侧播放器跳转到对应帧。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol
          className="grid grid-cols-2 gap-2 sm:grid-cols-4"
          aria-label="证据关键帧"
        >
          {KEYFRAMES.map((kf, index) => {
            const selected = kf.id === selectedKeyframeId
            return (
              <li key={kf.id}>
                <button
                  type="button"
                  onClick={() => selectKeyframe(kf.id)}
                  aria-pressed={selected}
                  aria-label={`${kf.id} ${formatOffset(kf.offsetSec)} ${kf.label}`}
                  className={cn(
                    "flex w-full flex-col gap-1 rounded-md border bg-background p-1 text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                    selected ? "border-primary" : "border-border hover:border-input"
                  )}
                >
                  <span className="relative block aspect-video overflow-hidden rounded-sm">
                    <Image
                      src={dossier.keyframes[index]}
                      alt=""
                      fill
                      sizes="(min-width: 1280px) 12vw, 40vw"
                      className="object-cover"
                    />
                    <span
                      className={cn(
                        "absolute rounded-sm border-2",
                        kf.breach ? "border-destructive" : "border-signal"
                      )}
                      style={{
                        left: `${kf.box[0]}%`,
                        top: `${kf.box[1]}%`,
                        width: `${kf.box[2]}%`,
                        height: `${kf.box[3]}%`,
                      }}
                      aria-hidden="true"
                    />
                    {kf.breach ? (
                      <span className="absolute left-1 top-1 rounded-sm bg-destructive px-1 font-mono text-[9px] text-primary-foreground">
                        BREACH
                      </span>
                    ) : null}
                  </span>
                  <span className="flex items-center justify-between gap-1 px-0.5">
                    <span className="font-mono text-[10px] text-signal">
                      {formatOffset(kf.offsetSec)}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {formatClipTime(CLIP_T0 + kf.offsetSec).slice(0, 5)}
                    </span>
                  </span>
                  <span className="truncate px-0.5 text-[11px] text-foreground">{kf.label}</span>
                </button>
              </li>
            )
          })}
        </ol>
      </CardContent>
    </Card>
  )
}
