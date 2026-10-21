"use client"

import { Camera, CircleCheck, ClipboardList, Cpu, Film, ListChecks, TriangleAlert } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { formatDuration, formatSize } from "@/lib/vigil/data"
import { normalizeSeverity } from "@/lib/vigil/rules"
import { EvidenceFrame, TimestampBadge } from "./evidence-frame"
import { KeyframeGrid } from "./frame-test-dialog"
import { SeverityBadge } from "./status-badges"
import { useVigil } from "./vigil-provider"

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="size-4 text-primary" />
        {title}
      </h3>
      {children}
    </section>
  )
}

export function VideoDetailDialog() {
  const { queue, selectedId, setSelectedId, modelName } = useVigil()
  const video = queue.find((v) => v.id === selectedId)
  const open = Boolean(video && (video.status === "alert" || video.status === "safe"))
  const isAlert = video?.status === "alert" && Boolean(video.ruleId)
  const report = video?.vlmReport
  const ruleName = video?.ruleName ?? video?.ruleId ?? "异常预警"
  const severity = normalizeSeverity(video?.ruleSeverity)
  const reportedModel = report?.metrics.model ?? modelName
  const sourceLabel = report ? (report.metrics.source === "remote" ? "远端模型" : "离线模拟") : null

  const reportEvidence =
    video && report && video.keyframes
      ? report.result.evidenceKeyframes.flatMap((index) => {
          const frame = video.keyframes?.find((k) => k.index === index)
          return frame
            ? [
                {
                  at: video.durationSec > 0 ? frame.timestampSec / video.durationSec : 0,
                  sec: frame.timestampSec,
                  text: `关键帧 #${frame.index}（${frame.timecode}）被模型引用为证据`,
                },
              ]
            : []
        })
      : []
  const evidencePoints = isAlert ? reportEvidence : []
  const evidenceTimestamp = video?.timestamp ?? report?.result.timestampOffset.replace(/\.\d+$/, "")

  return (
    <Dialog open={open} onOpenChange={(next) => !next && setSelectedId(null)}>
      <DialogContent className="max-h-[88vh] gap-0 p-0 sm:max-w-2xl">
        {video && (
          <>
            <DialogHeader className="gap-2 border-b border-border p-6">
              <div className="flex items-center gap-2">
                {isAlert ? (
                  <>
                    <TriangleAlert className="size-5 text-destructive" aria-hidden="true" />
                    <SeverityBadge severity={severity} />
                  </>
                ) : (
                  <CircleCheck className="size-5 text-success" aria-hidden="true" />
                )}
                <DialogTitle>{isAlert ? ruleName : "分析结果：未发现违规行为"}</DialogTitle>
              </div>
              <DialogDescription className="font-mono text-xs break-all">
                {video.name} · {formatDuration(video.durationSec)} · {formatSize(video.sizeMB)} ·
                置信度 {Math.round((video.confidence ?? 0) * 100)}%
              </DialogDescription>
            </DialogHeader>

            <ScrollArea className="max-h-[60vh]">
              <div className="flex flex-col gap-6 p-6">
                {isAlert && (
                  <Section icon={Camera} title="违规抓拍证据">
                    <EvidenceFrame
                      variant="full"
                      src={video.evidenceFrameBase64}
                      alt={`${ruleName}在 ${evidenceTimestamp ?? "未知时间"} 的违规抓拍`}
                    />
                    {evidenceTimestamp ? (
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <TimestampBadge timestamp={evidenceTimestamp} />
                        <span>
                          采样时间点 {evidenceTimestamp}
                          {video.evidenceFrameIndex && video.evidenceFrameTotal
                            ? `（第 ${video.evidenceFrameIndex}/${video.evidenceFrameTotal} 采样帧）`
                            : ""}
                        </span>
                        {video.motionSegment ? <span>· 所属动作区间 {video.motionSegment}</span> : null}
                      </p>
                    ) : null}
                  </Section>
                )}
                {video.keyframes && video.keyframeWindow && (
                  <Section
                    icon={Film}
                    title={`证据关键帧 [${video.keyframeWindow.startSec}s – ${video.keyframeWindow.endSec}s]`}
                  >
                    <KeyframeGrid keyframes={video.keyframes} />
                  </Section>
                )}
                {isAlert ? (
                  <>
                    <Section icon={ClipboardList} title="事件概述">
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        {report?.result.summary ?? "模型判定命中该规则。"}
                      </p>
                      <div className="relative mt-2 h-8 rounded-md bg-secondary" aria-hidden="true">
                        {evidencePoints.map((ev, i) => (
                          <span
                            key={`${ev.sec}-${i}`}
                            className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-destructive ring-4 ring-destructive/25"
                            style={{ left: `${Math.min(1, Math.max(0, ev.at)) * 100}%` }}
                          />
                        ))}
                      </div>
                      <ul className="flex flex-col gap-1.5">
                        {evidencePoints.map((ev, i) => (
                          <li key={`${ev.sec}-${i}`} className="flex gap-3 text-sm">
                            <span className="shrink-0 font-mono text-destructive">
                              T+{ev.sec.toFixed(1)}s
                            </span>
                            <span className="text-muted-foreground">{ev.text}</span>
                          </li>
                        ))}
                      </ul>
                    </Section>

                    <Section icon={Cpu} title={`模型推理依据 (${reportedModel})`}>
                      <p className="rounded-lg border border-border bg-secondary/50 p-3 text-sm leading-relaxed text-muted-foreground">
                        {report?.result.reasoning ?? "暂无模型推理记录。"}
                      </p>
                      {report && report.result.timestampOffset && (
                        <p className="font-mono text-xs text-muted-foreground">
                          违规时间点 {report.result.timestampOffset}
                          {report.result.bbox ? ` · 目标框 [${report.result.bbox.join(", ")}]` : ""}
                        </p>
                      )}
                      {video.triggerCount !== undefined && video.triggerCount > 1 && (
                        <p className="text-xs text-warning" role="status">
                          冷却窗口内累计触发 {video.triggerCount} 次，其中 {video.suppressedCount ?? 0} 次已折叠进同一事件。
                        </p>
                      )}
                      <p className="font-mono text-xs text-muted-foreground">
                        {sourceLabel ? `${sourceLabel} · ` : ""}采样 {video.samplingFps} FPS · 共 {video.frames} 帧 · 分析于{" "}
                        {video.analyzedAt}
                      </p>
                      {report?.metrics.source === "fallback" && (
                        <p className="text-xs text-warning" role="status">
                          未使用远端模型{report.metrics.fallbackReason ? `：${report.metrics.fallbackReason}` : ""}
                          。本结果为离线模拟，不代表真实模型判断。
                        </p>
                      )}
                    </Section>

                    <Section icon={ListChecks} title="建议处置措施">
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        {report?.result.advice || "请由值班人员现场核实并按预案处置。"}
                      </p>
                    </Section>
                  </>
                ) : (
                  <Section icon={Cpu} title={`模型推理依据 (${reportedModel})`}>
                    <p className="rounded-lg border border-border bg-secondary/50 p-3 text-sm leading-relaxed text-muted-foreground">
                      {video.suppressedReason ??
                        report?.result.reasoning ??
                        "模型对全部采样帧完成逐帧推理，未检测到与已启用规则匹配的异常行为，人员活动与环境状态均处于正常范围。"}
                    </p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {sourceLabel ? `${sourceLabel} · ` : ""}采样 {video.samplingFps} FPS · 共 {video.frames} 帧 · 分析于{" "}
                      {video.analyzedAt}
                    </p>
                    {report?.metrics.source === "fallback" && (
                      <p className="text-xs text-warning" role="status">
                        未使用远端模型{report.metrics.fallbackReason ? `：${report.metrics.fallbackReason}` : ""}
                        。本结果为离线模拟，不代表真实模型判断。
                      </p>
                    )}
                  </Section>
                )}
              </div>
            </ScrollArea>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
