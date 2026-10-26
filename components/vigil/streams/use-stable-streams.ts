"use client"

import * as React from "react"

import type { StreamView } from "@/lib/vigil/streams"

/**
 * 服务端连续上报 offline 超过该时长（轮询间隔 5 秒，约等于连续 3 次探活失败）后，
 * 前端才把通道判定为离线；在此之前保持画面并显示“连接重试中”。
 */
export const OFFLINE_GRACE_MS = 15_000

export interface StableStreams {
  streams: StreamView[]
  /** 服务端已报告离线、但仍处于容错期的通道 */
  reconnectingIds: ReadonlySet<string>
}

const NO_IDS: ReadonlySet<string> = new Set()

export function useStableStreams(streams: StreamView[]): StableStreams {
  const [offlineSince, setOfflineSince] = React.useState<Record<string, number>>({})
  const [now, setNow] = React.useState(() => Date.now())

  React.useEffect(() => {
    const at = Date.now()
    // 离线起始时间需要在“数据到达”这一刻用 Date.now() 记录，渲染期间不能读取时钟，所以只能在 effect 里同步
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOfflineSince((prev) => {
      const next: Record<string, number> = {}
      for (const stream of streams) {
        if (stream.status === "offline") next[stream.id] = prev[stream.id] ?? at
      }
      const keys = Object.keys(next)
      const unchanged = keys.length === Object.keys(prev).length && keys.every((key) => prev[key] === next[key])
      return unchanged ? prev : next
    })
  }, [streams])

  const waiting = Object.values(offlineSince).some((since) => now - since < OFFLINE_GRACE_MS)
  React.useEffect(() => {
    if (!waiting) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [waiting])

  return React.useMemo(() => {
    if (!streams.some((stream) => stream.status === "offline")) return { streams, reconnectingIds: NO_IDS }
    const reconnecting = new Set<string>()
    const stable = streams.map((stream) => {
      if (stream.status !== "offline") return stream
      // 首次渲染到该通道离线时 offlineSince 还没记录（effect 尚未执行），同样视为容错期，避免闪一帧“离线”
      const since = offlineSince[stream.id]
      if (since !== undefined && now - since >= OFFLINE_GRACE_MS) return stream
      reconnecting.add(stream.id)
      return { ...stream, status: "online" as const }
    })
    return { streams: stable, reconnectingIds: reconnecting }
  }, [streams, offlineSince, now])
}
