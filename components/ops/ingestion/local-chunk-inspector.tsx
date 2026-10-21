"use client"

import { Film, RefreshCw } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { planVideoChunks } from "@/lib/client/frame-capture"
import { CHUNK_STATUS_CLASS, CHUNK_STATUS_LABEL } from "@/lib/ops/local-source"
import type { ChunkRecord, VideoItem } from "@/lib/vigil/types"
import { cn } from "@/lib/utils"
import { ChannelSelector } from "./channel-selector"

function plannedChunks(video: VideoItem): ChunkRecord[] {
  return planVideoChunks(video.prescreen?.durationSec ?? video.durationSec).map((chunk) => ({
    index: chunk.index,
    total: chunk.total,
    startSec: chunk.startTime,
    endSec: chunk.endTime,
    startStr: chunk.startStr,
    endStr: chunk.endStr,
    status: "pending",
    frames: [],
  }))
}

function ChunkCard({ chunk }: { chunk: ChunkRecord }) {
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border bg-background/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-semibold">
          CHUNK {chunk.index}/{chunk.total}
        </span>
        <Badge variant="outline" className={cn("font-mono", CHUNK_STATUS_CLASS[chunk.status])}>
          {CHUNK_STATUS_LABEL[chunk.status]}
        </Badge>
      </div>
      <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
        [{chunk.startStr}-{chunk.endStr}] · {chunk.frames.length} 关键帧
      </p>
      {chunk.frames.length > 0 ? (
        <ol className="grid grid-cols-4 gap-1" aria-label={`切片 ${chunk.index} 关键帧`}>
          {chunk.frames.slice(0, 8).map((frame) => (
            <li key={frame.seconds} className="flex flex-col gap-0.5">
              <div className="aspect-video overflow-hidden rounded border border-border bg-secondary">
                {frame.base64 && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={frame.base64} alt={`${frame.timestamp} 关键帧`} className="size-full object-cover" />
                )}
              </div>
              <span className="text-center font-mono text-[10px] tabular-nums text-muted-foreground">
                {frame.timestamp}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          {chunk.status === "pending" ? "等待轮到该切片抽帧" : "关键帧未保留，可在二级研判页重新抽取"}
        </p>
      )}
      {chunk.ruleName && <p className="truncate text-xs text-destructive">{chunk.ruleName}</p>}
    </li>
  )
}

export function LocalChunkInspector({ video }: { video: VideoItem }) {
  const chunks = video.chunks?.length ? video.chunks : plannedChunks(video)
  const hasReal = Boolean(video.chunks?.length)
  const done = chunks.filter((c) => c.status === "alert" || c.status === "safe").length
  const framesTotal = chunks.reduce((sum, c) => sum + c.frames.length, 0)

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="flex flex-col gap-3 border-b border-border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <RefreshCw className="size-4 text-primary" aria-hidden="true" />
              切片缓存检视器
            </CardTitle>
            <CardDescription>本地录像按 90 秒窗口划分切片，逐片抽取关键帧后送入 VLM</CardDescription>
          </div>
          <Badge variant="outline" className="border-primary/40 bg-primary/10 font-mono text-primary">
            {hasReal ? "真实切片" : "切片计划"}
          </Badge>
        </div>
        <ChannelSelector />
      </CardHeader>

      <CardContent className="flex flex-col gap-5 p-4">
        <dl className="grid grid-cols-3 gap-3 font-mono">
          {[
            ["切片总数", `${chunks.length}`],
            ["已完成", `${done}/${chunks.length}`],
            ["关键帧", `${framesTotal}`],
          ].map(([label, value]) => (
            <div key={label} className="flex flex-col gap-0.5 rounded-lg border border-border bg-background/60 p-2.5">
              <dt className="text-[11px] text-muted-foreground">{label}</dt>
              <dd className="text-sm font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>

        {hasReal || chunks.length > 0 ? (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label="时间切片网格">
            {chunks.map((chunk) => (
              <ChunkCard key={chunk.index} chunk={chunk} />
            ))}
          </ul>
        ) : (
          <Empty className="border border-dashed border-border p-6">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Film />
              </EmptyMedia>
              <EmptyTitle>暂无切片</EmptyTitle>
              <EmptyDescription>开始分析后会在这里显示切片与关键帧。</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </CardContent>
    </Card>
  )
}
