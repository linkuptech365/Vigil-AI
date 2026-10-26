"use client"

import * as React from "react"
import useSWR from "swr"
import { Download, Megaphone, ShieldAlert, ShieldCheck, Siren } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { getJson } from "@/lib/ops/rules-client"
import { cn } from "@/lib/utils"
import {
  CASE_STATUS_LABEL,
  ALERT_SOURCE_LABEL,
  type EvidenceIntegrity,
  type FalsePositiveReasonCode,
  type LinkageResult,
  type StreamAlert,
} from "@/lib/vigil/streams"
import { alertFrameUrl, STREAM_ALERTS_ENDPOINT, useStreams } from "@/components/vigil/streams/use-streams"

const LINKAGE_STATUS: Record<LinkageResult["status"], { label: string; className: string }> = {
  SUCCESS: { label: "已送达", className: "bg-success/15 text-success" },
  FAILED: { label: "失败", className: "bg-destructive/15 text-destructive" },
  NOT_CONFIGURED: { label: "未配置", className: "bg-muted text-muted-foreground" },
  SKIPPED: { label: "未触发", className: "bg-muted text-muted-foreground" },
}

const FALSE_POSITIVE_OPTIONS: { value: FalsePositiveReasonCode; label: string }[] = [
  { value: "LIGHT_CHANGE", label: "光线 / 反光变化" },
  { value: "OCCLUSION", label: "遮挡导致误判" },
  { value: "OBJECT_MISJUDGED", label: "物体 / 动作误识别" },
  { value: "OTHER", label: "其他" },
]

function formatTime(iso?: string) {
  if (!iso) return "—"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "—"
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date)
}

function CaseList({
  alerts,
  selectedId,
  onSelect,
}: {
  alerts: StreamAlert[]
  selectedId: string
  onSelect: (id: string) => void
}) {
  return (
    <ul className="flex flex-col gap-2" aria-label="处置案卷列表">
      {alerts.map((alert) => {
        const status = alert.case?.status ?? "PENDING"
        const active = alert.id === selectedId
        return (
          <li key={alert.id}>
            <button
              type="button"
              onClick={() => onSelect(alert.id)}
              aria-pressed={active}
              className={cn(
                "flex w-full flex-col gap-1 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-secondary/60",
                active ? "border-signal" : "border-border"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] text-muted-foreground">{alert.case?.caseId ?? alert.id}</span>
                <Badge variant="outline" className="text-[10px]">
                  {CASE_STATUS_LABEL[status]}
                </Badge>
              </div>
              <span className="text-sm font-semibold">{alert.ruleName}</span>
              <span className="line-clamp-2 text-xs text-muted-foreground">{alert.summary}</span>
              <span className="font-mono text-[11px] text-muted-foreground">
                {alert.streamName} · {formatTime(alert.triggeredAt)}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function CaseDetail({ alert, onLocate }: { alert: StreamAlert; onLocate: (channelId: string) => void }) {
  const { alertAction } = useStreams()
  const [responder, setResponder] = React.useState("")
  const [reason, setReason] = React.useState<FalsePositiveReasonCode>("LIGHT_CHANGE")
  const [explanation, setExplanation] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const { data: detail } = useSWR<{ integrity: EvidenceIntegrity }>(
    `${STREAM_ALERTS_ENDPOINT}/${encodeURIComponent(alert.id)}`,
    getJson,
    { refreshInterval: 15_000 }
  )

  const caseInfo = alert.case
  const status = caseInfo?.status ?? "PENDING"
  const closed = status === "RESOLVED" || status === "FALSE_POSITIVE"
  const integrity = detail?.integrity

  const run = async (body: Record<string, unknown>, success: string) => {
    setBusy(true)
    const result = await alertAction(alert.id, body)
    setBusy(false)
    if (result) toast.success(success)
  }

  const copyHash = () => {
    const hash = alert.seal?.recordHash
    if (!hash || !navigator.clipboard?.writeText) return
    navigator.clipboard.writeText(hash).then(
      () => toast.success("存证校验码已复制"),
      () => toast.error("复制失败，请手动选中复制")
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <section className="flex flex-col gap-3 rounded-xl border border-border bg-card/50 p-4" aria-label="案卷概要">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={cn("font-mono text-[10px]", alert.severity === "CRITICAL" ? "bg-destructive text-destructive-foreground" : "bg-warning text-black")}>
              {alert.severity}
            </Badge>
            <h3 className="text-base font-semibold">{alert.ruleName}</h3>
            <Badge variant="outline">{CASE_STATUS_LABEL[status]}</Badge>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={() => onLocate(alert.streamId)}>
            定位通道画面
          </Button>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">{alert.reasoning || alert.summary}</p>
        {alert.advice && <p className="text-sm leading-relaxed">处置建议：{alert.advice}</p>}
        {alert.fine && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border bg-muted/40 p-2 font-mono text-[11px] text-muted-foreground md:grid-cols-4">
            <div><dt className="inline">动作 </dt><dd className="inline text-foreground">{alert.fine.primary_action || "—"}</dd></div>
            <div>
              <dt className="inline">交互介质 </dt>
              <dd className="inline text-foreground">
                {alert.fine.interaction_target.category || "—"}（{Math.round(alert.fine.interaction_target.confidence * 100)}%）
              </dd>
            </div>
            <div>
              <dt className="inline">排他校验 </dt>
              <dd className="inline text-foreground">{alert.fine.exclusion_matched ? `命中：${alert.fine.exclusion_reason ?? "反例"}` : "未命中反例"}</dd>
            </div>
            <div><dt className="inline">置信度 </dt><dd className="inline text-foreground">{Math.round(alert.fine.confidence * 100)}%</dd></div>
          </dl>
        )}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground md:grid-cols-4">
          <div><dt className="inline">案卷 </dt><dd className="inline text-foreground">{caseInfo?.caseId ?? "—"}</dd></div>
          <div><dt className="inline">通道 </dt><dd className="inline text-foreground">{alert.streamName}</dd></div>
          <div><dt className="inline">时间 </dt><dd className="inline text-foreground">{formatTime(alert.triggeredAt)}</dd></div>
          <div><dt className="inline">置信度 </dt><dd className="inline text-foreground">{alert.confidence}%</dd></div>
          <div><dt className="inline">模型 </dt><dd className="inline text-foreground">{alert.model || "—"}</dd></div>
          <div><dt className="inline">责任人 </dt><dd className="inline text-foreground">{caseInfo?.responder ?? "未派工"}</dd></div>
          <div><dt className="inline">来源 </dt><dd className="inline text-foreground">{ALERT_SOURCE_LABEL[alert.source]}</dd></div>
        </dl>
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-border bg-card/50 p-4" aria-label="证据归档">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            {integrity?.ok === false ? (
              <ShieldAlert className="size-4 text-destructive" aria-hidden="true" />
            ) : (
              <ShieldCheck className="size-4 text-success" aria-hidden="true" />
            )}
            证据归档（SHA-256 封存）
          </h3>
          <Button asChild size="sm" variant="outline">
            <a href={`${STREAM_ALERTS_ENDPOINT}/${encodeURIComponent(alert.id)}/archive`} download>
              <Download data-icon="inline-start" />
              下载存证包
            </a>
          </Button>
        </div>
        {alert.seal ? (
          <>
            <button
              type="button"
              onClick={copyHash}
              className="break-all rounded-md bg-secondary px-3 py-2 text-left font-mono text-[11px] text-muted-foreground hover:text-foreground"
              title="点击复制"
            >
              记录哈希 {alert.seal.recordHash}
            </button>
            <p className="text-xs text-muted-foreground">
              封存于 {formatTime(alert.seal.sealedAt)}，共 {alert.seal.files.length} 个文件。
              {integrity
                ? integrity.ok
                  ? " 完整性校验通过：证据帧与研判记录均未被改动。"
                  : ` 完整性校验失败：缺失 ${integrity.missing.length} 个，被改动 ${integrity.tampered.length} 个${integrity.recordMatches ? "" : "，研判记录不一致"}。`
                : " 正在校验完整性…"}
            </p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">该告警没有封存信息。</p>
        )}
        {alert.frames.length > 0 && (
          <ul className="grid grid-cols-2 gap-2 md:grid-cols-4" aria-label="证据关键帧">
            {alert.frames.map((frame, index) => (
              <li key={frame.timecode + index} className="flex flex-col gap-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={alertFrameUrl(alert.id, index + 1)}
                  alt={`证据帧 ${index + 1}`}
                  className="aspect-video w-full rounded-md bg-black object-cover"
                  loading="lazy"
                />
                <span className="font-mono text-[10px] text-muted-foreground">
                  #{index + 1} · {frame.timecode}
                  {alert.seal?.files[index] ? ` · ${alert.seal.files[index].sha256.slice(0, 10)}…` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-border bg-card/50 p-4" aria-label="处置流程">
        <h3 className="text-sm font-semibold">处置流程</h3>
        {closed ? (
          <p className="text-sm text-muted-foreground">
            案卷已{CASE_STATUS_LABEL[status]}（{formatTime(caseInfo?.closedAt)}），不再接受变更。
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" variant="outline" disabled={busy || status !== "PENDING"} onClick={() => run({ op: "ack" }, "已确认告警")}>
                确认告警
              </Button>
              <Input
                value={responder}
                onChange={(event) => setResponder(event.target.value)}
                placeholder="责任人，例如：张工 (安全员)"
                aria-label="处置责任人"
                className="h-8 w-56"
                disabled={status !== "PENDING" && status !== "ACKED"}
              />
              <Button
                type="button"
                size="sm"
                disabled={busy || !responder.trim() || (status !== "PENDING" && status !== "ACKED")}
                onClick={() => run({ op: "dispatch", responder }, `已派工：${responder}`)}
              >
                派工
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy || (status !== "DISPATCHED" && status !== "IN_PROGRESS")}
                onClick={() => run({ op: "action", actionType: "VOICE_INTERCOM" }, "现场喊话已记录")}
              >
                现场喊话
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy || (status !== "DISPATCHED" && status !== "IN_PROGRESS")}
                onClick={() => run({ op: "action", actionType: "RECTIFICATION_ORDER" }, "整改单已下发")}
              >
                下发整改单
              </Button>
              <Button type="button" size="sm" disabled={busy || status !== "IN_PROGRESS"} onClick={() => run({ op: "sign_off" }, "案卷已结案")}>
                签收结案
              </Button>
            </div>
            <div className="flex flex-col gap-2 border-t border-border pt-3">
              <span className="text-xs text-muted-foreground">标记为误报（样本会回流作为困难样本）</span>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={reason}
                  onChange={(event) => setReason(event.target.value as FalsePositiveReasonCode)}
                  aria-label="误报原因"
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                >
                  {FALSE_POSITIVE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <Textarea
                  value={explanation}
                  onChange={(event) => setExplanation(event.target.value)}
                  placeholder="补充说明（可选）"
                  aria-label="误报说明"
                  className="min-h-8 flex-1"
                  rows={1}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => run({ op: "false_positive", reason, explanation }, "已标记误报")}
                >
                  标记误报
                </Button>
              </div>
            </div>
          </div>
        )}
        {caseInfo && caseInfo.actions.length > 0 && (
          <ol className="flex flex-col gap-2 border-t border-border pt-3" aria-label="处置时间线">
            {caseInfo.actions.map((action) => (
              <li key={action.id} className="flex flex-col gap-0.5 text-xs">
                <span className="font-mono text-[11px] text-muted-foreground">
                  {formatTime(action.at)} · {action.operator} · {action.actionType}
                </span>
                <span className="leading-relaxed">{action.notes}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-border bg-card/50 p-4" aria-label="多渠道联动">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Siren className="size-4 text-signal" aria-hidden="true" />
            多渠道联动
          </h3>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => run({ op: "broadcast" }, "已重新触发全渠道联动")}>
            <Megaphone data-icon="inline-start" />
            重新触发联动
          </Button>
        </div>
        <ul className="grid gap-2 md:grid-cols-2">
          {(caseInfo?.linkage ?? []).map((item) => {
            const meta = LINKAGE_STATUS[item.status]
            return (
              <li key={item.channel} className="flex flex-col gap-1 rounded-md border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{item.name}</span>
                  <Badge className={cn("text-[10px]", meta.className)}>{meta.label}</Badge>
                </div>
                <span className="text-xs text-muted-foreground">
                  {item.detail ?? "—"}
                  {item.firedAt ? ` · ${formatTime(item.firedAt)}` : ""}
                </span>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}

export function RealDispatch({ onLocate }: { onLocate: (channelId: string) => void }) {
  const { alerts } = useStreams()
  const [selectedId, setSelectedId] = React.useState("")
  const selected = alerts.find((alert) => alert.id === selectedId) ?? alerts[0]

  if (alerts.length === 0) {
    return (
      <Empty className="py-16">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ShieldCheck />
          </EmptyMedia>
          <EmptyTitle>暂无处置案卷</EmptyTitle>
          <EmptyDescription>视频流或目录视频研判命中规则后，会自动建案、封存证据并触发联动，案卷将显示在这里。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="grid min-h-0 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <CaseList alerts={alerts} selectedId={selected.id} onSelect={setSelectedId} />
      <CaseDetail key={selected.id} alert={selected} onLocate={onLocate} />
    </div>
  )
}
