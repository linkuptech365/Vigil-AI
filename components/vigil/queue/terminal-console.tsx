"use client"

import * as React from "react"
import { Eraser, Terminal } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { LogLevel } from "@/lib/vigil/types"
import { useVigil } from "../vigil-provider"

const LEVEL_STYLE: Record<LogLevel, { tag: string; className: string }> = {
  sys: { tag: "SYS", className: "text-muted-foreground" },
  info: { tag: "INFO", className: "text-primary" },
  sample: { tag: "FRAME", className: "text-primary" },
  req: { tag: "REQ", className: "text-warning" },
  res: { tag: "RES", className: "text-foreground" },
  ok: { tag: "OK", className: "text-success" },
  warn: { tag: "WARN", className: "text-warning" },
  alert: { tag: "ALERT", className: "text-destructive" },
}

export function TerminalConsole() {
  const { logs, clearLogs, activeTab } = useVigil()
  const viewportRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const el = viewportRef.current
    if (el && activeTab === "queue") el.scrollTop = el.scrollHeight
  }, [logs, activeTab])

  return (
    <section
      aria-label="推理管线终端日志"
      className="overflow-hidden rounded-xl border border-border bg-card"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <h2 className="flex items-center gap-2 font-mono text-sm text-muted-foreground">
          <Terminal className="size-4 text-primary" aria-hidden="true" />
          vigil-pipeline.log
        </h2>
        <Button variant="ghost" size="sm" onClick={clearLogs}>
          <Eraser data-icon="inline-start" />
          清空
        </Button>
      </div>
      <div
        ref={viewportRef}
        role="log"
        aria-live="off"
        className="h-56 overflow-y-auto bg-background/60 p-4 font-mono text-xs leading-relaxed"
      >
        {logs.length === 0 ? (
          <p className="text-muted-foreground">$ 暂无日志输出_</p>
        ) : (
          logs.map((line) => {
            const style = LEVEL_STYLE[line.level]
            return (
              <p key={line.id} className="flex gap-3 break-all">
                <span className="shrink-0 text-muted-foreground/70">{line.ts}</span>
                <span className={cn("w-12 shrink-0 font-semibold", style.className)}>
                  {style.tag}
                </span>
                <span className={cn("min-w-0", style.className)}>{line.text}</span>
              </p>
            )
          })
        )}
      </div>
    </section>
  )
}
