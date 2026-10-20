"use client"

import { CircleCheck, ClipboardList, Cpu, Film, ListChecks, TriangleAlert } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { formatDuration, formatSize } from "@/lib/vigil/data"
import { RULES } from "@/lib/vigil/rules"
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
  const rule = video?.status === "alert" && video.ruleId ? RULES[video.ruleId] : null
  const report = video?.vlmReport
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
  const evidencePoints =
    rule && video
      ? reportEvidence.length > 0
        ? reportEvidence
        : rule.evidence.map((ev) => ({ at: ev.at, sec: ev.at * video.durationSec, text: ev.text }))
      : []

  return (
    <Dialog open={open} onOpenChange={(next) => !next && setSelectedId(null)}>
      <DialogContent className="max-h-[88vh] gap-0 p-0 sm:max-w-2xl">
        {video && (
          <>
            <DialogHeader className="gap-2 border-b border-border p-6">
              <div className="flex items-center gap-2">
                {rule ? (
                  <>
                    <TriangleAlert className="size-5 text-destructive" aria-hidden="true" />
                    <SeverityBadge severity={rule.severity} />
                  </>
                ) : (
                  <CircleCheck className="size-5 text-success" aria-hidden="true" />
                )}
                <DialogTitle>{rule ? rule.ruleName : "分析结果：未发现违规行为"}</DialogTitle>
              </div>
              <DialogDescription className="font-mono text-xs break-all">
                {video.name} · {formatDuration(video.durationSec)} · {formatSize(video.sizeMB)} ·
                置信度 {Math.round((video.confidence ?? 0) * 100)}%
              </DialogDescription>
            </DialogHeader>

            <ScrollArea className="max-h-[60vh]">
              <div className="flex flex-col gap-6 p-6">
                {video.keyframes && video.keyframeWindow && (
                  <Section
                    icon={Film}
                    title={`证据关键帧 [${video.keyframeWindow.startSec}s – ${video.keyframeWindow.endSec}s]`}
                  >
                    <KeyframeGrid keyframes={video.keyframes} />
                  </Section>
                )}
                {rule ? (
                  <>
                    <Section icon={ClipboardList} title="事件概述">
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        {report?.result.summary ?? rule.brief}
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
                        {report?.result.intentAnalysis ?? rule.reasoning}
                      </p>
                      {report && report.result.violationClauses.length > 0 && (
                        <p className="text-sm text-muted-foreground">
                          合规扣分项：{report.result.violationClauses.join("；")}
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
                      {report?.result.actionAdvice ? (
                        <p className="text-sm leading-relaxed text-muted-foreground">
                          {report.result.actionAdvice}
                        </p>
                      ) : (
                        <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm leading-relaxed text-muted-foreground marker:text-primary">
                          {rule.actions.map((action) => (
                            <li key={action}>{action}</li>
                          ))}
                        </ol>
                      )}
                    </Section>
                  </>
                ) : (
                  <Section icon={Cpu} title={`模型推理依据 (${reportedModel})`}>
                    <p className="rounded-lg border border-border bg-secondary/50 p-3 text-sm leading-relaxed text-muted-foreground">
                      {video.suppressedReason ??
                        report?.result.intentAnalysis ??
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
