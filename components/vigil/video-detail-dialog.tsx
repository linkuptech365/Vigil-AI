"use client"

import { CircleCheck, ClipboardList, Cpu, ListChecks, TriangleAlert } from "lucide-react"

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
                {rule ? (
                  <>
                    <Section icon={ClipboardList} title="事件概述">
                      <p className="text-sm leading-relaxed text-muted-foreground">{rule.brief}</p>
                      <div className="relative mt-2 h-8 rounded-md bg-secondary" aria-hidden="true">
                        {rule.evidence.map((ev) => (
                          <span
                            key={ev.at}
                            className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-destructive ring-4 ring-destructive/25"
                            style={{ left: `${ev.at * 100}%` }}
                          />
                        ))}
                      </div>
                      <ul className="flex flex-col gap-1.5">
                        {rule.evidence.map((ev) => (
                          <li key={ev.at} className="flex gap-3 text-sm">
                            <span className="shrink-0 font-mono text-destructive">
                              T+{(ev.at * video.durationSec).toFixed(1)}s
                            </span>
                            <span className="text-muted-foreground">{ev.text}</span>
                          </li>
                        ))}
                      </ul>
                    </Section>

                    <Section icon={Cpu} title={`模型推理依据 (${modelName})`}>
                      <p className="rounded-lg border border-border bg-secondary/50 p-3 text-sm leading-relaxed text-muted-foreground">
                        {rule.reasoning}
                      </p>
                      <p className="font-mono text-xs text-muted-foreground">
                        采样 {video.samplingFps} FPS · 共 {video.frames} 帧 · 分析于{" "}
                        {video.analyzedAt}
                      </p>
                    </Section>

                    <Section icon={ListChecks} title="建议处置措施">
                      <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm leading-relaxed text-muted-foreground marker:text-primary">
                        {rule.actions.map((action) => (
                          <li key={action}>{action}</li>
                        ))}
                      </ol>
                    </Section>
                  </>
                ) : (
                  <Section icon={Cpu} title={`模型推理依据 (${modelName})`}>
                    <p className="rounded-lg border border-border bg-secondary/50 p-3 text-sm leading-relaxed text-muted-foreground">
                      {video.suppressedReason ??
                        "模型对全部采样帧完成逐帧推理，未检测到与已启用规则匹配的异常行为，人员活动与环境状态均处于正常范围。"}
                    </p>
                    <p className="font-mono text-xs text-muted-foreground">
                      采样 {video.samplingFps} FPS · 共 {video.frames} 帧 · 分析于{" "}
                      {video.analyzedAt}
                    </p>
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
