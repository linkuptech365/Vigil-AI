"use client"

import Link from "next/link"
import { FolderOpen, MonitorPlay, ShieldAlert } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { shortFolder } from "@/lib/vigil/data"
import { useVigil } from "./vigil-provider"

function StatusDot({ active }: { active: boolean }) {
  return (
    <span className="relative flex size-2">
      {active && (
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-70" />
      )}
      <span
        className={cn(
          "relative inline-flex size-2 rounded-full",
          active ? "bg-success" : "bg-muted-foreground/60"
        )}
      />
    </span>
  )
}

export function AppHeader() {
  const { ping, settings } = useVigil()
  const connected = ping.state === "ok"

  return (
    <header className="flex flex-col gap-4 py-5 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex items-center gap-3">
        <div className="relative flex size-11 shrink-0 items-center justify-center rounded-xl border border-primary/40 bg-primary/10 text-primary shadow-[0_0_24px] shadow-primary/30">
          <span className="absolute inset-0 animate-pulse rounded-xl bg-primary/15" />
          <ShieldAlert className="relative size-6" aria-hidden="true" />
        </div>
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-balance">Vigil-AI</h1>
            <Badge
              variant="outline"
              className="border-primary/40 bg-primary/10 font-mono text-primary"
            >
              v1.0 Sentinel
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Multimodal Video Reasoning &amp; Warning Platform
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm" variant="outline">
          <Link href="/">
            <MonitorPlay data-icon="inline-start" />
            返回作业大屏
          </Link>
        </Button>
        <Badge
          variant="outline"
          className={cn(
            "h-7 gap-2 px-3 font-mono text-xs",
            connected
              ? "border-success/40 bg-success/10 text-success"
              : "border-border bg-secondary text-muted-foreground"
          )}
          role="status"
          aria-live="polite"
        >
          <StatusDot active={connected} />
          {connected ? `API: 200 OK - ${ping.model}` : "API: 未连接"}
        </Badge>
        <Badge
          variant="outline"
          className="h-7 max-w-64 gap-2 border-warning/40 bg-warning/10 px-3 font-mono text-xs text-warning"
          title={settings.folderPath}
        >
          <FolderOpen aria-hidden="true" />
          <span className="truncate">{shortFolder(settings.folderPath)}</span>
        </Badge>
      </div>
    </header>
  )
}
