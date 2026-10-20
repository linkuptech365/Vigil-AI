"use client"

import * as React from "react"
import { Database, MapPin, SearchX, Search, Sparkles } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Progress } from "@/components/ui/progress"
import { RAG_INDEX, RAG_PRESETS, RAG_THRESHOLD, searchCorpus } from "@/lib/ops/vlm-data"
import type { LocateOptions } from "@/lib/ops/types"
import { defaultIncidentSec, isChannelId } from "@/lib/ops/video-scenarios"
import type { RagSearchResult } from "@/lib/ops/vlm-types"

type SearchPhase = "idle" | "searching" | "done"

const SEARCH_STAGES = [
  { until: 30, label: "正在将检索语句编码为 1024 维语义向量..." },
  { until: 85, label: "正在执行多模态余弦相似度计算..." },
  { until: 101, label: "正在对 Top-K 候选切片重排序..." },
]

type LocateHandler = (channelId: string, opts?: LocateOptions) => void

interface RagStudioProps {
  onLocate: LocateHandler
}

function IndexStatus() {
  const stats = [
    { label: "已索引视频切片", value: `${RAG_INDEX.clips.toLocaleString("en-US")} 切片` },
    { label: "向量维度", value: `${RAG_INDEX.dimensions} (${RAG_INDEX.embedding})` },
    { label: "向量库", value: RAG_INDEX.store },
  ]

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {stats.map((stat) => (
        <div key={stat.label} className="flex items-start gap-3 rounded-md border border-border bg-background p-3">
          <Database className="mt-0.5 size-4 shrink-0 text-signal" aria-hidden="true" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">{stat.label}</span>
            <span className="text-sm font-medium break-words">{stat.value}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function ResultCard({
  result,
  rank,
  onLocate,
}: {
  result: RagSearchResult
  rank: number
  onLocate: LocateHandler
}) {
  return (
    <article className="flex flex-col overflow-hidden rounded-lg border border-border bg-background">
      <div className="relative aspect-video overflow-hidden bg-black">
        <img src={result.thumbnail} alt={`${result.channelName} 检索命中关键帧`} className="size-full object-cover" />
        <div className="cctv-scanlines pointer-events-none absolute inset-0" aria-hidden="true" />
        <span className="absolute top-2 left-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-xs text-white">
          #{rank}
        </span>
        <Badge className="absolute top-2 right-2 bg-signal font-mono text-black hover:bg-signal">
          {result.similarityScore.toFixed(1)}% 相似度匹配
        </Badge>
        <span className="absolute right-2 bottom-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[11px] text-white tabular-nums">
          {result.timeRange}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-3">
        <div className="flex flex-col gap-0.5">
          <span className="truncate font-mono text-xs font-medium" title={result.id}>
            {result.id}
          </span>
          <span className="text-xs text-muted-foreground">
            {result.channelId} · {result.channelName}
          </span>
        </div>
        <Progress value={result.similarityScore} aria-label={`余弦相似度 ${result.similarityScore.toFixed(1)}%`} />
        <div className="flex gap-2 rounded-md bg-signal/10 p-2.5 text-xs leading-relaxed">
          <Sparkles className="mt-0.5 size-3.5 shrink-0 text-signal" aria-hidden="true" />
          <p>
            <span className="font-medium text-signal">匹配原因：</span>
            {result.matchedText}
          </p>
        </div>
        <Button variant="outline" size="sm" className="mt-auto w-full" onClick={() =>
            onLocate(result.channelId, {
              timestampSec: defaultIncidentSec(
                isChannelId(result.channelId) ? result.channelId : "CAM-01",
                result.matchedText
              ),
              label: result.matchedText,
            })
          }>
          <MapPin data-icon="inline-start" />
          跳转至监控矩阵定位 (Locate in Monitor)
        </Button>
      </div>
    </article>
  )
}

export function VideoRagStudio({ onLocate }: RagStudioProps) {
  const [query, setQuery] = React.useState("")
  const [phase, setPhase] = React.useState<SearchPhase>("idle")
  const [progress, setProgress] = React.useState(0)
  const [results, setResults] = React.useState<RagSearchResult[]>([])
  const [searched, setSearched] = React.useState("")
  const timer = React.useRef<ReturnType<typeof setInterval> | null>(null)

  React.useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current)
    },
    []
  )

  const runSearch = (text: string) => {
    const value = text.trim()
    if (!value || phase === "searching") return
    if (timer.current) clearInterval(timer.current)

    setQuery(value)
    setSearched(value)
    setResults([])
    setProgress(0)
    setPhase("searching")

    let current = 0
    timer.current = setInterval(() => {
      current = Math.min(100, current + 4 + Math.random() * 4)
      setProgress(current)
      if (current >= 100) {
        if (timer.current) clearInterval(timer.current)
        timer.current = null
        setResults(searchCorpus(value))
        setPhase("done")
      }
    }, 70)
  }

  const stage = SEARCH_STAGES.find((s) => progress < s.until) ?? SEARCH_STAGES[SEARCH_STAGES.length - 1]

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="gap-1 border-b px-4 py-3">
        <CardTitle className="text-sm">Video-RAG 语义向量检索 (Video-RAG & Semantic Vector Search)</CardTitle>
        <CardDescription className="text-xs">
          切片经多模态编码后写入向量库，用自然语言即可跨通道、跨时段检索历史视频，无需依赖预设标签。
        </CardDescription>
      </CardHeader>
      <div className="flex flex-col gap-4 p-4">
        <IndexStatus />

        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            runSearch(query)
          }}
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <InputGroup className="h-9">
              <InputGroupAddon>
                <Search aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="用自然语言描述要找的画面，例如：穿黄色反光衣骑叉车的人"
                aria-label="自然语言视频检索"
                disabled={phase === "searching"}
              />
            </InputGroup>
            <Button type="submit" disabled={!query.trim() || phase === "searching"}>
              <Search data-icon="inline-start" />
              语义检索
            </Button>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="预置检索语句">
            {RAG_PRESETS.map((preset) => (
              <Button
                key={preset}
                type="button"
                variant="outline"
                size="sm"
                className="h-auto py-1 text-xs whitespace-normal"
                onClick={() => runSearch(preset)}
                disabled={phase === "searching"}
              >
                {preset}
              </Button>
            ))}
          </div>
        </form>

        {phase === "searching" && (
          <div className="flex flex-col gap-2 rounded-md border border-border bg-background p-3" role="status">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-mono text-signal">{stage.label}</span>
              <span className="font-mono text-muted-foreground tabular-nums">{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} aria-label="向量检索进度" />
          </div>
        )}

        {phase === "done" && results.length > 0 && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">
              针对「{searched}」，在 {RAG_INDEX.clips.toLocaleString("en-US")} 个切片中命中 {results.length} 条，按余弦相似度降序排列。
            </p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-4">
              {results.map((result, index) => (
                <ResultCard key={result.id} result={result} rank={index + 1} onLocate={onLocate} />
              ))}
            </div>
          </div>
        )}

        {phase === "done" && results.length === 0 && (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchX />
              </EmptyMedia>
              <EmptyTitle>未检索到相似片段</EmptyTitle>
              <EmptyDescription>
                没有切片的相似度高于 {RAG_THRESHOLD}% 阈值，请尝试换一种描述，或点击上方的预置语句。
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </Card>
  )
}
