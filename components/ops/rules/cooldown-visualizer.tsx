"use client"

import { CloudLightning, Crosshair, Timer } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { CAMERAS } from "@/lib/ops/data"
import { ALL_CHANNELS } from "@/lib/ops/rules-data"
import type { ChannelCooldown } from "@/lib/ops/rules-types"
import { cn } from "@/lib/utils"
import { isWindowActive, lastTriggerOffset, remainingSeconds, useRules } from "./rules-provider"

const RING_RADIUS = 28
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

function formatClock(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds))
  const m = String(Math.floor(whole / 60)).padStart(2, "0")
  const s = String(whole % 60).padStart(2, "0")
  return `${m}:${s}`
}

function channelLabel(id: string) {
  const camera = CAMERAS.find((c) => c.id === id)
  return camera ? `${camera.code} ${camera.nameEn}` : id
}

function CountdownRing({ cooldown }: { cooldown: ChannelCooldown }) {
  const active = isWindowActive(cooldown)
  const remaining = remainingSeconds(cooldown)
  const ratio = active ? remaining / cooldown.windowSeconds : 0

  return (
    <div className="relative size-16 shrink-0" role="img" aria-label={`冷却窗口剩余 ${remaining} 秒`}>
      <svg viewBox="0 0 64 64" className="size-full -rotate-90" aria-hidden="true">
        <circle cx="32" cy="32" r={RING_RADIUS} fill="none" strokeWidth="4" className="stroke-border" />
        <circle
          cx="32"
          cy="32"
          r={RING_RADIUS}
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={RING_CIRCUMFERENCE * (1 - ratio)}
          className="stroke-warning transition-[stroke-dashoffset] duration-500 ease-linear"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-mono text-sm font-semibold tabular-nums">
        {remaining}s
      </span>
    </div>
  )
}

function PulseTimeline({ cooldown }: { cooldown: ChannelCooldown }) {
  const last = lastTriggerOffset(cooldown)
  const windowEnd = last + cooldown.windowSeconds
  const axisMax = Math.max(60, Math.ceil(Math.max(cooldown.elapsed + 5, windowEnd) / 15) * 15)
  const pct = (value: number) => `${Math.min(100, (value / axisMax) * 100)}%`
  const ticks = Array.from({ length: axisMax / 15 + 1 }, (_, i) => i * 15)
  const active = isWindowActive(cooldown)
  const empty = cooldown.pulses.length === 0

  return (
    <div className="flex flex-col gap-1.5">
      <div
        role="img"
        aria-label={`触发时间轴，共 ${cooldown.pulses.length} 次触发`}
        className="relative h-14 rounded-md border border-border bg-background"
      >
        {!empty && (
          <div
            className={cn(
              "absolute inset-y-0 border-x border-dashed",
              active ? "border-warning/60 bg-warning/10" : "border-border bg-muted/40"
            )}
            style={{ left: pct(last), width: `calc(${pct(windowEnd)} - ${pct(last)})` }}
          />
        )}
        <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
        {ticks.map((tick) => (
          <span
            key={tick}
            className="absolute top-0 h-2 w-px bg-border"
            style={{ left: pct(tick) }}
            aria-hidden="true"
          />
        ))}
        {!empty && (
          <span
            className="absolute inset-y-0 w-px bg-signal"
            style={{ left: pct(cooldown.elapsed) }}
            aria-hidden="true"
          />
        )}
        {cooldown.pulses.map((pulse) => (
          <span
            key={pulse.id}
            title={`${formatClock(pulse.offset)} ${pulse.kind === "incident" ? "Incident Created" : "Suppressed"}`}
            className={cn(
              "absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background",
              pulse.kind === "incident" ? "size-4 bg-destructive" : "size-3 bg-warning"
            )}
            style={{ left: pct(pulse.offset) }}
            aria-hidden="true"
          />
        ))}
        {empty && (
          <p className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
            当前通道没有活动冷却窗口，注入触发后开始计时
          </p>
        )}
      </div>
      <div className="relative h-4 font-mono text-[10px] text-muted-foreground" aria-hidden="true">
        {ticks.map((tick) => (
          <span
            key={tick}
            className="absolute -translate-x-1/2 first:translate-x-0 last:-translate-x-full"
            style={{ left: pct(tick) }}
          >
            {formatClock(tick)}
          </span>
        ))}
      </div>
    </div>
  )
}

export function CooldownVisualizer() {
  const { cooldowns, selectedChannel, setSelectedChannel, triggerOnce, runStorm, stormRunning } = useRules()
  const cooldown = cooldowns[selectedChannel]
  const active = isWindowActive(cooldown)
  const ended = cooldown.incidentId !== null && !active
  const folded = cooldown.pulses.filter((p) => p.kind === "suppressed").length

  return (
    <Card className="gap-4 py-4">
      <CardHeader className="px-4">
        <div className="flex flex-col gap-1">
          <CardTitle className="text-sm">防抖冷却与滑动窗口 (Flapping Suppression)</CardTitle>
          <CardDescription>
            窗口内的重复触发不会再次通知，而是自动追加到同一条证据链；窗口从最近一次触发起重新计时。
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 px-4">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={1}
          value={selectedChannel}
          onValueChange={(value) => value && setSelectedChannel(value)}
          aria-label="选择观察通道"
          className="flex-wrap"
        >
          {ALL_CHANNELS.map((id) => (
            <ToggleGroupItem key={id} value={id} className="font-mono text-xs">
              {channelLabel(id)}
              {isWindowActive(cooldowns[id]) && (
                <span className="size-1.5 rounded-full bg-warning" aria-label="冷却中" />
              )}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-background p-3">
          <CountdownRing cooldown={cooldown} />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <Timer className="size-4 text-warning" aria-hidden="true" />
              {active
                ? `冷却窗口倒计时 (Cooldown Window Active: ${remainingSeconds(cooldown)}s remaining)`
                : ended
                  ? "冷却窗口已结束，下一次触发将生成新工单"
                  : "待机中，尚未触发"}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {active ? (
                <Badge variant="outline" className="border-warning/50 bg-warning/10 text-warning">
                  [抑制中 - 证据自动追加]
                </Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">
                  {ended ? "[窗口已闭合]" : "[待机]"}
                </Badge>
              )}
              {cooldown.incidentId && (
                <span className="font-mono text-xs text-muted-foreground">{cooldown.incidentId}</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              已折叠 <span className="font-mono text-foreground">{folded}</span> 次重复触发，证据链共{" "}
              <span className="font-mono text-foreground">{cooldown.pulses.length}</span> 段。
            </p>
          </div>
        </div>

        <PulseTimeline cooldown={cooldown} />

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-3 rounded-full bg-destructive" aria-hidden="true" />
            Incident Created
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-warning" aria-hidden="true" />
            Suppressed & Merged
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-px bg-signal" aria-hidden="true" />
            当前时刻
          </span>
        </div>

        <ol
          aria-label="触发日志"
          className="scrollbar-thin flex max-h-40 flex-col gap-1.5 overflow-y-auto rounded-lg border border-border bg-background p-2"
        >
          {cooldown.pulses.length === 0 && (
            <li className="px-1 py-2 text-xs text-muted-foreground">暂无触发记录</li>
          )}
          {[...cooldown.pulses].reverse().map((pulse) => (
            <li key={pulse.id} className="flex items-start gap-2 px-1 text-xs">
              <span
                className={cn(
                  "mt-1 size-2 shrink-0 rounded-full",
                  pulse.kind === "incident" ? "bg-destructive" : "bg-warning"
                )}
                aria-hidden="true"
              />
              <span className="font-mono tabular-nums text-muted-foreground">{formatClock(pulse.offset)}</span>
              <span className="min-w-0 leading-relaxed">
                {pulse.kind === "incident"
                  ? "Incident Created，已派发声光告警与工单通知"
                  : "Suppressed & Merged into Existing Evidence Chain，无重复通知"}
              </span>
            </li>
          ))}
        </ol>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            disabled={stormRunning}
            onClick={() => triggerOnce(selectedChannel)}
          >
            <Crosshair data-icon="inline-start" />
            注入单次触发
          </Button>
          <Button type="button" disabled={stormRunning} onClick={() => runStorm(selectedChannel)}>
            {stormRunning ? <Spinner data-icon="inline-start" /> : <CloudLightning data-icon="inline-start" />}
            {stormRunning ? "风暴注入中..." : "注入连续告警风暴 (Simulate Alert Storm)"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
