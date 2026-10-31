"use client"

import * as React from "react"
import { Clock, PlayCircle, Search, Sparkles, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/spinner"
import { CAMERAS, SEARCH_MOMENTS, SEARCH_PRESETS, SEARCH_PRESET_QUERY } from "@/lib/ops/data"
import { handleImageError, hasMediaSrc, PLACEHOLDER_IMAGE } from "@/lib/ops/media"
import type { SearchMoment } from "@/lib/ops/types"
import { formatSimilarity, parseSearchQuery } from "@/lib/ops/video-search"
import { useDemoMode } from "@/components/vigil/demo-mode-provider"
import { cn } from "@/lib/utils"
import { useOps } from "./ops-provider"
import { OverlayBoxes } from "./overlay-boxes"

interface SearchFilters {
  channelNames: string[]
  channelUnresolved: boolean
  channelPhrases: string[]
  subjects: string[]
}

interface SearchResponse {
  status: "success"
  moments: SearchMoment[]
  filters: SearchFilters
}

async function searchRealAlerts(query: string, signal: AbortSignal): Promise<SearchResponse> {
  const response = await fetch("/api/v1/video-search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    signal,
  })
  if (!response.ok) throw new Error(`检索失败（HTTP ${response.status}）`)
  return (await response.json()) as SearchResponse
}

function matchMoments(query: string): SearchMoment[] {
  const q = query.trim()
  if (!q) return []
  // 演示数据同样遵循通道硬过滤：query 指定了摄像头编号时，只保留该通道的片段
  const cams = parseSearchQuery(
    q,
    CAMERAS.map((camera) => ({ id: camera.id, name: camera.id }))
  ).channel
  return SEARCH_MOMENTS.filter((moment) => !cams.channelIds || cams.channelIds.includes(moment.cameraId))
    .map((moment) => {
    const hits = moment.keywords.filter((k) => q.includes(k)).length
    return { moment, hits }
  })
    .filter((entry) => entry.hits > 0)
    .sort((a, b) => b.hits - a.hits || b.moment.score - a.moment.score)
    .map((entry) => entry.moment)
}

function MatchCard({ moment }: { moment: SearchMoment }) {
  const { startReplay, replay } = useOps()
  const camera = CAMERAS.find((c) => c.id === moment.cameraId)
  const active = replay?.momentId === moment.id

  return (
    <button
      type="button"
      onClick={() => startReplay(moment.id)}
      className={cn(
        "group flex w-72 shrink-0 snap-start flex-col overflow-hidden rounded-lg border bg-card text-left outline-none transition-colors hover:border-signal/70 focus-visible:ring-2 focus-visible:ring-ring",
        active ? "border-signal" : "border-border"
      )}
    >
      <div className="relative aspect-video overflow-hidden bg-black">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={moment.imageUrl ?? (hasMediaSrc(camera?.image) ? camera.image : PLACEHOLDER_IMAGE)}
          alt={`${moment.cameraLabel ?? moment.cameraId} ${moment.title} 匹配画面`}
          className="absolute inset-0 size-full object-cover"
          onError={handleImageError}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/30" />
        {moment.box.w > 0 && <OverlayBoxes boxes={[moment.box]} labelSize="xs" />}
        <Badge className="absolute left-2 top-2 bg-signal font-mono text-black">
          {formatSimilarity(moment.score)}
        </Badge>
        <span className="absolute bottom-2 left-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-white">
          {moment.cameraLabel ?? moment.cameraId}
        </span>
        <span className="absolute right-2 top-2 flex size-8 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <PlayCircle className="size-5" aria-hidden="true" />
        </span>
      </div>
      <div className="flex flex-col gap-1.5 p-3">
        <div className="flex items-center gap-1.5 font-mono text-xs text-signal">
          <Clock className="size-3" aria-hidden="true" />
          {moment.start} - {moment.end}
        </div>
        <p className="text-sm font-medium text-balance">{moment.title}</p>
        <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">
          {moment.rationale}
        </p>
      </div>
    </button>
  )
}

export function VideoSearchBar() {
  const [draft, setDraft] = React.useState("")
  const [searched, setSearched] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [remote, setRemote] = React.useState<SearchResponse | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const timer = React.useRef<number | null>(null)
  const controller = React.useRef<AbortController | null>(null)
  const { enabled: demo } = useDemoMode()

  React.useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current)
      controller.current?.abort()
    },
    []
  )

  const run = (query: string) => {
    if (!query.trim()) return
    setSearched(true)
    setLoading(true)
    setError(null)
    if (timer.current) window.clearTimeout(timer.current)
    controller.current?.abort()
    if (demo) {
      timer.current = window.setTimeout(() => setLoading(false), 650)
      return
    }
    const current = new AbortController()
    controller.current = current
    searchRealAlerts(query, current.signal)
      .then((data) => {
        setRemote(data)
        setLoading(false)
      })
      .catch((cause: unknown) => {
        if (current.signal.aborted) return
        setRemote(null)
        setError(cause instanceof Error ? cause.message : "检索失败")
        setLoading(false)
      })
  }

  const results = React.useMemo(
    () => (searched ? (demo ? matchMoments(draft) : (remote?.moments ?? [])) : []),
    [draft, searched, demo, remote]
  )
  const filters = demo ? null : remote?.filters

  const reset = () => {
    controller.current?.abort()
    setDraft("")
    setSearched(false)
    setLoading(false)
    setRemote(null)
    setError(null)
  }

  return (
    <section aria-labelledby="vqa-title" className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 id="vqa-title" className="text-sm font-semibold">
          自然语言视频检索
        </h2>
        <Badge variant="outline" className="border-signal/40 font-mono text-signal">
          Video VQA
        </Badge>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          run(draft)
        }}
        className="flex flex-col gap-3"
      >
        <InputGroup className="h-12 border-signal/30 bg-card focus-within:border-signal/70">
          <InputGroupAddon>
            <Sparkles className="text-signal" aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) event.stopPropagation()
            }}
            aria-label="自然语言视频检索"
            placeholder="用自然语言搜索视频，例如：'查找上午10点到11点穿红色上衣戴白色安全帽的人' 或 '搜索东门车辆违停事件'..."
            className="text-sm"
          />
          <InputGroupAddon align="inline-end">
            {draft && (
              <InputGroupButton size="icon-xs" aria-label="清除检索" onClick={reset}>
                <X />
              </InputGroupButton>
            )}
            <InputGroupButton
              type="submit"
              variant="default"
              size="sm"
              disabled={!draft.trim()}
              className="bg-signal text-black hover:bg-signal/90"
            >
              <Search data-icon="inline-start" />
              检索
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>

        <div className={cn("flex flex-wrap items-center gap-2", !demo && "hidden")}>
          <span className="text-xs text-muted-foreground">快捷检索：</span>
          {SEARCH_PRESETS.map((preset) => (
            <Button
              key={preset}
              type="button"
              size="xs"
              variant="outline"
              className="rounded-full"
              onClick={() => {
                const query = SEARCH_PRESET_QUERY[preset]
                setDraft(query)
                run(query)
              }}
            >
              {preset}
            </Button>
          ))}
        </div>
      </form>

      {searched && (
        <div
          className="flex flex-col gap-3 rounded-lg border border-border bg-card/60 p-3"
          aria-live="polite"
        >
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            {loading ? (
              <span className="flex items-center gap-2">
                <Spinner />
                多模态模型正在检索视频语义索引...
              </span>
            ) : (
              <span>
                共匹配到 <span className="font-mono font-semibold text-signal">{results.length}</span>{" "}
                个视频片段，点击片段跳转主播放器
              </span>
            )}
            <Button type="button" size="xs" variant="ghost" onClick={reset}>
              收起
            </Button>
          </div>

          {!loading && filters && (filters.channelNames.length > 0 || filters.subjects.length > 0 || filters.channelUnresolved) && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span>已应用硬过滤：</span>
              {filters.channelNames.map((name) => (
                <Badge key={name} variant="outline" className="border-signal/40 text-signal">
                  通道 = {name}
                </Badge>
              ))}
              {filters.channelUnresolved && (
                <Badge variant="outline" className="border-destructive/50 text-destructive">
                  未找到「{filters.channelPhrases.join("、")}」对应的通道
                </Badge>
              )}
              {filters.subjects.map((name) => (
                <Badge key={name} variant="outline">
                  目标 = {name}
                </Badge>
              ))}
            </div>
          )}

          {!loading && error && (
            <p role="alert" className="rounded-md border border-dashed border-destructive/50 py-4 text-center text-sm text-destructive">
              {error}
            </p>
          )}

          {!loading && !error && results.length === 0 && (
            <p className="rounded-md border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
              {demo ? "未找到匹配片段，试试 “打架冲突”、“安全帽” 或 “东门车辆违停”。" : "没有匹配的真实告警记录。检索范围为 AI 已研判并留存的告警事件。"}
            </p>
          )}

          {!loading && results.length > 0 && (
            <ul className="scrollbar-thin -mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
              {results.map((moment) => (
                <li key={moment.id} className="flex">
                  <MatchCard moment={moment} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
