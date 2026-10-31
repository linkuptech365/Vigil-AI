"use client"

import * as React from "react"
import useSWR from "swr"
import { Archive, Database, FolderOpen, MapPin, RotateCcw, Search, SearchX, Sparkles } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Progress } from "@/components/ui/progress"
import { Spinner } from "@/components/ui/spinner"
import { handleImageError, hasMediaSrc, PLACEHOLDER_IMAGE } from "@/lib/ops/media"
import { RagCaseList } from "@/components/ops/vlm/rag-case-list"
import type { RagCaseFilter, RagCasesResponse, RagHit, RagIndexStatus, RagSearchResponse } from "@/lib/ops/rag-types"
import type { LocateOptions } from "@/lib/ops/types"

type LocateHandler = (channelId: string, opts?: LocateOptions) => void

interface RagStudioProps {
  onLocate: LocateHandler
}

const SEVERITY_LABEL: Record<RagHit["severity"], string> = {
  CRITICAL: "严重",
  WARNING: "预警",
  INFO: "提示",
}

const SUGGESTED_QUERIES = ["1楼 吸烟", "未佩戴安全帽的人员", "跌倒 倒地", "夜间 越界闯入"]

async function fetchIndexStatus(url: string): Promise<{ index: RagIndexStatus }> {
  const response = await fetch(url, { cache: "no-store" })
  if (!response.ok) throw new Error(`索引状态获取失败（HTTP ${response.status}）`)
  return (await response.json()) as { index: RagIndexStatus }
}

const CASE_LIMIT = 100

const CASE_FILTER_LABEL: Record<RagCaseFilter, string> = {
  all: "全部",
  vlm: "已研判",
  pending: "未研判",
  archived: "已归档",
}

const CASE_FILTERS = Object.keys(CASE_FILTER_LABEL) as RagCaseFilter[]

async function fetchCases(url: string): Promise<RagCasesResponse> {
  const response = await fetch(url, { cache: "no-store" })
  if (!response.ok) throw new Error(`案卷列表获取失败（HTTP ${response.status}）`)
  return (await response.json()) as RagCasesResponse
}

function IndexStatus({
  status,
  error,
  loading,
  onShowAll,
}: {
  status?: RagIndexStatus
  error?: Error
  loading: boolean
  onShowAll: () => void
}) {
  const stats = status
    ? [
        { label: "已索引案卷", value: `${status.docs.toLocaleString("en-US")} 条（含二级研判 ${status.vlmDocs}，已归档 ${status.archivedDocs}）` },
        { label: "检索引擎", value: status.engine },
        { label: "最近入库", value: status.lastIndexedAt ?? "尚无入库记录" },
      ]
    : [
        { label: "已索引案卷", value: loading ? "加载中…" : (error?.message ?? "--") },
        { label: "检索引擎", value: "--" },
        { label: "最近入库", value: "--" },
      ]

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {stats.map((stat, index) => {
          const content = (
            <>
              <Database className="mt-0.5 size-4 shrink-0 text-signal" aria-hidden="true" />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">
                  {stat.label}
                  {index === 0 && status ? "（点击查看全部）" : ""}
                </span>
                <span className="text-sm font-medium break-words">{stat.value}</span>
              </div>
            </>
          )
          return index === 0 && status ? (
            <button
              key={stat.label}
              type="button"
              onClick={onShowAll}
              className="flex items-start gap-3 rounded-md border border-border bg-background p-3 text-left transition-colors hover:border-signal/60 hover:bg-signal/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {content}
            </button>
          ) : (
            <div key={stat.label} className="flex items-start gap-3 rounded-md border border-border bg-background p-3">
              {content}
            </div>
          )
        })}
      </div>
      {status && (
        <p className="font-mono text-xs text-muted-foreground">索引文件：{status.storagePath}</p>
      )}
    </div>
  )
}

function ResultCard({ hit, rank, onLocate }: { hit: RagHit; rank: number; onLocate: LocateHandler }) {
  return (
    <article className="flex flex-col overflow-hidden rounded-lg border border-border bg-background">
      <div className="relative aspect-video overflow-hidden bg-black">
        <img
          src={hit.thumbnailUrl && hasMediaSrc(hit.thumbnailUrl) ? hit.thumbnailUrl : PLACEHOLDER_IMAGE}
          alt={`${hit.channelName} 检索命中证据帧`}
          className="size-full object-cover"
          onError={handleImageError}
        />
        <span className="absolute top-2 left-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-xs text-white">
          #{rank}
        </span>
        <Badge className="absolute top-2 right-2 bg-signal font-mono text-black hover:bg-signal">
          相关度 {hit.score.toFixed(0)}
        </Badge>
        <span className="absolute right-2 bottom-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[11px] text-white tabular-nums">
          {hit.triggeredAt}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-3">
        <div className="flex flex-col gap-0.5">
          <span className="truncate font-mono text-xs font-medium" title={hit.caseId ?? hit.alertId}>
            {hit.caseId ?? hit.alertId}
          </span>
          <span className="text-xs text-muted-foreground">
            {hit.channelName}
            {hit.zone ? ` · ${hit.zone}` : ""} · {hit.ruleName}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline">{SEVERITY_LABEL[hit.severity]}</Badge>
          {hit.hasVlm && (
            <Badge variant="outline" className="border-signal/50 text-signal">
              已二级研判
            </Badge>
          )}
          {hit.archived && (
            <Badge variant="outline" className="gap-1">
              <Archive className="size-3" aria-hidden="true" />
              已归档
            </Badge>
          )}
        </div>
        <Progress value={hit.score} aria-label={`相关度 ${hit.score.toFixed(0)}`} />
        <div className="flex gap-2 rounded-md bg-signal/10 p-2.5 text-xs leading-relaxed">
          <Sparkles className="mt-0.5 size-3.5 shrink-0 text-signal" aria-hidden="true" />
          <p>
            <span className="font-medium text-signal">匹配内容：</span>
            {hit.matchedText}
            {hit.matchedTerms.length > 0 && (
              <span className="mt-1 block font-mono text-muted-foreground">命中词：{hit.matchedTerms.join("、")}</span>
            )}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="mt-auto w-full"
          onClick={() => onLocate(hit.channelId, { label: hit.matchedText })}
        >
          <MapPin data-icon="inline-start" />
          跳转至监控矩阵定位 (Locate in Monitor)
        </Button>
      </div>
    </article>
  )
}

export function VideoRagStudio({ onLocate }: RagStudioProps) {
  const [query, setQuery] = React.useState("")
  const [searched, setSearched] = React.useState("")
  const [searching, setSearching] = React.useState(false)
  const [response, setResponse] = React.useState<RagSearchResponse | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const abortRef = React.useRef<AbortController | null>(null)

  const [filter, setFilter] = React.useState<RagCaseFilter>("all")
  const listRef = React.useRef<HTMLDivElement | null>(null)

  const { data: statusData, error: statusError, isLoading: statusLoading, mutate: refreshStatus } = useSWR(
    "/api/v1/rag/search",
    fetchIndexStatus,
    { refreshInterval: 30_000 }
  )

  const {
    data: casesData,
    error: casesError,
    isLoading: casesLoading,
    mutate: refreshCases,
  } = useSWR(`/api/v1/rag/cases?filter=${filter}&limit=${CASE_LIMIT}`, fetchCases, {
    refreshInterval: 30_000,
    keepPreviousData: true,
  })

  React.useEffect(() => () => abortRef.current?.abort(), [])

  const browsing = response === null && !searching

  const showAll = (nextFilter: RagCaseFilter = "all") => {
    abortRef.current?.abort()
    setQuery("")
    setSearched("")
    setResponse(null)
    setError(null)
    setSearching(false)
    setFilter(nextFilter)
    void refreshStatus()
    void refreshCases()
    requestAnimationFrame(() => listRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }))
  }

  const runSearch = async (text: string) => {
    const value = text.trim()
    if (!value) {
      showAll(filter)
      return
    }
    if (searching) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setQuery(value)
    setSearched(value)
    setSearching(true)
    setError(null)
    try {
      const res = await fetch("/api/v1/rag/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: value, topK: 12 }),
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(`检索失败（HTTP ${res.status}）`)
      setResponse((await res.json()) as RagSearchResponse)
      void refreshStatus()
    } catch (err) {
      if (controller.signal.aborted) return
      setResponse(null)
      setError(err instanceof Error ? err.message : "检索失败")
    } finally {
      if (!controller.signal.aborted) setSearching(false)
    }
  }

  const hits = response?.hits ?? []
  const indexEmpty = (statusData?.index.docs ?? 0) === 0

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="gap-1 border-b px-4 py-3">
        <CardTitle className="text-sm">Video-RAG 案卷检索 (Video-RAG Case Retrieval)</CardTitle>
        <CardDescription className="text-xs">
          一级初筛命中的告警与二级研判结论会自动合成可检索文本并入库；支持按通道、主体类别和自然语言关键词跨时段检索历史案卷。
        </CardDescription>
      </CardHeader>
      <div className="flex flex-col gap-4 p-4">
        <IndexStatus
          status={statusData?.index}
          error={statusError}
          loading={statusLoading}
          onShowAll={() => showAll("all")}
        />

        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void runSearch(query)
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
                placeholder="描述要找的事件，例如：1楼 吸烟、未戴安全帽、跌倒；留空查看全部案卷"
                aria-label="案卷检索"
                disabled={searching}
              />
            </InputGroup>
            <Button type="submit" disabled={!query.trim() || searching}>
              {searching ? <Spinner data-icon="inline-start" /> : <Search data-icon="inline-start" />}
              检索
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => showAll("all")}
              disabled={!query && !response && filter === "all"}
            >
              <RotateCcw data-icon="inline-start" />
              清空 / 重置
            </Button>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="检索示例">
            <Button
              type="button"
              variant={browsing ? "default" : "outline"}
              size="sm"
              className="h-auto py-1 text-xs"
              aria-pressed={browsing}
              onClick={() => showAll(filter)}
            >
              <FolderOpen data-icon="inline-start" />
              全部案卷（共 {(casesData?.counts.all ?? statusData?.index.docs ?? 0).toLocaleString("en-US")} 条）
            </Button>
            {SUGGESTED_QUERIES.map((preset) => (
              <Button
                key={preset}
                type="button"
                variant="outline"
                size="sm"
                className="h-auto py-1 text-xs whitespace-normal"
                onClick={() => void runSearch(preset)}
                disabled={searching}
              >
                {preset}
              </Button>
            ))}
          </div>
        </form>

        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive" role="alert">
            {error}
          </p>
        )}

        {browsing && !indexEmpty && (
          <div ref={listRef} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-2" role="group" aria-label="案卷状态筛选">
                {CASE_FILTERS.map((key) => (
                  <Button
                    key={key}
                    type="button"
                    size="sm"
                    variant={filter === key ? "default" : "outline"}
                    aria-pressed={filter === key}
                    onClick={() => setFilter(key)}
                  >
                    {CASE_FILTER_LABEL[key]}
                    <span className="font-mono tabular-nums">
                      {casesData ? casesData.counts[key].toLocaleString("en-US") : "-"}
                    </span>
                  </Button>
                ))}
              </div>
              {casesData && (
                <p className="text-xs text-muted-foreground">
                  按入库时间倒序，当前显示 {casesData.cases.length} / {casesData.total} 条
                  {casesData.total > casesData.cases.length ? `（最多展示前 ${casesData.limit} 条）` : ""}
                </p>
              )}
            </div>

            {casesError && !casesData && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive" role="alert">
                {casesError.message}
              </p>
            )}
            {casesLoading && !casesData && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Spinner /> 正在加载案卷列表…
              </p>
            )}
            {casesData && casesData.cases.length > 0 && <RagCaseList key={filter} cases={casesData.cases} onLocate={onLocate} />}
            {casesData && casesData.cases.length === 0 && (
              <Empty className="border border-dashed">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FolderOpen />
                  </EmptyMedia>
                  <EmptyTitle>该状态下暂无案卷</EmptyTitle>
                  <EmptyDescription>当前筛选「{CASE_FILTER_LABEL[filter]}」没有案卷，可切换到「全部」查看库内所有记录。</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </div>
        )}

        {response && hits.length > 0 && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">
              针对「{searched}」，在 {response.index.docs.toLocaleString("en-US")} 条案卷中命中 {response.total} 条，按相关度降序排列
              {response.filters.channelNames.length > 0 ? `，已限定通道：${response.filters.channelNames.join("、")}` : ""}。
            </p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-4">
              {hits.map((hit, index) => (
                <ResultCard key={hit.id} hit={hit} rank={index + 1} onLocate={onLocate} />
              ))}
            </div>
          </div>
        )}

        {response && hits.length === 0 && (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchX />
              </EmptyMedia>
              <EmptyTitle>未检索到相关案卷</EmptyTitle>
              <EmptyDescription>
                {indexEmpty
                  ? "索引中还没有案卷。一级初筛产生命中告警后会自动入库，也可以先在上方对候选告警执行二级研判。"
                  : "没有案卷与该描述相关，请换用规则名称、通道名称或行为关键词重试。"}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}

        {browsing && !error && indexEmpty && !statusLoading && (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Database />
              </EmptyMedia>
              <EmptyTitle>语料库暂无案卷</EmptyTitle>
              <EmptyDescription>
                一级初筛命中并落库的告警会自动写入索引，二级研判完成后会补充研判结论。当前尚无可检索内容。
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </Card>
  )
}
