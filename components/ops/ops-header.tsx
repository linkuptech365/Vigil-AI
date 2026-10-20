"use client"

import * as React from "react"
import Link from "next/link"
import { Library, MonitorPlay, Plus, Settings2, ShieldAlert, Volume2, VolumeX } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { shanghaiClock, shanghaiDate } from "@/lib/ops/utils"
import { useOps } from "./ops-provider"

function LiveClock() {
  const [now, setNow] = React.useState<Date | null>(null)

  React.useEffect(() => {
    setNow(new Date())
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])

  return (
    <div
      className="flex min-w-32 flex-col items-end leading-tight"
      role="timer"
      aria-label="当前时间 UTC+8"
    >
      <span className="font-mono text-base font-semibold tabular-nums">
        {now ? shanghaiClock(now) : "--:--:--"}
      </span>
      <span className="font-mono text-[10px] text-muted-foreground">
        {now ? shanghaiDate(now) : "----"} UTC+8
      </span>
    </div>
  )
}

export function OpsHeader() {
  const { muted, toggleMuted, openRuleStudio } = useOps()

  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-border bg-card/60 px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="relative flex size-10 shrink-0 items-center justify-center rounded-xl border border-signal/40 bg-signal/10 text-signal">
          <span className="absolute inset-0 animate-pulse rounded-xl bg-signal/10" />
          <ShieldAlert className="relative size-5" aria-hidden="true" />
        </div>
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight">Vigil-AI</h1>
            <Badge variant="outline" className="border-signal/40 font-mono text-signal">
              作业大屏
            </Badge>
          </div>
          <p
            className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground"
            role="status"
          >
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-75" />
              <span className="relative inline-flex size-1.5 rounded-full bg-success" />
            </span>
            4 Channels Online | 30 FPS Aggregate | Inference Engine Active
          </p>
        </div>
      </div>

      <nav
        aria-label="页面导航"
        className="order-3 flex w-full items-center gap-1 rounded-lg border border-border bg-secondary/50 p-1 sm:order-none sm:w-auto"
      >
        <Button asChild size="sm" variant="secondary" className="flex-1 sm:flex-none">
          <Link href="/" aria-current="page">
            <MonitorPlay data-icon="inline-start" />
            作业大屏
          </Link>
        </Button>
        <Button asChild size="sm" variant="ghost" className="flex-1 sm:flex-none">
          <Link href="/console">
            <Settings2 data-icon="inline-start" />
            配置中心
          </Link>
        </Button>
      </nav>

      <div className="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-pressed={muted}
              aria-label={muted ? "取消静音紧急告警" : "静音紧急告警"}
              onClick={toggleMuted}
            >
              {muted ? <VolumeX /> : <Volume2 />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{muted ? "告警声音已静音" : "告警声音已开启"}</TooltipContent>
        </Tooltip>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="规则库管理"
          onClick={() => openRuleStudio("list")}
          className="sm:hidden"
        >
          <Library />
        </Button>
        <Button
          type="button"
          variant="outline"
          className="hidden sm:inline-flex"
          onClick={() => openRuleStudio("list")}
        >
          <Library data-icon="inline-start" />
          规则库管理
        </Button>
        <Button
          type="button"
          className="bg-signal text-black hover:bg-signal/90"
          onClick={() => openRuleStudio("custom")}
        >
          <Plus data-icon="inline-start" />
          新建布控规则
        </Button>
        <LiveClock />
      </div>
    </header>
  )
}
