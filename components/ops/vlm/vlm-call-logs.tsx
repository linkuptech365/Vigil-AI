"use client"

import * as React from "react"
import useSWR from "swr"
import { Activity, ChevronDown, ChevronRight, ImageOff, RefreshCw, Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { errorMessage, getJson, sendJson } from "@/lib/ops/rules-client"
import {
  VLM_CALL_ENDPOINTS,
  VLM_CALL_TRIGGERS,
  VLM_OUTCOME_LABEL,
  VLM_STATUS_LABEL,
  VLM_TRIGGER_LABEL,
  vlmFrameUrl,
  type VlmCallDetail,
  type VlmCallLogsResponse,
  type VlmCallRecord,
  type VlmCallStatus,
  type VlmCallTrigger,
} from "@/lib/vigil/vlm-call-log"
import { cn } from "@/lib/utils"

const PAGE_SIZE = 50
const REFRESH_MS = 4000

const STATUS_STYLE: Record<VlmCallStatus, string> = {
  alarm: "border-destructive/40 bg-destructive/10 text-destructive",
  dismissed: "border-success/40 bg-success/10 text-success",
  failed: "border-border bg-muted text-muted-foreground",
}

type StatusFilter = VlmCallStatus | "all"
type TriggerFilter = VlmCallTrigger | "all"

const STATUS_FILTERS: StatusFilter[] = ["all", "alarm", "dismissed", "failed"]

function startOfToday() {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  return now.toISOString()
}

function formatTime(at: string) {
  const date = new Date(at)
  return Number.isNaN(date.getTime()) ? at : date.toLocaleString("zh-CN", { hour12: false })
}

function formatTokens(value: number) {
  return value >= 10_000 ? `${(value / 1000).toFixed(1)}k` : String(value)
}

function formatCost(usd: number) {
  if (usd <= 0) return "$0"
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-md border border-border bg-muted/30 px-3 py-2">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="font-mono text-base font-semibold tabular-nums">{value}</span>
      {hint ? <span className="truncate font-mono text-[10px] text-muted-foreground">{hint}</span> : null}
    </div>
  )
}

function TextBlock({ title, text }: { title: string; text: string }) {
  return (
    <section className="flex flex-col gap-1">
      <h4 className="text-xs font-medium">{title}</h4>
      <pre className="scrollbar-thin max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background p-2 font-mono text-[11px] leading-relaxed">
        {text || "（空）"}
      </pre>
    </section>
  )
}

function Frame({ id, index }: { id: string; index: number }) {
  const [failed, setFailed] = React.useState(false)
  if (failed) {
    return (
      <div className="flex aspect-video items-center justify-center rounded-md border border-dashed border-border bg-muted text-muted-foreground">
        <ImageOff className="size-4" aria-hidden="true" />
      </div>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={vlmFrameUrl(id, index)}
      alt={`送检帧 ${index + 1}`}
      loading="lazy"
      onError={() => setFailed(true)}
      className="aspect-video w-full rounded-md border border-border bg-black object-contain"
    />
  )
}

function CallDetail({ record }: { record: VlmCallRecord }) {
  const { data, error, isLoading } = useSWR<{ record: VlmCallDetail }>(`${VLM_CALL_ENDPOINTS.logs}/${record.id}`, getJson)
  const detail = data?.record
  return (
    <div className="flex flex-col gap-3 border-t border-border bg-muted/30 px-4 py-3">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground sm:grid-cols-4">
        <div>
          <dt className="inline">案卷：</dt>
          <dd className="inline text-foreground">{record.alertId ?? "未生成告警"}</dd>
        </div>
        <div>
          <dt className="inline">耗时：</dt>
          <dd className="inline text-foreground">{record.rttMs} ms</dd>
        </div>
        <div>
          <dt className="inline">Token：</dt>
          <dd className="inline text-foreground">
            {record.promptTokens} + {record.completionTokens} = {record.totalTokens}
            {record.usageEstimated ? "（估算）" : ""}
          </dd>
        </div>
        <div>
          <dt className="inline">协议：</dt>
          <dd className="inline text-foreground">{record.protocol}</dd>
        </div>
      </dl>
      <p className="text-xs">
        <span className="text-muted-foreground">结论：</span>
        {VLM_OUTCOME_LABEL[record.outcome]}
        {record.ruleName !== "—" ? ` · ${record.ruleName}` : ""}
        {record.confidence !== null ? ` · 置信度 ${Math.round(record.confidence * 100)}%` : ""}
      </p>
      {record.summary ? <p className="text-xs leading-relaxed">{record.summary}</p> : null}
      {record.error ? <p className="text-xs text-destructive">{record.error}</p> : null}

      {record.savedFrames > 0 ? (
        <section className="flex flex-col gap-1">
          <h4 className="text-xs font-medium">
            送检缩略图（共 {record.frameCount} 帧，保留 {record.savedFrames} 张）
          </h4>
          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: record.savedFrames }, (_, index) => (
              <Frame key={index} id={record.id} index={index} />
            ))}
          </div>
        </section>
      ) : (
        <p className="text-xs text-muted-foreground">本次调用共送检 {record.frameCount} 帧，未保存缩略图。</p>
      )}

      {isLoading ? <p className="text-xs text-muted-foreground">正在加载提示词与模型原文…</p> : null}
      {error ? <p className="text-xs text-destructive">{errorMessage(error)}</p> : null}
      {detail ? (
        <>
          {detail.rules.length > 0 ? (
            <section className="flex flex-col gap-1">
              <h4 className="text-xs font-medium">Prompt 规则（{detail.rules.length}）</h4>
              <ul className="flex flex-col gap-1">
                {detail.rules.map((rule) => (
                  <li key={rule.id} className="rounded-md border border-border bg-background p-2 text-xs">
                    <span className="font-medium">{rule.name}</span>
                    <p className="mt-0.5 text-muted-foreground">{rule.description}</p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <TextBlock title="System Prompt" text={detail.systemPrompt} />
          <TextBlock title="User Prompt" text={detail.userPrompt} />
          <TextBlock title="模型完整回复（推理 / JSON）" text={detail.output} />
        </>
      ) : null}
    </div>
  )
}

export function VlmCallLogs() {
  const [open, setOpen] = React.useState(true)
  const [status, setStatus] = React.useState<StatusFilter>("all")
  const [trigger, setTrigger] = React.useState<TriggerFilter>("all")
  const [limit, setLimit] = React.useState(PAGE_SIZE)
  const [expandedId, setExpandedId] = React.useState<string | null>(null)
  const [since] = React.useState(startOfToday)
  const [clearError, setClearError] = React.useState<string | null>(null)

  const url = React.useMemo(() => {
    const params = new URLSearchParams({ limit: String(limit), since })
    if (status !== "all") params.set("status", status)
    if (trigger !== "all") params.set("trigger", trigger)
    return `${VLM_CALL_ENDPOINTS.logs}?${params.toString()}`
  }, [limit, since, status, trigger])

  const { data, error, isValidating, mutate } = useSWR<VlmCallLogsResponse>(url, getJson, {
    refreshInterval: REFRESH_MS,
    keepPreviousData: true,
  })

  const stats = data?.stats
  const records = data?.records ?? []

  const clearAll = async () => {
    if (!window.confirm("清空全部 VLM 调用流水？此操作不可恢复，且不影响 Token 的实际扣费。")) return
    try {
      await sendJson(VLM_CALL_ENDPOINTS.logs, "DELETE")
      setClearError(null)
      setExpandedId(null)
      await mutate()
    } catch (e) {
      setClearError(errorMessage(e))
    }
  }

  return (
    <section className="flex flex-col rounded-lg border border-border bg-card" aria-label="VLM 调用实时流水">
      <header className="flex flex-wrap items-center gap-2 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {open ? <ChevronDown className="size-4 shrink-0" aria-hidden="true" /> : <ChevronRight className="size-4 shrink-0" aria-hidden="true" />}
          <Activity className="size-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="text-sm font-semibold">VLM 调用实时流水 (VLM Invocation Logs)</span>
          <Badge variant="outline" className="font-mono text-[10px]">
            今日 {stats?.calls ?? 0} 次 · {formatTokens(stats?.totalTokens ?? 0)} Tokens
          </Badge>
        </button>
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <RefreshCw className={cn("size-3", isValidating && "animate-spin")} aria-hidden="true" />每 {REFRESH_MS / 1000} 秒自动刷新
        </span>
      </header>

      {open ? (
        <div className="flex flex-col gap-3 border-t border-border px-4 py-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            记录所有发往二级模型网关的真实请求，包括一级告警上报、定时巡检漏斗与人工研判；无论最终判定为违规告警还是合规忽略，只要产生 Token 消耗就会出现在这里。
          </p>

          <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
            <Stat label="今日调用次数" value={String(stats?.calls ?? 0)} hint={`告警 ${stats?.alarms ?? 0} · 忽略 ${stats?.dismissed ?? 0} · 失败 ${stats?.failed ?? 0}`} />
            <Stat label="累计 Tokens" value={formatTokens(stats?.totalTokens ?? 0)} />
            <Stat label="Prompt / Completion" value={`${formatTokens(stats?.promptTokens ?? 0)} / ${formatTokens(stats?.completionTokens ?? 0)}`} />
            <Stat label="预估花费" value={formatCost(stats?.costUsd ?? 0)} hint="按模型档案单价估算" />
            <Stat label="成功率" value={stats?.successRate == null ? "—" : `${(stats.successRate * 100).toFixed(1)}%`} />
          </div>

          {stats ? (
            <p className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground">
              {VLM_CALL_TRIGGERS.map((key) => (
                <span key={key}>
                  {VLM_TRIGGER_LABEL[key]} {stats.byTrigger[key]}
                </span>
              ))}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1" role="group" aria-label="按判定状态筛选">
              {STATUS_FILTERS.map((key) => (
                <Button
                  key={key}
                  type="button"
                  size="sm"
                  variant={status === key ? "default" : "outline"}
                  className="h-7 px-2 text-xs"
                  onClick={() => setStatus(key)}
                >
                  {key === "all" ? "全部" : VLM_STATUS_LABEL[key]}
                </Button>
              ))}
            </div>
            <select
              value={trigger}
              onChange={(event) => setTrigger(event.target.value as TriggerFilter)}
              aria-label="按触发源筛选"
              className="h-7 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="all">全部触发源</option>
              {VLM_CALL_TRIGGERS.map((key) => (
                <option key={key} value={key}>
                  {VLM_TRIGGER_LABEL[key]}
                </option>
              ))}
            </select>
            <span className="ml-auto font-mono text-[11px] text-muted-foreground">
              匹配 {data?.matched ?? 0} 条 · 保留 {data?.retained ?? 0}/{data?.capacity ?? 500}
            </span>
            <Button type="button" size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs text-destructive" onClick={clearAll}>
              <Trash2 className="size-3" aria-hidden="true" />
              清空
            </Button>
          </div>

          {error ? <p className="text-xs text-destructive">加载调用流水失败：{errorMessage(error)}</p> : null}
          {clearError ? <p className="text-xs text-destructive">清空失败：{clearError}</p> : null}

          {records.length === 0 ? (
            <p className="rounded-md border border-dashed border-border py-8 text-center text-xs text-muted-foreground">
              暂无调用记录。任何发往二级模型的请求都会在 {REFRESH_MS / 1000} 秒内出现在这里。
            </p>
          ) : (
            <ul className="flex flex-col overflow-hidden rounded-md border border-border">
              {records.map((record) => {
                const expanded = expandedId === record.id
                return (
                  <li key={record.id} className="border-b border-border last:border-b-0">
                    <button
                      type="button"
                      onClick={() => setExpandedId(expanded ? null : record.id)}
                      aria-expanded={expanded}
                      className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left text-xs hover:bg-muted/50"
                    >
                      {expanded ? <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" /> : <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />}
                      <span className="w-36 shrink-0 font-mono text-[11px] text-muted-foreground">{formatTime(record.at)}</span>
                      <span className="min-w-16 font-medium">{record.streamName}</span>
                      <span className="text-muted-foreground">{VLM_TRIGGER_LABEL[record.trigger]}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">{record.model}</span>
                      <span className="ml-auto flex items-center gap-2">
                        <span className="font-mono text-[11px] tabular-nums">
                          {record.totalTokens} tok{record.usageEstimated ? "*" : ""}
                        </span>
                        <Badge variant="outline" className={cn("text-[10px]", STATUS_STYLE[record.status])}>
                          {VLM_STATUS_LABEL[record.status]}
                        </Badge>
                      </span>
                    </button>
                    {expanded ? <CallDetail record={record} /> : null}
                  </li>
                )
              })}
            </ul>
          )}

          {(data?.matched ?? 0) > records.length ? (
            <Button type="button" variant="outline" size="sm" className="self-center" onClick={() => setLimit((v) => v + PAGE_SIZE)}>
              加载更多（已显示 {records.length} / {data?.matched}）
            </Button>
          ) : null}
          <p className="text-[11px] text-muted-foreground">带 * 的 Token 为本地估算值（网关未回传 usage）。</p>
        </div>
      ) : null}
    </section>
  )
}
