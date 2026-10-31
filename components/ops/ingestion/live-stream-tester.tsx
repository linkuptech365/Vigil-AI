"use client"

import * as React from "react"
import { Cast, Link2, Plug, Radio, Volume2, VolumeX } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { LivePhase, LiveProtocol, StreamHealthReport } from "@/lib/ops/ingestion-types"
import {
  buildHealthReport,
  fallbackSourceFor,
  gatewayHlsUrl,
  LIVE_PRESETS,
  LIVE_PROTOCOLS,
  posterFor,
  PROTOCOL_META,
} from "@/lib/ops/live-stream"
import { cn } from "@/lib/utils"
import { useOps } from "../ops-provider"
import { useIngestion } from "./ingestion-provider"
import { StreamQosPanel } from "./stream-qos-panel"
import { useLiveStream } from "./use-live-stream"

const DIAGNOSIS_MS = 3000

const PHASE_BADGE: Record<LivePhase, { label: string; className: string; dot: string }> = {
  idle: { label: "未连接", className: "bg-black/70 text-white", dot: "bg-muted-foreground" },
  connecting: { label: "连接中", className: "bg-black/70 text-white", dot: "bg-warning" },
  live: { label: "LIVE", className: "bg-black/70 text-success", dot: "bg-success" },
  fallback: { label: "回退回环", className: "bg-black/70 text-warning", dot: "bg-warning" },
  error: { label: "拉流失败", className: "bg-black/70 text-destructive", dot: "bg-destructive" },
}

function isReady(phase: LivePhase) {
  return phase === "live" || phase === "fallback"
}

interface LiveStreamTesterProps {
  initialChannelId?: string
  autoConnect?: boolean
}

export function LiveStreamTester({ initialChannelId, autoConnect = false }: LiveStreamTesterProps) {
  const { streams, selectedId } = useIngestion()
  const { pushLiveFeed, focusCamera } = useOps()
  const uid = React.useId()

  const [channelId, setChannelId] = React.useState(initialChannelId ?? selectedId)
  const [protocol, setProtocol] = React.useState<LiveProtocol>(initialChannelId ? "RTSP" : LIVE_PRESETS[0].protocol)
  const [url, setUrl] = React.useState(
    initialChannelId ? gatewayHlsUrl(initialChannelId) : LIVE_PRESETS[0].url,
  )
  const [muted, setMuted] = React.useState(true)
  const [pushing, setPushing] = React.useState(false)
  const [probing, setProbing] = React.useState(false)
  const [progress, setProgress] = React.useState(0)
  const [report, setReport] = React.useState<StreamHealthReport | null>(null)

  const stream = streams.find((s) => s.id === channelId)
  const fallbackSrc = fallbackSourceFor(channelId)
  const { videoRef, phase, message, activeProtocol, metrics, series, connect, disconnect, getSnapshot } =
    useLiveStream({ fallbackSrc, nominalBitrate: stream?.bitrate })

  const phaseRef = React.useRef(phase)
  const mountedRef = React.useRef(true)
  const diagnosisTimers = React.useRef<number[]>([])
  React.useEffect(() => {
    phaseRef.current = phase
  }, [phase])
  React.useEffect(() => {
    mountedRef.current = true
    const timers = diagnosisTimers.current
    return () => {
      mountedRef.current = false
      timers.forEach((id) => {
        window.clearTimeout(id)
        window.clearInterval(id)
      })
    }
  }, [])

  React.useEffect(() => {
    const video = videoRef.current
    if (video) video.muted = muted
  }, [muted, videoRef])

  const didAutoConnect = React.useRef(false)
  React.useEffect(() => {
    if (!autoConnect || didAutoConnect.current) return
    didAutoConnect.current = true
    void connect({ protocol, url })
  }, [autoConnect, connect, protocol, url])

  const startConnect = (nextProtocol = protocol, nextUrl = url) => {
    setReport(null)
    void connect({ protocol: nextProtocol, url: nextUrl })
  }

  const applyPreset = (presetId: string) => {
    const preset = LIVE_PRESETS.find((p) => p.id === presetId)
    if (!preset) return
    setProtocol(preset.protocol)
    setUrl(preset.url)
    startConnect(preset.protocol, preset.url)
  }

  const waitUntilReady = (timeoutMs: number) =>
    new Promise<boolean>((resolve) => {
      const startedAt = Date.now()
      const poll = () => {
        if (!mountedRef.current) return resolve(false)
        if (isReady(phaseRef.current)) return resolve(true)
        if (phaseRef.current === "error" || Date.now() - startedAt > timeoutMs) return resolve(false)
        window.setTimeout(poll, 150)
      }
      poll()
    })

  const pushToGrid = async () => {
    setPushing(true)
    try {
      if (!isReady(phaseRef.current)) {
        startConnect()
        const ok = await waitUntilReady(12000)
        if (!ok) {
          if (mountedRef.current) toast.error("测通失败，未推送到监控大屏")
          return
        }
      }
      const usedFallback = phaseRef.current === "fallback"
      const short = PROTOCOL_META[protocol].short
      pushLiveFeed({
        channelId,
        protocol: usedFallback ? "MP4" : protocol,
        url: usedFallback ? fallbackSrc : url.trim(),
        label: usedFallback ? `${channelId} · ${short} 回退回环` : `${channelId} · ${short} 实时流`,
        fallbackSrc,
      })
      focusCamera(channelId)
      toast.success(`已推送 ${channelId} 到监控大屏`, {
        description: usedFallback ? "实时流不可达，已使用本地 MP4 回环画面" : `${short} 实时流已接管该通道画面`,
      })
    } finally {
      if (mountedRef.current) setPushing(false)
    }
  }

  const runDiagnosis = () => {
    if (!isReady(phaseRef.current)) {
      toast.error("请先连接视频流再进行诊断")
      return
    }
    setReport(null)
    setProbing(true)
    setProgress(0)
    const startedAt = performance.now()
    const tickId = window.setInterval(() => {
      setProgress(Math.min(1, (performance.now() - startedAt) / DIAGNOSIS_MS))
    }, 60)
    const doneId = window.setTimeout(() => {
      window.clearInterval(tickId)
      if (!mountedRef.current) return
      setProgress(1)
      setReport(buildHealthReport(getSnapshot()))
      setProbing(false)
    }, DIAGNOSIS_MS)
    diagnosisTimers.current.push(tickId, doneId)
  }

  const badge = PHASE_BADGE[phase]
  const connecting = phase === "connecting"
  const posterSrc = posterFor(channelId)

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-2">
          <div className="relative aspect-video overflow-hidden rounded-lg border border-border bg-black">
            <video
              ref={videoRef}
              poster={posterSrc}
              muted
              loop
              playsInline
              aria-label={`${channelId} 拉流测通画面`}
              className="absolute inset-0 size-full object-cover"
            />
            <div className="cctv-scanlines pointer-events-none absolute inset-0" aria-hidden="true" />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-black/60" />

            <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className={cn(
                    "flex items-center gap-1.5 rounded px-1.5 py-0.5 font-mono text-xs font-semibold",
                    badge.className,
                  )}
                  role="status"
                >
                  <span className="relative flex size-2">
                    {(phase === "live" || connecting) && (
                      <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-75", badge.dot)} />
                    )}
                    <span className={cn("relative inline-flex size-2 rounded-full", badge.dot)} />
                  </span>
                  {badge.label}
                </span>
                {activeProtocol && (
                  <span className="rounded bg-black/70 px-1.5 py-0.5 font-mono text-[11px] text-signal">
                    {PROTOCOL_META[activeProtocol].short}
                  </span>
                )}
                <span className="rounded bg-black/70 px-1.5 py-0.5 font-mono text-[11px] text-white">{channelId}</span>
              </div>
              {isReady(phase) && (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="secondary"
                  aria-label={muted ? "取消静音" : "静音"}
                  aria-pressed={!muted}
                  className="bg-black/60 text-white backdrop-blur hover:bg-black/80"
                  onClick={() => setMuted((prev) => !prev)}
                >
                  {muted ? <VolumeX /> : <Volume2 />}
                </Button>
              )}
            </div>

            {phase === "idle" && (
              <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white/80">
                选择下方预设或填写流地址后点击“连接”开始拉流
              </div>
            )}
            {connecting && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Spinner className="size-6 text-signal" />
              </div>
            )}

            <div className="absolute inset-x-0 bottom-0 p-2.5">
              <p className="truncate rounded bg-black/70 px-2 py-1 text-xs text-white" title={message}>
                {message}
              </p>
            </div>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {PROTOCOL_META[protocol].hint}
            {stream && (
              <>
                {" "}
                通道 {stream.id} 源地址：<span className="font-mono">{stream.protocol}</span>
              </>
            )}
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label id={`${uid}-protocol`}>拉流协议</Label>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={protocol}
              onValueChange={(value) => {
                if (value) setProtocol(value as LiveProtocol)
              }}
              aria-labelledby={`${uid}-protocol`}
              className="flex-wrap justify-start"
            >
              {LIVE_PROTOCOLS.map((item) => (
                <ToggleGroupItem key={item} value={item} className="px-2.5 text-xs">
                  {PROTOCOL_META[item].label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>预设流</Label>
            <div className="flex flex-col gap-1.5">
              {LIVE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  disabled={connecting}
                  onClick={() => applyPreset(preset.id)}
                  className="flex flex-col items-start gap-0.5 rounded-md border border-border bg-card px-3 py-2 text-left outline-none transition-colors hover:border-signal/60 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                >
                  <span className="text-sm font-medium text-foreground">{preset.label}</span>
                  <span className="text-xs text-muted-foreground">{preset.description}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${uid}-channel`}>目标通道</Label>
              <Select value={channelId} onValueChange={setChannelId}>
                <SelectTrigger id={`${uid}-channel`} className="w-full">
                  <SelectValue placeholder="选择通道" />
                </SelectTrigger>
                <SelectContent>
                  {streams.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.id} · {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${uid}-url`}>流地址</Label>
              <Input
                id={`${uid}-url`}
                value={url}
                spellCheck={false}
                autoComplete="off"
                placeholder={PROTOCOL_META[protocol].placeholder}
                onChange={(event) => setUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229) startConnect()
                }}
                className="font-mono text-xs"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={connecting} onClick={() => startConnect()}>
              {connecting ? <Spinner /> : <Link2 />}
              {connecting ? "连接中" : "连接"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={phase === "idle"}
              onClick={() => {
                setReport(null)
                disconnect()
              }}
            >
              <Plug />
              断开
            </Button>
          </div>

          <Button type="button" disabled={pushing || connecting} onClick={() => void pushToGrid()} className="w-full">
            {pushing ? <Spinner /> : <Cast />}
            一键测通并推送到监控大屏 (Push Stream to Monitor Grid)
          </Button>
        </div>
      </div>

      <StreamQosPanel
        metrics={metrics}
        series={series}
        phase={phase}
        probing={probing}
        progress={progress}
        report={report}
        onDiagnose={runDiagnosis}
      />
    </div>
  )
}

export function LiveStreamProbeCard() {
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="flex flex-col gap-1 border-b border-border p-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <Radio className="size-4 text-signal" aria-hidden="true" />
          实时流媒体拉流测通器 (Live Stream Probe)
        </CardTitle>
        <CardDescription>
          真实拉取 HLS / WebRTC / MP4 流，实时采样码率、帧率与抖动；拉流失败时自动回退到本地回环素材。
        </CardDescription>
      </CardHeader>
      <CardContent className="p-4">
        <LiveStreamTester />
      </CardContent>
    </Card>
  )
}
