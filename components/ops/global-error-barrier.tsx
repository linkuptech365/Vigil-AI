"use client"

import { useEffect } from "react"

/**
 * 静默浏览器内部产生的、既无 message 也无 error/reason 的"幽灵"全局错误。
 *
 * 刻意使用冒泡阶段（不使用 capture）：<video>/<img> 的资源加载失败事件不会冒泡到 window，
 * 因此不会被这里拦截，组件自身的 onError 回退逻辑（直播流回退、海报帧回退等）不受影响。
 */
export function GlobalErrorBarrier() {
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      if (event.target !== window) return
      if (!event.message && !event.error) {
        event.stopImmediatePropagation()
        event.preventDefault()
      }
    }

    const handleRejection = (event: PromiseRejectionEvent) => {
      if (!event.reason) {
        event.preventDefault()
      }
    }

    window.addEventListener("error", handleError)
    window.addEventListener("unhandledrejection", handleRejection)

    return () => {
      window.removeEventListener("error", handleError)
      window.removeEventListener("unhandledrejection", handleRejection)
    }
  }, [])

  return null
}
