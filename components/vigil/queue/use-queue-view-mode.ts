"use client"

import * as React from "react"

import { QUEUE_VIEW_MODE_KEY, type QueueViewMode } from "@/lib/vigil/video-source"

export function useQueueViewMode() {
  const [mode, setModeState] = React.useState<QueueViewMode>("grid")

  React.useEffect(() => {
    try {
      const saved = window.localStorage.getItem(QUEUE_VIEW_MODE_KEY)
      if (saved === "grid" || saved === "table") setModeState(saved)
    } catch {
      // 隐私模式下沿用默认的监控矩阵视图
    }
  }, [])

  const setMode = React.useCallback((next: QueueViewMode) => {
    setModeState(next)
    try {
      window.localStorage.setItem(QUEUE_VIEW_MODE_KEY, next)
    } catch {
      // 隐私模式下仅在当前页面生效
    }
  }, [])

  return [mode, setMode] as const
}
