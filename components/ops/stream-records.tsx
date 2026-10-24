"use client"

import * as React from "react"
import { ChevronDown, History } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { AnalysisOutcome } from "@/lib/vigil/streams"
import { useDemoMode } from "@/components/vigil/demo-mode-provider"
import { useStreams } from "@/components/vigil/streams/use-streams"

const OUTCOME: Record<AnalysisOutcome, { label: string; className: string }> = {
  alert: { label: "命中", className: "bg-destructive/15 text-destructive" },
  safe: { label: "合规", className: "bg-success/15 text-success" },
  folded: { label: "已折叠", className: "bg-warning/15 text-warning" },
  error: { label: "失败", className: "bg-muted text-muted-foreground" },
}

function clock(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "--:--:--"
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date)
}

/** 每一次研判（含合规、被冷却折叠、失败）的流水，用来证明视频流研判确实在跑。 */
export function StreamRecords() {
  const { enabled: demo } = useDemoMode()
  const { records } = useStreams()
  const [open, setOpen] = React.useState(false)

  if (demo || records.length === 0) return null
  const recent = records.slice(0, 30)

  return (
    <section aria-label="研判记录" className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="flex items-center gap-2 px-1 text-xs font-medium text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <History className="size-3.5" aria-hidden="true" />
        视频流研判记录
        <Badge variant="outline" className="font-mono text-[10px]">
          {records.length}
        </Badge>
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open && (
        <ul className="flex flex-col gap-1.5">
          {recent.map((record) => {
            const meta = OUTCOME[record.outcome]
            return (
              <li key={record.id} className="flex flex-col gap-0.5 rounded-md border border-border bg-card px-3 py-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] text-signal">
                    {record.streamName} · {clock(record.at)}
                  </span>
                  <Badge className={cn("text-[10px]", meta.className)}>
                    {meta.label}
                    {record.count && record.count > 1 ? ` ×${record.count}` : ""}
                  </Badge>
                </div>
                <span className="line-clamp-2 leading-relaxed text-muted-foreground">{record.summary}</span>
                {record.reason && <span className="leading-relaxed text-muted-foreground">原因：{record.reason}</span>}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
