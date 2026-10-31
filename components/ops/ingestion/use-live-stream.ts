"use client"

import * as React from "react"
import type Hls from "hls.js"

import type {
  LivePhase,
  LiveProtocol,
  QosSeries,
  QosSnapshot,
  StreamQosMetrics,
} from "@/lib/ops/ingestion-types"
import { nearestStandardFps, PROTOCOL_META } from "@/lib/ops/live-stream"
import { hasMediaSrc, safePlay } from "@/lib/ops/media"

const SERIES_LENGTH = 30
const CONNECT_TIMEOUT_MS = 9000
const MAX_FRAME_GAP_MS = 200

const EMPTY_METRICS: StreamQosMetrics = {
  bitrateMbps: 0,
  fps: 0,
  targetFps: 25,
  droppedFrames: 0,
  totalFrames: 0,
  jitterMs: 0,
  gopSeconds: 2,
  gopFrames: 50,
  bitrateSource: "estimated",
}

const EMPTY_SERIES: QosSeries = { bitrate: [], fps: [], jitter: [] }

export interface LiveStreamConfig {
  protocol: LiveProtocol
  url: string
}

interface Options {
  fallbackSrc: string
  nominalBitrate?: number
  collectQos?: boolean
}

interface Sample {
  fps: number
  jitter: number
  bitrate: number
}

interface RtpState {
  bytes: number
  at: number
  bitrateMbps: number | null
  jitterMs: number | null
  lossPct: number | null
}

const EMPTY_RTP: RtpState = { bytes: 0, at: 0, bitrateMbps: null, jitterMs: null, lossPct: null }

function stddev(values: number[]) {
  if (values.length < 2) return 0
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length
  return Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length)
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0
}

function median(values: number[]) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function appendSeries(series: number[], value: number) {
  return [...series, value].slice(-SERIES_LENGTH)
}

function waitForIceGathering(pc: RTCPeerConnection, timeoutMs: number) {
  return new Promise<void>((resolve) => {
    if (pc.iceGatheringState === "complete") {
      resolve()
      return
    }
    const finish = () => {
      pc.removeEventListener("icegatheringstatechange", onChange)
      resolve()
    }
    const onChange = () => {
      if (pc.iceGatheringState === "complete") finish()
    }
    pc.addEventListener("icegatheringstatechange", onChange)
    window.setTimeout(finish, timeoutMs)
  })
}

export function useLiveStream({ fallbackSrc, nominalBitrate = 2.4, collectQos = true }: Options) {
  const videoRef = React.useRef<HTMLVideoElement>(null)
  const [phase, setPhase] = React.useState<LivePhase>("idle")
  const [message, setMessage] = React.useState("尚未连接")
  const [activeProtocol, setActiveProtocol] = React.useState<LiveProtocol | null>(null)
  const [metrics, setMetrics] = React.useState<StreamQosMetrics>(EMPTY_METRICS)
  const [series, setSeries] = React.useState<QosSeries>(EMPTY_SERIES)

  const optionsRef = React.useRef({ fallbackSrc, nominalBitrate })
  React.useEffect(() => {
    optionsRef.current = { fallbackSrc, nominalBitrate }
  }, [fallbackSrc, nominalBitrate])

  const sessionRef = React.useRef(0)
  const hlsRef = React.useRef<Hls | null>(null)
  const pcRef = React.useRef<RTCPeerConnection | null>(null)
  const timeoutRef = React.useRef<number | undefined>(undefined)
  const startedAtRef = React.useRef(0)
  const firstFrameMsRef = React.useRef<number | null>(null)
  const fallbackActiveRef = React.useRef(false)
  const activeProtocolRef = React.useRef<LiveProtocol | null>(null)
  const fragRef = React.useRef<{ bitrateMbps: number | null; loadMs: number[]; duration: number }>({
    bitrateMbps: null,
    loadMs: [],
    duration: 0,
  })
  const rtpRef = React.useRef<RtpState>(EMPTY_RTP)
  const intervalsRef = React.useRef<number[]>([])
  const samplesRef = React.useRef<Sample[]>([])
  const lastTickRef = React.useRef({ at: 0, total: 0 })

  const teardown = React.useCallback(() => {
    window.clearTimeout(timeoutRef.current)
    try {
      hlsRef.current?.destroy()
    } catch {
      // The instance may already be destroyed by a fatal error.
    }
    hlsRef.current = null
    try {
      pcRef.current?.close()
    } catch {
      // Closing an already closed peer connection is harmless.
    }
    pcRef.current = null
    const video = videoRef.current
    if (video) {
      try {
        video.pause()
        video.srcObject = null
        video.removeAttribute("src")
        video.load()
      } catch {
        // Detaching a media element must never surface to the console.
      }
    }
  }, [])

  const resetStats = React.useCallback(() => {
    firstFrameMsRef.current = null
    fragRef.current = { bitrateMbps: null, loadMs: [], duration: 0 }
    rtpRef.current = EMPTY_RTP
    intervalsRef.current = []
    samplesRef.current = []
    lastTickRef.current = { at: 0, total: 0 }
    setMetrics(EMPTY_METRICS)
    setSeries(EMPTY_SERIES)
  }, [])

  const playDirect = React.useCallback((url: string) => {
    const video = videoRef.current
    if (!video) return
    video.srcObject = null
    video.loop = true
    video.src = url
    safePlay(video)
  }, [])

  const enterFallback = React.useCallback(
    (sessionId: number, reason: string) => {
      if (sessionId !== sessionRef.current) return
      teardown()
      const source = optionsRef.current.fallbackSrc
      if (!hasMediaSrc(source) || fallbackActiveRef.current) {
        setPhase("error")
        setMessage(`${reason}，且本地回退素材不可用`)
        return
      }
      fallbackActiveRef.current = true
      startedAtRef.current = performance.now()
      firstFrameMsRef.current = null
      fragRef.current = { bitrateMbps: null, loadMs: [], duration: 0 }
      rtpRef.current = EMPTY_RTP
      setPhase("fallback")
      setMessage(`${reason}，已回退到本地 MP4 回环`)
      playDirect(source)
    },
    [playDirect, teardown],
  )

  const connectHls = React.useCallback(
    async (url: string, sessionId: number) => {
      const video = videoRef.current
      if (!video) return
      const { default: HlsLib } = await import("hls.js")
      if (sessionId !== sessionRef.current) return

      if (HlsLib.isSupported()) {
        const hls = new HlsLib({ enableWorker: true, lowLatencyMode: true, maxBufferLength: 20 })
        hlsRef.current = hls
        hls.on(HlsLib.Events.FRAG_LOADED, (_event, data) => {
          const stats = data.frag.stats
          const duration = data.frag.duration
          const loadMs = Math.max(0, stats.loading.end - stats.loading.start)
          if (duration > 0 && stats.total > 0) {
            const mbps = (stats.total * 8) / duration / 1_000_000
            const previous = fragRef.current.bitrateMbps
            fragRef.current.bitrateMbps = previous === null ? mbps : previous * 0.6 + mbps * 0.4
            fragRef.current.duration = duration
          }
          fragRef.current.loadMs = [...fragRef.current.loadMs, loadMs].slice(-10)
        })
        hls.on(HlsLib.Events.MANIFEST_PARSED, () => safePlay(video))
        hls.on(HlsLib.Events.ERROR, (_event, data) => {
          if (data.fatal) enterFallback(sessionId, `HLS 拉流失败（${data.details}）`)
        })
        hls.loadSource(url)
        hls.attachMedia(video)
        return
      }
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        playDirect(url)
        return
      }
      throw new Error("当前浏览器不支持 HLS 播放")
    },
    [enterFallback, playDirect],
  )

  const connectWhep = React.useCallback(
    async (url: string, sessionId: number) => {
      const video = videoRef.current
      if (!video) return
      if (typeof RTCPeerConnection === "undefined") throw new Error("当前浏览器不支持 WebRTC")

      const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] })
      pcRef.current = pc
      pc.addTransceiver("video", { direction: "recvonly" })
      pc.addTransceiver("audio", { direction: "recvonly" })
      pc.ontrack = (event) => {
        if (sessionId !== sessionRef.current) return
        video.srcObject = event.streams[0] ?? new MediaStream([event.track])
        safePlay(video)
      }
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed") enterFallback(sessionId, "WebRTC 连接失败")
      }

      await pc.setLocalDescription(await pc.createOffer())
      await waitForIceGathering(pc, 1500)
      const sdp = pc.localDescription?.sdp
      if (!sdp) throw new Error("无法生成 WHEP Offer")

      const controller = new AbortController()
      const abortId = window.setTimeout(() => controller.abort(), 6000)
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/sdp" },
          body: sdp,
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(`WHEP 信令返回 HTTP ${response.status}`)
        const answer = await response.text()
        if (sessionId !== sessionRef.current) return
        await pc.setRemoteDescription({ type: "answer", sdp: answer })
      } finally {
        window.clearTimeout(abortId)
      }
    },
    [enterFallback],
  )

  const connect = React.useCallback(
    async (config: LiveStreamConfig) => {
      const video = videoRef.current
      if (!video) return
      const sessionId = ++sessionRef.current
      teardown()
      resetStats()
      fallbackActiveRef.current = false
      activeProtocolRef.current = config.protocol
      startedAtRef.current = performance.now()
      setActiveProtocol(config.protocol)

      const url = config.url.trim()
      if (!url) {
        setPhase("error")
        setMessage("请先填写流地址")
        return
      }

      setPhase("connecting")
      setMessage(`正在通过 ${PROTOCOL_META[config.protocol].short} 拉流…`)
      timeoutRef.current = window.setTimeout(
        () => enterFallback(sessionId, `拉流超时（>${CONNECT_TIMEOUT_MS / 1000}s）`),
        CONNECT_TIMEOUT_MS,
      )

      try {
        if (config.protocol === "WEBRTC") {
          await connectWhep(url, sessionId)
        } else if (config.protocol === "MP4") {
          playDirect(url)
        } else if (/^rtsp:/i.test(url)) {
          throw new Error("浏览器无法直接解码 rtsp://，请填写网关转码后的 HLS 地址")
        } else if (/\.m3u8(\?|#|$)/i.test(url)) {
          await connectHls(url, sessionId)
        } else {
          playDirect(url)
        }
      } catch (error) {
        enterFallback(sessionId, error instanceof Error ? error.message : "拉流失败")
      }
    },
    [connectHls, connectWhep, enterFallback, playDirect, resetStats, teardown],
  )

  const disconnect = React.useCallback(() => {
    sessionRef.current += 1
    teardown()
    resetStats()
    fallbackActiveRef.current = false
    setPhase("idle")
    setMessage("连接已断开")
  }, [resetStats, teardown])

  React.useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const onPlaying = () => {
      if (firstFrameMsRef.current === null) {
        firstFrameMsRef.current = performance.now() - startedAtRef.current
      }
      window.clearTimeout(timeoutRef.current)
      setPhase((current) => {
        if (current !== "connecting") return current
        return fallbackActiveRef.current ? "fallback" : "live"
      })
      setMessage((current) => (fallbackActiveRef.current ? current : "拉流成功，画面实时播放中"))
    }
    const onError = () => {
      if (!video.getAttribute("src") && !video.srcObject) return
      enterFallback(sessionRef.current, "媒体资源加载失败")
    }

    video.addEventListener("playing", onPlaying)
    video.addEventListener("error", onError)
    return () => {
      video.removeEventListener("playing", onPlaying)
      video.removeEventListener("error", onError)
    }
  }, [enterFallback])

  React.useEffect(() => {
    return () => {
      sessionRef.current += 1
      teardown()
    }
  }, [teardown])

  React.useEffect(() => {
    const video = videoRef.current
    if (!collectQos || !video || typeof video.requestVideoFrameCallback !== "function") return
    let handle = 0
    let lastAt = 0
    const onFrame = (now: DOMHighResTimeStamp) => {
      if (lastAt) {
        const gap = now - lastAt
        if (gap < MAX_FRAME_GAP_MS) {
          intervalsRef.current.push(gap)
          if (intervalsRef.current.length > 120) intervalsRef.current.shift()
        }
      }
      lastAt = now
      handle = video.requestVideoFrameCallback(onFrame)
    }
    handle = video.requestVideoFrameCallback(onFrame)
    return () => video.cancelVideoFrameCallback(handle)
  }, [collectQos])

  React.useEffect(() => {
    if (!collectQos || (phase !== "live" && phase !== "fallback")) return
    let cancelled = false

    const readRtp = async () => {
      const pc = pcRef.current
      if (!pc) return
      try {
        const report = await pc.getStats()
        report.forEach((entry: Record<string, unknown>) => {
          if (entry.type !== "inbound-rtp" || entry.kind !== "video") return
          const bytes = Number(entry.bytesReceived ?? 0)
          const received = Number(entry.packetsReceived ?? 0)
          const lost = Number(entry.packetsLost ?? 0)
          const now = performance.now()
          const previous = rtpRef.current
          const bitrate =
            previous.at > 0 && now > previous.at
              ? ((bytes - previous.bytes) * 8) / ((now - previous.at) / 1000) / 1_000_000
              : null
          rtpRef.current = {
            bytes,
            at: now,
            bitrateMbps: bitrate !== null && bitrate >= 0 ? bitrate : previous.bitrateMbps,
            jitterMs: typeof entry.jitter === "number" ? entry.jitter * 1000 : previous.jitterMs,
            lossPct: received + lost > 0 ? (Math.max(0, lost) / (received + lost)) * 100 : 0,
          }
        })
      } catch {
        // Stats are optional; the decoder-based fallback metrics still apply.
      }
    }

    const tick = async () => {
      const video = videoRef.current
      if (!video || video.paused || video.readyState < 2) return
      const quality = typeof video.getVideoPlaybackQuality === "function" ? video.getVideoPlaybackQuality() : null
      const total = quality?.totalVideoFrames ?? 0
      const dropped = quality?.droppedVideoFrames ?? 0
      const now = performance.now()
      const last = lastTickRef.current
      lastTickRef.current = { at: now, total }
      if (last.at === 0 || now <= last.at) return

      await readRtp()
      if (cancelled) return

      const fps = Math.max(0, (total - last.total) / ((now - last.at) / 1000))
      const rtp = rtpRef.current
      const frag = fragRef.current
      let bitrate: number
      let bitrateSource: StreamQosMetrics["bitrateSource"] = "measured"
      if (rtp.bitrateMbps !== null) {
        bitrate = rtp.bitrateMbps
      } else if (frag.bitrateMbps !== null) {
        bitrate = frag.bitrateMbps
      } else {
        bitrate = optionsRef.current.nominalBitrate * (0.96 + Math.random() * 0.08)
        bitrateSource = "estimated"
      }
      const jitter = rtp.jitterMs ?? stddev(intervalsRef.current)

      const samples = [...samplesRef.current, { fps, jitter, bitrate }].slice(-SERIES_LENGTH)
      samplesRef.current = samples
      const targetFps = nearestStandardFps(median(samples.map((s) => s.fps)))
      const gopSeconds = frag.duration > 0 ? frag.duration : 2

      setMetrics({
        bitrateMbps: Math.round(bitrate * 100) / 100,
        fps: Math.round(fps * 10) / 10,
        targetFps,
        droppedFrames: dropped,
        totalFrames: total,
        jitterMs: Math.round(jitter * 10) / 10,
        gopSeconds: Math.round(gopSeconds * 10) / 10,
        gopFrames: Math.round(gopSeconds * targetFps),
        bitrateSource,
      })
      setSeries((prev) => ({
        bitrate: appendSeries(prev.bitrate, bitrate),
        fps: appendSeries(prev.fps, fps),
        jitter: appendSeries(prev.jitter, jitter),
      }))
    }

    const id = window.setInterval(() => void tick(), 1000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [collectQos, phase])

  const getSnapshot = React.useCallback((): QosSnapshot => {
    const recent = samplesRef.current.slice(-6)
    const video = videoRef.current
    const quality =
      video && typeof video.getVideoPlaybackQuality === "function" ? video.getVideoPlaybackQuality() : null
    const hls = hlsRef.current
    const level = hls ? hls.levels[hls.currentLevel >= 0 ? hls.currentLevel : 0] : undefined
    const fps = recent.map((s) => s.fps)
    return {
      protocol: activeProtocolRef.current,
      usedFallback: fallbackActiveRef.current,
      samples: recent.length,
      fpsAvg: average(fps),
      targetFps: nearestStandardFps(median(fps)),
      droppedFrames: quality?.droppedVideoFrames ?? 0,
      totalFrames: quality?.totalVideoFrames ?? 0,
      jitterAvgMs: average(recent.map((s) => s.jitter)),
      firstFrameMs: firstFrameMsRef.current ?? 0,
      fragLoadMs: average(fragRef.current.loadMs),
      videoCodec: level?.videoCodec,
      audioCodec: level?.audioCodec,
      resolution: level?.width
        ? `${level.width}x${level.height}`
        : video?.videoWidth
          ? `${video.videoWidth}x${video.videoHeight}`
          : "未知",
      rtpLossPct: rtpRef.current.lossPct,
    }
  }, [])

  return { videoRef, phase, message, activeProtocol, metrics, series, connect, disconnect, getSnapshot }
}
