"use client"

import Image from "next/image"
import {
  BellRing,
  CircleCheck,
  Cpu,
  DoorClosed,
  DoorOpen,
  MessageSquareWarning,
  Radio,
  RotateCcw,
  Siren,
  TriangleAlert,
  Volume2,
  VolumeX,
  Webhook,
  Zap,
  type LucideIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { WORKSHOP_IMAGE } from "@/lib/ops/dispatch-data"
import type { BroadcastChannelType, ChannelBroadcastStatus } from "@/lib/ops/dispatch-types"
import { cn } from "@/lib/utils"
import { useDispatch } from "./dispatch-provider"

const CHANNEL_ICON: Record<BroadcastChannelType, LucideIcon> = {
  SIREN: Siren,
  WEBHOOK: Webhook,
  IM_BOT: MessageSquareWarning,
  IOT_HARDWARE: Cpu,
}

const CHANNEL_SUBTITLE: Record<BroadcastChannelType, string> = {
  SIREN: "Control Room Siren & Overlay",
  WEBHOOK: "Enterprise API Webhook",
  IM_BOT: "IM Bot Notification Card",
  IOT_HARDWARE: "Edge IoT Hardware Actuator",
}

function ChannelState({
  channel,
  firing,
}: {
  channel: ChannelBroadcastStatus
  firing: boolean
}) {
  if (firing) {
    return (
      <Badge variant="outline" className="border-warning/50 bg-warning/10 text-warning">
        <Spinner aria-hidden="true" />
        Firing
      </Badge>
    )
  }
  if (channel.status === "SUCCESS") {
    return (
      <Badge variant="outline" className="border-destructive/50 bg-destructive/10 text-destructive">
        <span className="size-1.5 rounded-full bg-destructive" aria-hidden="true" />
        Fired
        {channel.lastFiredTime ? (
          <span className="font-mono text-[10px]">{channel.lastFiredTime}</span>
        ) : null}
      </Badge>
    )
  }
  if (channel.status === "FAILED") {
    return (
      <Badge variant="outline" className="border-destructive/50 text-destructive">
        Failed
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="border-success/50 bg-success/10 text-success">
      <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
      Ready
    </Badge>
  )
}

function ChannelShell({
  channel,
  firing,
  children,
}: {
  channel: ChannelBroadcastStatus
  firing: boolean
  children: React.ReactNode
}) {
  const Icon = CHANNEL_ICON[channel.channelType]
  const fired = channel.status === "SUCCESS"

  return (
    <Card
      className={cn(
        "gap-3 transition-colors",
        fired && "border-destructive/50",
        firing && "border-warning/60"
      )}
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Icon className="size-4 shrink-0 text-signal" aria-hidden="true" />
              <span className="truncate">{channel.name}</span>
            </CardTitle>
            <CardDescription className="font-mono text-[10px]">
              {CHANNEL_SUBTITLE[channel.channelType]}
            </CardDescription>
          </div>
          <div className="flex items-center gap-1.5">
            {fired && !firing ? (
              <CircleCheck className="size-4 text-success" aria-label="已确认送达" />
            ) : null}
            <ChannelState channel={channel} firing={firing} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">{children}</CardContent>
    </Card>
  )
}

function SirenPanel({ channel, firing }: { channel: ChannelBroadcastStatus; firing: boolean }) {
  const { sirenMuted, setSirenMuted } = useDispatch()
  const fired = channel.status === "SUCCESS"

  return (
    <ChannelShell channel={channel} firing={firing}>
      <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2">
        <label htmlFor="siren-mute" className="flex items-center gap-2 text-sm">
          {sirenMuted ? (
            <VolumeX className="size-4 text-muted-foreground" aria-hidden="true" />
          ) : (
            <Volume2 className="size-4 text-signal" aria-hidden="true" />
          )}
          警报音频
          <span className="font-mono text-[10px] text-muted-foreground">
            {sirenMuted ? "MUTE" : "SIREN ON"}
          </span>
        </label>
        <Switch
          id="siren-mute"
          checked={sirenMuted}
          onCheckedChange={setSirenMuted}
          aria-label="静音警报音频"
        />
      </div>
      <div
        className={cn(
          "relative flex aspect-video items-center justify-center overflow-hidden rounded-md border bg-background",
          fired ? "border-destructive" : "border-border",
          fired && !sirenMuted && "animate-pulse"
        )}
        aria-label="全屏告警层预览"
      >
        <Image
          src={WORKSHOP_IMAGE}
          alt=""
          fill
          sizes="(min-width: 1280px) 25vw, 90vw"
          className={cn("object-cover", fired ? "opacity-40" : "opacity-60")}
        />
        {fired ? (
          <div className="relative flex flex-col items-center gap-1 rounded-md border border-destructive bg-background/90 px-4 py-2 text-center">
            <TriangleAlert className="size-5 text-destructive" aria-hidden="true" />
            <span className="text-xs font-semibold text-destructive">CRITICAL 严重违规</span>
            <span className="text-[10px] text-muted-foreground">CAM-02 机加工车间越界与冲突</span>
          </div>
        ) : (
          <span className="relative rounded-sm bg-background/80 px-2 py-1 font-mono text-[10px] text-muted-foreground">
            高优先级全屏告警层 · 待命
          </span>
        )}
      </div>
    </ChannelShell>
  )
}

function WebhookPanel({ channel, firing }: { channel: ChannelBroadcastStatus; firing: boolean }) {
  const fired = channel.status === "SUCCESS"

  return (
    <ChannelShell channel={channel} firing={firing}>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Target URL</span>
        <code className="break-all rounded-md border border-border bg-background px-3 py-2 font-mono text-xs text-signal">
          POST {channel.target}
        </code>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">Handshake</span>
        {fired ? (
          <Badge variant="outline" className="border-success/50 bg-success/10 font-mono text-success">
            HTTP 200 OK
          </Badge>
        ) : (
          <Badge variant="outline" className="font-mono text-muted-foreground">
            等待发送
          </Badge>
        )}
        {fired ? <span className="font-mono text-[10px] text-muted-foreground">128 ms</span> : null}
      </div>
      <pre className="scrollbar-thin overflow-x-auto rounded-md border border-border bg-background px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
        {`{
  "event": "incident.critical",
  "dossier_id": "DOS-20261020-008",
  "channel": "CAM-02",
  "type": "intrusion+physical_conflict",
  "confidence": 0.97,
  "evidence_sha256": "e3b0c442…b855"
}`}
      </pre>
    </ChannelShell>
  )
}

function ImBotPanel({ channel, firing }: { channel: ChannelBroadcastStatus; firing: boolean }) {
  const fired = channel.status === "SUCCESS"

  return (
    <ChannelShell channel={channel} firing={firing}>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">推送目标</span>
        <span className="text-sm">{channel.target}</span>
      </div>
      <div
        className={cn(
          "flex flex-col gap-2 rounded-md border bg-background p-3",
          fired ? "border-warning/60" : "border-border"
        )}
      >
        <div className="flex items-center gap-2">
          <TriangleAlert className="size-4 shrink-0 text-warning" aria-hidden="true" />
          <span className="text-sm font-semibold">【严重】1号机加工车间越界入侵与肢体冲突</span>
        </div>
        <div className="relative aspect-[16/7] overflow-hidden rounded-sm border border-border">
          <Image
            src={WORKSHOP_IMAGE}
            alt="告警关键帧缩略图"
            fill
            sizes="(min-width: 1280px) 25vw, 90vw"
            className="object-cover"
          />
          <span
            className="absolute rounded-sm border-2 border-destructive"
            style={{ left: "49%", top: "45%", width: "22%", height: "32%" }}
            aria-hidden="true"
          />
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          14:32:08 · CAM-02 · 置信度 0.97。违反厂区安全生产规程第 4.2 条，请
          <span className="font-medium text-signal"> @东门安保组 </span>
          立即前往处置。
        </p>
        <span className="text-xs font-medium text-primary">[点击一键接单]</span>
      </div>
    </ChannelShell>
  )
}

function IotPanel({ channel, firing }: { channel: ChannelBroadcastStatus; firing: boolean }) {
  const fired = channel.status === "SUCCESS"

  return (
    <ChannelShell channel={channel} firing={firing}>
      <ul className="flex flex-col gap-2">
        <li
          className={cn(
            "flex items-center gap-3 rounded-md border bg-background px-3 py-2",
            fired ? "border-destructive/50" : "border-border"
          )}
        >
          {fired ? (
            <DoorClosed className="size-5 shrink-0 text-destructive" aria-hidden="true" />
          ) : (
            <DoorOpen className="size-5 shrink-0 text-success" aria-hidden="true" />
          )}
          <div className="flex min-w-0 flex-col">
            <span className="text-sm">门禁闸机 GATE-02</span>
            <span className="text-xs text-muted-foreground">
              {fired ? "自动锁定阻止进入 (Locked)" : "正常通行 (Unlocked)"}
            </span>
          </div>
        </li>
        <li
          className={cn(
            "flex items-center gap-3 rounded-md border bg-background px-3 py-2",
            fired ? "border-destructive/50" : "border-border"
          )}
        >
          {fired ? (
            <Zap
              className={cn("size-5 shrink-0 text-destructive", "animate-pulse")}
              aria-hidden="true"
            />
          ) : (
            <Radio className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          <div className="flex min-w-0 flex-col">
            <span className="text-sm">频闪灯与高音警号 HORN-02</span>
            <span className="text-xs text-muted-foreground">
              {fired ? "高分贝声光警号触发中 (Strobe Active)" : "待命 (Standby)"}
            </span>
          </div>
        </li>
      </ul>
      <p className="font-mono text-[10px] text-muted-foreground">{channel.target}</p>
    </ChannelShell>
  )
}

export function MultiChannelBroadcast() {
  const { broadcast, firingChannel, broadcasting, broadcastAll, resetBroadcast } = useDispatch()
  const anyFired = broadcast.some((c) => c.status === "SUCCESS")
  const allFired = broadcast.every((c) => c.status === "SUCCESS")

  const byType = (type: BroadcastChannelType) => {
    const channel = broadcast.find((c) => c.channelType === type)
    if (!channel) throw new Error(`missing broadcast channel ${type}`)
    return { channel, firing: firingChannel === type }
  }

  const siren = byType("SIREN")
  const webhook = byType("WEBHOOK")
  const im = byType("IM_BOT")
  const iot = byType("IOT_HARDWARE")

  return (
    <section aria-labelledby="broadcast-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h3 id="broadcast-title" className="flex items-center gap-2 text-base font-semibold">
            <BellRing className="size-4 text-signal" aria-hidden="true" />
            多渠道告警广播模拟器 (Multi-Channel Alert Broadcast)
          </h3>
          <p className="text-sm text-muted-foreground">
            同一条告警同时触达大屏、业务系统、群聊机器人与现场硬件，4 个渠道逐一确认送达。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {anyFired && !broadcasting ? (
            <Button type="button" variant="outline" onClick={resetBroadcast}>
              <RotateCcw data-icon="inline-start" />
              复位全部渠道
            </Button>
          ) : null}
          <Button
            type="button"
            variant="destructive"
            onClick={broadcastAll}
            disabled={broadcasting}
          >
            {broadcasting ? <Spinner data-icon="inline-start" /> : <Siren data-icon="inline-start" />}
            {broadcasting
              ? "正在广播…"
              : allFired
                ? "再次触发全渠道联合广播"
                : "模拟触发全渠道联合广播 (Broadcast Emergency Alert)"}
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-4">
        <SirenPanel {...siren} />
        <WebhookPanel {...webhook} />
        <ImBotPanel {...im} />
        <IotPanel {...iot} />
      </div>
    </section>
  )
}
