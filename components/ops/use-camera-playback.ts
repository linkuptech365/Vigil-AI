"use client"

import * as React from "react"

export type PlaybackStatus = "loading" | "ready" | "fallback"

interface SavedPlayback {
  time: number
  playing: boolean
  muted: boolean
}

/** Survives tile remounts (tab switches, layout changes) so playback resumes where it was. */
const savedPlayback = new Map<string, SavedPlayback>()

const TICK_MS = 200
const LOAD_TIMEOUT_MS = 8000

interface Options {
  cameraId: string
  duration: number
  /** True while the tile is hidden; playback is paused to save decoding. */
  suspended: boolean
}

export function useCameraPlayback({ cameraId, duration, suspended }: Options) {
  const videoRef = React.useRef<HTMLVideoElement>(null)
  const [initial] = React.useState(() => savedPlayback.get(cameraId))
  const [time, setTime] = React.useState(initial?.time ?? 0)
  const [playing, setPlaying] = React.useState(initial?.playing ?? true)
  const [muted, setMuted] = React.useState(initial?.muted ?? true)
  const [status, setStatus] = React.useState<PlaybackStatus>("loading")

  const timeRef = React.useRef(time)
  const pendingSeek = React.useRef<number | null>(initial ? initial.time : null)
  const latest = React.useRef({ playing, muted })

  React.useEffect(() => {
    latest.current = { playing, muted }
  }, [playing, muted])

  React.useEffect(
    () => () => {
      savedPlayback.set(cameraId, { time: timeRef.current, ...latest.current })
    },
    [cameraId]
  )

  const markReady = React.useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (pendingSeek.current !== null) {
      video.currentTime = pendingSeek.current
      pendingSeek.current = null
    } else if (Math.abs(video.currentTime - timeRef.current) > 0.5) {
      video.currentTime = timeRef.current
    }
    setStatus("ready")
  }, [])

  // The file may finish loading before hydration attaches onLoadedData.
  React.useEffect(() => {
    const video = videoRef.current
    if (video && video.readyState >= 2) markReady()
  }, [markReady])

  React.useEffect(() => {
    if (status !== "loading") return
    const id = window.setTimeout(() => setStatus((s) => (s === "loading" ? "fallback" : s)), LOAD_TIMEOUT_MS)
    return () => window.clearTimeout(id)
  }, [status])

  React.useEffect(() => {
    const video = videoRef.current
    if (video) video.muted = muted
  }, [muted])

  React.useEffect(() => {
    const video = videoRef.current
    if (!video || status === "fallback") return
    if (playing && !suspended) {
      // AbortError ("interrupted by a new load request") is benign, so every rejection is swallowed.
      video.play().catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "NotAllowedError") setPlaying(false)
      })
    } else {
      video.pause()
    }
  }, [playing, suspended, status])

  React.useEffect(() => {
    if (!playing || suspended || status === "loading") return
    const id = window.setInterval(() => {
      let next: number
      if (status === "ready") {
        const video = videoRef.current
        if (!video || video.paused) return
        next = video.currentTime
      } else {
        next = (timeRef.current + TICK_MS / 1000) % duration
      }
      if (Math.abs(next - timeRef.current) < 0.01) return
      timeRef.current = next
      setTime(next)
    }, TICK_MS)
    return () => window.clearInterval(id)
  }, [playing, suspended, status, duration])

  const seek = React.useCallback(
    (seconds: number) => {
      const next = Math.min(Math.max(seconds, 0), duration - 0.05)
      timeRef.current = next
      setTime(next)
      const video = videoRef.current
      if (video && video.readyState >= 1) video.currentTime = next
      else pendingSeek.current = next
    },
    [duration]
  )

  const toggle = React.useCallback(() => setPlaying((p) => !p), [])
  const toggleMute = React.useCallback(() => setMuted((m) => !m), [])
  const markFailed = React.useCallback(() => setStatus("fallback"), [])

  return {
    videoRef,
    time,
    playing,
    muted,
    status,
    seek,
    toggle,
    toggleMute,
    onLoadedData: markReady,
    onError: markFailed,
  }
}
