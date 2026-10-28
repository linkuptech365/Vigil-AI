"use client"

import * as React from "react"
import useSWR from "swr"
import { ChevronDown, History, ImageOff, Loader2, Maximize2, Minimize2, ShieldOff, Sparkles, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { errorMessage, getJson, sendJson } from "@/lib/ops/rules-client"
import {
  HIT_GATE_LABEL,
  HIT_HISTORY_ENDPOINTS,
  HIT_STATUS_LABEL,
  hitFrameUrl,
  hitRuleIds,
  hitStatusOf,
  type HitHistoryRecord,
  type HitHistoryResponse,
  type HitHistoryStatus,
} from "@/lib/vigil/hit-history"
import { visionRoleLabel } from "@/lib/vigil/vision"
import { cn } from "@/lib/utils"
import { usePerception } from "./perception-provider"

const PAGE_SIZE = 50

const STATUS_STYLE: Record<HitHistoryStatus, string> = {
  alarm: "border-destructive/40 bg-destructive/10 text-destructive",
  blocked: "border-warning/40 bg-warning/10 text-warning",
  passed: "border-success/40 bg-success/10 text-success",
}

const VERDICT_STYLE = {
  pass: "border-success/40 bg-success/10 text-success",
  block: "border-destructive/40 bg-destructive/10 text-destructive",
  info: "border-border bg-muted text-muted-foreground",
} as const

const VERDICT_LABEL = { pass: "通过", block: "拦截", info: "信息" } as const

type StatusFilter = HitHistoryStatus | "all"

function formatTime(at: string) {
  const date = new Date(at)
  return Number.isNaN(date.getTime()) ? at : date.toLocaleString("zh-CN", { hour12: false })
}

function historyUrl(streamId: string | null, status: StatusFilter, limit: number) {
  const params = new URLSearchParams({ limit: String(limit) })
  if (streamId) params.set("streamId", streamId)
  if (status !== "all") params.set("status", status)
  return `${HIT_HISTORY_ENDPOINTS.history}?${params.toString()}`
}

function FrameWithBoxes({ record }: { record: HitHistoryRecord }) {
  const [failed, setFailed] = React.useState(false)
  if (!record.hasFrame || failed) {
    return (
      <div className="flex aspect-video items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted text-xs text-muted-foreground">
        <ImageOff className="size-4" aria-hidden="true" />
        触发帧截屏不可用（未保存或已被淘汰）
      </div>
    )
  }
  const aspect = record.frameWidth > 0 && record.frameHeight > 0 ? `${record.frameWidth} / ${record.frameHeight}` : "16 / 9"
  return (
    <div className="relative w-full overflow-hidden rounded-md border border-border bg-black" style={{ aspectRatio: aspect }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={hitFrameUrl(record.id)}
        alt={`${record.streamId} 在 ${formatTime(record.at)} 的触发帧`}
        className="absolute inset-0 size-full object-contain"
        loading="lazy"
        onError={() => setFailed(true)}
      />
      {record.rawDetections.map((det, index) => {
        const [x1, y1, x2, y2] = det.box
        return (
          <div
            key={`${det.prompt}-${index}`}
            className={cn("absolute border-2", det.passed ? "border-success" : "border-warning border-dashed")}
            style={{ left: `${x1 / 10}%`, top: `${y1 / 10}%`, width: `${(x2 - x1) / 10}%`, height: `${(y2 - y1) / 10}%` }}
          >
            <span
              className={cn(
                "absolute -top-5 left-0 whitespace-nowrap rounded-sm px-1 font-mono text-[10px] leading-4",
                det.passed ? "bg-success text-success-foreground" : "bg-warning text-warning-foreground",
              )}
            >
              {det.label} {Math.round(det.confidence * 100)}%
            </span>
          </div>
        )
      })}
    </div>
  )
}

interface ManualAnalysis {
  verdict: "alert" | "safe"
  confidence: number
  summary: string
  reasoning: string
  action: string | null
  ruleName: string | null
  model: string
  frameCount: number
}

/** 收起抽屉卡片会卸载详情，模块级缓存让「已标记」与研判结果在重新展开后仍可见。 */
const markedDetections = new Set<string>()
const manualAnalyses = new Map<string, ManualAnalysis>()

const detectionKey = (recordId: string, index: number) => `${recordId}:${index}`

async function postJson<T>(url: string, body: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  } catch {
    throw new Error("无法连接到服务端，请检查网络后重试")
  }
  const payload = (await response.json().catch(() => null)) as (T & { message?: string }) | null
  if (!response.ok || !payload) throw new Error(payload?.message ?? `请求失败 (HTTP ${response.status})`)
  return payload
}

/** 0-1000 的 [x1, y1, x2, y2] 转为锚点要求的 0-1 归一化 [ymin, xmin, ymax, xmax]。 */
function toAnchorBbox(box: [number, number, number, number]): [number, number, number, number] | null {
  const clamp = (value: number) => Math.min(1, Math.max(0, value / 1000))
  const [x1, y1, x2, y2] = box
  const bbox: [number, number, number, number] = [clamp(y1), clamp(x1), clamp(y2), clamp(x2)]
  return bbox[2] > bbox[0] && bbox[3] > bbox[1] ? bbox : null
}

function regionLabel(box: [number, number, number, number]) {
  const [x1, y1, x2, y2] = box
  const cx = (x1 + x2) / 2
  const cy = (y1 + y2) / 2
  const horizontal = cx < 333 ? "左侧" : cx > 666 ? "右侧" : "中间"
  const vertical = cy < 333 ? "上方" : cy > 666 ? "下方" : "中部"
  return `${horizontal}${vertical}区域`
}

function NegativeAnchorPicker({ record }: { record: HitHistoryRecord }) {
  const detections = record.rawDetections
  const [marked, setMarked] = React.useState<ReadonlySet<number>>(
    () => new Set(detections.map((_, index) => index).filter((index) => markedDetections.has(detectionKey(record.id, index)))),
  )
  const [picking, setPicking] = React.useState(false)
  const [selected, setSelected] = React.useState<number | null>(null)
  const [label, setLabel] = React.useState("")
  const [wildcard, setWildcard] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)

  const markable = detections.map((_, index) => index).filter((index) => !marked.has(index))

  function choose(index: number) {
    setSelected(index)
    setLabel(detections[index]?.prompt ?? "")
  }

  function open() {
    if (picking) {
      setPicking(false)
      return
    }
    setPicking(true)
    const first = selected !== null && markable.includes(selected) ? selected : markable[0]
    if (first !== undefined) choose(first)
  }

  async function submit() {
    if (selected === null) return
    const det = detections[selected]
    const bbox = det ? toAnchorBbox(det.box) : null
    if (!det || !bbox) {
      toast.error("该检测框坐标无效，无法加入负样本")
      return
    }
    const finalLabel = wildcard ? "*" : label.trim()
    if (!finalLabel) {
      toast.error("请填写类别名称，或勾选通配所有类别")
      return
    }
    setSubmitting(true)
    try {
      await postJson(`/api/v1/channels/${encodeURIComponent(record.streamId)}/negative-anchors`, { label: finalLabel, bbox })
      markedDetections.add(detectionKey(record.id, selected))
      setMarked((current) => new Set(current).add(selected))
      setPicking(false)
      toast.success("已加入负样本抑制库，后续同位置静态伪影将��静默过滤")
    } catch (error) {
      toast.error(`加入负样本失败：${errorMessage(error)}`)
    } finally {
      setSubmitting(false)
    }
  }

  const disabled = detections.length === 0 || markable.length === 0

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 gap-1.5 px-2 text-xs"
        disabled={disabled}
        aria-expanded={picking}
        onClick={open}
        title={detections.length === 0 ? "该帧没有原始检测框" : undefined}
      >
        <ShieldOff className="size-3.5" aria-hidden="true" />
        {detections.length > 0 && markable.length === 0 ? "检测框均已加入负样本" : "标为固定误判"}
      </Button>
      {picking ? (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-3">
          <p className="text-xs font-medium">{detections.length > 1 ? "选择要抑制的检测框" : "将抑制该检测框所在位置"}</p>
          <RadioGroup value={selected === null ? "" : String(selected)} onValueChange={(value) => choose(Number(value))} className="gap-1.5">
            {detections.map((det, index) => {
              const isMarked = marked.has(index)
              const id = `neg-${record.id}-${index}`
              return (
                <div key={id} className="flex items-center gap-2">
                  <RadioGroupItem value={String(index)} id={id} disabled={isMarked || submitting} />
                  <Label htmlFor={id} className={cn("flex flex-1 flex-wrap items-center gap-1.5 text-xs font-normal", isMarked && "text-muted-foreground")}>
                    <span>
                      {det.prompt} ({(det.confidence * 100).toFixed(1)}%) - {regionLabel(det.box)}
                    </span>
                    {isMarked ? (
                      <Badge variant="outline" className={cn("text-[10px]", VERDICT_STYLE.pass)}>
                        已添加负样本
                      </Badge>
                    ) : null}
                  </Label>
                </div>
              )
            })}
          </RadioGroup>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <Label htmlFor={`neg-label-${record.id}`} className="text-xs font-normal">
                类别
              </Label>
              <Input
                id={`neg-label-${record.id}`}
                value={wildcard ? "*" : label}
                onChange={(event) => setLabel(event.target.value)}
                disabled={wildcard || submitting}
                maxLength={60}
                className="h-7 w-44 font-mono text-xs"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <Checkbox id={`neg-wild-${record.id}`} checked={wildcard} onCheckedChange={(next) => setWildcard(next === true)} disabled={submitting} />
              <Label htmlFor={`neg-wild-${record.id}`} className="text-xs font-normal">
                通配所有类别 *
              </Label>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" className="h-7 px-2 text-xs" onClick={submit} disabled={submitting || selected === null}>
              {submitting ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
              {submitting ? "提交中..." : "确认加入负样本库"}
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setPicking(false)} disabled={submitting}>
              取消
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ManualReviewPanel({ record }: { record: HitHistoryRecord }) {
  const [loading, setLoading] = React.useState(false)
  const [analysis, setAnalysis] = React.useState<ManualAnalysis | null>(() => manualAnalyses.get(record.id) ?? null)

  async function review() {
    if (!record.hasFrame) {
      toast.error("该记录的触发帧截屏不可用（未保存或已被淘汰），无法送审")
      return
    }
    setLoading(true)
    try {
      const data = await postJson<Partial<ManualAnalysis>>(`/api/v1/streams/${encodeURIComponent(record.streamId)}/analyze`, {
        trigger: "manual",
        evidenceFrames: [hitFrameUrl(record.id)],
        ruleIds: hitRuleIds(record),
      })
      const next: ManualAnalysis = {
        verdict: data.verdict === "alert" ? "alert" : "safe",
        confidence: typeof data.confidence === "number" ? data.confidence : 0,
        summary: data.summary ?? "",
        reasoning: data.reasoning ?? "",
        action: data.action ?? null,
        ruleName: data.ruleName ?? null,
        model: data.model ?? "",
        frameCount: data.frameCount ?? 1,
      }
      manualAnalyses.set(record.id, next)
      setAnalysis(next)
    } catch (error) {
      toast.error(`手动送审失败：${errorMessage(error)}`)
    } finally {
      setLoading(false)
    }
  }

  const behavior = analysis ? [analysis.ruleName, analysis.action].filter(Boolean).join(" · ") || "未识别到规则行为" : ""
  const percent = analysis ? Math.round((analysis.confidence <= 1 ? analysis.confidence * 100 : analysis.confidence) * 10) / 10 : 0

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" size="sm" variant="outline" className="h-7 gap-1.5 px-2 text-xs" onClick={review} disabled={loading}>
        {loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="size-3.5" aria-hidden="true" />}
        {loading ? "VLM 研判中..." : "手动送审二级 VLM"}
      </Button>
      {analysis ? (
        <section className="flex flex-col gap-2 rounded-md border border-border bg-card p-3" aria-label="手动研判结果">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={cn("text-[10px]", analysis.verdict === "alert" ? "border-destructive/40 bg-destructive/10 text-destructive" : VERDICT_STYLE.pass)}
            >
              {analysis.verdict === "alert" ? "违规告警" : "合规忽略"}
            </Badge>
            <span className="text-xs">
              置信度 <span className="font-mono">{percent}%</span>
            </span>
            <span className="text-xs text-muted-foreground">行为类型：{behavior}</span>
            {analysis.model ? <span className="ml-auto font-mono text-[10px] text-muted-foreground">{analysis.model}</span> : null}
          </div>
          {analysis.summary ? <p className="text-xs leading-relaxed">{analysis.summary}</p> : null}
          <div className="flex flex-col gap-1">
            <h5 className="text-[11px] font-medium text-muted-foreground">推理因果链</h5>
            <p className="whitespace-pre-wrap text-xs leading-relaxed">{analysis.reasoning || "模型未返回推理文本。"}</p>
          </div>
        </section>
      ) : null}
    </div>
  )
}

function RecordActions({ record }: { record: HitHistoryRecord }) {
  return (
    <section className="flex flex-col gap-2 border-t border-border pt-3" aria-label="记录操作">
      <div className="flex flex-wrap items-start gap-2">
        <NegativeAnchorPicker record={record} />
        <ManualReviewPanel record={record} />
      </div>
    </section>
  )
}

function RecordDetail({ record, fullscreen }: { record: HitHistoryRecord; fullscreen: boolean }) {
  const detectionsSection = (
    <section className="flex flex-col gap-1.5">
      <h4 className="text-xs font-medium">原始检测框（{record.rawDetections.length}）</h4>
      {record.rawDetections.length === 0 ? (
        <p className="text-xs text-muted-foreground">该帧没有保留原始检测框。</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {record.rawDetections.map((det, index) => (
            <li key={`${det.prompt}-${index}`} className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="outline" className={cn("text-[10px]", det.passed ? VERDICT_STYLE.pass : VERDICT_STYLE.info)}>
                {det.passed ? "达标" : "低于门槛"}
              </Badge>
              <span>{det.label}</span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {det.prompt} · {visionRoleLabel(det.role)} · {(det.confidence * 100).toFixed(1)}%
                {det.trackId !== null ? ` · 轨迹 #${det.trackId}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )

  const gatesSection = (
    <section className="flex flex-col gap-1.5">
      <h4 className="text-xs font-medium">逐级门禁结果</h4>
      {record.decisions.length === 0 ? (
        <p className="text-xs text-muted-foreground">没有规则参与该帧的门禁判定。</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {record.decisions.map((decision) => (
            <li key={decision.ruleId} className="rounded-md border border-border bg-card p-2">
              <p className="mb-1 text-xs font-medium">{decision.ruleName}</p>
              <ul className="flex flex-col gap-1">
                {decision.gates.map((step, index) => (
                  <li key={`${step.gate}-${index}`} className="flex items-start gap-2 text-xs">
                    <Badge variant="outline" className={cn("shrink-0 text-[10px]", VERDICT_STYLE[step.verdict])}>
                      {VERDICT_LABEL[step.verdict]}
                    </Badge>
                    <span className="shrink-0 font-medium">{step.gate}</span>
                    <span className="text-muted-foreground">{step.detail}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  )

  if (fullscreen) {
    return (
      <div className="grid grid-cols-1 gap-6 border-t border-border bg-muted/30 px-4 py-4 lg:grid-cols-12">
        <div className="flex flex-col gap-3 lg:col-span-7">
          <FrameWithBoxes record={record} />
        </div>
        <div className="flex flex-col gap-4 lg:col-span-5">
          {detectionsSection}
          {gatesSection}
          <RecordActions record={record} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 border-t border-border bg-muted/30 px-4 py-3">
      <FrameWithBoxes record={record} />
      {detectionsSection}
      {gatesSection}
      <RecordActions record={record} />
    </div>
  )
}

function RecordRow({
  record,
  open,
  onToggle,
  fullscreen,
}: {
  record: HitHistoryRecord
  open: boolean
  onToggle: () => void
  fullscreen: boolean
}) {
  const status = hitStatusOf(record)
  const top = record.tags.reduce<{ label: string; confidence: number } | null>(
    (best, tag) => (!best || tag.confidence > best.confidence ? tag : best),
    null,
  )
  const gateSteps = record.decisions.flatMap((decision) => decision.gates)
  const blocked = gateSteps.find((step) => step.verdict === "block")
  const blockReason = blocked ? `${blocked.gate}：${blocked.detail}` : record.reasons.join("；")
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full flex-col gap-1.5 px-4 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] text-muted-foreground">{formatTime(record.at)}</span>
          <Badge variant="outline" className="text-[10px]">
            {record.streamId}
          </Badge>
          <Badge variant="outline" className={cn("text-[10px]", STATUS_STYLE[status])}>
            {HIT_STATUS_LABEL[status]}
          </Badge>
          <span className="text-[11px] text-muted-foreground">{HIT_GATE_LABEL[record.gate]}</span>
          {record.repeat > 1 ? <span className="font-mono text-[10px] text-muted-foreground">×{record.repeat}</span> : null}
          <ChevronDown className={cn("ml-auto size-4 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden="true" />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {top ? (
            <span className="text-xs">
              最高置信 <span className="font-medium">{top.label}</span>{" "}
              <span className="font-mono text-[10px] text-muted-foreground">{Math.round(top.confidence * 100)}%</span>
            </span>
          ) : null}
          {record.tags.length > 1 ? <span className="text-[10px] text-muted-foreground">共 {record.tags.length} 个主体</span> : null}
          {gateSteps.length > 0 ? (
            <span className="flex flex-wrap items-center gap-1">
              {gateSteps.map((step, index) => (
                <span
                  key={`${step.gate}-${index}`}
                  title={step.detail}
                  className={cn("rounded border px-1 text-[10px] leading-4", VERDICT_STYLE[step.verdict])}
                >
                  {step.gate.split(/[·\s]/)[0]} {VERDICT_LABEL[step.verdict]}
                </span>
              ))}
            </span>
          ) : null}
        </div>
        {blockReason ? <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{blockReason}</p> : null}
      </button>
      {open ? <RecordDetail record={record} fullscreen={fullscreen} /> : null}
    </li>
  )
}

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "alarm", label: "已报警" },
  { value: "blocked", label: "被拦截" },
  { value: "passed", label: "放行归档" },
]

export function HitHistorySheet() {
  const { cameraId } = usePerception()
  const [open, setOpen] = React.useState(false)
  const [onlyCurrent, setOnlyCurrent] = React.useState(true)
  const [status, setStatus] = React.useState<StatusFilter>("all")
  const [limit, setLimit] = React.useState(PAGE_SIZE)
  const [expanded, setExpanded] = React.useState<string | null>(null)
  const [confirming, setConfirming] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = React.useState(false)

  const summary = useSWR<HitHistoryResponse>(historyUrl(null, "all", 1), getJson, { refreshInterval: 5000, keepPreviousData: true })
  const list = useSWR<HitHistoryResponse>(
    open ? historyUrl(onlyCurrent ? cameraId : null, status, limit) : null,
    getJson,
    { refreshInterval: 4000, keepPreviousData: true },
  )

  const retention = list.data?.retention ?? summary.data?.retention ?? 500
  const total = summary.data?.total ?? 0

  async function clearAll() {
    if (!confirming) {
      setConfirming(true)
      return
    }
    setConfirming(false)
    try {
      await sendJson(HIT_HISTORY_ENDPOINTS.history, "DELETE")
      setExpanded(null)
      setMessage("已清空全部历史命中记录")
      await Promise.all([summary.mutate(), list.mutate()])
    } catch (error) {
      setMessage(errorMessage(error))
    }
  }

  const records = list.data?.records ?? []
  const counts = list.data?.counts

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setConfirming(false)
          setMessage(null)
          setIsFullscreen(false)
        }
      }}
    >
      <SheetTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-xs">
          <History className="size-3.5" aria-hidden="true" />
          历史命中明细（共 {total}/{retention} 条）
        </Button>
      </SheetTrigger>
      <SheetContent
        className={cn(
          "flex flex-col gap-0 p-0 transition-all duration-300",
          isFullscreen
            ? "data-[side=right]:w-screen data-[side=right]:max-w-none data-[side=right]:sm:max-w-none"
            : "data-[side=right]:w-full data-[side=right]:sm:max-w-2xl",
        )}
        onEscapeKeyDown={(event) => {
          if (isFullscreen) {
            event.preventDefault()
            setIsFullscreen(false)
          }
        }}
      >
        <SheetHeader className="gap-1 border-b px-4 py-3 pr-14">
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-col gap-1">
              <SheetTitle className="text-sm">历史命中明细</SheetTitle>
              <SheetDescription className="text-xs leading-relaxed">
                当前保留最近 {total} 条（上限绑定自审计设置：{retention} 条，超出后按先进先出自动淘汰最旧记录及其截屏）。不论是否报警、被哪一级门禁拦截，只要产生初筛命中均会留存。
              </SheetDescription>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="shrink-0"
              onClick={() => setIsFullscreen((current) => !current)}
              title={isFullscreen ? "退出全屏" : "全屏显示"}
            >
              {isFullscreen ? <Minimize2 className="size-4" aria-hidden="true" /> : <Maximize2 className="size-4" aria-hidden="true" />}
              <span className="sr-only">{isFullscreen ? "退出全屏" : "全屏显示"}</span>
            </Button>
          </div>
        </SheetHeader>
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
          <div className="flex items-center gap-1" role="group" aria-label="命中状态筛选">
            {FILTERS.map((item) => (
              <Button
                key={item.value}
                type="button"
                size="sm"
                variant={status === item.value ? "default" : "outline"}
                className="h-7 px-2 text-xs"
                onClick={() => {
                  setStatus(item.value)
                  setLimit(PAGE_SIZE)
                }}
              >
                {item.label}
                {counts ? ` ${item.value === "all" ? counts.alarm + counts.blocked + counts.passed : counts[item.value]}` : ""}
              </Button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Switch
                id="hit-history-current"
                size="sm"
                checked={onlyCurrent}
                onCheckedChange={(next) => {
                  setOnlyCurrent(next)
                  setLimit(PAGE_SIZE)
                }}
              />
              <Label htmlFor="hit-history-current" className="text-xs font-normal">
                仅当前通道
              </Label>
            </div>
            <Button
              type="button"
              size="sm"
              variant={confirming ? "destructive" : "ghost"}
              className="h-7 gap-1 px-2 text-xs"
              onClick={clearAll}
              onBlur={() => setConfirming(false)}
              disabled={total === 0}
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
              {confirming ? "确认清空" : "清空"}
            </Button>
          </div>
        </div>
        {message ? <p className="border-b px-4 py-1.5 text-xs text-muted-foreground">{message}</p> : null}
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto" aria-live="polite">
          {list.error ? (
            <p className="px-4 py-8 text-center text-xs text-destructive">历史命中加载失败</p>
          ) : !list.data ? (
            <p className="px-4 py-8 text-center text-xs text-muted-foreground">加载中…</p>
          ) : records.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs text-muted-foreground">没有符合条件的命中记录。</p>
          ) : (
            <ul className="divide-y divide-border">
              {records.map((record) => (
                <RecordRow
                  key={record.id}
                  record={record}
                  open={expanded === record.id}
                  onToggle={() => setExpanded((current) => (current === record.id ? null : record.id))}
                  fullscreen={isFullscreen}
                />
              ))}
            </ul>
          )}
          {list.data && list.data.matched > records.length ? (
            <div className="flex justify-center border-t border-border p-3">
              <Button type="button" variant="outline" size="sm" className="text-xs" onClick={() => setLimit((current) => current + PAGE_SIZE)}>
                加载更多（已显示 {records.length}/{list.data.matched}）
              </Button>
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}
